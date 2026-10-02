// Signed Stripe webhook receiver.
//
// Fixes the core payment-integrity gap: today fulfillment runs ONLY when the
// browser returns to `success_url` (a GET verify handler). If the tab closes,
// the payment is captured but nothing is recorded. This endpoint receives
// Stripe's server-to-server events, verifies their signature, and fulfils the
// session through utils/fulfill (idempotent, shared with the redirect path).
//
// MUST be mounted with a RAW body parser (see server.js) so the signature can
// be verified against the exact bytes Stripe signed.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { fulfillCheckoutSession } = require('./utils/fulfill');

async function stripeWebhookHandler(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET not set — cannot verify events.');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      secret
    );
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Card payments arrive as completed+paid; delayed methods (e.g. bank debits)
    // complete unpaid and are fulfilled on async_payment_succeeded.
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const result = await fulfillCheckoutSession(session);
      console.log(`[webhook] ${event.type} ${session.id}: ${result.kind} ${result.status}`);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry; fulfillment released its claim, so the retry can grant.
    console.error('[webhook] fulfillment failed:', err.message);
    return res.status(500).json({ error: 'fulfillment_failed' });
  }
}

module.exports = { stripeWebhookHandler };
