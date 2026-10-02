// Écran d'accueil du cockpit (/admin/console?vue=accueil, PWA.md) :
// « Ce qui demande mon attention ». Quatre sources, chacune avec une action
// en un tap :
//   - les livrables des robots à valider (statut a_valider) ;
//   - les robots activés depuis 7 jours (nouveaux clients payants) ;
//   - les alertes finances du mois (FINANCES.md) ;
//   - les Conseils terminés depuis 7 jours.
// Une source illisible (table absente) est signalée sans faire tomber l'écran.

const logger = require('./logger');
const finances = require('./finances');
const notifications = require('./notifications');
const { fmt } = require('./espace');

const JOURS = 7;
const MAX_PAR_GROUPE = 8;

async function lignes(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

async function attention(admin, { livrables = [], entreprises = [], now = new Date(), env = process.env } = {}) {
  const depuis = new Date(now.getTime() - JOURS * 24 * 3600 * 1000).toISOString();
  const nomEntreprise = Object.fromEntries(entreprises.map((e) => [e.id, e.nom]));
  const erreurs = [];
  const groupes = [];

  // 1. Livrables à valider.
  const aValider = livrables.filter((l) => l.statut === 'a_valider');
  groupes.push({
    id: 'livrables', emoji: '🕵️', titre: 'Livrables à valider', total: aValider.length,
    items: aValider.slice(0, MAX_PAR_GROUPE).map((l) => ({
      titre: clip(l.titre, 140),
      detail: `${l.entreprise || nomEntreprise[l.entreprise_id] || '—'} · ${fmt.jour(l.created_at)}`,
      action: { href: `/admin/console?vue=robots#livrable-${l.id}`, label: '👀 Relire et publier' },
    })),
  });

  // 2. Nouvelles activations.
  let activations = [];
  try {
    activations = (await lignes(admin.from('robots_actifs').select('id, entreprise_id, robot, statut, created_at').gte('created_at', depuis)))
      .filter((r) => r.statut !== 'annule')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } catch (err) {
    logger.warn('[cockpit] robots_actifs illisible :', err.message);
    erreurs.push('Activations : exécutez db/006_robots.sql.');
  }
  groupes.push({
    id: 'activations', emoji: '⚡', titre: 'Nouvelles activations', total: activations.length,
    items: activations.slice(0, MAX_PAR_GROUPE).map((r) => ({
      titre: `${nomEntreprise[r.entreprise_id] || 'Un client'} a activé « ${r.robot} »`,
      detail: fmt.jour(r.created_at),
      action: { href: '/admin/console?vue=robots', label: '🤝 Voir l’abonnement' },
    })),
  });

  // 3. Alertes finances du mois.
  let alertes = [];
  let mois = null;
  try {
    const fin = await finances.loadFinances(admin, {
      now, stripe: null, usdToCad: env.FINANCES_USD_CAD, fmtMoney: (c) => fmt.money(c / 100),
    });
    alertes = (fin.alerts || []).filter((a) => a.niveau === 'critique' || a.niveau === 'attention');
    mois = fin.periode && fin.periode.mois;
    notifications.enArrierePlan(notifications.alertesFinances(admin, alertes, mois || 'mois'));
  } catch (err) {
    logger.warn('[cockpit] finances illisibles :', err.message);
    erreurs.push('Finances : exécutez db/007_finances.sql.');
  }
  groupes.push({
    id: 'finances', emoji: '💰', titre: 'Alertes finances', total: alertes.length,
    items: alertes.slice(0, MAX_PAR_GROUPE).map((a) => ({
      titre: `${a.niveau === 'critique' ? '🔴' : '🟠'} ${a.titre}`,
      detail: clip(a.detail, 200),
      action: { href: '/admin/console?vue=finances', label: '💰 Voir les finances' },
    })),
  });

  // 4. Conseils terminés.
  let conseils = [];
  try {
    conseils = (await lignes(admin.from('agent_jobs').select('id, kind, status, payload, result, finished_at').eq('kind', 'debate').eq('status', 'done').gte('finished_at', depuis)))
      .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
  } catch (err) {
    logger.warn('[cockpit] agent_jobs illisible :', err.message);
    erreurs.push('Conseils : exécutez db/003_moteur_agents.sql.');
  }
  groupes.push({
    id: 'conseils', emoji: '🧠', titre: 'Conseils terminés', total: conseils.length,
    items: conseils.slice(0, MAX_PAR_GROUPE).map((j) => {
      const r = j.result || {};
      const accord = typeof r.accord === 'number' ? ` · accord ${Math.round(r.accord * 100)} %` : '';
      return {
        titre: clip((j.payload && j.payload.sujet) || 'Décision du Conseil', 140),
        detail: `${r.consensus ? 'Consensus' : 'Sans consensus'}${accord} · ${fmt.jour(j.finished_at)}`,
        action: { href: '/admin/console?vue=conseil', label: '🧠 Lire la décision' },
      };
    }),
  });

  return { groupes, total: groupes.reduce((s, g) => s + g.total, 0), erreurs, jours: JOURS };
}

module.exports = { attention, JOURS };
