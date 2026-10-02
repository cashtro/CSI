// Grant what a paid Stripe Checkout session bought, exactly once.
//
// Both the signed webhook and the success_url redirect handlers call
// fulfillCheckoutSession() with a session retrieved from Stripe, so whichever
// arrives first does the work and the other (or any replay of the redirect
// URL) is a no-op. The `fulfill:<session id>` key is claimed in the
// fulfillments ledger before granting and released if granting fails, so a
// failed attempt can be retried instead of leaving a paid order stuck.
//
// Grants run with the service client: the buyer's JWT is no longer stored in
// temp_access_tokens, and the client never writes Entry / cours_students /
// rendez_vous / bills itself.

const { createSupabaseAdmin } = require('./supabaseUtil');
const logger = require('./logger');
const { claimFulfillment, releaseFulfillment } = require('./fulfillment');
const { slotWasClaimed, sumEntryCounts } = require('./booking');
const { sendEmail } = require('./emailService');

// What a session paid for, from the metadata each checkout sets.
function kindOf(session) {
  const m = session.metadata || {};
  if (m.type === 'lottery_entry') return 'lottery_entry';
  if (m.type === 'product') return 'product';
  if (m.type === 'achat') return 'achat';
  if (m.type === 'robot') return 'robot';
  if (m.disponibilite_id) return 'rendez_vous';
  if (m.course_id) return session.mode === 'subscription' ? 'subscription' : 'course';
  return 'unknown';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function insertBill(admin, userId, source, session) {
  const { error } = await admin.from('bills').insert({ user_id: userId, source, payment_data: session });
  if (error) throw new Error(`bill insert failed: ${error.message}`);
}

// Run the last step of a grant; if it fails, undo the earlier writes so the
// released claim can be retried from a clean state.
async function orUndo(step, undo) {
  try {
    await step();
  } catch (err) {
    try {
      await undo();
    } catch (undoErr) {
      logger.error('[fulfill] undo failed:', undoErr.message);
    }
    throw err;
  }
}

async function grantRendezVous(admin, session) {
  const { disponibilite_id: dispoId, id_eleve: idEleve } = session.metadata;
  // Only the payer that flips taken=false -> true gets the slot.
  const { data: claimed, error: claimError } = await admin
    .from('disponibilites')
    .update({ taken: true })
    .eq('id', dispoId)
    .eq('taken', false)
    .select('id');
  if (claimError) throw claimError;
  if (!slotWasClaimed(claimed)) {
    logger.error(`[fulfill] slot ${dispoId} already booked; payment ${session.payment_intent} needs a refund.`);
    return { status: 'slot_taken' };
  }
  const freeSlot = () => admin.from('disponibilites').update({ taken: false }).eq('id', dispoId);
  const { data: rdv, error } = await admin
    .from('rendez_vous')
    .insert([{ disponibilite_id: dispoId, id_eleve: idEleve, payment_id: session.payment_intent }])
    .select('id')
    .single();
  if (error) {
    await freeSlot();
    throw error;
  }
  await orUndo(
    () => insertBill(admin, idEleve, `rendez_vous:${rdv.id}`, session),
    async () => {
      await admin.from('rendez_vous').delete().eq('id', rdv.id);
      await freeSlot();
    },
  );
  return { status: 'granted', id: rdv.id };
}

async function grantCourse(admin, session) {
  const { course_id: courseId, student_id: studentId } = session.metadata;
  const { data: existing } = await admin
    .from('cours_students')
    .select('id')
    .eq('cours_id', courseId)
    .eq('student_id', studentId)
    .maybeSingle();
  let enrollmentId = existing?.id;
  const created = !enrollmentId;
  if (created) {
    const { data, error } = await admin
      .from('cours_students')
      .insert([{ cours_id: courseId, student_id: studentId }])
      .select('id')
      .single();
    if (error) throw error;
    enrollmentId = data.id;
  }
  await orUndo(
    () => insertBill(admin, studentId, `course:${enrollmentId}`, session),
    async () => {
      if (created) await admin.from('cours_students').delete().eq('id', enrollmentId);
    },
  );
  return { status: 'granted', id: enrollmentId };
}

async function grantLotteryEntry(admin, session) {
  const { lotteryId, userId } = session.metadata;
  const quantity = parseInt(session.metadata.entryQuantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('invalid entryQuantity in metadata');

  const { data: lottery } = await admin
    .from('Lottery')
    .select('lotteryTime, isActive')
    .eq('lotteryId', lotteryId)
    .single();
  if (!lottery) throw new Error('lottery not found');
  if (!lottery.isActive || new Date(lottery.lotteryTime) <= new Date()) {
    logger.error(`[fulfill] lottery ${lotteryId} closed; payment ${session.payment_intent} needs a refund.`);
    return { status: 'lottery_closed' };
  }

  const { data: entry } = await admin
    .from('Entry')
    .select('entryCount')
    .match({ lotteryId, userId })
    .maybeSingle();
  const before = entry ? entry.entryCount || 0 : null;
  const setCount = (count) =>
    before === null && count === null
      ? admin.from('Entry').delete().match({ lotteryId, userId })
      : admin.from('Entry').update({ entryCount: count }).match({ lotteryId, userId });
  const refreshTotal = async () => {
    const { data: all, error: sumError } = await admin.from('Entry').select('entryCount').eq('lotteryId', lotteryId);
    if (sumError) throw sumError;
    const { error: totalError } = await admin
      .from('Lottery')
      .update({ totalEntries: sumEntryCounts(all) })
      .eq('lotteryId', lotteryId);
    if (totalError) throw totalError;
  };

  const { error: entryError } = entry
    ? await setCount(before + quantity)
    : await admin.from('Entry').insert({ lotteryId, userId, entryCount: quantity });
  if (entryError) throw entryError;

  await orUndo(
    async () => {
      await refreshTotal();
      await insertBill(admin, userId, `lottery:${lotteryId}`, session);
    },
    async () => {
      await setCount(before);
      await refreshTotal();
    },
  );
  return { status: 'granted', id: lotteryId };
}

async function grantProduct(admin, session) {
  const { lotteryId, userId, quantity, size, productPrice } = session.metadata;
  const { data: product } = await admin.from('Lottery').select('nomProduit, price').eq('lotteryId', lotteryId).single();
  if (!product) throw new Error('product not found');

  await insertBill(admin, userId === 'anonymous' ? null : userId, `product:${lotteryId}`, session);

  const address = session.shipping_details?.address || session.collected_information?.shipping_details?.address;
  const addressHtml = address?.line1
    ? [address.line1, address.line2, `${address.city || ''}, ${address.state || ''} ${address.postal_code || ''}`, address.country]
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '<p>No shipping address provided.</p>';
  // sendEmail logs its own failures; the order is recorded either way.
  await sendEmail(
    process.env.OWNER_EMAIL,
    'Pandora Brand Product Purchase',
    `
      <div style="font-family: 'Poppins', sans-serif; background-color: #0e0e0e; padding: 40px; border-radius: 24px; max-width: 600px; margin: auto; color: #855e1b;">
        <h1 style="font-family: 'Cinzel', serif; font-size: 28px; margin-bottom: 20px; color: #855e1b;">New Product Purchase</h1>
        <p style="font-size: 16px; line-height: 1.6;">The product <strong>${escapeHtml(product.nomProduit)}</strong> has been purchased at full price.</p>
        <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Order Details:</h3>
        <p><strong>Quantity:</strong> ${escapeHtml(quantity)}</p>
        <p><strong>Size:</strong> ${escapeHtml(size || 'N/A')}</p>
        <p><strong>Price:</strong> $${escapeHtml(productPrice || product.price)}</p>
        <p><strong>Stripe session:</strong> ${escapeHtml(session.id)}</p>
        <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Buyer Information:</h3>
        <p><strong>Email:</strong> ${escapeHtml(session.customer_details?.email || 'Not provided')}</p>
        <h3 style="font-size: 20px; margin-top: 30px; color: #D4AF37;">Shipping Address:</h3>
        ${addressHtml}
        <p style="margin-top: 40px; font-size: 14px; color: #E6C373;">Please prepare the item for delivery.</p>
      </div>
    `,
  );
  return { status: 'granted', id: lotteryId };
}

// Shop item from the Achat table (achatsCRUD /purchase). Used to send an
// e-mail on every reload of the success URL and never on the webhook.
async function grantAchat(admin, session) {
  const { productId, quantity, size } = session.metadata;
  const { data: product } = await admin.from('Achat').select('title_item, price_item').eq('id_item', productId).maybeSingle();
  if (!product) throw new Error('achat product not found');

  await insertBill(admin, null, `achat:${productId}`, session);

  const address = session.shipping_details?.address || session.collected_information?.shipping_details?.address;
  const addressHtml = address?.line1
    ? [address.line1, address.line2, `${address.city || ''}, ${address.state || ''} ${address.postal_code || ''}`, address.country]
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '<p>No shipping address provided.</p>';
  await sendEmail(
    process.env.OWNER_EMAIL,
    'Pandora Brand Achat Product Purchase',
    `
      <h1>New Achat Product Purchase</h1>
      <p>The product <strong>${escapeHtml(product.title_item)}</strong> has been purchased.</p>
      <h3>Order Details:</h3>
      <p><strong>Quantity:</strong> ${escapeHtml(quantity)}</p>
      <p><strong>Size:</strong> ${escapeHtml(size || 'N/A')}</p>
      <p><strong>Price:</strong> $${escapeHtml(product.price_item)}</p>
      <p><strong>Stripe session:</strong> ${escapeHtml(session.id)}</p>
      <h3>Buyer Information:</h3>
      <p><strong>Email:</strong> ${escapeHtml(session.customer_details?.email || 'Not provided')}</p>
      <h3>Shipping Address:</h3>
      ${addressHtml}
      <p>Please prepare the item for delivery.</p>
    `,
  );
  return { status: 'granted', id: productId };
}

// Robot subscription (routes(api)/robotsCRUD.js, ROBOTS.md): one robots_actifs
// row per Stripe subscription. The company and the robot come from the
// metadata the server itself set when it created the session.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stripeId = (v) => (typeof v === 'string' ? v : (v && typeof v.id === 'string' ? v.id : null));

async function grantRobot(admin, session) {
  const { entreprise_id: entrepriseId, robot, user_id: userId } = session.metadata;
  if (!UUID_RE.test(String(entrepriseId)) || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(String(robot))) throw new Error('invalid robot metadata');
  const { data: offre, error: offreError } = await admin.from('robots_offres').select('slug').eq('slug', robot).maybeSingle();
  if (offreError) throw offreError;
  if (!offre) throw new Error(`robot ${robot} not found`);
  const { data: entreprise, error: entError } = await admin.from('entreprises').select('id').eq('id', entrepriseId).maybeSingle();
  if (entError) throw entError;
  if (!entreprise) throw new Error('entreprise not found');

  const subscriptionId = stripeId(session.subscription);
  const customerId = stripeId(session.customer);
  const now = new Date().toISOString();
  if (subscriptionId) {
    const { data: same } = await admin.from('robots_actifs').select('id').eq('stripe_subscription_id', subscriptionId).maybeSingle();
    if (same) return { status: 'granted', id: same.id };
  }
  const { data: rowsOfRobot, error: readError } = await admin.from('robots_actifs').select('*').eq('entreprise_id', entrepriseId).eq('robot', robot);
  if (readError) throw readError;
  const vivant = (rowsOfRobot || []).find((r) => r.statut !== 'annule');
  let id;
  let undo;
  if (vivant) {
    // A second checkout for a robot that is already live (two tabs): keep one
    // row, point it at the newest subscription, and flag the other one.
    if (vivant.stripe_subscription_id && vivant.stripe_subscription_id !== subscriptionId) {
      logger.warn(`[fulfill] robot ${robot}: entreprise ${entrepriseId} has two subscriptions (${vivant.stripe_subscription_id}, ${subscriptionId}); cancel one in Stripe.`);
    }
    const before = { statut: vivant.statut, stripe_subscription_id: vivant.stripe_subscription_id, stripe_customer_id: vivant.stripe_customer_id };
    const { error } = await admin.from('robots_actifs')
      .update({ statut: 'actif', stripe_subscription_id: subscriptionId, stripe_customer_id: customerId, updated_at: now })
      .eq('id', vivant.id);
    if (error) throw error;
    id = vivant.id;
    undo = () => admin.from('robots_actifs').update(before).eq('id', id);
  } else {
    const { data, error } = await admin.from('robots_actifs')
      .insert({
        entreprise_id: entrepriseId, robot, statut: 'actif', stripe_subscription_id: subscriptionId, stripe_customer_id: customerId,
        depuis: now, reglages: {}, created_by: UUID_RE.test(String(userId)) ? userId : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    id = data.id;
    undo = () => admin.from('robots_actifs').delete().eq('id', id);
  }
  await orUndo(() => insertBill(admin, UUID_RE.test(String(userId)) ? userId : null, `robot:${robot}`, session), undo);
  // Push to the admins (PWA.md): a new paying client. Never blocks the grant.
  if (!vivant) {
    const notifications = require('./notifications');
    notifications.enArrierePlan((async () => {
      const { data: ent } = await admin.from('entreprises').select('nom').eq('id', entrepriseId).maybeSingle();
      return notifications.robotActive(admin, { robot, entreprise: ent && ent.nom });
    })());
  }
  return { status: 'granted', id };
}

const GRANTS = {
  achat: grantAchat,
  robot: grantRobot,
  rendez_vous: grantRendezVous,
  course: grantCourse,
  subscription: grantCourse,
  lottery_entry: grantLotteryEntry,
  product: grantProduct,
};

/**
 * @param {object} session a Checkout Session retrieved from (or signed by) Stripe
 * @returns {Promise<{status:string, kind:string, id?:string}>}
 *   status: granted | already_fulfilled | not_paid | slot_taken | lottery_closed | unknown
 *   Throws when the ledger or a grant fails (the claim is released first).
 */
async function fulfillCheckoutSession(session) {
  const kind = kindOf(session);
  // A subscription started with a free trial or a 100 % coupon has nothing to
  // pay yet, but it is a real subscription (robots only).
  const paid = session.payment_status === 'paid' || (kind === 'robot' && session.payment_status === 'no_payment_required');
  if (!paid) return { status: 'not_paid', kind };
  const grant = GRANTS[kind];
  if (!grant) return { status: 'unknown', kind };

  const key = `fulfill:${session.id}`;
  const claim = await claimFulfillment(key, kind);
  if (claim.alreadyProcessed) return { status: 'already_fulfilled', kind };
  if (!claim.claimed) throw new Error(`fulfillment ledger unavailable: ${claim.error?.message || 'unknown'}`);

  try {
    return { kind, ...(await grant(createSupabaseAdmin(), session)) };
  } catch (err) {
    await releaseFulfillment(key);
    throw err;
  }
}

module.exports = { fulfillCheckoutSession, kindOf, escapeHtml };
