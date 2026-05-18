// netlify/functions/get-config.js — FormGuard
//
// Returns runtime config to the client. Currently exposes the Stripe payment
// link URL so it can be swapped per-environment (test on staging, live on
// prod) via Netlify env vars without code changes.
//
// Same-origin GET — no auth, no CORS needed (called from index.html on the
// same Netlify site).

exports.handler = async function () {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      stripePaymentLinkUrl: process.env.STRIPE_PAYMENT_LINK_URL || null,
    }),
  };
};
