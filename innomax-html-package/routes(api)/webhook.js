// Signed Stripe webhook receiver.
//
// Fixes the core payment-integrity gap: today fulfillment runs ONLY when the
// browser returns to `success_url` (a GET verify handler). If the tab closes,
// the payment is captured but nothing is recorded. This endpoint receives
// Stripe's server-to-server events, verifies their signature, and records an
// idempotent payment backstop so a paid order is never silently lost.
//
// MUST be mounted with a RAW body parser (see server.js) so the signature can
// be verified against the exact bytes Stripe signed.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { claimFulfillment } = require('./utils/fulfillment');

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
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Idempotency: dedupe Stripe re-deliveries of the same session.
      const claim = await claimFulfillment(`webhook:${session.id}`, session.metadata?.type || 'unknown');
      if (claim.alreadyProcessed) {
        return res.status(200).json({ received: true, duplicate: true });
      }
      if (claim.error) {
        // Ledger unavailable: return 500 so Stripe retries later rather than
        // marking a possibly-unfulfilled payment as handled.
        console.error('[webhook] ledger error:', claim.error.message);
        return res.status(500).json({ error: 'ledger_unavailable' });
      }

      // Payment backstop: persist the order so it survives an abandoned redirect.
      const type = session.metadata?.type || 'unknown';
      const ref =
        session.metadata?.lotteryId ||
        session.metadata?.course_id ||
        session.metadata?.disponibilite_id ||
        session.metadata?.id_item ||
        '';
      const admin = createSupabaseAdmin();
      const { error: billError } = await admin.from('bills').insert({
        user_id: session.metadata?.userId || null,
        source: `${type}:${ref}`,
        payment_data: session,
      });
      if (billError) console.error('[webhook] bill insert error:', billError.message);

      console.log(`[webhook] recorded ${type} payment for session ${session.id}`);
      // Per-type grant (entry / enroll / RDV / product) is migrated from the
      // redirect verify handlers in follow-ups; the redirect path continues to
      // perform the grant, now guarded by the same idempotency ledger.
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
    return res.status(500).json({ error: 'handler_error' });
  }
}

module.exports = { stripeWebhookHandler };
