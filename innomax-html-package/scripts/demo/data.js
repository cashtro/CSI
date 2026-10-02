// Example data of the local demo: an admin, two companies, the 38 starting
// agents, a few jobs (orders, a research, a finished Council taken from the
// artifact's "concept de rupture" deliberation) and some activity.

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const catalog = require('../../agents/catalog');
const { monthStart } = require('../../agents/budget');

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const ENT_A = '10000000-0000-4000-8000-000000000001';
const ENT_B = '10000000-0000-4000-8000-000000000002';

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

// Artifact debate (agent names, confidence 0-100) -> engine result format.
function councilFromArtifact(d, idByName) {
  const r = d.run || {};
  const id = (name) => idByName[name] || name;
  const pct = (v) => Math.max(0, Math.min(1, (Number(v) || 0) / 100));
  const grouped = {};
  for (const o of r.objections || []) {
    grouped[o.agent] = grouped[o.agent] || { agent: id(o.agent), nom: o.agent, objections: [], contre_proposition: (r.contre_propositions || {})[o.agent] || '' };
    grouped[o.agent].objections.push({ cible: o.cible, objection: o.objection, gravite: o.gravite });
  }
  const tours = (r.rounds || []).map((t) => ({
    tour: t.n,
    arbitre: {
      proposition: t.proposition && t.proposition.proposition,
      compromis: [].concat((t.proposition && t.proposition.compromis) || []).join(' ; '),
      points_ouverts: (t.proposition && t.proposition.points_ouverts) || [],
    },
    votes: (t.votes || []).map((v) => ({ agent: id(v.agent), nom: v.agent, vote: v.vote, confiance: pct(v.confiance), raison: v.raison, condition: v.condition || '' })),
    accord: t.accord,
    consensus: t.accord >= 0.7,
  }));
  const last = tours[tours.length - 1] || { accord: 0, consensus: false };
  const f = r.final || {};
  return {
    payload: {
      sujet: d.topic,
      contexte: d.contexte || null,
      proposeurs: (r.cast.proposers || []).map(id),
      contradicteurs: (r.cast.critics || []).map(id),
      votants: [],
      planificateur: id(r.cast.planner),
      arbitre: id(r.cast.arbiter),
      reviseur: id(r.cast.reviewer),
    },
    result: {
      protocole: 'conseil',
      sujet: d.topic,
      phase: 'termine',
      erreurs: [],
      plan: { questions: r.plan.questions, criteres: r.plan.criteres, taches: (r.plan.taches || []).map((t) => t.titre) },
      propositions: (r.propositions || []).map((p) => ({ agent: id(p.agent), nom: p.agent, position: p.position, arguments: p.arguments, premiere_action: p.premiere_action, confiance: pct(p.confiance) })),
      objections: Object.values(grouped),
      revisions: (r.revisions || []).map((v) => ({ agent: id(v.agent), nom: v.agent, position: v.position, reponse: v.reponse, concede: v.concede ? [v.concede] : [] })),
      tours,
      accord: last.accord,
      consensus: last.consensus,
      decision: {
        decision: f.decision,
        justification: f.justification,
        plan: f.plan,
        taches: (f.taches || []).map((t) => ({ titre: t.titre, detail: t.detail, responsable: t.responsable, echeance: t.echeance || '' })),
        dissidence: f.dissidence,
        risques: f.risques,
        points_a_valider: f.points_a_valider,
      },
      taches_creees: (f.taches || []).length,
    },
    tasks: (f.taches || []).map((t) => ({ title: t.titre, detail: t.detail || null, owner: t.responsable || null, due: t.echeance || null })),
  };
}

async function seedDemo(db) {
  const tables = db.tables;
  Object.assign(tables, {
    Users: [{ userId: ADMIN_ID, email: 'fondateur@demo.local', username: 'Fondateur (démo)', isAdmin: true }],
    Users_2fa: [{ userId: ADMIN_ID, enabled: true }],
    entreprises: [
      { id: ENT_A, nom: 'Clinique Horizon (démo)', courriel: 'contact@horizon.demo', created_at: ago(60 * 24 * 20) },
      { id: ENT_B, nom: 'Boulangerie Lumière (démo)', courriel: 'bonjour@lumiere.demo', created_at: ago(60 * 24 * 9) },
    ],
    membres: [],
    mandats: [],
    livrables: [],
    bills: [],
    site_content: [],
    agents: [],
    agent_jobs: [],
    agent_activity: [],
    agent_tasks: [],
    agent_usage: [],
    agent_workers: [],
    agent_settings: [{ id: 1, enabled: true, monthly_budget_usd: 60, model_quick: null, model_default: null, model_complex: null, concurrency: 2 }],
  });

  await catalog.seedAgents(db, catalog.loadSeed());
  const idByName = Object.fromEntries(tables.agents.map((a) => [a.name, a.id]));
  const job = (row) => {
    const j = {
      id: crypto.randomUUID(), priority: 0, attempts: 1, max_attempts: 3, locked_by: null, locked_at: null, run_after: ago(0),
      error: null, cost_usd: 0, tokens_in: 0, tokens_out: 0, entreprise_id: null, created_by: ADMIN_ID, started_at: null, finished_at: null, ...row,
    };
    j.updated_at = j.finished_at || j.created_at;
    tables.agent_jobs.push(j);
    return j;
  };

  // Finished Council (artifact example data).
  const file = path.join(__dirname, 'conseil-concept-rupture.json');
  const council = councilFromArtifact(JSON.parse(fs.readFileSync(file, 'utf8')), idByName);
  const debate = job({ kind: 'debate', status: 'done', payload: council.payload, result: council.result, cost_usd: 1.8421, tokens_in: 182000, tokens_out: 41000, created_at: ago(180), started_at: ago(179), finished_at: ago(140) });
  council.tasks.forEach((t, i) => tables.agent_tasks.push({ id: crypto.randomUUID(), job_id: debate.id, status: i < 2 ? 'a_faire' : 'a_valider', entreprise_id: null, created_at: ago(140), ...t }));

  // Orders and a research.
  job({
    kind: 'order', status: 'done', entreprise_id: ENT_A, created_at: ago(95), started_at: ago(94), finished_at: ago(93), cost_usd: 0.0412, tokens_in: 3100, tokens_out: 2200,
    payload: { agent_id: 'contenu-strategie', instruction: 'Écris le calendrier éditorial d’octobre pour la clinique, en français d’abord.' },
    result: { protocole: 'ordre', agent: 'contenu-strategie', agent_name: 'Plume', texte: '[Démo] Calendrier éditorial d’octobre\n\nSemaine 1 : conseils de prévention (Instagram, Facebook)\nSemaine 2 : témoignage patient, avec consentement écrit\nSemaine 3 : vidéo courte « une journée à la clinique »\nSemaine 4 : infolettre mensuelle (consentement LCAP vérifié)\n\nÀ valider par un humain\n- Les consentements des patients\n- Les dates de publication', tronque: false },
  });
  job({
    kind: 'order', status: 'done', entreprise_id: ENT_B, created_at: ago(70), started_at: ago(69), finished_at: ago(68), cost_usd: 0.0287, tokens_in: 2400, tokens_out: 1500,
    payload: { agent_id: 'web-architecte', instruction: 'Propose l’architecture du site de commande en ligne de la boulangerie.' },
    result: { protocole: 'ordre', agent: 'web-architecte', agent_name: 'Ossature', texte: '[Démo] Architecture proposée\n\n1. Site statique rapide (pages produits, horaires)\n2. Commande avec paiement Stripe\n3. Tableau de bord des commandes du jour\n\nÀ valider par un humain\n- Les frais Stripe\n- La politique de confidentialité (Loi 25)', tronque: false },
  });
  job({
    kind: 'research', status: 'done', created_at: ago(50), started_at: ago(49), finished_at: ago(48), cost_usd: 0.0631, tokens_in: 21000, tokens_out: 1800,
    payload: { agent_id: catalog.DEFAULT_RESEARCH_AGENT, question: 'Quelles obligations de la Loi 25 touchent une PME qui utilise des agents IA ?', max_uses: 5 },
    result: {
      protocole: 'recherche', agent: catalog.DEFAULT_RESEARCH_AGENT, agent_name: 'Cap', question: 'Quelles obligations de la Loi 25 touchent une PME qui utilise des agents IA ?', recherches: 3, erreurs_recherche: [], tronque: false,
      texte: '[Démo : recherche simulée, aucune page réelle n’a été lue]\n\nRéponse courte : une PME doit désigner un responsable de la protection des renseignements personnels, informer les personnes d’une décision automatisée et évaluer les facteurs relatifs à la vie privée avant certains transferts [à vérifier].\n\nPoints clés :\n- Responsable désigné et politique publiée\n- Avis de décision fondée exclusivement sur un traitement automatisé\n- ÉFVP avant une communication hors Québec\n\nLimites : synthèse de démonstration, à refaire avec une vraie clé API.',
      sources: [
        { url: 'https://example.org/demo/loi-25-responsable', titre: 'Source de démonstration : responsable (example.org)', cite: true, extrait: 'Extrait de démonstration.' },
        { url: 'https://example.org/demo/decision-automatisee', titre: 'Source de démonstration : décision automatisée (example.org)', cite: true, extrait: null },
        { url: 'https://example.com/demo/efvp', titre: 'Source de démonstration : ÉFVP (example.com)', cite: false, extrait: null },
      ],
    },
  });
  job({
    kind: 'order', status: 'error', created_at: ago(40), started_at: ago(39), finished_at: ago(39), error: '[Démo] API Anthropic 529 (overloaded_error) après 3 tentatives',
    payload: { agent_id: 'marketing-seo', instruction: 'Audit SEO de la page d’accueil de pandorabrains.com.' },
  });
  job({ kind: 'order', status: 'queued', created_at: ago(1), attempts: 0, payload: { agent_id: 'ventes-strategie', instruction: 'Prépare une offre pilote d’une page pour le Conseil, à 290 $ (estimation).' } });

  // Activity of the morning (ascending ids, like the bigserial).
  const feed = [
    [debate.id, null, 'job_queued', 'Conseil mis en file', 181],
    [debate.id, null, 'job_started', 'Conseil démarré (tentative 1)', 179],
    [debate.id, null, 'phase', 'Conseil : propositions', 172],
    [debate.id, null, 'phase', 'Conseil : objections', 163],
    [debate.id, null, 'phase', 'Conseil : vote', 150],
    [debate.id, null, 'job_done', 'Conseil terminé (31 appels, 1.8421 $)', 140],
    [null, 'contenu-strategie', 'job_done', 'Ordre terminé (1 appels, 0.0412 $)', 93],
    [null, 'web-architecte', 'job_done', 'Ordre terminé (1 appels, 0.0287 $)', 68],
    [null, catalog.DEFAULT_RESEARCH_AGENT, 'job_done', 'Recherche terminée (1 appels, 3 recherche(s) web, 0.0631 $)', 48],
    [null, 'marketing-seo', 'job_error', '[Démo] API Anthropic 529 (overloaded_error)', 39],
    [null, 'ventes-strategie', 'job_queued', 'Ordre mis en file', 1],
  ];
  feed.forEach(([jobId, agentId, kind, message, min], i) => tables.agent_activity.push({ id: i + 1, job_id: jobId, agent_id: agentId, kind, message, data: null, created_at: ago(min) }));

  // Spend of the month (the budget bar).
  const day = monthStart();
  tables.agent_usage.push(
    { day, model: 'claude-sonnet-5-5', calls: 41, tokens_in: 208000, tokens_out: 46500, cost_usd: 0.8810 },
    { day, model: 'claude-opus-5-5', calls: 4, tokens_in: 26000, tokens_out: 9000, cost_usd: 0.2840 },
    { day, model: 'claude-haiku-4-5-20251001', calls: 10, tokens_in: 12000, tokens_out: 3000, cost_usd: 0.0270 },
    { day, model: 'web_search', calls: 1, tokens_in: 0, tokens_out: 0, cost_usd: 0.03 },
  );
  return { adminId: ADMIN_ID, entreprises: [ENT_A, ENT_B], debateId: debate.id };
}

module.exports = { seedDemo, councilFromArtifact, ADMIN_ID, ENT_A, ENT_B };
