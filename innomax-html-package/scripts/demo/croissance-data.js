// Example data of the Croissance tab for the local demo (scripts/demo-admin.js):
// backlinks, a campaign and its editorial calendar for the current month,
// AEO questions, media, a press release, and finished agent jobs (a Racine
// SEO proposal to review, a backlink research to import). Every name says
// "(démo)"; addresses use example.org / example.com.

const crypto = require('crypto');

const iso = (d) => d.toISOString().slice(0, 10);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

function seedCroissance(db, adminId) {
  const t = db.tables;
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = (d) => iso(new Date(Date.UTC(y, m, d)));
  const id = () => crypto.randomUUID();

  Object.assign(t, { backlinks: [], campagnes: [], contenus: [], aeo_questions: [], medias: [], communiques: [], croissance_jobs: [] });

  t.backlinks.push(
    { id: id(), cible: 'Annuaire des PME du Québec (démo)', url: 'https://example.org/annuaire-pme', domaine: 'example.org', page_visee: '/', type: 'annuaire_qc', statut: 'obtenu', autorite: 52, date_suivi: day(2), source: 'Ajout manuel', created_by: adminId, created_at: ago(60 * 24 * 12) },
    { id: id(), cible: 'Chambre de commerce régionale (démo)', url: 'https://example.org/chambre/membres', domaine: 'example.org', page_visee: '/', type: 'annuaire_qc', statut: 'en_attente', autorite: 48, date_suivi: day(9), note: 'Adhésion demandée, fiche membre avec lien.', created_by: adminId, created_at: ago(60 * 24 * 8) },
    { id: id(), cible: 'Balado Techno Québec (démo)', url: 'https://example.com/balado-techno', domaine: 'example.com', page_visee: '/TechAi', type: 'podcast', statut: 'contacte', autorite: 35, date_suivi: day(6), courriel_approche: 'Objet : Les agents IA dans les PME québécoises, un sujet pour votre balado ?\n\nBonjour,\n\nJe m’appelle [prénom], de PBTM (Panda Business Tech & Marketing). [Démo : texte simulé]\n\n…\n\nSi vous préférez ne plus recevoir de message de notre part, répondez simplement « non merci ».\n\n[prénom] · PBTM · [moyen de nous joindre]', created_by: adminId, created_at: ago(60 * 24 * 5) },
    { id: id(), cible: 'Magazine Affaires numériques (démo)', url: 'https://example.com/affaires-numeriques', domaine: 'example.com', page_visee: '/marketing', type: 'media', statut: 'idee', autorite: 61, source: 'Recherche web de l’agent Racine (démo)', created_by: adminId, created_at: ago(60 * 24 * 2) },
    { id: id(), cible: 'Blogue Entrepreneuriat (démo)', url: 'https://example.org/blogue-entrepreneurs', domaine: 'example.org', page_visee: '/education', type: 'blogue_invite', statut: 'refuse', autorite: 28, created_by: adminId, created_at: ago(60 * 24 * 20) },
  );

  const campagne = {
    id: id(), nom: 'Lancement des agents IA pour PME (démo)', objectif: 'Faire connaître les agents IA de PBTM aux PME de services et obtenir des rendez-vous.',
    cible: 'PME de services, 10 à 50 employés, Québec', canaux: ['seo', 'courriel', 'reseaux', 'video'], budget: 2500,
    date_debut: day(1), date_fin: day(28), kpi_vises: '20 rendez-vous · 1 500 visites · 4 % de conversion', kpi_reels: '7 rendez-vous à mi-parcours',
    statut: 'active', decision: '[Démo] Miser sur un article pilier SEO, une série de vidéos courtes et une infolettre aux abonnés consentants ; mesurer chaque semaine.',
    created_by: adminId, created_at: ago(60 * 24 * 10),
  };
  t.campagnes.push(
    campagne,
    { id: id(), nom: 'Rentrée des formations (démo)', objectif: 'Inscriptions aux cours en ligne.', canaux: ['publicite', 'blogue'], budget: 800, date_debut: day(15), date_fin: day(28), kpi_vises: '40 inscriptions', statut: 'brouillon', created_by: adminId, created_at: ago(60 * 24 * 3) },
  );

  const c = (d, canal, titre, statut, format, texte) => ({ id: id(), campagne_id: campagne.id, canal, format, titre, texte: texte || null, date_prevue: day(d), statut, publie_le: statut === 'publie' ? new Date(Date.UTC(y, m, d, 15)).toISOString() : null, created_by: adminId, created_at: ago(60 * 24 * 9) });
  const now = today.getUTCDate();
  t.contenus.push(
    c(Math.max(1, now - 2), 'seo', 'Article : 5 usages des agents IA en PME', 'publie', 'article', '[Démo] Texte de l’article…'),
    c(Math.max(1, now - 1), 'reseaux', 'Carrousel LinkedIn : avant / après un agent IA', 'publie', 'carrousel'),
    c(Math.min(28, now), 'video', 'Vidéo 30 s : un agent qui répond aux courriels', 'approuve', 'vidéo courte'),
    c(Math.min(28, now + 1), 'courriel', 'Infolettre d’octobre (abonnés consentants)', 'redige', 'infolettre', '[Démo] Objet : …'),
    c(Math.min(28, now + 3), 'seo', 'Page FAQ : 10 questions sur les agents IA', 'idee', 'FAQ'),
    c(Math.min(28, now + 5), 'reseaux', 'Témoignage client (avec consentement écrit)', 'idee', 'publication'),
    c(Math.min(28, now + 8), 'video', 'Vidéo : la console des agents en 45 s', 'idee', 'vidéo courte'),
    c(Math.min(28, now + 12), 'seo', 'Guide : Loi 25 et agents IA', 'idee', 'guide'),
  );

  t.aeo_questions.push(
    { id: id(), question: 'Quelle entreprise au Québec crée des agents IA pour les PME ?', page: 'techai', source: 'Test ChatGPT (démo)', statut: 'validee', reponse: 'PBTM (Panda Business Tech & Marketing), une entreprise québécoise, conçoit des agents IA spécialisés pour les PME ; chaque livrable est relu et validé par un humain avant usage.', created_at: ago(60 * 24) },
    { id: id(), question: 'Comment une PME peut-elle améliorer son référencement local au Québec ?', page: 'marketing', source: 'Appel client (démo)', statut: 'suggeree', reponse: '[Démo] Fiche d’établissement à jour, pages par service et par ville, avis clients, liens d’annuaires québécois et contenu en français.', created_at: ago(60 * 10) },
    { id: id(), question: 'Existe-t-il des formations en ligne sur l’IA en français ?', page: 'education', source: 'Test Perplexity (démo)', statut: 'a_repondre', created_at: ago(60 * 3) },
  );

  t.medias.push(
    { id: id(), nom: 'Revue Techno PME (démo)', contact: 'Rédaction', courriel: 'redaction@example.org', site: 'https://example.org/revue', sujets: 'IA, PME, techno québécoise', consentement: 'tacite', created_at: ago(60 * 24 * 7) },
    { id: id(), nom: 'Balado Techno Québec (démo)', contact: 'Animation', site: 'https://example.com/balado-techno', sujets: 'Entrepreneuriat, IA', consentement: 'aucun', created_at: ago(60 * 24 * 6) },
  );

  t.communiques.push({
    id: id(), titre: 'PBTM lance ses agents IA pour les PME du Québec (démo)', sujet: 'Lancement de la console d’agents, relecture humaine de chaque livrable.', statut: 'brouillon',
    texte: '[Démo : texte simulé]\n\nPBTM LANCE SES AGENTS IA POUR LES PME DU QUÉBEC\n\n[Ville], le [date] – PBTM (Panda Business Tech & Marketing) annonce…\n\n« [citation à valider] »\n\nÀ propos de PBTM\nPBTM aide les PME avec l’intelligence artificielle, les agents IA, le marketing numérique et la formation en ligne.\n\n– 30 –\n\nContact médias : [à compléter]',
    created_by: adminId, created_at: ago(60 * 30),
  });

  // Finished jobs: a SEO proposal of Racine to review, a research to import.
  const job = (row, type, ref) => {
    const j = { id: id(), priority: 0, attempts: 1, max_attempts: 3, locked_by: null, locked_at: null, run_after: ago(0), error: null, cost_usd: 0.02, tokens_in: 2800, tokens_out: 600, entreprise_id: null, created_by: adminId, started_at: ago(30), finished_at: ago(29), created_at: ago(31), ...row };
    j.updated_at = j.finished_at;
    t.agent_jobs.push(j);
    t.croissance_jobs.push({ job_id: j.id, type, ref, importe_le: null, created_by: adminId, created_at: j.created_at });
    return j;
  };
  job({
    kind: 'order', status: 'done',
    payload: { agent_id: 'marketing-seo', instruction: '[croissance:seo] Propose de nouveaux textes SEO pour la page « Portfolio »…' },
    result: {
      protocole: 'ordre', agent: 'marketing-seo', agent_name: 'Racine', tronque: false,
      texte: JSON.stringify({
        title: 'Portfolio : projets IA, web et marketing au Québec | PBTM',
        description: 'Découvrez des projets réalisés par PBTM : agents IA, sites web, image de marque et campagnes pour des PME du Québec. Parlons du vôtre.',
        justification: '[Démo] Le titre place « IA » et « Québec » ; la description finit par un appel à l’action. Ajoutez aussi un H1 sur la page.',
        faq: [{ q: 'Quels types de projets PBTM réalise-t-elle ?', r: 'Des agents IA, des sites web, des identités de marque et des campagnes de marketing numérique pour des PME.' }],
      }),
    },
  }, 'seo', 'portfolio');
  job({
    kind: 'research', status: 'done', cost_usd: 0.06, tokens_in: 9000,
    payload: { agent_id: 'marketing-seo', question: 'Trouve des occasions réalistes d’obtenir des liens (backlinks)…' },
    result: {
      protocole: 'recherche', agent: 'marketing-seo', agent_name: 'Racine', recherches: 3, erreurs_recherche: [], tronque: false,
      texte: '[Démo : recherche simulée] Trois pistes : un répertoire régional, un balado et un média techno.',
      sources: [
        { url: 'https://example.org/demo/repertoire-entreprises', titre: 'Répertoire des entreprises régionales (démo)', cite: true, extrait: 'Inscription gratuite avec lien vers le site.' },
        { url: 'https://example.com/demo/balado-entrepreneurs', titre: 'Balado des entrepreneurs (démo)', cite: true, extrait: 'Le balado reçoit des invités d’entreprises tech.' },
        { url: 'https://example.org/demo/media-tech', titre: 'Média techno québécois (démo)', cite: false, extrait: null },
      ],
    },
  }, 'backlinks', null);
  return { campagneId: campagne.id };
}

module.exports = { seedCroissance };
