// Croissance tab of the admin console (CROISSANCE.md): validation of the
// rows (backlinks, campaigns, contents, AEO questions, media, press
// releases), the agent jobs it starts, the import of their results, and the
// data the page shows.
//
// Nothing here publishes or sends anything. Agents write proposals and
// drafts; a person reviews them and applies them (CMS, statuses) by hand.

const logger = require('./logger');
const store = require('../../agents/store');
const { extractJson } = require('../../agents/json');
const { MAX_PROPOSERS } = require('../../agents/protocol');
const seo = require('./seo');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MISSING_TABLES = 'Les tables Croissance sont introuvables : exécutez db/008_croissance.sql (après 007).';

// ---------------------------------------------------------------- vocabularies

const BACKLINK_TYPES = { annuaire_qc: 'Annuaire québécois', media: 'Média', partenaire: 'Partenaire', blogue_invite: 'Blogue invité', podcast: 'Balado (podcast)' };
const BACKLINK_STATUTS = { idee: '💡 Idée', contacte: '✉️ Contacté', en_attente: '⏳ En attente', obtenu: '✅ Obtenu', refuse: '✖️ Refusé' };
const CAMPAGNE_STATUTS = { brouillon: '📝 Brouillon', planifiee: '🗓️ Planifiée', active: '🚀 Active', terminee: '✅ Terminée', annulee: '✖️ Annulée' };
const CONTENU_STATUTS = { idee: '💡 Idée', redige: '✍️ Rédigé', approuve: '👍 Approuvé', publie: '📣 Publié' };
const AEO_STATUTS = { a_repondre: '❔ À répondre', suggeree: '🤖 Réponse suggérée', validee: '👍 Validée', publiee: '📣 Publiée' };
const COMMUNIQUE_STATUTS = { en_redaction: '🤖 En rédaction', brouillon: '📝 Brouillon', approuve: '👍 Approuvé', diffuse: '📣 Diffusé' };
const CONSENTEMENTS = { aucun: 'Aucun consentement', tacite: 'Consentement tacite (adresse publiée, lien avec la fonction)', expres: 'Consentement exprès' };

// Channels of a campaign and the marketing agent who speaks for each one.
const CANAUX = {
  seo: { label: 'SEO', agent: 'marketing-seo' },
  publicite: { label: 'Publicité', agent: 'marketing-ads' },
  courriel: { label: 'Courriel', agent: 'marketing-courriel' },
  rp: { label: 'Relations de presse', agent: 'marketing-rp' },
  reseaux: { label: 'Réseaux sociaux', agent: 'marketing-communaute' },
  video: { label: 'Vidéo courte', agent: 'marketing-video-courte' },
  conversion: { label: 'Conversion (site)', agent: 'marketing-cro' },
  marque: { label: 'Marque', agent: 'marketing-marque' },
  blogue: { label: 'Blogue', agent: 'marketing-seo' },
};
const COUNCIL = {
  strategist: 'marketing-growth',
  contradicteurs: ['contra-client', 'contra-diable'],
  planificateur: 'planif-projet',
  arbitre: 'revue-arbitre',
  reviseur: 'revue-qualite',
};
const AGENTS = { racine: 'marketing-seo', tribune: 'marketing-rp' };

const JOB_TYPES = ['seo', 'aeo_questions', 'aeo_reponses', 'backlinks', 'approche', 'campagne', 'communique'];
const JOB_LABEL = {
  seo: 'Textes SEO (Racine)', aeo_questions: 'Questions AEO', aeo_reponses: 'Réponses AEO', backlinks: 'Opportunités de backlinks',
  approche: 'Courriel d’approche (Tribune)', campagne: 'Campagne (Conseil)', communique: 'Communiqué (Tribune)',
};

// ---------------------------------------------------------------- validation helpers

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optStr = (v, max) => { const s = str(v, max); return s || null; };

function optDate(v) {
  if (v == null || v === '') return { value: null };
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { error: 'Date invalide (AAAA-MM-JJ).' };
  return { value: v };
}
function optUrl(v, { httpsOnly = false } = {}) {
  if (v == null || v === '') return { value: null };
  if (typeof v !== 'string' || v.length > 2000) return { error: 'Adresse invalide.' };
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' && (httpsOnly || u.protocol !== 'http:')) return { error: httpsOnly ? 'Adresse en https:// attendue.' : 'Adresse http(s):// attendue.' };
    return { value: u.href };
  } catch {
    return { error: 'Adresse invalide.' };
  }
}
function optInt(v, lo, hi, label) {
  if (v == null || v === '') return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) return { error: `${label} : entier entre ${lo} et ${hi}.` };
  return { value: n };
}
function optMoney(v) {
  if (v == null || v === '') return { value: null };
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return { error: 'Budget invalide.' };
  return { value: Math.round(n * 100) / 100 };
}
function oneOf(v, allowed, label, fallback) {
  if (v == null || v === '') return { value: fallback };
  return Object.prototype.hasOwnProperty.call(allowed, v) ? { value: v } : { error: `${label} invalide.` };
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };

// Builds a row from a request body. `partial` (PATCH): only the given fields.
// fields: { name: (value) => { value } | { error } }
function parseFields(body, fields, { partial = false, required = [] } = {}) {
  const b = body || {};
  const row = {};
  for (const [name, check] of Object.entries(fields)) {
    if (partial && b[name] === undefined) continue;
    const r = check(b[name]);
    if (r.error) return { error: r.error };
    row[name] = r.value;
  }
  for (const name of required) if (!partial || b[name] !== undefined) if (!row[name]) return { error: `Champ requis : ${name}.` };
  if (partial && !Object.keys(row).length) return { error: 'Rien à modifier.' };
  return { row };
}

const txt = (max) => (v) => ({ value: optStr(v, max) });

const BACKLINK_FIELDS = {
  cible: txt(200),
  url: (v) => optUrl(v),
  domaine: txt(200),
  page_visee: (v) => ({ value: str(v, 200) || '/' }),
  type: (v) => oneOf(v, BACKLINK_TYPES, 'Type', 'annuaire_qc'),
  statut: (v) => oneOf(v, BACKLINK_STATUTS, 'Statut', 'idee'),
  autorite: (v) => optInt(v, 0, 100, 'Autorité'),
  date_suivi: optDate,
  note: txt(4000),
  source: txt(500),
  courriel_approche: txt(8000),
};
function parseBacklink(body, opts = {}) {
  const r = parseFields(body, BACKLINK_FIELDS, { ...opts, required: ['cible'] });
  if (r.row && r.row.url && !r.row.domaine && !opts.partial) r.row.domaine = hostOf(r.row.url);
  return r;
}

function parseCanaux(v) {
  if (v == null || v === '') return { value: [] };
  const list = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  if (out.some((c) => !CANAUX[c])) return { error: `Canal inconnu (choix : ${Object.keys(CANAUX).join(', ')}).` };
  return { value: out };
}
const CAMPAGNE_FIELDS = {
  nom: txt(200),
  objectif: txt(2000),
  cible: txt(1000),
  canaux: parseCanaux,
  budget: optMoney,
  date_debut: optDate,
  date_fin: optDate,
  kpi_vises: txt(2000),
  kpi_reels: txt(2000),
  statut: (v) => oneOf(v, CAMPAGNE_STATUTS, 'Statut', 'brouillon'),
};
function parseCampagne(body, opts = {}) {
  // HTML forms send one checkbox per channel (canaux_seo=on…).
  const b = { ...(body || {}) };
  if (b.canaux === undefined && Object.keys(b).some((k) => k.startsWith('canaux_'))) {
    b.canaux = Object.keys(CANAUX).filter((k) => b[`canaux_${k}`]);
  }
  const r = parseFields(b, CAMPAGNE_FIELDS, { ...opts, required: ['nom'] });
  if (r.row && r.row.date_debut && r.row.date_fin && r.row.date_fin < r.row.date_debut) return { error: 'La date de fin précède la date de début.' };
  return r;
}

const CONTENU_FIELDS = {
  campagne_id: (v) => (v == null || v === '' ? { value: null } : isUuid(v) ? { value: v } : { error: 'Campagne invalide.' }),
  canal: (v) => ({ value: str(v, 60) || 'blogue' }),
  format: txt(60),
  titre: txt(300),
  texte: txt(20000),
  media_url: (v) => optUrl(v, { httpsOnly: true }),
  date_prevue: optDate,
  statut: (v) => oneOf(v, CONTENU_STATUTS, 'Statut', 'idee'),
};
const parseContenu = (body, opts = {}) => parseFields(body, CONTENU_FIELDS, { ...opts, required: ['titre'] });

const PAGE_IDS = ['generale', ...seo.PAGES.filter((p) => p.id !== 'faq' && p.id !== 'presse').map((p) => p.id)];
const AEO_FIELDS = {
  question: txt(300),
  page: (v) => (v == null || v === '' ? { value: 'generale' } : PAGE_IDS.includes(v) ? { value: v } : { error: 'Page invalide.' }),
  source: txt(300),
  reponse: txt(2000),
  statut: (v) => oneOf(v, AEO_STATUTS, 'Statut', 'a_repondre'),
};
const parseAeo = (body, opts = {}) => parseFields(body, AEO_FIELDS, { ...opts, required: ['question'] });

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const MEDIA_FIELDS = {
  nom: txt(200),
  contact: txt(200),
  courriel: (v) => (v == null || v === '' ? { value: null } : typeof v === 'string' && EMAIL_RE.test(v.trim()) && v.length <= 320 ? { value: v.trim() } : { error: 'Courriel invalide.' }),
  site: (v) => optUrl(v),
  sujets: txt(1000),
  consentement: (v) => oneOf(v, CONSENTEMENTS, 'Consentement', 'aucun'),
  note: txt(4000),
};
const parseMedia = (body, opts = {}) => parseFields(body, MEDIA_FIELDS, { ...opts, required: ['nom'] });

const COMMUNIQUE_FIELDS = {
  titre: txt(300),
  sujet: txt(4000),
  texte: txt(20000),
  statut: (v) => oneOf(v, COMMUNIQUE_STATUTS, 'Statut', 'brouillon'),
  date_diffusion: optDate,
};
const parseCommunique = (body, opts = {}) => parseFields(body, COMMUNIQUE_FIELDS, { ...opts, required: ['titre'] });

// ---------------------------------------------------------------- agent jobs

class CroissanceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function existingAgents(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set();
  const { data, error } = await db.from('agents').select('id').in('id', unique);
  if (error) throw new CroissanceError(500, 'Table agents illisible : exécutez db/003_moteur_agents.sql.');
  return new Set((data || []).map((r) => r.id));
}

async function requireAgent(db, id) {
  const found = await existingAgents(db, [id]);
  if (!found.has(id)) throw new CroissanceError(400, `Agent « ${id} » introuvable : importez les agents de départ (onglet Réglages agents).`);
}

// Queues an agent job (picked up by the worker, see MOTEUR-AGENTS.md) and
// links it to the Croissance tab.
async function queueJob(db, { kind, payload, type, ref = null, userId }) {
  const { data, error } = await db.from('agent_jobs')
    .insert({ kind, payload, status: 'queued', priority: 0, entreprise_id: null, created_by: userId })
    .select('id, kind, status, created_at').single();
  if (error) {
    logger.error('[croissance] job insert failed:', error.message);
    throw new CroissanceError(500, 'Création du travail impossible.');
  }
  const { error: linkError } = await db.from('croissance_jobs').insert({ job_id: data.id, type, ref: ref == null ? null : String(ref).slice(0, 100), created_by: userId });
  if (linkError) {
    logger.error('[croissance] job link failed:', linkError.message);
    throw new CroissanceError(500, MISSING_TABLES);
  }
  await store.logActivity(db, { job_id: data.id, agent_id: payload.agent_id || null, kind: 'job_queued', message: `Croissance : ${JOB_LABEL[type]} mis en file` });
  return data;
}

const RULES_FR = 'Écris en français du Québec (Loi 96 : le français d’abord). N’invente aucun chiffre, prix, client, témoignage ni promesse ; écris « [à vérifier] » quand une donnée manque.';

function seoInstruction(page, auditPage) {
  const problems = (auditPage && auditPage.corrections.length) ? auditPage.corrections.map((c) => `- ${c}`).join('\n') : '- aucun problème bloquant';
  return [
    `[croissance:seo] Propose de nouveaux textes SEO pour la page « ${page.label} » (${page.path}) du site de PBTM (Panda Business Tech & Marketing).`,
    RULES_FR,
    `Titre (balise title) : 30 à 65 caractères, avec au moins un mot-clé cible, unique sur le site.`,
    `Description : 70 à 160 caractères, factuelle, avec un appel à l’action.`,
    `FAQ : 3 questions que des clients poseraient, avec des réponses courtes (40 à 60 mots) et vérifiables.`,
    `Mots-clés cibles : ${(page.motsCles || []).join(', ') || 'aucun'}.`,
    `Titre actuel : ${auditPage ? auditPage.title : ''}`,
    `Description actuelle : ${auditPage ? auditPage.description : ''}`,
    `H1 actuel : ${auditPage ? auditPage.h1 : ''}`,
    `Problèmes relevés par l’audit :\n${problems}`,
    'Réponds uniquement en JSON : {"title": "...", "description": "...", "justification": "...", "faq": [{"q": "...", "r": "..."}]}',
  ].join('\n\n');
}

function aeoQuestionsInstruction(existing) {
  return [
    '[croissance:aeo_questions] Liste 8 questions que des clients du Québec posent aux assistants IA (ChatGPT, Gemini, Copilot, Perplexity) quand ils cherchent des services comme ceux de PBTM : solutions IA, agents IA, marketing numérique, formation en ligne, NFT, boutique.',
    RULES_FR,
    `Pages possibles : ${PAGE_IDS.join(', ')}.`,
    existing.length ? `Questions déjà listées (ne pas répéter) :\n${existing.map((q) => `- ${q}`).join('\n')}` : '',
    'Réponds uniquement en JSON : {"questions": [{"question": "...", "page": "generale"}]}',
  ].filter(Boolean).join('\n\n');
}

function aeoAnswersInstruction(questions) {
  return [
    '[croissance:aeo_reponses] Rédige pour chaque question une réponse courte (40 à 60 mots), factuelle, qui commence par la réponse directe, au nom de PBTM.',
    RULES_FR,
    `Questions :\n${questions.map((q) => `- [${q.id}] ${q.question}`).join('\n')}`,
    'Réponds uniquement en JSON : {"reponses": [{"id": "...", "reponse": "..."}]}',
  ].join('\n\n');
}

function backlinksQuestion(zone) {
  return [
    `Trouve des occasions réalistes d’obtenir des liens (backlinks) vers pandorabrains.com pour PBTM, une PME québécoise en IA, agents IA, marketing numérique et formation${zone ? `, en priorité pour : ${zone}` : ''}.`,
    'Cherche : annuaires d’affaires du Québec, chambres de commerce (régionales et FCCQ), médias tech et affaires québécois, balados (podcasts) québécois sur la tech, l’IA ou l’entrepreneuriat, blogues qui acceptent des articles invités.',
    'Pour chacun : nom, adresse web, type (annuaire, chambre de commerce, média, balado, blogue), comment obtenir le lien (inscription, adhésion, proposition d’article, entrevue) et coût s’il est indiqué. Cite chaque source.',
  ].join('\n');
}

function approcheInstruction(b) {
  return [
    `[croissance:approche] Rédige un courriel d’approche de PBTM pour obtenir un lien (${BACKLINK_TYPES[b.type] || b.type}) sur « ${b.cible} »${b.url ? ` (${b.url})` : ''}, vers notre page ${b.page_visee || '/'}.`,
    RULES_FR,
    'Format : « Objet : … » puis le message, 120 à 180 mots, ton professionnel et personnalisé, une seule demande claire.',
    'LCAP (loi canadienne anti-pourriel) : identifie clairement l’expéditeur (PBTM, nom de la personne, moyen de nous joindre) et termine par une phrase qui permet de refuser tout autre message.',
    'Ce courriel ne sera PAS envoyé automatiquement : une personne le relira et l’enverra elle-même, seulement si l’adresse est publiée à des fins professionnelles en lien avec le message ou si le destinataire a consenti.',
  ].join('\n\n');
}

function communiqueInstruction(c) {
  return [
    `[croissance:communique] Rédige un communiqué de presse de PBTM (Panda Business Tech & Marketing) : « ${c.titre} ».`,
    c.sujet ? `Sujet et faits fournis :\n${c.sujet}` : '',
    RULES_FR,
    'Structure : titre, sous-titre, lieu et date « [Ville], le [date] – », un premier paragraphe qui répond à qui, quoi, quand, où, pourquoi, une citation (marquée [citation à valider]), les détails, le paragraphe « À propos de PBTM », la mention « – 30 – » et le contact médias [à compléter].',
    'Longueur : 350 à 500 mots.',
  ].filter(Boolean).join('\n\n');
}

function campagneSujet(c) {
  const canaux = (c.canaux || []).map((k) => (CANAUX[k] ? CANAUX[k].label : k)).join(', ') || 'à choisir';
  return [
    `Plan de la campagne marketing « ${c.nom} » de PBTM.`,
    `Objectif : ${c.objectif || '[à préciser]'}`,
    `Cible : ${c.cible || '[à préciser]'}`,
    `Canaux : ${canaux}`,
    `Budget : ${c.budget != null ? `${c.budget} $ CA` : '[à préciser]'}`,
    `Dates : ${c.date_debut || '?'} au ${c.date_fin || '?'}`,
    `KPI visés : ${c.kpi_vises || '[à préciser]'}`,
    'Décidez du message central, de la répartition par canal et du calendrier. Chaque tâche finale est UN contenu à produire : titre = « canal : titre du contenu » (canaux possibles : '
      + `${Object.keys(CANAUX).join(', ')}), détail = angle, format et appel à l’action, échéance = date AAAA-MM-JJ dans la période. `
      + 'Rien ne sera publié automatiquement : chaque contenu sera relu et publié à la main. Respectez la Loi 96 (français d’abord) et la LCAP (aucun courriel sans consentement).',
  ].join('\n');
}

// Council members for a campaign: the agents of its channels plus Élan
// (growth), limited to the agents that exist.
async function councilFor(db, canaux) {
  const proposeurs = [...new Set([...(canaux || []).map((k) => CANAUX[k] && CANAUX[k].agent), COUNCIL.strategist].filter(Boolean))];
  const all = [...proposeurs, ...COUNCIL.contradicteurs, COUNCIL.planificateur, COUNCIL.arbitre, COUNCIL.reviseur];
  const found = await existingAgents(db, all);
  const keep = (id) => (found.has(id) ? id : null);
  const props = proposeurs.filter((id) => found.has(id)).slice(0, MAX_PROPOSERS);
  if (!props.length) throw new CroissanceError(400, 'Aucun agent marketing trouvé : importez les agents de départ (onglet Réglages agents).');
  return {
    proposeurs: props,
    contradicteurs: COUNCIL.contradicteurs.filter((id) => found.has(id)),
    votants: [],
    planificateur: keep(COUNCIL.planificateur),
    arbitre: keep(COUNCIL.arbitre),
    reviseur: keep(COUNCIL.reviseur),
  };
}

// ---------------------------------------------------------------- reading job results

const resultText = (job) => (job && job.result && typeof job.result.texte === 'string' ? job.result.texte : '');

function parseJsonResult(job) {
  try { return extractJson(resultText(job)); } catch { return null; }
}

// SEO proposal of Racine: { title, description, justification, faq } or null.
function seoProposal(job) {
  const v = parseJsonResult(job);
  if (!v || typeof v !== 'object' || typeof v.title !== 'string' || typeof v.description !== 'string') return null;
  return {
    title: v.title.trim().slice(0, 120),
    description: v.description.trim().slice(0, 300),
    justification: typeof v.justification === 'string' ? v.justification.trim().slice(0, 1000) : '',
    faq: seo.cleanFaq(v.faq).slice(0, 6),
  };
}

function guessBacklinkType(text) {
  const t = text.toLowerCase();
  if (/podcast|balado/.test(t)) return 'podcast';
  if (/annuaire|r[eé]pertoire|directory|chambre|cci|fccq|registre|bottin/.test(t)) return 'annuaire_qc';
  if (/blog|article invit|guest/.test(t)) return 'blogue_invite';
  if (/partenaire|partner|association|r[eé]seau/.test(t)) return 'partenaire';
  return 'media';
}

// Backlink ideas from the sources of a research job.
function backlinkIdeas(job) {
  const sources = (job && job.result && Array.isArray(job.result.sources)) ? job.result.sources : [];
  const day = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const url = optUrl(s && s.url).value;
    if (!url || seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    const title = str(s.title, 200) || hostOf(url) || url;
    out.push({
      cible: title,
      url,
      domaine: hostOf(url),
      page_visee: '/',
      type: guessBacklinkType(`${title} ${url}`),
      statut: 'idee',
      source: `Recherche web de l’agent ${job.result.agent_name || 'Racine'}, ${day}`,
      note: optStr(s.cited_text, 4000),
    });
  }
  return out.slice(0, 40);
}

// Contents (status "idée") from the final tasks of a campaign's Council.
function contenusFromTasks(tasks, campagne) {
  const debut = campagne.date_debut ? new Date(`${campagne.date_debut}T00:00:00Z`) : null;
  const fin = campagne.date_fin ? new Date(`${campagne.date_fin}T00:00:00Z`) : null;
  const span = debut && fin ? Math.max(0, Math.round((fin - debut) / 86400000)) : 0;
  return tasks.map((t, i) => {
    let titre = str(t.title, 300) || `Contenu ${i + 1}`;
    let canal = (campagne.canaux && campagne.canaux[0]) || 'blogue';
    const m = /^\s*([a-zA-Zéèàç-]+)\s*:\s*(.+)$/.exec(titre);
    if (m && CANAUX[m[1].toLowerCase()]) { canal = m[1].toLowerCase(); titre = m[2].trim(); }
    let date = DATE_RE.test(String(t.due || '')) ? t.due : null;
    if (!date && debut) date = new Date(debut.getTime() + Math.round((span * (i + 1)) / (tasks.length + 1)) * 86400000).toISOString().slice(0, 10);
    return { campagne_id: campagne.id, canal, format: null, titre, texte: optStr(t.detail, 20000), date_prevue: date, statut: 'idee' };
  });
}

// ---------------------------------------------------------------- import of a finished job

async function getLinkedJob(db, jobId) {
  const { data: link, error } = await db.from('croissance_jobs').select('*').eq('job_id', jobId).maybeSingle();
  if (error) throw new CroissanceError(500, MISSING_TABLES);
  if (!link) throw new CroissanceError(404, 'Travail inconnu de l’onglet Croissance.');
  const { data: job, error: jobError } = await db.from('agent_jobs').select('id, kind, status, result, payload, created_at').eq('id', jobId).maybeSingle();
  if (jobError || !job) throw new CroissanceError(404, 'Travail introuvable.');
  return { link, job };
}

async function markImported(db, jobId) {
  await db.from('croissance_jobs').update({ importe_le: new Date().toISOString() }).eq('job_id', jobId);
}

const now = () => new Date().toISOString();

// Imports the result of a finished job into the Croissance tables. Never
// publishes anything; returns { imported, message }.
async function importJob(db, jobId, userId) {
  const { link, job } = await getLinkedJob(db, jobId);
  if (job.status !== 'done') throw new CroissanceError(409, 'Ce travail n’est pas terminé.');
  if (link.importe_le) throw new CroissanceError(409, 'Résultat déjà importé.');

  if (link.type === 'backlinks') {
    const ideas = backlinkIdeas(job);
    const { data: existing } = await db.from('backlinks').select('url');
    const known = new Set((existing || []).map((r) => String(r.url || '').toLowerCase()).filter(Boolean));
    const fresh = ideas.filter((x) => !known.has(x.url.toLowerCase())).map((x) => ({ ...x, job_id: job.id, created_by: userId }));
    if (fresh.length) {
      const { error } = await db.from('backlinks').insert(fresh);
      if (error) throw new CroissanceError(500, 'Ajout des opportunités impossible.');
    }
    await markImported(db, jobId);
    return { imported: fresh.length, message: `${fresh.length} opportunité(s) ajoutée(s) comme idées.` };
  }

  if (link.type === 'approche') {
    const texte = resultText(job).slice(0, 8000);
    if (!isUuid(link.ref) || !texte) throw new CroissanceError(400, 'Rien à importer.');
    const { error } = await db.from('backlinks').update({ courriel_approche: texte, updated_at: now() }).eq('id', link.ref);
    if (error) throw new CroissanceError(500, 'Enregistrement du courriel impossible.');
    await markImported(db, jobId);
    return { imported: 1, message: 'Brouillon de courriel enregistré. Rien n’a été envoyé.' };
  }

  if (link.type === 'communique') {
    const texte = resultText(job).slice(0, 20000);
    if (!isUuid(link.ref) || !texte) throw new CroissanceError(400, 'Rien à importer.');
    const { error } = await db.from('communiques').update({ texte, statut: 'brouillon', updated_at: now() }).eq('id', link.ref);
    if (error) throw new CroissanceError(500, 'Enregistrement du communiqué impossible.');
    await markImported(db, jobId);
    return { imported: 1, message: 'Communiqué enregistré en brouillon, à relire.' };
  }

  if (link.type === 'aeo_questions') {
    const v = parseJsonResult(job);
    const list = v && Array.isArray(v.questions) ? v.questions : [];
    const { data: existing } = await db.from('aeo_questions').select('question');
    const known = new Set((existing || []).map((r) => String(r.question).toLowerCase()));
    const rows = list
      .map((q) => ({ question: str(q && q.question, 300), page: PAGE_IDS.includes(q && q.page) ? q.page : 'generale' }))
      .filter((q) => q.question && !known.has(q.question.toLowerCase()))
      .slice(0, 20)
      .map((q) => ({ ...q, source: 'Suggestion de l’agent Racine', statut: 'a_repondre', job_id: job.id, created_by: userId }));
    if (rows.length) {
      const { error } = await db.from('aeo_questions').insert(rows);
      if (error) throw new CroissanceError(500, 'Ajout des questions impossible.');
    }
    await markImported(db, jobId);
    return { imported: rows.length, message: `${rows.length} question(s) ajoutée(s).` };
  }

  if (link.type === 'aeo_reponses') {
    const v = parseJsonResult(job);
    const list = v && Array.isArray(v.reponses) ? v.reponses : [];
    let n = 0;
    for (const r of list.slice(0, 30)) {
      const reponse = str(r && r.reponse, 2000);
      if (!isUuid(r && r.id) || !reponse) continue;
      const { data } = await db.from('aeo_questions').update({ reponse, statut: 'suggeree', job_id: job.id, updated_at: now() })
        .eq('id', r.id).eq('statut', 'a_repondre').select('id');
      n += (data || []).length;
    }
    await markImported(db, jobId);
    return { imported: n, message: `${n} réponse(s) suggérée(s), à relire avant validation.` };
  }

  if (link.type === 'campagne') {
    if (!isUuid(link.ref)) throw new CroissanceError(400, 'Campagne inconnue.');
    const { data: campagne } = await db.from('campagnes').select('*').eq('id', link.ref).maybeSingle();
    if (!campagne) throw new CroissanceError(404, 'Campagne introuvable.');
    const { data: tasks } = await db.from('agent_tasks').select('*').eq('job_id', job.id);
    const rows = contenusFromTasks((tasks || []).slice(0, 40), campagne).map((r) => ({ ...r, job_id: job.id, created_by: userId }));
    if (rows.length) {
      const { error } = await db.from('contenus').insert(rows);
      if (error) throw new CroissanceError(500, 'Création des contenus impossible.');
    }
    const decision = job.result && job.result.decision && typeof job.result.decision.decision === 'string' ? job.result.decision.decision.slice(0, 8000) : null;
    await db.from('campagnes').update({ decision, updated_at: now() }).eq('id', campagne.id);
    await markImported(db, jobId);
    return { imported: rows.length, message: `${rows.length} contenu(s) ajouté(s) au calendrier, au statut Idée. Rien n’est publié.` };
  }

  throw new CroissanceError(400, 'Ce travail se relit dans la section SEO (aucun import).');
}

// ---------------------------------------------------------------- page data

async function readTable(db, table, errors) {
  const { data, error } = await db.from(table).select('*').order('created_at', { ascending: false }).limit(500);
  if (error) {
    if (!errors.includes(MISSING_TABLES)) errors.push(MISSING_TABLES);
    return [];
  }
  return data || [];
}

// Linked jobs, newest first, with the agent job's status and result.
async function readJobs(db, errors) {
  const { data: links, error } = await db.from('croissance_jobs').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) {
    if (!errors.includes(MISSING_TABLES)) errors.push(MISSING_TABLES);
    return [];
  }
  const ids = (links || []).map((l) => l.job_id);
  if (!ids.length) return [];
  const { data: jobs } = await db.from('agent_jobs').select('id, kind, status, result, error, created_at, finished_at').in('id', ids);
  const byId = new Map((jobs || []).map((j) => [j.id, j]));
  return (links || [])
    .map((l) => ({ ...l, label: JOB_LABEL[l.type] || l.type, job: byId.get(l.job_id) || null }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

// Monday 00:00 to next Monday (UTC dates), for "this week".
function weekRange(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - dow * 86400000);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function dashboard({ audit, backlinks, contenus, campagnes, today = new Date() }) {
  const { start, end } = weekRange(today);
  const inWeek = (d) => d && String(d).slice(0, 10) >= start && String(d).slice(0, 10) < end;
  return {
    scoreMoyen: audit ? audit.moyenne : null,
    backlinksObtenus: backlinks.filter((b) => b.statut === 'obtenu').length,
    backlinksTotal: backlinks.length,
    prevusSemaine: contenus.filter((c) => inWeek(c.date_prevue) && c.statut !== 'publie').length,
    publiesSemaine: contenus.filter((c) => c.statut === 'publie' && inWeek(c.publie_le || c.date_prevue)).length,
    campagnesActives: campagnes.filter((c) => c.statut === 'active').length,
    semaine: { start, end },
  };
}

// Month grid of the editorial calendar: weeks of 7 days (Monday first).
function monthGrid(mois, contenus) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mois || ''));
  const today = new Date();
  const year = m ? Number(m[1]) : today.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : today.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
  const byDay = new Map();
  for (const c of contenus) {
    if (!c.date_prevue) continue;
    const k = String(c.date_prevue).slice(0, 10);
    byDay.set(k, [...(byDay.get(k) || []), c]);
  }
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = iso(year, month, d);
    cells.push({ day: d, date, contenus: byDay.get(date) || [] });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const label = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const prev = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 7);
  const sansDate = contenus.filter((c) => !c.date_prevue);
  return { mois: first.toISOString().slice(0, 7), label, prev, next, weeks, sansDate, today: today.toISOString().slice(0, 10) };
}

const SECTIONS = ['tableau', 'seo', 'aeo', 'backlinks', 'campagnes', 'medias'];

// Everything the Croissance tab shows. `audit` is computed by the caller.
async function loadPage(db, { section, mois, audit }) {
  const errors = [];
  const [backlinks, campagnes, contenus, questions, medias, communiques, jobs] = await Promise.all([
    readTable(db, 'backlinks', errors),
    readTable(db, 'campagnes', errors),
    readTable(db, 'contenus', errors),
    readTable(db, 'aeo_questions', errors),
    readTable(db, 'medias', errors),
    readTable(db, 'communiques', errors),
    readJobs(db, errors),
  ]);
  const seoJobs = jobs.filter((j) => j.type === 'seo').map((j) => ({ ...j, proposal: j.job && j.job.status === 'done' ? seoProposal(j.job) : null }));
  const lastSeo = {};
  for (const j of seoJobs) if (!lastSeo[j.ref]) lastSeo[j.ref] = j;
  const approches = {};
  for (const j of jobs.filter((x) => x.type === 'approche')) if (!approches[j.ref]) approches[j.ref] = j;
  const communiqueJobs = {};
  for (const j of jobs.filter((x) => x.type === 'communique')) if (!communiqueJobs[j.ref]) communiqueJobs[j.ref] = j;
  const campagneJobs = {};
  for (const j of jobs.filter((x) => x.type === 'campagne')) if (!campagneJobs[j.ref]) campagneJobs[j.ref] = j;
  const campagneNom = {};
  campagnes.forEach((c) => { campagneNom[c.id] = c.nom; });
  return {
    section,
    errors,
    audit,
    board: dashboard({ audit, backlinks, contenus, campagnes }),
    backlinks, campagnes, contenus, questions, medias, communiques, jobs,
    seoJobs, lastSeo, approches, communiqueJobs, campagneJobs, campagneNom,
    calendrier: monthGrid(mois, contenus),
    labels: {
      backlinkTypes: BACKLINK_TYPES, backlinkStatuts: BACKLINK_STATUTS, campagneStatuts: CAMPAGNE_STATUTS, contenuStatuts: CONTENU_STATUTS,
      aeoStatuts: AEO_STATUTS, communiqueStatuts: COMMUNIQUE_STATUTS, consentements: CONSENTEMENTS,
      jobStatuts: { queued: '⏳ En file', running: '⚙️ En cours', done: '✅ Terminé', error: '⚠️ Erreur', cancelled: '✖️ Annulé', budget_refused: '💸 Budget atteint' },
    },
    canaux: CANAUX,
    pages: seo.PAGES,
    pageIds: PAGE_IDS,
    pageLabel: Object.fromEntries([['generale', 'FAQ générale'], ...seo.PAGES.map((p) => [p.id, p.label])]),
    exports: Object.keys(EXPORTS),
  };
}

// ---------------------------------------------------------------- CSV export

const EXPORTS = {
  backlinks: ['cible', 'url', 'domaine', 'page_visee', 'type', 'statut', 'autorite', 'date_suivi', 'source', 'note', 'created_at'],
  campagnes: ['nom', 'objectif', 'cible', 'canaux', 'budget', 'date_debut', 'date_fin', 'kpi_vises', 'kpi_reels', 'statut', 'decision', 'created_at'],
  contenus: ['titre', 'canal', 'format', 'date_prevue', 'statut', 'publie_le', 'media_url', 'texte', 'campagne_id', 'created_at'],
  medias: ['nom', 'contact', 'courriel', 'site', 'sujets', 'consentement', 'note', 'created_at'],
  communiques: ['titre', 'statut', 'date_diffusion', 'texte', 'created_at'],
  aeo_questions: ['question', 'page', 'statut', 'reponse', 'source', 'created_at'],
};

// One CSV cell: quoted, and a leading = + - @ (spreadsheet formula) is
// neutralised with an apostrophe.
function csvCell(v) {
  let s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function toCsv(rows, columns) {
  return `﻿${[columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n')}\r\n`;
}

module.exports = {
  MISSING_TABLES, SECTIONS, JOB_TYPES, JOB_LABEL, AGENTS, CANAUX, COUNCIL, PAGE_IDS, EXPORTS,
  BACKLINK_TYPES, BACKLINK_STATUTS, CAMPAGNE_STATUTS, CONTENU_STATUTS, AEO_STATUTS, COMMUNIQUE_STATUTS, CONSENTEMENTS,
  CroissanceError, isUuid,
  parseBacklink, parseCampagne, parseContenu, parseAeo, parseMedia, parseCommunique,
  requireAgent, queueJob, councilFor, importJob, getLinkedJob, markImported,
  seoInstruction, aeoQuestionsInstruction, aeoAnswersInstruction, backlinksQuestion, approcheInstruction, communiqueInstruction, campagneSujet,
  seoProposal, backlinkIdeas, contenusFromTasks, guessBacklinkType,
  loadPage, dashboard, monthGrid, weekRange, toCsv, csvCell,
};
