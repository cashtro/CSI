// SEO and AEO of the public site (see CROISSANCE.md).
//
// One registry of the public pages: path, view, default French title and
// description, target keywords. Every value can be overridden in the CMS:
//   seo.<page>.title, seo.<page>.description, seo.<page>.image
//   aeo.<page>.reponse   short factual answer shown at the top of the page
//   faq.<page>           list of { "q": "...", "r": "..." } (JSON)
// With an empty CMS the defaults below are used and the AEO blocks render
// nothing, so the visible page is unchanged.
//
// The partial views/partials/seo-head.ejs prints what buildSeo() returns:
// title, description, canonical, Open Graph, Twitter card, hreflang and the
// JSON-LD blocks (Organization, WebSite + SearchAction, Course, FAQPage,
// BreadcrumbList). JSON-LD is serialised with ldJson(), which escapes "<", ">"
// and "&" so a value can never close the <script> data block.

const cms = require('./cms');

const { BRAND, LEGAL_NAME, DEFAULT_URL, LOGO, ORG_DESCRIPTION, PAGES, COURSE_PAGE, FAQ_GENERALE, byId } = require('./seo-data');

const FAQ_MAX = 30;

function baseUrl(env = process.env) {
  const candidates = [env.SITE_URL, env.APP_URL];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' || (u.protocol === 'http:' && env.NODE_ENV !== 'production')) return u.origin;
    } catch { /* ignore */ }
  }
  return DEFAULT_URL;
}

const abs = (base, p) => (/^https:\/\//i.test(p) ? p : `${base}/${String(p).replace(/^\/+/, '')}`);

// Keeps only well-formed { q, r } items.
function cleanFaq(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x.q === 'string' && typeof x.r === 'string' && x.q.trim() && x.r.trim())
    .slice(0, FAQ_MAX)
    .map((x) => ({ q: x.q.trim().slice(0, 300), r: x.r.trim().slice(0, 2000) }));
}

// JSON for a <script type="application/ld+json"> data block.
function ldJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function organization(base, content) {
  const sameAs = (content('seo.organisation.sameas', []) || []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
  const courriel = content('presse.courriel', '');
  const org = {
    '@type': 'Organization',
    '@id': `${base}/#organisation`,
    name: BRAND,
    alternateName: LEGAL_NAME,
    url: `${base}/`,
    logo: abs(base, LOGO),
    description: content('presse.description', ORG_DESCRIPTION),
    areaServed: { '@type': 'AdministrativeArea', name: 'Québec' },
    address: { '@type': 'PostalAddress', addressRegion: 'QC', addressCountry: 'CA' },
    knowsLanguage: ['fr-CA', 'en-CA'],
  };
  if (sameAs.length) org.sameAs = sameAs;
  if (courriel) org.contactPoint = { '@type': 'ContactPoint', contactType: 'relations de presse', email: courriel, availableLanguage: ['fr', 'en'] };
  return org;
}

function website(base) {
  return {
    '@type': 'WebSite',
    '@id': `${base}/#site`,
    url: `${base}/`,
    name: BRAND,
    inLanguage: 'fr-CA',
    publisher: { '@id': `${base}/#organisation` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${base}/faq?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

function breadcrumb(base, page, extraName, url) {
  const chain = [];
  for (let p = page; p; p = p.parent ? byId(p.parent) : null) chain.unshift(p);
  const items = [{ name: 'Accueil', url: `${base}/` }];
  for (const p of chain) {
    if (p.id === 'accueil') continue;
    if (p.id === COURSE_PAGE.id) items.push({ name: extraName || p.label, url });
    else items.push({ name: p.label, url: abs(base, p.path) });
  }
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

function courseLd(base, course, url, description) {
  const ld = {
    '@type': 'Course',
    name: String(course.nom || 'Cours'),
    description,
    url,
    inLanguage: 'fr-CA',
    provider: { '@id': `${base}/#organisation`, '@type': 'Organization', name: BRAND, sameAs: `${base}/` },
  };
  const prix = Number(course.prix);
  if (Number.isFinite(prix) && prix >= 0) ld.offers = { '@type': 'Offer', price: prix.toFixed(2), priceCurrency: 'CAD', category: prix > 0 ? 'Paid' : 'Free', url };
  const heures = Number(course.nombre_heures);
  ld.hasCourseInstance = { '@type': 'CourseInstance', courseMode: 'Online', ...(Number.isFinite(heures) && heures > 0 ? { courseWorkload: `PT${Math.round(heures)}H` } : {}) };
  return ld;
}

function faqLd(items) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.r } })),
  };
}

// AEO content of a page from the CMS: { reponse, faq } (empty by default).
function aeoFor(pageId, content) {
  const reponse = content(`aeo.${pageId}.reponse`, '');
  return {
    reponse: typeof reponse === 'string' ? reponse.trim().slice(0, 600) : '',
    faq: cleanFaq(content(`faq.${pageId}`, [])),
  };
}

// FAQ of /faq: the general list (CMS key faq.generale) then every page FAQ.
function allFaq(content) {
  const groups = [{ id: 'generale', label: 'PBTM en bref', items: cleanFaq(content('faq.generale', FAQ_GENERALE)) }];
  for (const p of PAGES) {
    if (p.id === 'faq') continue;
    const items = cleanFaq(content(`faq.${p.id}`, []));
    if (items.length) groups.push({ id: p.id, label: p.label, items, path: p.path });
  }
  return groups;
}

const hasEnglish = (pageId) => typeof cms.resolve(`seo.${pageId}.title`, 'en', undefined) === 'string';

// Everything seo-head.ejs prints for one page.
//   extra.course: the course of a course page; extra.faq: FAQ items to mark
//   up (the /faq page passes its whole list).
function buildSeo(pageId, { content = (k, f) => f, lang = 'fr', env = process.env, extra = {} } = {}) {
  const page = byId(pageId) || PAGES[0];
  const base = baseUrl(env);
  const course = page.id === COURSE_PAGE.id ? (extra.course || {}) : null;
  const vars = course ? { nom: course.nom || 'Cours' } : {};
  const pathOf = course ? `/course-details/${encodeURIComponent(String(course.id == null ? '' : course.id))}` : page.path;
  const frUrl = abs(base, pathOf);

  const cmsKey = course ? `seo.cours-${String(course.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 40)}` : `seo.${page.id}`;
  const english = !course && hasEnglish(page.id);
  const enUrl = `${frUrl}${frUrl.includes('?') ? '&' : '?'}lang=en`;
  const canonical = lang === 'en' && english ? enUrl : frUrl;

  let title = String(content(`${cmsKey}.title`, fill(page.title, vars)) || '').trim();
  let courseText = '';
  if (course) {
    courseText = String(course.description || course.about || '').replace(/\s+/g, ' ').trim();
  }
  const defaultDescription = course && courseText ? clip(courseText, 158) : fill(page.description, vars);
  let description = String(content(`${cmsKey}.description`, defaultDescription) || '').trim();
  if (!title) title = fill(page.title, vars);
  if (!description) description = defaultDescription;
  const image = abs(base, content(`${cmsKey}.image`, LOGO) || LOGO);

  const aeo = aeoFor(page.id, content);
  const faqItems = cleanFaq(extra.faq || aeo.faq);

  const graph = [organization(base, content), website(base), breadcrumb(base, page, course ? vars.nom : null, frUrl)];
  if (course) graph.push(courseLd(base, course, frUrl, description));
  if (faqItems.length) graph.push(faqLd(faqItems));

  const alternates = english
    ? [{ hreflang: 'fr-CA', href: frUrl }, { hreflang: 'en-CA', href: enUrl }, { hreflang: 'x-default', href: frUrl }]
    : [];

  return {
    page: page.id,
    title,
    description,
    canonical,
    image,
    siteName: BRAND,
    locale: lang === 'en' && english ? 'en_CA' : 'fr_CA',
    localeAlternate: english ? (lang === 'en' ? 'fr_CA' : 'en_CA') : null,
    alternates,
    jsonld: graph.map((node) => ldJson({ '@context': 'https://schema.org', ...node })),
    aeo,
  };
}

// Exposes seoFor(page, extra) and aeoFor(page) to the templates. Mount after
// cms.middleware (it uses res.locals.content).
function middleware(req, res, next) {
  res.locals.seoFor = (pageId, extra = {}) => buildSeo(pageId, {
    content: res.locals.content || ((k, f) => f),
    lang: res.locals.lang || 'fr',
    extra,
  });
  res.locals.aeoFor = (pageId) => aeoFor(pageId, res.locals.content || ((k, f) => f));
  next();
}

// ---------------------------------------------------------------- sitemap, robots, llms

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const day = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null;
};

// courses: rows of public.cours ({ id, nom, created_at, updated_at });
// cmsRows: rows of site_content ({ key, updated_at }) for lastmod.
function sitemapXml({ courses = [], cmsRows = [], env = process.env } = {}) {
  const base = baseUrl(env);
  const latest = (prefixes) => {
    let best = null;
    for (const r of cmsRows) {
      if (!prefixes.some((p) => String(r.key).startsWith(p))) continue;
      const d = day(r.updated_at);
      if (d && (!best || d > best)) best = d;
    }
    return best;
  };
  const urls = PAGES.map((p) => {
    const prefixes = [`seo.${p.id}.`, `aeo.${p.id}.`, `faq.${p.id}`];
    if (p.id === 'accueil') prefixes.push('home.');
    if (p.id === 'presse') prefixes.push('presse.');
    if (p.id === 'faq') prefixes.push('faq.');
    return { loc: abs(base, p.path), lastmod: latest(prefixes), changefreq: p.changefreq, priority: p.priority, en: hasEnglish(p.id) };
  });
  for (const c of courses) {
    if (c == null || c.id == null) continue;
    urls.push({ loc: abs(base, `/course-details/${encodeURIComponent(String(c.id))}`), lastmod: day(c.updated_at || c.created_at), changefreq: 'monthly', priority: '0.7' });
  }
  const body = urls.map((u) => [
    '  <url>',
    `    <loc>${xml(u.loc)}</loc>`,
    u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : null,
    u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : null,
    u.priority ? `    <priority>${u.priority}</priority>` : null,
    u.en ? `    <xhtml:link rel="alternate" hreflang="fr-CA" href="${xml(u.loc)}"/>\n    <xhtml:link rel="alternate" hreflang="en-CA" href="${xml(`${u.loc}?lang=en`)}"/>` : null,
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

const DISALLOW = ['/admin', '/espace', '/api', '/dashboard', '/Purchase-Lottery-Tickets', '/reset-password', '/oauth-callback', '/signup-callback', '/email-confirmed-callback'];

function robotsTxt(env = process.env) {
  const base = baseUrl(env);
  return [
    '# robots.txt de PBTM (Panda Business Tech & Marketing)',
    'User-agent: *',
    'Allow: /',
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    `# Résumé pour les moteurs de réponse IA : ${base}/llms.txt`,
    '',
  ].join('\n');
}

// https://llmstxt.org : a Markdown summary for answer engines.
function llmsTxt({ courses = [], content = (k, f) => f, env = process.env } = {}) {
  const base = baseUrl(env);
  const line = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
  const md = (s) => line(s).replace(/([[\]])/g, '\\$1');
  const out = [
    `# ${BRAND} (${LEGAL_NAME})`,
    '',
    `> ${line(content('presse.description', ORG_DESCRIPTION))}`,
    '',
    'Entreprise du Québec (Canada). Langue principale : français (fr-CA) ; anglais sur demande.',
    'Chaque livrable produit par un agent IA est relu et validé par un humain.',
    '',
    '## Pages clés',
    '',
    ...PAGES.map((p) => `- [${md(p.label)}](${abs(base, p.path)}): ${line(content(`seo.${p.id}.description`, p.description))}`),
    '',
  ];
  const list = courses.filter((c) => c && c.id != null && c.nom).slice(0, 50);
  if (list.length) {
    out.push('## Cours en ligne', '', ...list.map((c) => `- [${md(c.nom)}](${abs(base, `/course-details/${encodeURIComponent(String(c.id))}`)})`), '');
  }
  const faq = allFaq(content).flatMap((g) => g.items).slice(0, 15);
  if (faq.length) out.push('## Réponses courtes', '', ...faq.map((x) => `- **${md(x.q)}** ${line(x.r)}`), '');
  out.push('## Contact', '', `- [Contact](${abs(base, '/contact')})`, `- [Kit média](${abs(base, '/presse')})`, `- [Questions fréquentes](${abs(base, '/faq')})`, '');
  return out.join('\n');
}

module.exports = {
  BRAND, LEGAL_NAME, LOGO, ORG_DESCRIPTION, PAGES, COURSE_PAGE, FAQ_GENERALE, DISALLOW,
  byId, baseUrl, ldJson, cleanFaq, buildSeo, aeoFor, allFaq, middleware,
  sitemapXml, robotsTxt, llmsTxt,
};
