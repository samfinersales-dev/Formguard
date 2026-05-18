// netlify/functions/capture-lead.js — FormGuard
//
// Pre-payment email capture. Called via navigator.sendBeacon from the paywall
// when the user clicks the Unlock button with an email entered. Inserts a row
// into the Supabase `leads` table for the Phase 1 acquisition dataset.
//
// Public endpoint — no auth gate (it's just an email capture). Validates email
// format and silently no-ops on bad input or duplicate. Always returns 200 so
// the beacon never logs an error in the user's console as they navigate to Stripe.

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = [
  'https://uscisformcheck.com',
  'https://www.uscisformcheck.com',
];

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

// RFC-5322-ish: good enough to reject obvious garbage without rejecting valid edge cases
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false }) };
  }

  // Cap body to defend against abuse — a lead payload is tiny
  if (event.body && event.body.length > 2000) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const formType = typeof body.formType === 'string' ? body.formType.slice(0, 64) : null;
  const source = typeof body.source === 'string' ? body.source.slice(0, 32) : 'paywall';

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (supabase) {
    try {
      const { error: dbErr } = await supabase
        .from('leads')
        .insert({ email, form_type: formType, source });
      if (dbErr) console.error('[formguard-capture-lead] supabase insert error:', dbErr.message);
    } catch (err) {
      console.error('[formguard-capture-lead] capture failed:', err.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
