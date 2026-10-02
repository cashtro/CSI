// Data of the public SEO (no dependency, so utils/cms.js can list the CMS
// zones without a require cycle). Used by utils/seo.js and the SEO audit.

const BRAND = 'PBTM';
const LEGAL_NAME = 'Panda Business Tech & Marketing';
const DEFAULT_URL = 'https://pandorabrains.com';
const LOGO = '/assets/img/logo/cropped-LogoPB512gold-1.webp';
const ORG_DESCRIPTION = 'PBTM (Panda Business Tech & Marketing) est une entreprise québécoise qui aide les PME avec l’intelligence artificielle, les agents IA, le marketing numérique, la formation en ligne et des projets NFT.';

// Public pages. `view` is the EJS view, `path` the URL, `motsCles` the
// target keywords checked by the SEO audit.
const PAGES = [
  {
    id: 'accueil', path: '/', view: 'home4', label: 'Accueil', priority: '1.0', changefreq: 'weekly',
    title: 'PBTM | IA, agents IA et marketing pour les PME du Québec',
    description: 'PBTM aide les PME du Québec à croître : solutions d’intelligence artificielle, agents IA, marketing numérique, formations en ligne, NFT et boutique.',
    motsCles: ['IA', 'marketing', 'Québec', 'PME'],
  },
  {
    id: 'techai', path: '/TechAi', view: 'TechAndAi', label: 'Tech et IA', priority: '0.9', changefreq: 'monthly',
    title: 'Solutions IA et agents IA pour entreprises | PBTM',
    description: 'Automatisation, agents IA, analyse de données et solutions sur mesure : PBTM conçoit l’intelligence artificielle utile aux PME québécoises.',
    motsCles: ['IA', 'agents', 'automatisation', 'données'],
  },
  {
    id: 'marketing', path: '/marketing', view: 'marketing', label: 'Marketing numérique', priority: '0.9', changefreq: 'monthly',
    title: 'Marketing numérique, SEO et publicité au Québec | PBTM',
    description: 'SEO, publicité en ligne, réseaux sociaux et courriel : PBTM bâtit des campagnes de marketing numérique mesurables pour les PME du Québec.',
    motsCles: ['marketing', 'SEO', 'publicité', 'réseaux sociaux'],
  },
  {
    id: 'education', path: '/education', view: 'education', label: 'Éducation', priority: '0.8', changefreq: 'weekly',
    title: 'Formations en ligne en IA, tech et marketing | PBTM',
    description: 'Apprenez l’IA, la technologie et le marketing numérique avec les formations en ligne de PBTM : cours guidés, certificats et suivi de progrès.',
    motsCles: ['formation', 'cours', 'IA', 'marketing'],
  },
  {
    id: 'cours', path: '/all-courses', view: 'all-courses', label: 'Tous les cours', parent: 'education', priority: '0.8', changefreq: 'weekly',
    title: 'Catalogue des cours en ligne | PBTM Éducation',
    description: 'Tous les cours en ligne de PBTM : intelligence artificielle, technologie et marketing numérique, à suivre à votre rythme.',
    motsCles: ['cours', 'formation', 'en ligne'],
  },
  {
    id: 'nft', path: '/nft', view: 'nft', label: 'NFT', priority: '0.6', changefreq: 'monthly',
    title: 'NFT à avantages réels : rabais et services | PBTM',
    description: 'Le NFT de PBTM donne des avantages concrets : rabais sur les services de marketing et de technologie, et accès à des offres exclusives.',
    motsCles: ['NFT', 'avantages', 'crypto'],
  },
  {
    id: 'tirage', path: '/luckydraw', view: 'lottery', label: 'Tirage', priority: '0.5', changefreq: 'weekly',
    title: 'Tirage PBTM : faites connaître vos produits | PBTM',
    description: 'Le tirage de PBTM permet aux entreprises d’offrir leurs produits en prix et d’obtenir de la visibilité ; les participants courent la chance de gagner.',
    motsCles: ['tirage', 'prix', 'visibilité'],
  },
  {
    id: 'boutique', path: '/achats', view: 'achats', label: 'Boutique', priority: '0.6', changefreq: 'weekly',
    title: 'Boutique PBTM : produits exclusifs | PBTM',
    description: 'Les produits exclusifs de PBTM, en vente en ligne avec paiement sécurisé.',
    motsCles: ['boutique', 'produits'],
  },
  {
    id: 'portfolio', path: '/portfolio', view: 'portfolio', label: 'Portfolio', priority: '0.6', changefreq: 'monthly',
    title: 'Portfolio : réalisations en IA, web et marketing | PBTM',
    description: 'Des projets réalisés par PBTM pour ses clients : intelligence artificielle, sites web, image de marque et campagnes de marketing.',
    motsCles: ['portfolio', 'projets', 'réalisations'],
  },
  {
    id: 'contact', path: '/contact', view: 'contact', label: 'Contact', priority: '0.7', changefreq: 'yearly',
    title: 'Contactez PBTM | Consultation IA et marketing',
    description: 'Parlez de votre projet d’IA, de marketing ou de formation avec l’équipe de PBTM. Réponse rapide, en français ou en anglais.',
    motsCles: ['contact', 'consultation'],
  },
  {
    id: 'faq', path: '/faq', view: 'faq', label: 'Questions fréquentes', priority: '0.7', changefreq: 'monthly',
    title: 'Questions fréquentes sur PBTM | IA, marketing, formations',
    description: 'Les réponses courtes aux questions les plus posées sur PBTM : services d’IA, agents IA, marketing numérique, formations, NFT et contact.',
    motsCles: ['questions', 'IA', 'marketing'],
  },
  {
    id: 'presse', path: '/presse', view: 'presse', label: 'Presse', priority: '0.5', changefreq: 'monthly',
    title: 'Kit média et relations de presse | PBTM',
    description: 'Le kit média de PBTM : description de l’entreprise, logo officiel et coordonnées des relations de presse.',
    motsCles: ['presse', 'média', 'PBTM'],
  },
];

// The course detail page is dynamic (one URL per course of the database).
const COURSE_PAGE = {
  id: 'cours-detail', path: '/course-details/:id', view: 'course-details', label: 'Cours', parent: 'cours',
  title: '{nom} | Cours en ligne PBTM',
  description: 'Cours en ligne « {nom} » offert par PBTM.',
  motsCles: ['cours'],
};

const byId = (id) => PAGES.find((p) => p.id === id) || (id === COURSE_PAGE.id ? COURSE_PAGE : null);

// Default FAQ of /faq. Short, factual answers: only what the site states.
const FAQ_GENERALE = [
  { q: 'Que fait PBTM ?', r: 'PBTM (Panda Business Tech & Marketing) aide les PME avec l’intelligence artificielle, les agents IA, le marketing numérique, la formation en ligne et des projets NFT.' },
  { q: 'Qu’est-ce qu’un agent IA chez PBTM ?', r: 'Un agent IA est un assistant spécialisé (rédaction, SEO, publicité, analyse…) qui prépare un travail ; chaque livrable est relu et validé par un humain avant d’être utilisé.' },
  { q: 'PBTM offre-t-elle des formations ?', r: 'Oui. La section Éducation propose des cours en ligne en IA, en technologie et en marketing numérique, à suivre à votre rythme.' },
  { q: 'Quels services de marketing numérique offrez-vous ?', r: 'Référencement (SEO), publicité en ligne, réseaux sociaux, courriel et stratégie de marque, avec des résultats mesurés.' },
  { q: 'Dans quelle langue travaillez-vous ?', r: 'En français d’abord, et en anglais sur demande.' },
  { q: 'Comment joindre PBTM ?', r: 'Par le formulaire de la page Contact. Indiquez votre besoin : l’équipe vous répond pour fixer une consultation.' },
];


// CMS zones of the SEO/AEO (listed in the admin "Contenu du site" tab). The
// fallbacks are the ones utils/seo.js and the templates use.
function cmsZones() {
  const out = [];
  for (const p of PAGES) {
    const section = `SEO · ${p.label}`;
    out.push(
      { key: `seo.${p.id}.title`, section, label: 'Titre (balise title, 30 à 65 caractères)', type: 'texte', fallback: p.title },
      { key: `seo.${p.id}.description`, section, label: 'Description (70 à 160 caractères)', type: 'texte', fallback: p.description },
    );
    if (p.id !== 'faq' && p.id !== 'presse') {
      out.push(
        { key: `aeo.${p.id}.reponse`, section, label: 'Réponse courte en tête de la FAQ (vide : aucun bloc)', type: 'texte', fallback: '' },
        { key: `faq.${p.id}`, section, label: 'Questions fréquentes (liste JSON [{"q": "…", "r": "…"}])', type: 'json', fallback: [] },
      );
    }
  }
  out.push(
    { key: 'faq.generale', section: 'SEO · Questions fréquentes', label: 'FAQ générale de /faq (liste JSON [{"q": "…", "r": "…"}])', type: 'json', fallback: FAQ_GENERALE },
    { key: 'seo.organisation.sameas', section: 'SEO · Organisation', label: 'Profils officiels (liste JSON d’adresses https://)', type: 'json', fallback: [] },
    { key: 'presse.description', section: 'Presse · Kit média', label: 'Description de l’entreprise', type: 'texte', fallback: ORG_DESCRIPTION },
    { key: 'presse.contact_nom', section: 'Presse · Kit média', label: 'Personne-ressource (médias)', type: 'texte', fallback: '' },
    { key: 'presse.courriel', section: 'Presse · Kit média', label: 'Courriel des relations de presse', type: 'texte', fallback: '' },
    { key: 'presse.telephone', section: 'Presse · Kit média', label: 'Téléphone des relations de presse', type: 'texte', fallback: '' },
    { key: 'presse.logo', section: 'Presse · Kit média', label: 'Logo officiel', type: 'image', fallback: LOGO.replace(/^\//, '') },
  );
  return out;
}

module.exports = { BRAND, LEGAL_NAME, DEFAULT_URL, LOGO, ORG_DESCRIPTION, PAGES, COURSE_PAGE, FAQ_GENERALE, byId, cmsZones };
