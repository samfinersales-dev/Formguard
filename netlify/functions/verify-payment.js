// netlify/functions/verify-payment.js — FormGuard
//
// Verifies a Stripe Checkout session is paid before allowing content generation.
// The front-end passes session_id (from Stripe's success URL) and this function
// confirms with Stripe's API that the session was actually paid.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGINS = [
  'https://uscisformcheck.com',
  'https://www.uscisformcheck.com',
];

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(statusCode, body, headers) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  const headers = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, headers);
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON' }, headers);
  }

  const { session_id } = body;

  if (!session_id || typeof session_id !== 'string') {
    return jsonResponse(400, { paid: false, error: 'Missing session_id' }, headers);
  }

  if (!session_id.startsWith('cs_')) {
    return jsonResponse(400, { paid: false, error: 'Invalid session format' }, headers);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return jsonResponse(403, {
        paid: false,
        error: 'Session exists but payment not completed',
        status: session.payment_status,
      }, headers);
    }

    // ─── CROSS-PRODUCT SESSION GUARD ──────────────────────────────────────────
    const allowlist = (process.env.STRIPE_PLINK_ALLOWLIST || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const incomingPlink = session.payment_link || null;

    if (allowlist.length === 0) {
      console.warn('[formguard-verify-payment] STRIPE_PLINK_ALLOWLIST not set — accepting all paid sessions (UNSAFE)');
    } else if (!incomingPlink || !allowlist.includes(incomingPlink)) {
      console.log(
        `[formguard-verify-payment] rejected — payment_link ${incomingPlink || '(none)'} not in allowlist; ` +
        `session=${session_id.slice(0, 20)} email=${session.customer_details?.email || '(none)'}`
      );
      return jsonResponse(403, {
        paid: false,
        error: 'Session does not belong to this product',
      }, headers);
    }

    return jsonResponse(200, {
      paid: true,
      customer_email: session.customer_details?.email || null,
      amount: session.amount_total,
      currency: session.currency,
    }, headers);
  } catch (err) {
    if (err.type === 'StripeInvalidRequestError') {
      return jsonResponse(403, {
        paid: false,
        error: 'Session not found — payment not verified',
      }, headers);
    }
    console.error('[formguard-verify-payment] error:', err);
    return jsonResponse(500, { paid: false, error: 'Server error' }, headers);
  }
};
