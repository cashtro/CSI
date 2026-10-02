// Site CMS: editable texts, images and JSON blocks stored in public.site_content.
//
// Templates call the EJS helper `content(key, fallback)`. When the table has
// no row for the key in the visitor's language, the fallback (the text that
// was hardcoded in the template) is shown, so an empty table changes nothing.
//
// The whole table is small, so it is loaded once into memory and served from
// there. A save from the admin console invalidates the cache at once; other
// processes (if PM2 ever runs several) pick changes up within CACHE_TTL_MS.
//
// Values are never rendered as HTML: templates print them with <%= %>, which
// escapes them. Images must be https URLs or paths under assets/.

const { createSupabaseAdmin } = require('./supabaseUtil');
const logger = require('./logger');

const LANGS = ['fr', 'en'];
const TYPES = ['texte', 'image', 'json'];
const KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,99}$/;
const MAX_VALUE = 20000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

// Zones wired in the templates, listed in the admin console. `fallback` must
// match the value written in the template.
const REGISTRY = [
  { key: 'home.hero.title', section: 'Accueil · Bandeau', label: 'Grand titre', type: 'texte', fallback: 'Pandora' },
  { key: 'home.hero.subtitle_l1', section: 'Accueil · Bandeau', label: 'Sous-titre, ligne 1', type: 'texte', fallback: 'Business Technology' },
  { key: 'home.hero.subtitle_l2', section: 'Accueil · Bandeau', label: 'Sous-titre, ligne 2', type: 'texte', fallback: '& Marketing' },
  { key: 'home.hero.cta', section: 'Accueil · Bandeau', label: 'Bouton principal', type: 'texte', fallback: 'Live Consultation' },
  { key: 'home.hero.image', section: 'Accueil · Bandeau', label: 'Image du bandeau (logo)', type: 'image', fallback: 'assets/img/shape/logogo.webp' },
  { key: 'home.services.kicker', section: 'Accueil · Offres', label: 'Surtitre', type: 'texte', fallback: 'Missions' },
  { key: 'home.services.title_a', section: 'Accueil · Offres', label: 'Titre (partie blanche)', type: 'texte', fallback: 'Our' },
  { key: 'home.services.title_b', section: 'Accueil · Offres', label: 'Titre (partie dorée)', type: 'texte', fallback: 'work' },
  ...[
    ['tech', 'Tech & A.I', ['Artificial intelligence for smart businesses', 'Automate tasks with intelligent systems', 'Data turned into smart insights', 'Scalable custom AI-driven solutions', 'Predictive analysis boosts performance']],
    ['education', 'Education', ['Learn anytime, anywhere, any device', 'Expert-led courses with certifications', 'Interactive lessons for deeper understanding', 'Track progress with smart analytics', 'Affordable education for every learner']],
    ['marketing', 'Marketing Digital', ['Targeted ads for higher conversions', 'SEO strategies to increase visibility', 'Social media growth with analytics', 'Email campaigns that drive engagement', 'Data-driven digital marketing results']],
    ['nft', 'NFT', ['Unique digital assets for collectors', 'Verified ownership through blockchain tech', 'Mint, sell, and trade NFTs', 'NFT drops with limited editions', 'Community-driven Web3 art platform']],
    ['lottery', 'Lottery Draw', ['Enter raffles to win big', 'Fair draws with verified winners', 'Instant notifications for lucky entries', 'Transparent process, secure digital tickets', 'Exciting prizes updated every week']],
  ].flatMap(([id, title, items]) => [
    { key: `home.services.${id}.title`, section: 'Accueil · Offres', label: `Offre « ${title} » : titre`, type: 'texte', fallback: title },
    { key: `home.services.${id}.items`, section: 'Accueil · Offres', label: `Offre « ${title} » : points (liste JSON)`, type: 'json', fallback: items },
  ]),
  { key: 'marketing.hero.title_l1', section: 'Marketing · Bandeau', label: 'Titre, ligne 1', type: 'texte', fallback: 'Complete Digital' },
  { key: 'marketing.hero.title_l2', section: 'Marketing · Bandeau', label: 'Titre, ligne 2 (blanc)', type: 'texte', fallback: 'Marketing' },
  { key: 'marketing.hero.title_gold', section: 'Marketing · Bandeau', label: 'Titre, ligne 2 (doré)', type: 'texte', fallback: 'Service' },
  { key: 'marketing.hero.subtitle', section: 'Marketing · Bandeau', label: 'Sous-titre', type: 'texte', fallback: 'PBTM is a full-service creative marketing agency' },
  { key: 'marketing.services.kicker', section: 'Marketing · Services', label: 'Surtitre', type: 'texte', fallback: 'Our services' },
  { key: 'marketing.services.title_a', section: 'Marketing · Services', label: 'Titre (partie blanche)', type: 'texte', fallback: "What we're" },
  { key: 'marketing.services.title_b', section: 'Marketing · Services', label: 'Titre (partie dorée)', type: 'texte', fallback: 'good at' },
  { key: 'techai.hero.title_a', section: 'Tech & IA · Bandeau', label: 'Titre (partie blanche)', type: 'texte', fallback: 'WELCOME TO' },
  { key: 'techai.hero.title_gold', section: 'Tech & IA · Bandeau', label: 'Titre (partie dorée)', type: 'texte', fallback: 'THE FUTURE' },
  { key: 'techai.hero.description', section: 'Tech & IA · Bandeau', label: 'Texte de présentation', type: 'texte', fallback: 'Step into the world of cutting-edge technology and artificial intelligence. From machine learning breakthroughs to the latest in robotics, we explore how innovation is shaping our world and redefining the future.' },
  { key: 'techai.hero.tagline', section: 'Tech & IA · Bandeau', label: 'Slogan', type: 'texte', fallback: 'DISCOVER. LEARN. INNOVATE.' },
  { key: 'techai.feature.title_a', section: 'Tech & IA · Concept', label: 'Titre (partie blanche)', type: 'texte', fallback: 'Elevating Tech & AI for a' },
  { key: 'techai.feature.title_gold', section: 'Tech & IA · Concept', label: 'Titre (partie dorée)', type: 'texte', fallback: 'Smarter Future' },
  { key: 'techai.feature.text', section: 'Tech & IA · Concept', label: 'Texte', type: 'texte', fallback: 'Artificial intelligence is transforming how we live, work, and innovate. By harnessing its power, we drive progress, enhance efficiency, and open new frontiers of possibility. Join us as we shape the future.' },
  { key: 'techai.feature.tagline', section: 'Tech & IA · Concept', label: 'Slogan', type: 'texte', fallback: 'INNOVATE. TRANSFORM. EMPOWER.' },
  { key: 'contact.hero.title_a', section: 'Contact · Bandeau', label: 'Titre (partie blanche)', type: 'texte', fallback: 'Contact' },
  { key: 'contact.hero.title_gold', section: 'Contact · Bandeau', label: 'Titre (partie dorée)', type: 'texte', fallback: 'Us' },
  { key: 'contact.hero.description', section: 'Contact · Bandeau', label: 'Texte de présentation', type: 'texte', fallback: "Ready to start your next project with us? Get in touch today and let's create something amazing together. Our team is here to help you with any questions or inquiries." },
];

// SEO and AEO zones of the public pages (utils/seo-data.js, CROISSANCE.md).
REGISTRY.push(...require('./seo-data').cmsZones());

let cache = new Map(); // `${lang}:${key}` -> { type, value }
let loadedAt = 0;
let failedAt = 0;
let loading = null;

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.length > 2000 || url.includes('..')) return false;
  return /^https:\/\/[^\s"'<>\\]+$/i.test(url) || /^\/?assets\/[A-Za-z0-9_\-./ ()]+$/.test(url);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function load(admin) {
  const { data, error } = await admin.from('site_content').select('key, lang, type, value');
  if (error) throw new Error(error.message);
  const next = new Map();
  for (const row of data || []) {
    const value = row.type === 'json' ? parseJson(row.value) : row.value;
    if (value !== undefined) next.set(`${row.lang}:${row.key}`, { type: row.type, value });
  }
  cache = next;
  loadedAt = Date.now();
}

// Never throws: on failure the site keeps the template fallbacks.
async function ensureLoaded(admin) {
  const now = Date.now();
  if (loadedAt && now - loadedAt < CACHE_TTL_MS) return;
  if (failedAt && now - failedAt < RETRY_MS) return;
  if (!loading) {
    loading = load(admin || createSupabaseAdmin())
      .then(() => { failedAt = 0; })
      .catch((err) => {
        failedAt = Date.now();
        logger.warn('[cms] site_content unavailable, using template defaults:', err.message);
      })
      .finally(() => { loading = null; });
  }
  await loading;
}

function invalidate() {
  loadedAt = 0;
  failedAt = 0;
}

// The value to show for key, or the fallback when there is none (or when the
// stored value does not have the shape the template expects).
function resolve(key, lang, fallback) {
  const entry = cache.get(`${lang}:${key}`);
  if (!entry) return fallback;
  if (entry.type === 'image') return isSafeImageUrl(entry.value) ? entry.value : fallback;
  if (Array.isArray(fallback) && !Array.isArray(entry.value)) return fallback;
  if (typeof fallback === 'string' && typeof entry.value !== 'string') return fallback;
  return entry.value;
}

function pickLang(req) {
  const asked = (req.query && req.query.lang) || (req.cookies && req.cookies.lang);
  if (LANGS.includes(asked)) return asked;
  return LANGS.includes(process.env.SITE_LANG) ? process.env.SITE_LANG : 'fr';
}

// Exposes `content(key, fallback)` and `lang` to every template.
function middleware(req, res, next) {
  const lang = pickLang(req);
  res.locals.lang = lang;
  res.locals.content = (key, fallback = '') => resolve(key, lang, fallback);
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  ensureLoaded().then(() => next(), next);
}

// Validates an admin edit. Returns { entry } or { error }.
function validateEntry(input) {
  const { key, lang = 'fr', type = 'texte' } = input || {};
  let { value } = input || {};
  if (typeof key !== 'string' || !KEY_RE.test(key)) return { error: 'Clé invalide.' };
  if (!LANGS.includes(lang)) return { error: 'Langue invalide (fr ou en).' };
  if (!TYPES.includes(type)) return { error: 'Type invalide (texte, image ou json).' };
  if (type === 'json' && typeof value !== 'string') value = JSON.stringify(value);
  if (typeof value !== 'string' || value.length > MAX_VALUE) return { error: 'Valeur manquante ou trop longue.' };
  if (type === 'image' && !isSafeImageUrl(value)) return { error: 'Image : adresse https:// ou chemin assets/ attendu.' };
  if (type === 'json' && parseJson(value) === undefined) return { error: 'JSON invalide.' };
  const known = REGISTRY.find((r) => r.key === key);
  if (known && known.type !== type) return { error: `Cette zone attend le type « ${known.type} ».` };
  return { entry: { key, lang, type, value } };
}

async function save(admin, entry, userId) {
  const { error } = await admin
    .from('site_content')
    .upsert({ ...entry, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key,lang' });
  if (error) throw new Error(error.message);
  invalidate();
}

async function remove(admin, key, lang) {
  const { error } = await admin.from('site_content').delete().eq('key', key).eq('lang', lang);
  if (error) throw new Error(error.message);
  invalidate();
}

// Rows of the table as the admin console shows them, joined to the registry.
async function listForAdmin(admin) {
  const { data, error } = await admin.from('site_content').select('key, lang, type, value, updated_at');
  if (error) throw new Error(error.message);
  const rows = data || [];
  const stored = (key, lang) => rows.find((r) => r.key === key && r.lang === lang);
  const zones = REGISTRY.map((zone) => ({
    ...zone,
    fallbackText: zone.type === 'json' ? JSON.stringify(zone.fallback, null, 2) : zone.fallback,
    fr: stored(zone.key, 'fr') || null,
    en: stored(zone.key, 'en') || null,
  }));
  const extra = rows.filter((r) => !REGISTRY.some((z) => z.key === r.key));
  return { zones, extra };
}

module.exports = {
  REGISTRY, LANGS, TYPES,
  middleware, ensureLoaded, invalidate, resolve, pickLang,
  validateEntry, save, remove, listForAdmin, isSafeImageUrl,
  _reset() { cache = new Map(); loadedAt = 0; failedAt = 0; loading = null; },
};
