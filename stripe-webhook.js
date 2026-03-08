const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const sig = event.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error("Missing stripe-signature header or STRIPE_WEBHOOK_SECRET env var");
    return { statusCode: 400, body: "Missing signature or secret" };
  }

  // ── Verify Stripe signature ────────────────────────────────
  let stripeEvent;
  try {
    stripeEvent = verifyStripeSignature(event.body, sig, secret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log("Stripe event received:", stripeEvent.type);

  // ── Handle events ──────────────────────────────────────────
  try {
    switch (stripeEvent.type) {

      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        const reportId = session.metadata?.report_id;
        const email    = session.customer_details?.email;
        console.log(`Payment complete — report: ${reportId}, email: ${email}`);
        // Mark the report as paid in your DB here if needed
        break;
      }

      case "payment_intent.succeeded": {
        const pi = stripeEvent.data.object;
        console.log(`PaymentIntent succeeded: ${pi.id}, amount: ${pi.amount}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }
  } catch (err) {
    console.error("Error processing event:", err.message);
    return { statusCode: 500, body: "Internal Server Error" };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// ── Manual Stripe signature verification (no SDK needed) ───
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts      = sigHeader.split(",");
  const timestamp  = parts.find(p => p.startsWith("t="))?.split("=")[1];
  const signatures = parts.filter(p => p.startsWith("v1=")).map(p => p.split("=")[1]);

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid stripe-signature header format");
  }

  // Reject webhooks older than 5 minutes (replay attack protection)
  const tolerance = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > tolerance) {
    throw new Error("Webhook timestamp too old — possible replay attack");
  }

  const signed    = `${timestamp}.${payload}`;
  const expected  = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  const match     = signatures.some(sig => safeCompare(sig, expected));

  if (!match) throw new Error("Stripe signature mismatch");

  return JSON.parse(payload);
}

// Timing-safe string comparison
function safeCompare(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
