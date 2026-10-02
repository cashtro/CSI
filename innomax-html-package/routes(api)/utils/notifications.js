// Notifications push de PBTM (PWA.md), table public.push_abonnements (db/009_pwa.sql).
//
// Pour l'admin : un livrable de robot à valider, un robot activé (nouveau
// client payant), un Conseil arrivé au consensus, une alerte finance critique.
// Pour le client : un livrable publié pour son entreprise.
//
// Rien ne bloque jamais le travail : sans clés VAPID, chaque fonction rend
// { envoye: 0, raison: 'vapid-absent' } sans lire la base ; une erreur est
// journalisée et avalée. Les textes ne contiennent que des titres courts,
// jamais le contenu d'un livrable.

const logger = require('./logger');
const webpush = require('./webpush');

const TABLE = 'push_abonnements';
const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function envoyerA(db, abonnements, message, opts) {
  let envoye = 0;
  for (const a of abonnements) {
    try {
      const r = await webpush.envoyer(a, message, opts);
      if (r.ok) envoye += 1;
      if (r.expire) await db.from(TABLE).delete().eq('id', a.id);
      else if (r.ok) await db.from(TABLE).update({ last_used_at: new Date().toISOString() }).eq('id', a.id);
    } catch (err) {
      logger.warn('[push] envoi impossible :', err.message);
    }
  }
  return envoye;
}

// Abonnements des admins, revérifiés : le compte doit encore être admin.
async function abonnementsAdmins(db) {
  const { data, error } = await db.from(TABLE).select('id, user_id, endpoint, p256dh, auth').eq('role', 'admin');
  if (error) throw new Error(error.message);
  const subs = data || [];
  if (!subs.length) return [];
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const { data: users } = await db.from('Users').select('userId, isAdmin').in('userId', ids);
  const admins = new Set((users || []).filter((u) => u.isAdmin === true).map((u) => u.userId));
  return subs.filter((s) => admins.has(s.user_id));
}

async function sansErreur(nom, fn, opts = {}) {
  const cfg = opts.cfg !== undefined ? opts.cfg : webpush.config();
  if (!cfg) return { envoye: 0, raison: 'vapid-absent' };
  try {
    return { envoye: await fn({ ...opts, cfg }) };
  } catch (err) {
    logger.warn(`[push] ${nom} :`, err.message);
    return { envoye: 0, raison: 'erreur' };
  }
}

function versAdmins(db, message, opts = {}) {
  return sansErreur('admins', async (o) => envoyerA(db, await abonnementsAdmins(db), message, o), opts);
}

function versEntreprise(db, entrepriseId, message, opts = {}) {
  return sansErreur('entreprise', async (o) => {
    if (!entrepriseId) return 0;
    const { data, error } = await db.from(TABLE).select('id, endpoint, p256dh, auth').eq('role', 'client').eq('entreprise_id', entrepriseId);
    if (error) throw new Error(error.message);
    return envoyerA(db, data || [], message, o);
  }, opts);
}

function versUtilisateur(db, userId, message, opts = {}) {
  return sansErreur('utilisateur', async (o) => {
    const { data, error } = await db.from(TABLE).select('id, endpoint, p256dh, auth').eq('user_id', userId);
    if (error) throw new Error(error.message);
    return envoyerA(db, data || [], message, o);
  }, opts);
}

// ------------------------------------------------------------------ événements

const livrableAValider = (db, { id, titre }, opts) => versAdmins(db, {
  title: '🕵️ Livrable à valider',
  body: clip(titre || 'Un robot a terminé une tâche.', 140),
  url: id ? `/admin/console?vue=robots#livrable-${id}` : '/admin/console?vue=robots',
  tag: 'livrable-a-valider',
}, opts);

const robotActive = (db, { robot, entreprise }, opts) => versAdmins(db, {
  title: '⚡ Nouveau robot activé',
  body: clip(`${entreprise || 'Un client'} a activé ${robot || 'un robot'}.`, 140),
  url: '/admin/console?vue=robots',
  tag: 'robot-active',
}, opts);

const conseilConsensus = (db, { question, accord }, opts) => versAdmins(db, {
  title: '🧠 Le Conseil a tranché',
  body: clip(`${question ? `${question} · ` : ''}consensus${typeof accord === 'number' ? ` à ${Math.round(accord * 100)} %` : ''}.`, 140),
  url: '/admin/console?vue=conseil',
  tag: 'conseil',
}, opts);

const livrablePublie = (db, { entreprise_id: entrepriseId, titre }, opts) => versEntreprise(db, entrepriseId, {
  title: '📦 Nouveau livrable pour vous',
  body: clip(`${titre || 'Un livrable'} : à approuver dans votre espace.`, 140),
  url: '/espace?vue=livrables',
  tag: 'livrable',
}, opts);

// Alertes finances critiques : une seule fois par alerte et par mois, dans ce
// processus (le serveur tourne en un seul processus, voir MISE-EN-LIGNE.md).
const dejaSignalees = new Set();
async function alertesFinances(db, alertes, mois, opts) {
  const neuves = (alertes || []).filter((a) => a && a.niveau === 'critique' && !dejaSignalees.has(`${mois}:${a.id}`));
  if (!neuves.length) return { envoye: 0, raison: 'rien-de-neuf' };
  if (!(opts && opts.cfg !== undefined ? opts.cfg : webpush.config())) return { envoye: 0, raison: 'vapid-absent' };
  neuves.forEach((a) => dejaSignalees.add(`${mois}:${a.id}`));
  return versAdmins(db, {
    title: '💰 Alerte finances',
    body: clip(neuves.map((a) => a.titre).join(' · '), 140),
    url: '/admin/console?vue=finances',
    tag: 'finances',
  }, opts);
}

// Lance une notification sans attendre ni jamais faire échouer l'appelant.
function enArrierePlan(promesse) {
  Promise.resolve(promesse).catch((err) => logger.warn('[push]', err && err.message));
}

module.exports = {
  TABLE,
  versAdmins, versEntreprise, versUtilisateur,
  livrableAValider, robotActive, conseilConsensus, livrablePublie, alertesFinances,
  enArrierePlan,
  _reset() { dejaSignalees.clear(); },
};
