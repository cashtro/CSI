// Robots clients (ROBOTS.md): the catalogue of agent offers, the robots a
// company pays for, their monthly task quota, and the data shown in /espace,
// /robots and the admin "Robots" tab.
//
// Every query runs with the service client; the company id always comes from
// the server-side membership lookup, never from the browser. RLS
// (db/006_robots.sql) is the second wall.

const { monthStart } = require('../../agents/budget');
const { AGENT_ID } = require('../../agents/catalog');
const logger = require('./logger');

const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
const PRICE_ID = /^price_[A-Za-z0-9]{3,200}$/;
const STATUTS = ['actif', 'en_pause', 'annule'];
const MODES = ['ordre', 'conseil'];
// Job statuses that use a task of the month (a cancelled or failed job does not).
const COMPTE_QUOTA = ['queued', 'running', 'done'];

// Starting catalogue. Prices are ESTIMATIONS in Canadian dollars (ROBOTS.md),
// to be set by the founder. Same list as the seed of db/006_robots.sql.
const ROBOTS_DEPART = [
  {
    slug: 'receptionniste', nom: 'Réceptionniste IA', emoji: '🧾',
    pitch: 'Elle répond à vos clients, trie vos courriels et prépare vos rendez-vous, même le soir.',
    fait: ['Prépare les réponses à vos courriels et messages', 'Propose des rendez-vous selon votre agenda', 'Résume les appels et les demandes du jour', 'Répond aux questions fréquentes avec vos infos'],
    pour_qui: 'Cliniques, salons, bureaux de services et commerces qui manquent de temps au téléphone.',
    prix_mensuel: 349, prix_mise_en_place: 499, agents: ['marketing-courriel', 'ventes-strategie'], equipes: ['marketing', 'ventes'],
    mode: 'ordre', quota_taches_mois: 200, actif: true, ordre: 10,
  },
  {
    slug: 'redacteur', nom: 'Rédacteur de contenu', emoji: '✍️',
    pitch: 'Vos articles de blogue, publications et infolettres, écrits dans votre ton, en français.',
    fait: ['Rédige des articles de blogue optimisés', 'Prépare un mois de publications pour vos réseaux', 'Écrit votre infolettre', 'Adapte vos textes en anglais au besoin'],
    pour_qui: 'PME qui veulent publier chaque semaine sans y passer leurs soirées.',
    prix_mensuel: 299, prix_mise_en_place: 299, agents: ['contenu-strategie', 'contenu-redaction', 'contenu-social', 'marketing-courriel'], equipes: ['contenu', 'marketing'],
    mode: 'ordre', quota_taches_mois: 30, actif: true, ordre: 20,
  },
  {
    slug: 'seo-aeo', nom: 'Agent SEO et AEO', emoji: '📈',
    pitch: 'Il fait monter votre site dans Google et dans les réponses des assistants IA.',
    fait: ['Audite vos pages et propose les corrections', 'Trouve les questions que vos clients posent', 'Rédige des pages et des FAQ pensées pour l’IA (AEO)', 'Suit vos positions chaque mois'],
    pour_qui: 'Entreprises locales et boutiques en ligne qui veulent être trouvées.',
    prix_mensuel: 399, prix_mise_en_place: 499, agents: ['marketing-seo', 'contenu-strategie', 'web-architecte'], equipes: ['marketing', 'web'],
    mode: 'ordre', quota_taches_mois: 20, actif: true, ordre: 30,
  },
  {
    slug: 'prospecteur', nom: 'Prospecteur de ventes', emoji: '🤝',
    pitch: 'Il trouve des clients potentiels et prépare des messages personnalisés, que vous validez.',
    fait: ['Dresse des listes de prospects ciblés', 'Rédige des messages et des relances personnalisés', 'Prépare vos appels avec une fiche par prospect', 'Respecte la LCAP : rien n’est envoyé sans votre accord'],
    pour_qui: 'Entreprises B2B et services professionnels qui veulent plus de rencontres.',
    prix_mensuel: 449, prix_mise_en_place: 499, agents: ['ventes-strategie', 'marketing-growth', 'contenu-redaction'], equipes: ['ventes', 'marketing'],
    mode: 'ordre', quota_taches_mois: 40, actif: true, ordre: 40,
  },
  {
    slug: 'conseil', nom: 'Le Conseil', emoji: '🧭',
    pitch: 'Un comité de décision IA : plusieurs agents débattent de votre question et votent.',
    fait: ['Analyse une décision sous plusieurs angles', 'Fait critiquer chaque option par des contradicteurs', 'Vote jusqu’au consensus (70 %)', 'Rend un plan d’action, les risques et les points à valider'],
    pour_qui: 'Dirigeants qui veulent un deuxième avis solide avant une grosse décision.',
    prix_mensuel: 599, prix_mise_en_place: 0, agents: ['conseil-strategie', 'conseil-marketing', 'conseil-donnees', 'contra-diable', 'contra-client', 'revue-arbitre', 'revue-qualite'], equipes: ['conseil', 'contra', 'revue'],
    mode: 'conseil', quota_taches_mois: 8, actif: true, ordre: 50,
  },
  {
    slug: 'studio-video', nom: 'Studio vidéo courte', emoji: '🎬',
    pitch: 'Des idées et des scripts de vidéos courtes pour TikTok, Reels et Shorts, prêts à tourner.',
    fait: ['Propose des idées de vidéos selon les tendances', 'Écrit les scripts, plan par plan', 'Prépare les sous-titres et les descriptions', 'Planifie votre calendrier de publication'],
    pour_qui: 'Commerces et marques qui veulent exister sur les réseaux en vidéo.',
    prix_mensuel: 499, prix_mise_en_place: 299, agents: ['marketing-video-courte', 'contenu-video', 'studio-video'], equipes: ['marketing', 'studio'],
    mode: 'ordre', quota_taches_mois: 12, actif: true, ordre: 60,
  },
];

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// "a, b" or "a\nb" or ["a", "b"] -> clean list.
function list(v, { max = 20, len = 200, sep = /[\n,]/ } = {}) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : [];
  return raw.map((x) => text(String(x), len)).filter(Boolean).slice(0, max);
}

function money(v, label) {
  if (v === undefined || v === null || v === '') return { error: `${label} requis.` };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: `${label} invalide (0 à 100 000 $).` };
  return { value: Math.round(n * 100) / 100 };
}

const bool = (v) => v === true || v === 'true' || v === 'on' || v === '1';

// Offer from the admin form or the API. Returns { offre } or { error }.
// partial: only the fields present are validated (PATCH-like updates).
function parseOffre(body, { partial = false } = {}) {
  const b = body || {};
  const has = (k) => !partial || b[k] !== undefined;
  const o = {};
  if (!partial || b.slug !== undefined) {
    if (typeof b.slug !== 'string' || !SLUG.test(b.slug)) return { error: 'Identifiant (slug) : lettres minuscules, chiffres et tirets.' };
    o.slug = b.slug;
  }
  if (has('nom')) {
    o.nom = text(b.nom, 120);
    if (!o.nom) return { error: 'Nom du robot requis.' };
  }
  if (has('emoji')) o.emoji = text(b.emoji, 16) || '🤖';
  if (has('pitch')) o.pitch = text(b.pitch, 400);
  if (has('fait')) o.fait = list(b.fait, { max: 12, len: 200, sep: /\n/ });
  if (has('pour_qui')) o.pour_qui = text(b.pour_qui, 400);
  if (has('prix_mensuel')) {
    const m = money(b.prix_mensuel, 'Prix mensuel');
    if (m.error) return m;
    o.prix_mensuel = m.value;
  }
  if (has('prix_mise_en_place')) {
    const m = money(b.prix_mise_en_place === '' || b.prix_mise_en_place == null ? 0 : b.prix_mise_en_place, 'Prix de mise en place');
    if (m.error) return m;
    o.prix_mise_en_place = m.value;
  }
  if (has('stripe_price_id')) {
    const p = text(b.stripe_price_id, 220);
    if (p && !PRICE_ID.test(p)) return { error: 'Le price id Stripe commence par price_.' };
    o.stripe_price_id = p || null;
  }
  if (has('agents')) {
    o.agents = list(b.agents, { max: 12, len: 100 });
    if (o.agents.some((id) => !AGENT_ID.test(id))) return { error: 'Identifiant d’agent invalide.' };
  }
  if (has('equipes')) o.equipes = list(b.equipes, { max: 10, len: 40 });
  if (has('mode')) {
    o.mode = b.mode || 'ordre';
    if (!MODES.includes(o.mode)) return { error: 'Mode : ordre ou conseil.' };
  }
  if (has('quota_taches_mois')) {
    const q = Number(b.quota_taches_mois === '' || b.quota_taches_mois == null ? 20 : b.quota_taches_mois);
    if (!Number.isInteger(q) || q < 0 || q > 10000) return { error: 'Quota : nombre entier de tâches par mois (0 à 10 000).' };
    o.quota_taches_mois = q;
  }
  if (has('actif')) o.actif = bool(b.actif);
  if (has('ordre')) {
    const n = Number(b.ordre === '' || b.ordre == null ? 0 : b.ordre);
    if (!Number.isInteger(n) || Math.abs(n) > 100000) return { error: 'Ordre : nombre entier.' };
    o.ordre = n;
  }
  if (!partial && o.mode === 'conseil' && !o.agents.length) return { error: 'Le Conseil a besoin d’agents.' };
  return { offre: o };
}

const byOrdre = (a, b) => (a.ordre || 0) - (b.ordre || 0) || String(a.slug).localeCompare(String(b.slug));

function normalise(o) {
  return {
    ...o,
    fait: Array.isArray(o.fait) ? o.fait : [],
    agents: Array.isArray(o.agents) ? o.agents : [],
    equipes: Array.isArray(o.equipes) ? o.equipes : [],
    prix_mensuel: Number(o.prix_mensuel) || 0,
    prix_mise_en_place: Number(o.prix_mise_en_place) || 0,
    quota_taches_mois: Number.isInteger(Number(o.quota_taches_mois)) ? Number(o.quota_taches_mois) : 0,
  };
}

// Offers for the public page. A missing table (db/006 not run) shows the
// starting catalogue instead of an empty shop window; the activation then
// fails cleanly until the table exists.
async function loadCatalogue(admin, { actifsSeulement = true } = {}) {
  let q = admin.from('robots_offres').select('*');
  if (actifsSeulement) q = q.eq('actif', true);
  const { data, error } = await q.order('ordre');
  if (error) {
    logger.warn('[robots] robots_offres unreadable, starting catalogue shown:', error.message);
    return { offres: ROBOTS_DEPART.filter((o) => !actifsSeulement || o.actif).map(normalise).sort(byOrdre), depuisSeed: true };
  }
  return { offres: (data || []).map(normalise).sort(byOrdre), depuisSeed: false };
}

async function getOffre(admin, slug, { actifSeulement = true } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  const { data, error } = await admin.from('robots_offres').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || (actifSeulement && !data.actif)) return null;
  return normalise(data);
}

// Insert the starting robots that are missing (by slug). Never overwrites.
async function seedRobots(admin) {
  const { data, error } = await admin.from('robots_offres').select('slug');
  if (error) throw new Error(error.message);
  const have = new Set((data || []).map((r) => r.slug));
  const missing = ROBOTS_DEPART.filter((o) => !have.has(o.slug));
  if (missing.length) {
    const { error: insertError } = await admin.from('robots_offres').insert(missing.map((o) => ({ ...o })));
    if (insertError) throw new Error(insertError.message);
  }
  return { ajoutes: missing.length, existants: have.size };
}

// Tasks used this month by a company's robot.
async function tachesDuMois(admin, entrepriseId, robot, now = new Date()) {
  const { data, error } = await admin
    .from('agent_jobs')
    .select('id, status')
    .eq('entreprise_id', entrepriseId)
    .eq('robot', robot)
    .gte('created_at', monthStart(now))
    .limit(10001);
  if (error) throw new Error(error.message);
  return (data || []).filter((j) => COMPTE_QUOTA.includes(j.status)).length;
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

const byDateDesc = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

// What a client sees of its robots: the robot, its status, the quota and
// what it did (jobs and the deliverables PBTM already published).
async function loadRobotsEspace(admin, entrepriseId, now = new Date()) {
  const actifs = (await rows(admin.from('robots_actifs').select('*').eq('entreprise_id', entrepriseId))).sort(byDateDesc);
  const { offres } = await loadCatalogue(admin, { actifsSeulement: false });
  const offreDe = Object.fromEntries(offres.map((o) => [o.slug, o]));
  const debut = monthStart(now);
  const jobs = await rows(admin.from('agent_jobs').select('id, status, robot, created_at, finished_at').eq('entreprise_id', entrepriseId).limit(2000));
  const livrables = await rows(admin.from('livrables').select('id, robot, job_id, statut, titre, created_at').eq('entreprise_id', entrepriseId).limit(2000));
  const publies = livrables.filter((l) => l.robot && !['a_valider', 'refuse'].includes(l.statut));
  const robots = actifs.map((a) => {
    const offre = offreDe[a.robot] || normalise({ slug: a.robot, nom: a.robot, emoji: '🤖', quota_taches_mois: 0 });
    const siens = jobs.filter((j) => j.robot === a.robot).sort(byDateDesc);
    const mois = siens.filter((j) => String(j.created_at) >= debut && COMPTE_QUOTA.includes(j.status)).length;
    const livresParJob = new Set(publies.filter((l) => l.robot === a.robot).map((l) => l.job_id));
    return {
      id: a.id,
      robot: a.robot,
      statut: a.statut,
      depuis: a.depuis || a.created_at,
      annulation_prevue_le: a.annulation_prevue_le || null,
      consignes: (a.reglages && typeof a.reglages.consignes === 'string') ? a.reglages.consignes : '',
      offre,
      quota: offre.quota_taches_mois,
      utilisees: mois,
      restantes: Math.max(0, offre.quota_taches_mois - mois),
      faits: {
        total: siens.filter((j) => j.status === 'done').length,
        enCours: siens.filter((j) => ['queued', 'running'].includes(j.status)).length,
        livres: publies.filter((l) => l.robot === a.robot).length,
      },
      recents: siens.slice(0, 5).map((j) => ({
        id: j.id,
        created_at: j.created_at,
        etat: ['queued', 'running'].includes(j.status) ? 'en_cours'
          : j.status === 'done' ? (livresParJob.has(j.id) ? 'livre' : 'verification') : 'arrete',
      })),
    };
  });
  const vivants = robots.filter((r) => r.statut !== 'annule');
  const proposes = offres.filter((o) => o.actif && !vivants.some((r) => r.robot === o.slug));
  return { robots, vivants, proposes, aClient: actifs.some((a) => a.stripe_customer_id) };
}

// Admin tab: the catalogue, robots by company, monthly recurring revenue by
// robot, deliverables to validate and connection requests.
async function loadRobotsAdmin(admin, now = new Date()) {
  const { offres, depuisSeed } = await loadCatalogue(admin, { actifsSeulement: false });
  const actifs = await rows(admin.from('robots_actifs').select('*'));
  const entreprises = await rows(admin.from('entreprises').select('id, nom'));
  const livrables = await rows(admin.from('livrables').select('*').eq('statut', 'a_valider'));
  const connexions = await rows(admin.from('connexions').select('id, entreprise_id, fournisseur, statut, compte, consenti_at, created_at, updated_at'));
  const debut = monthStart(now);
  const jobs = await rows(admin.from('agent_jobs').select('id, status, robot, entreprise_id, created_at').gte('created_at', debut).limit(10000));
  const nom = Object.fromEntries(entreprises.map((e) => [e.id, e.nom]));
  const offreDe = Object.fromEntries(offres.map((o) => [o.slug, o]));
  const parEntreprise = actifs
    .map((a) => ({
      ...a,
      entreprise: nom[a.entreprise_id] || '—',
      offre: offreDe[a.robot] || null,
      taches: jobs.filter((j) => j.entreprise_id === a.entreprise_id && j.robot === a.robot && COMPTE_QUOTA.includes(j.status)).length,
    }))
    .sort((x, y) => String(x.entreprise).localeCompare(String(y.entreprise), 'fr') || String(x.robot).localeCompare(String(y.robot)));
  const mrr = offres.map((o) => {
    const n = actifs.filter((a) => a.robot === o.slug && a.statut === 'actif').length;
    return { slug: o.slug, nom: o.nom, emoji: o.emoji, actifs: n, enPause: actifs.filter((a) => a.robot === o.slug && a.statut === 'en_pause').length, prix: o.prix_mensuel, mrr: n * o.prix_mensuel };
  });
  return {
    offres,
    depuisSeed,
    parEntreprise,
    mrr,
    mrrTotal: mrr.reduce((s, r) => s + r.mrr, 0),
    nbActifs: actifs.filter((a) => a.statut === 'actif').length,
    aValider: livrables.map((l) => ({ ...l, entreprise: nom[l.entreprise_id] || '—', offre: offreDe[l.robot] || null })).sort(byDateDesc),
    connexions: connexions.map((c) => ({ ...c, entreprise: nom[c.entreprise_id] || '—' })).sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))),
  };
}

module.exports = {
  ROBOTS_DEPART, SLUG, STATUTS, MODES, COMPTE_QUOTA,
  parseOffre, normalise, loadCatalogue, getOffre, seedRobots, tachesDuMois, loadRobotsEspace, loadRobotsAdmin,
};
