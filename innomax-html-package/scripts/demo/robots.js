// Robots in the local demo (scripts/demo-admin.js, ROBOTS.md): the 6 starting
// robots, a client account (owner of the demo clinic) with two robots, a few
// tasks and deliverables, connections, and a FAKE Stripe: the checkout and
// the billing portal are simulated pages of the demo, nothing is charged.

const crypto = require('crypto');
const { ROBOTS_DEPART } = require('../../routes(api)/utils/robots');
const { ENT_A, ENT_B } = require('./data');

const CLIENT_ID = '00000000-0000-4000-8000-00000000c001';
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

function seedRobotsDemo(db) {
  const t = db.tables;
  t.Users.push({ userId: CLIENT_ID, email: 'proprio@horizon.demo', username: 'Julie (démo)', isAdmin: false });
  t.membres.push({ id: crypto.randomUUID(), entreprise_id: ENT_A, user_id: CLIENT_ID, role: 'proprietaire', created_at: ago(60 * 24 * 20) });
  t.robots_offres = ROBOTS_DEPART.map((o) => ({ ...o, stripe_price_id: null, created_at: ago(60 * 24 * 30), updated_at: ago(60 * 24 * 30) }));
  const redacteur = crypto.randomUUID();
  t.robots_actifs = [
    { id: redacteur, entreprise_id: ENT_A, robot: 'redacteur', statut: 'actif', stripe_subscription_id: 'sub_demo_a1', stripe_customer_id: 'cus_demo_a', depuis: ago(60 * 24 * 18), reglages: { consignes: 'Ton chaleureux, vouvoiement, jamais de promesse médicale.' }, created_at: ago(60 * 24 * 18) },
    { id: crypto.randomUUID(), entreprise_id: ENT_A, robot: 'receptionniste', statut: 'en_pause', stripe_subscription_id: 'sub_demo_a2', stripe_customer_id: 'cus_demo_a', depuis: ago(60 * 24 * 40), reglages: {}, created_at: ago(60 * 24 * 40) },
    { id: crypto.randomUUID(), entreprise_id: ENT_B, robot: 'seo-aeo', statut: 'actif', stripe_subscription_id: 'sub_demo_b1', stripe_customer_id: 'cus_demo_b', depuis: ago(60 * 24 * 6), reglages: {}, created_at: ago(60 * 24 * 6) },
    { id: crypto.randomUUID(), entreprise_id: ENT_B, robot: 'conseil', statut: 'actif', stripe_subscription_id: 'sub_demo_b2', stripe_customer_id: 'cus_demo_b', depuis: ago(60 * 24 * 3), reglages: {}, created_at: ago(60 * 24 * 3) },
  ];

  const robotJob = (min, status, demande, texte) => {
    const id = crypto.randomUUID();
    t.agent_jobs.push({
      id, kind: 'order', status, priority: 0, attempts: 1, max_attempts: 3, locked_by: null, locked_at: null, run_after: ago(min), error: null,
      cost_usd: 0.03, tokens_in: 2000, tokens_out: 1500, entreprise_id: ENT_A, robot: 'redacteur', created_by: CLIENT_ID,
      payload: { robot: 'redacteur', agent_id: 'contenu-strategie', instruction: 'Tâche de robot (démo)', client: { robot: 'Rédacteur de contenu', entreprise: 'Clinique Horizon (démo)', demande } },
      result: texte ? { protocole: 'ordre', agent: 'contenu-strategie', agent_name: 'Plume', texte } : null,
      created_at: ago(min), started_at: ago(min - 1), finished_at: status === 'done' ? ago(min - 2) : null, updated_at: ago(min - 2),
    });
    return id;
  };
  const j1 = robotJob(60 * 24 * 4, 'done', 'Article de blogue : 5 gestes pour un dos en santé au bureau.', '[Démo] 5 gestes pour un dos en santé au bureau\n\n1. Ajustez votre écran à la hauteur des yeux…\n\nÀ valider par un humain\n- Les conseils santé avec un professionnel');
  const j2 = robotJob(60 * 5, 'done', 'Trois publications Instagram pour la semaine de la prévention.', '[Démo] Trois publications Instagram\n\n1. « Saviez-vous que… » (carrousel)\n2. Vidéo de 20 s : l’équipe se présente\n3. Question du jour en story\n\nÀ valider par un humain\n- Le consentement des personnes filmées');
  robotJob(3, 'running', 'Infolettre de novembre : nouveautés et horaires des Fêtes.', null);

  t.livrables.push(
    { id: crypto.randomUUID(), entreprise_id: ENT_A, mandat_id: null, titre: '✍️ Rédacteur de contenu : Article « 5 gestes pour un dos en santé »', description: 'Demande : Article de blogue : 5 gestes pour un dos en santé au bureau.', contenu: t.agent_jobs.find((j) => j.id === j1).result.texte, url: null, produit_par: 'Robot Rédacteur de contenu (Plume)', statut: 'en_attente', robot: 'redacteur', job_id: j1, created_at: ago(60 * 24 * 3) },
    { id: crypto.randomUUID(), entreprise_id: ENT_A, mandat_id: null, titre: '✍️ Rédacteur de contenu : Trois publications Instagram', description: 'Demande : Trois publications Instagram pour la semaine de la prévention.', contenu: t.agent_jobs.find((j) => j.id === j2).result.texte, url: null, produit_par: 'Robot Rédacteur de contenu (Plume)', statut: 'a_valider', robot: 'redacteur', job_id: j2, created_at: ago(60 * 4) },
  );

  t.connexions = [
    { id: crypto.randomUUID(), entreprise_id: ENT_A, fournisseur: 'google_business', statut: 'connectee', portee: [], compte: null, jetons: null, consenti_par: CLIENT_ID, consenti_at: ago(60 * 24 * 17), created_at: ago(60 * 24 * 17), updated_at: ago(60 * 24 * 17) },
    { id: crypto.randomUUID(), entreprise_id: ENT_A, fournisseur: 'meta', statut: 'demandee', portee: [], compte: null, jetons: null, consenti_par: CLIENT_ID, consenti_at: ago(60 * 24), created_at: ago(60 * 24), updated_at: ago(60 * 24) },
    { id: crypto.randomUUID(), entreprise_id: ENT_B, fournisseur: 'shopify', statut: 'demandee', portee: [], compte: 'lumiere.myshopify.com', jetons: null, consenti_par: null, consenti_at: ago(60 * 30), created_at: ago(60 * 30), updated_at: ago(60 * 30) },
  ];
  t.connexions_etats = [];
  t.fulfillments = t.fulfillments || [];
  return { clientId: CLIENT_ID };
}

// Fake Stripe SDK: require('stripe')(key) returns this object in the demo.
function createFakeStripe() {
  const sessions = new Map();
  const api = {
    checkout: {
      sessions: {
        async create(params) {
          const id = `cs_demo_${crypto.randomBytes(8).toString('hex')}`;
          sessions.set(id, {
            id, object: 'checkout.session', mode: params.mode, metadata: params.metadata, payment_status: 'paid',
            subscription: `sub_demo_${crypto.randomBytes(5).toString('hex')}`, customer: 'cus_demo_nouveau', amount_total: 0, currency: 'cad',
          });
          return { id, url: `/demo/stripe/${id}` };
        },
        async retrieve(id) {
          const s = sessions.get(id);
          if (!s) throw new Error('No such checkout session (démo)');
          return s;
        },
      },
    },
    billingPortal: { sessions: { async create() { return { url: '/demo/stripe-portail' }; } } },
    subscriptions: { async update(id, p) { return { id, ...p }; } },
    webhooks: { constructEvent() { throw new Error('démo : pas de webhook'); } },
  };
  return () => api;
}

module.exports = { seedRobotsDemo, createFakeStripe, CLIENT_ID };
