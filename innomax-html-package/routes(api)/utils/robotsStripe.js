// Stripe for the robots (ROBOTS.md): the subscription Checkout, the billing
// portal, pause / resume, and the customer.subscription.* webhook events.
//
// The Stripe client is built on first use, so tests replace the 'stripe'
// module with a mock (jest.mock) and no key is ever needed in tests.

const logger = require('./logger');
const { createSupabaseAdmin } = require('./supabaseUtil');
const { claimFulfillment, releaseFulfillment } = require('./fulfillment');

let client;
function stripe() {
  if (!client) client = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return client;
}
function _reset() { client = null; }

const appUrl = () => String(process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const cents = (n) => Math.round(Number(n) * 100);

// Checkout Session parameters for a robot. The company and the robot are
// written by the server in the metadata (session AND subscription), so the
// webhook never trusts anything the browser sent.
function checkoutParams({ offre, entrepriseId, user }) {
  const metadata = { type: 'robot', entreprise_id: entrepriseId, robot: offre.slug, user_id: user.id };
  const product = { name: `Robot ${offre.nom}` };
  if (offre.pitch) product.description = String(offre.pitch).slice(0, 300);
  const lineItems = [
    offre.stripe_price_id
      ? { price: offre.stripe_price_id, quantity: 1 }
      : {
        price_data: {
          currency: 'cad',
          product_data: product,
          unit_amount: cents(offre.prix_mensuel),
          recurring: { interval: 'month', interval_count: 1 },
        },
        quantity: 1,
      },
  ];
  // One-time setup fee, billed on the first invoice.
  if (offre.prix_mise_en_place > 0) {
    lineItems.push({
      price_data: { currency: 'cad', product_data: { name: `Mise en place : ${offre.nom}` }, unit_amount: cents(offre.prix_mise_en_place) },
      quantity: 1,
    });
  }
  const params = {
    mode: 'subscription',
    line_items: lineItems,
    metadata,
    subscription_data: { metadata },
    client_reference_id: entrepriseId,
    locale: 'fr-CA',
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    success_url: `${appUrl()}/robots/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/robots?annule=${encodeURIComponent(offre.slug)}#robot-${offre.slug}`,
  };
  if (user.email) params.customer_email = user.email;
  return params;
}

async function createCheckout(args) {
  return stripe().checkout.sessions.create(checkoutParams(args));
}

async function retrieveCheckout(id) {
  return stripe().checkout.sessions.retrieve(String(id));
}

// Billing portal: manage the card, invoices, and cancel. With
// subscriptionId, the portal opens straight on the cancellation of that one.
async function createPortal({ customerId, subscriptionId = null, retour }) {
  const params = { customer: customerId, return_url: retour || `${appUrl()}/espace?vue=robots`, locale: 'fr-CA' };
  if (subscriptionId) {
    params.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscriptionId },
      after_completion: { type: 'redirect', redirect: { return_url: params.return_url } },
    };
  }
  return stripe().billingPortal.sessions.create(params);
}

// The customer portal cannot pause a subscription, so pause and resume use
// pause_collection directly (invoices are voided during the pause).
async function setPause(subscriptionId, pause) {
  return stripe().subscriptions.update(subscriptionId, { pause_collection: pause ? { behavior: 'void' } : '' });
}

// Stripe subscription -> robot status.
function statutDepuisStripe(sub, deleted = false) {
  if (deleted) return 'annule';
  if (['canceled', 'incomplete_expired'].includes(sub.status)) return 'annule';
  if (sub.pause_collection || ['paused', 'past_due', 'unpaid'].includes(sub.status)) return 'en_pause';
  if (['active', 'trialing'].includes(sub.status)) return 'actif';
  return null; // incomplete: keep the current status
}

const iso = (seconds) => (Number.isFinite(Number(seconds)) && seconds ? new Date(Number(seconds) * 1000).toISOString() : null);

// customer.subscription.updated / .deleted. Idempotent: each event id is
// claimed once in the fulfillments ledger; an older event never overwrites a
// newer one, and a cancelled robot never comes back to life.
async function syncRobotSubscription(event) {
  const sub = event.data && event.data.object;
  if (!sub || typeof sub.id !== 'string') return { status: 'ignored' };
  const key = `stripe_event:${event.id}`;
  const claim = await claimFulfillment(key, 'robot_subscription');
  if (claim.alreadyProcessed) return { status: 'already_processed' };
  if (!claim.claimed) throw new Error(`fulfillment ledger unavailable: ${claim.error && claim.error.message}`);
  try {
    const admin = createSupabaseAdmin();
    const { data: row, error } = await admin.from('robots_actifs').select('*').eq('stripe_subscription_id', sub.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      // Not a robot, or the checkout event has not arrived yet (the checkout
      // creates the row as active). Let a later delivery be applied.
      await releaseFulfillment(key);
      return { status: 'unknown_subscription' };
    }
    if (row.statut === 'annule') return { status: 'already_cancelled', id: row.id };
    const at = iso(event.created) || new Date().toISOString();
    if (row.stripe_event_at && Date.parse(at) < Date.parse(row.stripe_event_at)) return { status: 'stale', id: row.id };
    const deleted = event.type === 'customer.subscription.deleted';
    const statut = statutDepuisStripe(sub, deleted) || row.statut;
    const patch = {
      statut,
      annulation_prevue_le: !deleted && sub.cancel_at_period_end ? iso(sub.cancel_at || sub.current_period_end) : null,
      stripe_event_at: at,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await admin.from('robots_actifs').update(patch).eq('id', row.id);
    if (updateError) throw new Error(updateError.message);
    logger.info(`[robots] subscription ${sub.id}: ${row.statut} -> ${statut}`);
    return { status: 'updated', id: row.id, statut };
  } catch (err) {
    await releaseFulfillment(key);
    throw err;
  }
}

module.exports = {
  stripe, _reset, checkoutParams, createCheckout, retrieveCheckout, createPortal, setPause, statutDepuisStripe, syncRobotSubscription,
};
