// Données de la nouvelle page d'accueil publique (views/accueil.ejs, PWA.md) :
// robots du catalogue, derniers cours, produits de la boutique, FAQ.
// Chaque source qui manque (table absente, erreur) donne une liste vide : la
// page s'affiche toujours, avec un message à la place de la section.

const logger = require('./logger');
const robots = require('./robots');
const cms = require('./cms');
const seo = require('./seo');

const MAX = 6;

const imageSure = (url) => (typeof url === 'string' && cms.isSafeImageUrl(url) ? (url.startsWith('assets/') ? `/${url}` : url) : null);
const nombre = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const court = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

async function cours(admin) {
  try {
    const { data, error } = await admin.from('cours').select('*').order('created_at', { ascending: false }).limit(MAX);
    if (error) throw new Error(error.message);
    return (data || []).filter((c) => c && c.id != null && c.nom).map((c) => ({
      id: String(c.id),
      nom: court(c.nom, 120),
      niveau: c.niveau ? court(c.niveau, 40) : null,
      heures: nombre(c.nombre_heures),
      prix: nombre(c.prix),
      image: imageSure(c.image_url),
    }));
  } catch (err) {
    logger.warn('[vitrine] cours indisponibles :', err.message);
    return [];
  }
}

async function produits(admin) {
  try {
    const { data, error } = await admin.from('Achat').select('*').limit(MAX);
    if (error) throw new Error(error.message);
    return (data || []).filter((p) => p && p.title_item).map((p) => ({
      id: String(p.id_item),
      nom: court(p.title_item, 120),
      description: p.description_item ? court(p.description_item, 160) : '',
      prix: nombre(p.price_item),
      image: imageSure(p.image_item),
    }));
  } catch (err) {
    logger.warn('[vitrine] boutique indisponible :', err.message);
    return [];
  }
}

// FAQ de l'accueil : celle de la page dans le CMS, sinon la FAQ générale.
function faq(content) {
  const page = seo.aeoFor('accueil', content).faq;
  return page.length ? page : seo.allFaq(content)[0].items;
}

async function charger(admin, content = (k, f) => f) {
  const [catalogue, listeCours, listeProduits] = await Promise.all([
    robots.loadCatalogue(admin).catch((err) => {
      logger.warn('[vitrine] robots indisponibles :', err.message);
      return { offres: [] };
    }),
    cours(admin),
    produits(admin),
  ]);
  const offres = catalogue.offres || [];
  return {
    offres: offres.slice(0, MAX),
    deFrom: offres.length ? Math.min(...offres.map((o) => o.prix_mensuel)) : null,
    cours: listeCours,
    produits: listeProduits,
    faq: faq(content),
  };
}

// Données vides (audit SEO, tests de gabarit).
const vide = (content = (k, f) => f) => ({ offres: [], deFrom: null, cours: [], produits: [], faq: faq(content) });

module.exports = { charger, vide, imageSure, MAX };
