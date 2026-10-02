// Stand-in for the Anthropic Messages API, for the local demo only. It is
// passed to createLLM() as fetchImpl, so the real engine (llm, budget,
// protocol, worker) runs end to end without a key and without spending.
// Every answer says it is a simulation; sources point to example.org.

const { SHAPES } = require('../../agents/protocol');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body) {
  const msgs = (body.messages || []).filter((m) => m.role === 'user');
  const m = msgs[msgs.length - 1];
  if (!m) return '';
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
}

function between(text, start) {
  const i = text.indexOf(start);
  if (i < 0) return '';
  return text.slice(i + start.length).split('\n')[0].trim().slice(0, 160);
}

function councilAnswer(kind, sujet) {
  const s = sujet || 'le sujet';
  switch (kind) {
    case 'plan':
      return {
        questions: [`Quelle option répond le mieux à « ${s} » ?`, 'Quel budget et quel délai sont réalistes ?', 'Quels risques Loi 25 faut-il lever ?'],
        criteres: ['Revenus récurrents en 90 jours (estimation)', 'Coût de départ sous 100 $ par mois', 'Conformité Loi 25 et Loi 96'],
        taches: ['Vérifier les prix concurrents à la source', 'Lister 5 PME à appeler', 'Rédiger une offre pilote'],
      };
    case 'proposition':
      return {
        position: `[Démo] Commencer petit : un pilote de 21 jours sur « ${s} », avec 3 PME, livré à la main.`,
        arguments: ['Risque faible et réversible', 'Apprend vite ce que les clients paient', 'Aucun renseignement personnel requis au départ'],
        premiere_action: 'Appeler 5 PME du réseau lundi matin.',
        confiance: 0.72,
      };
    case 'objections':
      return {
        objections: [
          { cible: 'P1', objection: '[Démo] Aucune preuve que les PME paieront ce prix : il faut un engagement écrit.', gravite: 4 },
          { cible: 'P2', objection: '[Démo] Le délai de 21 jours est serré pour la révision juridique.', gravite: 3 },
        ],
        contre_proposition: '[Démo] Prévente d’abord : 3 engagements écrits avant de construire quoi que ce soit.',
      };
    case 'revision':
      return { position: '[Démo] Pilote de 21 jours, mais seulement après 3 engagements écrits.', reponse: 'J’accepte le seuil de prévente.', concede: ['Le prix reste une hypothèse'] };
    case 'arbitre':
      return { proposition: `[Démo] Prévente de 14 jours puis pilote de 21 jours pour « ${s} ».`, compromis: 'Prévente avant construction', points_ouverts: ['Prix final', 'Avis juridique'] };
    case 'vote':
      return { vote: 'pour', confiance: 0.8, raison: '[Démo] Test borné et réversible.', condition: '' };
    case 'final':
      return {
        decision: `[Démo] Lancer une prévente de 14 jours sur « ${s} », puis un pilote de 21 jours si 3 PME s’engagent par écrit.`,
        justification: 'Simulation de démonstration : risque faible, apprentissage rapide, conformité préservée.',
        plan: ['Semaine 1 : liste de PME et offre écrite', 'Semaine 2 : appels et engagements', 'Semaines 3 à 5 : pilote livré à la main', 'Semaine 6 : bilan et décision'],
        taches: [
          { titre: '[Démo] Liste de 5 PME à appeler', detail: 'Nom, besoin, contact autorisé', responsable: 'toi', echeance: 'vendredi' },
          { titre: '[Démo] Offre pilote d’une page', detail: 'Prix, durée, garantie', responsable: 'agents', echeance: 'mercredi' },
        ],
        dissidence: '[Démo] Un contradicteur juge le prix trop bas.',
        risques: ['Prix non validé', 'Délai juridique'],
        points_a_valider: ['Prix de l’offre', 'Clause de responsabilité'],
      };
    default:
      return {};
  }
}

const RESEARCH_SOURCES = [
  { url: 'https://example.org/demo/source-1', title: 'Source de démonstration 1 (example.org)' },
  { url: 'https://example.org/demo/source-2', title: 'Source de démonstration 2 (example.org)' },
  { url: 'https://example.com/demo/source-3', title: 'Source de démonstration 3 (example.com)' },
];

function researchContent(question) {
  return [
    { type: 'server_tool_use', id: 'srvtoolu_demo', name: 'web_search', input: { query: question } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_demo',
      content: RESEARCH_SOURCES.map((s) => ({ type: 'web_search_result', url: s.url, title: s.title, encrypted_content: 'demo' })),
    },
    { type: 'text', text: `[Démo : recherche simulée, aucune page réelle n’a été lue]\n\nRéponse courte : voici à quoi ressemble une synthèse pour « ${question} ».\n\nPoints clés :\n- ` },
    {
      type: 'text',
      text: 'Premier point appuyé sur une source citée.',
      citations: [{ type: 'web_search_result_location', url: RESEARCH_SOURCES[0].url, title: RESEARCH_SOURCES[0].title, cited_text: 'Extrait de démonstration de la première source.', encrypted_index: 'demo' }],
    },
    { type: 'text', text: '\n- ' },
    {
      type: 'text',
      text: 'Deuxième point, avec une autre source.',
      citations: [{ type: 'web_search_result_location', url: RESEARCH_SOURCES[1].url, title: RESEARCH_SOURCES[1].title, cited_text: 'Extrait de démonstration de la deuxième source.', encrypted_index: 'demo' }],
    },
    { type: 'text', text: '\n\nLimites : les chiffres réels sont [à vérifier] avec une vraie clé API.' },
  ];
}

// Answers of the Croissance tab (marker [croissance:<type>] in the
// instruction, see routes(api)/utils/croissance.js).
function croissanceAnswer(text) {
  const m = /\[croissance:([a-z_]+)\]/.exec(text);
  if (!m) return null;
  const page = (/la page « ([^»]+) »/.exec(text) || [])[1] || 'la page';
  switch (m[1]) {
    case 'seo':
      return JSON.stringify({
        title: `${page} : IA et marketing pour PME du Québec | PBTM`.slice(0, 65),
        description: `[Démo] ${page} de PBTM : solutions d’IA, agents IA et marketing numérique pour les PME du Québec. Parlons de votre projet.`.slice(0, 160),
        justification: '[Démo : proposition simulée] Mot-clé cible dans le titre, appel à l’action dans la description.',
        faq: [{ q: `Que propose PBTM sur la page ${page} ?`, r: '[Démo] Une réponse courte et vérifiable, à relire.' }],
      });
    case 'aeo_questions':
      return JSON.stringify({ questions: [
        { question: 'Combien coûte un agent IA pour une PME au Québec ? (démo)', page: 'techai' },
        { question: 'Qui peut m’aider à faire du marketing numérique en français ? (démo)', page: 'marketing' },
        { question: 'Où suivre une formation en IA en ligne au Québec ? (démo)', page: 'education' },
      ] });
    case 'aeo_reponses': {
      const ids = [...text.matchAll(/- \[([0-9a-f-]{36})\]/g)].map((x) => x[1]);
      return JSON.stringify({ reponses: ids.map((id) => ({ id, reponse: '[Démo] PBTM, entreprise québécoise, répond en 40 à 60 mots avec des faits vérifiables, relus par un humain avant publication.' })) });
    }
    case 'approche':
      return 'Objet : Une idée de sujet pour vos lecteurs (démo)\n\nBonjour,\n\n[Démo : texte simulé, aucun modèle n’a été appelé] Je m’appelle [prénom], de PBTM (Panda Business Tech & Marketing)…\n\nSi vous préférez ne plus recevoir de message de notre part, dites-le-moi simplement.\n\n[prénom] · PBTM · [moyen de nous joindre]';
    case 'communique':
      return '[Démo : texte simulé]\n\nTITRE DU COMMUNIQUÉ\n\n[Ville], le [date] – PBTM (Panda Business Tech & Marketing) annonce…\n\n« [citation à valider] »\n\nÀ propos de PBTM\n…\n\n– 30 –\n\nContact médias : [à compléter]';
    default:
      return null;
  }
}

function reply(body, content, { searches = 0, input = 1400, output = 650 } = {}) {
  const data = {
    id: 'msg_demo',
    type: 'message',
    role: 'assistant',
    model: body.model,
    stop_reason: 'end_turn',
    content,
    usage: { input_tokens: input, output_tokens: output, server_tool_use: { web_search_requests: searches } },
  };
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
}

function createFakeAnthropic({ delayMs = 1500 } = {}) {
  return async function fakeFetch(url, init) {
    const body = JSON.parse(init.body);
    const text = lastUserText(body);
    if ((body.tools || []).some((t) => t.name === 'web_search')) {
      await wait(delayMs * 3);
      const question = between(text, 'Question de recherche de Pandora :') || 'la question';
      return reply(body, researchContent(question), { searches: 3, input: 9000 });
    }
    const kind = Object.keys(SHAPES).find((k) => text.includes(SHAPES[k]));
    if (kind) {
      await wait(delayMs);
      const sujet = between(text, 'Sujet soumis au Conseil par Pandora :');
      return reply(body, [{ type: 'text', text: JSON.stringify(councilAnswer(kind, sujet)) }], { output: 400 });
    }
    const croissance = croissanceAnswer(text);
    if (croissance) {
      await wait(delayMs * 2);
      return reply(body, [{ type: 'text', text: croissance }]);
    }
    await wait(delayMs * 3);
    const instruction = between(text, 'Instruction de Pandora :') || 'la demande';
    return reply(body, [{
      type: 'text',
      text: `[Démo : texte simulé, aucun modèle n’a été appelé]\n\nVoici le livrable demandé : « ${instruction} ».\n\n1. Ce qu’on propose\n2. Pourquoi\n3. Prochaines étapes\n\nÀ valider par un humain\n- Les chiffres et les noms\n- Le ton avant l’envoi`,
    }]);
  };
}

module.exports = { createFakeAnthropic, councilAnswer, croissanceAnswer };
