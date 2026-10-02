// Automatic SEO audit of the public pages (Croissance tab, CROISSANCE.md).
//
// Each view is rendered in memory with the real templates, the CMS and the
// SEO partial (no HTTP call, no database write), then checked: title,
// description, H1, image alt, canonical, JSON-LD (JSON.parse), text length,
// target keywords and internal links. Each page gets a score out of 100 and
// a list of proposed corrections in French.

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const seo = require('./seo');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

// Routes served by server.js (GET), for the broken-link check.
const KNOWN_ROUTES = new Set([
  '/', '/marketing', '/nft', '/education', '/TechAi', '/login', '/signup', '/portfolio', '/all-courses', '/luckydraw',
  '/contact', '/subscription', '/achats', '/dashboard', '/reset-password', '/oauth-callback', '/signup-callback',
  '/email-confirmed-callback', '/Purchase-Lottery-Tickets', '/espace', '/admin/console', '/faq', '/presse',
  '/sitemap.xml', '/robots.txt', '/llms.txt', '/healthz',
]);
const KNOWN_PATTERNS = [/^\/course-details\/[^/]+$/, /^\/api\//];

const TITLE_RANGE = [30, 65];
const DESCRIPTION_RANGE = [70, 160];
const MIN_WORDS = 300;

// Data each view needs to render (empty lists: the audit never reads the
// database except for one course, passed in by the caller).
function viewLocals(page, { course } = {}) {
  const base = { currentPage: page.path, pixelId: '', stripePublicKey: '' };
  switch (page.view) {
    case 'home4': return { ...base, courses: [], lotteries: [] };
    case 'education': return { ...base, courses: [] };
    case 'all-courses': return { ...base, currentPage: '/education', data: { courses: [] } };
    case 'course-details': return { ...base, currentPage: '/education', data: course };
    case 'lottery': return { ...base, lotteries: [] };
    case 'achats': return { ...base, products: [] };
    case 'portfolio': return { ...base, portfolioItems: [] };
    case 'presse': return { ...base, orgDescription: seo.ORG_DESCRIPTION };
    default: return base;
  }
}

function faqLocals(content) {
  const groups = seo.allFaq(content);
  const faqItems = groups.flatMap((g) => g.items);
  return { groups, faqItems, q: '', total: faqItems.length, reponse: content('presse.description', seo.ORG_DESCRIPTION) };
}

// Renders one page as a visitor would get it (CMS content of `lang`).
async function renderPage(page, { content = (k, f) => f, lang = 'fr', course = null, viewsDir = VIEWS_DIR } = {}) {
  const locals = {
    ...viewLocals(page, { course }),
    ...(page.view === 'faq' ? faqLocals(content) : {}),
    content,
    lang,
    seoFor: (id, extra = {}) => seo.buildSeo(id, { content, lang, extra }),
    aeoFor: (id) => seo.aeoFor(id, content),
  };
  return ejs.renderFile(path.join(viewsDir, `${page.view}.ejs`), locals);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}
const norm = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
};

function splitHead(html) {
  const i = html.search(/<\/head>/i);
  return i < 0 ? { head: '', body: html } : { head: html.slice(0, i), body: html.slice(i) };
}

function visibleText(body) {
  return decode(body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function assetExists(p) {
  const rel = decodeURIComponent(p.replace(/^\/assets\//, ''));
  if (rel.includes('..')) return false;
  try { return fs.statSync(path.join(ASSETS_DIR, rel)).isFile(); } catch { return false; }
}

// Internal link targets that no route serves. Relative links are resolved
// against the page's URL, as a browser would.
function brokenLinks(body, pagePath) {
  const broken = [];
  const seen = new Set();
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (href === null) continue;
    const h = decode(href).trim();
    if (!h) { broken.push('(lien vide)'); continue; }
    if (/^(#|mailto:|tel:|javascript:|data:)/i.test(h) || /^(https?:)?\/\//i.test(h)) continue;
    let resolved;
    try { resolved = new URL(h, `https://site.invalid${pagePath}`).pathname; } catch { broken.push(h); continue; }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const known = KNOWN_ROUTES.has(resolved) || KNOWN_PATTERNS.some((re) => re.test(resolved))
      || (resolved.startsWith('/assets/') && assetExists(resolved));
    if (!known) broken.push(h === resolved ? h : `${h} → ${resolved}`);
  }
  return broken;
}

function inRange(n, [lo, hi]) { return n >= lo && n <= hi; }

// Checks one rendered page. Returns { score, checks, corrections, stats }.
function analyse(html, page) {
  const { head, body } = splitHead(html);
  const checks = [];
  const corrections = [];
  const add = (id, label, points, max, detail, fix) => {
    checks.push({ id, label, ok: points === max, points, max, detail });
    if (points < max && fix) corrections.push(fix);
  };

  const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => decode(m[1]).trim());
  const title = titles[0] || '';
  if (!title) add('title', 'Titre', 0, 15, 'absent', 'Ajouter une balise title unique (30 à 65 caractères).');
  else if (titles.length > 1) add('title', 'Titre', 8, 15, `${titles.length} balises title`, 'Garder une seule balise title.');
  else if (!inRange(title.length, TITLE_RANGE)) {
    add('title', 'Titre', 8, 15, `${title.length} caractères`, `Titre de ${title.length} caractères : visez ${TITLE_RANGE[0]} à ${TITLE_RANGE[1]}.`);
  } else add('title', 'Titre', 15, 15, `${title.length} caractères`);

  const descTag = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, 'name') || '').toLowerCase() === 'description');
  const description = descTag ? decode(attr(descTag, 'content') || '').trim() : '';
  if (!description) add('description', 'Description', 0, 15, 'absente', 'Écrire une méta-description de 70 à 160 caractères.');
  else if (!inRange(description.length, DESCRIPTION_RANGE)) {
    add('description', 'Description', 8, 15, `${description.length} caractères`, `Description de ${description.length} caractères : visez ${DESCRIPTION_RANGE[0]} à ${DESCRIPTION_RANGE[1]}.`);
  } else add('description', 'Description', 15, 15, `${description.length} caractères`);

  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => visibleText(m[1]));
  if (!h1s.length) add('h1', 'Titre H1', 0, 15, 'aucun', 'Ajouter un seul titre H1 qui dit le sujet de la page.');
  else if (h1s.length > 1) add('h1', 'Titre H1', 8, 15, `${h1s.length} titres H1`, `${h1s.length} titres H1 : n’en garder qu’un (les autres en H2).`);
  else add('h1', 'Titre H1', 15, 15, h1s[0].slice(0, 80));

  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => attr(t, 'alt') === null).length;
  const emptyAlt = imgs.filter((t) => attr(t, 'alt') === '').length;
  const altPoints = imgs.length ? Math.round((10 * (imgs.length - noAlt)) / imgs.length) : 10;
  add('alt', 'Texte alternatif des images', altPoints, 10, `${imgs.length} image(s), ${noAlt} sans alt, ${emptyAlt} décorative(s)`,
    noAlt ? `${noAlt} image(s) sans attribut alt : décrire l’image, ou alt="" si elle est décorative.` : null);

  const canonical = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, 'rel') || '').toLowerCase() === 'canonical');
  const canonicalHref = canonical ? attr(canonical, 'href') : '';
  add('canonical', 'Adresse canonique', /^https:\/\//.test(canonicalHref || '') ? 10 : 0, 10, canonicalHref || 'absente',
    'Ajouter une balise link rel="canonical" en https.');

  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const types = [];
  let invalid = 0;
  for (const b of blocks) {
    try {
      const v = JSON.parse(b);
      types.push(v['@type']);
    } catch { invalid += 1; }
  }
  add('jsonld', 'Données structurées (JSON-LD)', blocks.length && !invalid ? 10 : 0, 10,
    blocks.length ? `${types.join(', ')}${invalid ? ` · ${invalid} invalide(s)` : ''}` : 'aucune',
    blocks.length ? 'Corriger les blocs JSON-LD invalides.' : 'Ajouter les données structurées (Organization, BreadcrumbList…).');

  const text = visibleText(body);
  const words = text ? text.split(' ').length : 0;
  const wordPoints = words >= MIN_WORDS ? 10 : words >= MIN_WORDS / 2 ? 5 : 0;
  add('longueur', 'Longueur du texte', wordPoints, 10, `${words} mots`, `Texte court (${words} mots) : visez au moins ${MIN_WORDS} mots utiles (réponses, exemples, FAQ).`);

  const haystack = norm(`${title} ${description} ${h1s.join(' ')} ${text}`);
  const targets = page.motsCles || [];
  const missing = targets.filter((k) => !haystack.includes(norm(k)));
  const inTitle = targets.filter((k) => norm(title).includes(norm(k)));
  const kwPoints = targets.length ? Math.round((10 * (targets.length - missing.length)) / targets.length) : 10;
  add('motscles', 'Mots-clés cibles', kwPoints, 10, targets.length ? `${targets.length - missing.length}/${targets.length} présents · ${inTitle.length} dans le titre` : 'aucun défini',
    missing.length ? `Mots-clés absents de la page : ${missing.join(', ')}.` : null);
  if (targets.length && !inTitle.length) corrections.push(`Placer au moins un mot-clé cible dans le titre (${targets.slice(0, 3).join(', ')}).`);

  const broken = brokenLinks(body, page.path);
  add('liens', 'Liens internes', broken.length ? 0 : 5, 5, broken.length ? `${broken.length} cassé(s)` : 'aucun lien cassé',
    broken.length ? `Liens internes cassés : ${broken.slice(0, 5).join(' ; ')}${broken.length > 5 ? '…' : ''}.` : null);

  const score = checks.reduce((s, c) => s + c.points, 0);
  return {
    score,
    checks,
    corrections,
    title,
    description,
    h1: h1s[0] || '',
    stats: { words, images: imgs.length, noAlt, jsonld: types, broken },
  };
}

// Audits every public page. `course` (one row of public.cours) enables the
// course page; without it that page is skipped.
async function auditSite({ content = (k, f) => f, lang = 'fr', course = null, viewsDir = VIEWS_DIR } = {}) {
  const pages = [...seo.PAGES];
  if (course && course.id != null) pages.push({ ...seo.COURSE_PAGE, path: `/course-details/${course.id}` });
  const results = [];
  for (const page of pages) {
    let html;
    try {
      html = await renderPage(page, { content, lang, course, viewsDir });
    } catch (err) {
      results.push({ id: page.id, label: page.label, path: page.path, score: 0, checks: [], corrections: [`La page ne se rend pas : ${String(err.message).split('\n').pop()}`], title: '', description: '', h1: '', stats: {}, error: true });
      continue;
    }
    results.push({ id: page.id, label: page.label, path: page.path, ...analyse(html, page) });
  }
  // Duplicate titles and descriptions across pages.
  for (const key of ['title', 'description']) {
    const by = new Map();
    for (const r of results) if (r[key]) by.set(r[key], [...(by.get(r[key]) || []), r.label]);
    for (const r of results) {
      const same = (by.get(r[key]) || []).filter((l) => l !== r.label);
      if (same.length) r.corrections.push(`${key === 'title' ? 'Titre' : 'Description'} identique à : ${same.join(', ')}.`);
    }
  }
  const moyenne = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  return { pages: results, moyenne, date: new Date().toISOString() };
}

module.exports = { auditSite, analyse, renderPage, brokenLinks, viewLocals, KNOWN_ROUTES, TITLE_RANGE, DESCRIPTION_RANGE, MIN_WORDS };
