// netlify/functions/claude.js — FormGuard
//
// USCIS form analysis endpoint. Payment-gated: requires a paid Stripe session_id
// whose payment_link is in this product's allowlist. Without this gate, the
// endpoint can be abused as a free general-purpose Claude proxy.

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

exports.handler = async function (event) {
  const headers = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // 8MB cap on request body — prevents giant uploads racking up vision costs
  if (event.body && event.body.length > 8_000_000) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'Payload too large. Please upload a smaller image (max 6MB).' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, sessionId } = body;
  if (!messages || !messages.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No messages provided' }) };
  }

  // ─── PAYMENT GATE ────────────────────────────────────────────────────────
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return { statusCode: 402, headers, body: JSON.stringify({ error: 'Payment required' }) };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    if (err.type === 'StripeInvalidRequestError') {
      return { statusCode: 402, headers, body: JSON.stringify({ error: 'Invalid session' }) };
    }
    console.error('[formguard-claude] stripe.retrieve error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }

  if (session.payment_status !== 'paid') {
    return { statusCode: 402, headers, body: JSON.stringify({ error: 'Payment not completed' }) };
  }

  // Cross-product allowlist (this Stripe account is shared across 5 products)
  const allowlist = (process.env.STRIPE_PLINK_ALLOWLIST || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allowlist.length > 0) {
    if (!session.payment_link || !allowlist.includes(session.payment_link)) {
      console.log(
        `[formguard-claude] rejected — payment_link ${session.payment_link || '(none)'} ` +
        `not in allowlist; session=${sessionId.slice(0, 20)}`
      );
      return { statusCode: 402, headers, body: JSON.stringify({ error: 'Wrong product' }) };
    }
  } else {
    console.warn('[formguard-claude] STRIPE_PLINK_ALLOWLIST not set — accepting all paid sessions (UNSAFE)');
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[formguard-claude] ANTHROPIC_API_KEY not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[formguard-claude] Anthropic error:', response.status, JSON.stringify(data).slice(0, 200));
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Analysis service temporarily unavailable. Please try again.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: data.content }) };
  } catch (err) {
    console.error('[formguard-claude] error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
