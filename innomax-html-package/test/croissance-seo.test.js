// Public SEO and AEO (CROISSANCE.md): sitemap, robots, llms.txt, the
// seo-head partial (JSON-LD parsed with JSON.parse), the AEO blocks, /faq,
// /presse, and the guarantee that with an empty CMS the visible page (the
// <body>) is exactly what it was without the SEO and AEO includes.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'x';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'x';
require('./helpers/quiet');

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

jest.mock('../routes(api)/utils/supabaseUtil', () => require('./helpers/fakeSupabase').module);
const fake = require('./helpers/fakeSupabase');
const cms = require('../routes(api)/utils/cms');
const seo = require('../routes(api)/utils/seo');
const seoData = require('../routes(api)/utils/seo-data');
const { auditSite, analyse, brokenLinks, viewLocals } = require('../routes(api)/utils/seoAudit');

const VIEWS = path.join(__dirname, '..', 'views');
const COURSE = { id: 42, nom: 'IA <pour> PME', prix: 49, nombre_heures: 6, description: 'Un cours pratique sur les agents IA pour les petites entreprises du Québec, avec exercices.', created_at: '2026-09-20T10:00:00Z' };

const app = express();
app.set('view engine', 'ejs');
app.set('views', VIEWS);
app.use(cookieParser());
app.use(cms.middleware);
app.use(seo.middleware);
app.use(require('../routes(api)/seoRoutes'));
// Public views rendered with the data the audit uses (no HTTP to the API).
app.get('/rendu/:id', (req, res) => {
  const page = seo.PAGES.find((p) => p.id === req.params.id) || (req.params.id === 'cours-detail' ? seo.COURSE_PAGE : null);
  if (!page) return res.sendStatus(404);
  res.render(page.view, viewLocals(page, { course: COURSE }));
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

function seed(siteContent = []) {
  fake.reset({ tables: { cours: [COURSE, { id: 'c-2', nom: 'Marketing & SEO', created_at: '2026-09-01' }], site_content: siteContent } });
  cms._reset();
}
beforeEach(() => seed());

// The new home (views/accueil.ejs) is a PBTM page like /faq and /presse: test/pwa.test.js checks its SEO.
const LEGACY = seo.PAGES.filter((p) => !['faq', 'presse', 'accueil'].includes(p.id)).concat([seo.COURSE_PAGE]);
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const body = (html) => html.slice(html.search(/<body[\s>]/i));
const head = (html) => html.slice(0, html.search(/<\/head>/i));

describe('/sitemap.xml', () => {
  it('lists the public pages, the courses of the database and CMS dates', async () => {
    seed([{ key: 'seo.marketing.title', lang: 'fr', type: 'texte', value: 'Marketing au Québec, SEO et publicité | PBTM', updated_at: '2026-09-30T12:00:00Z' }]);
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    for (const p of seo.PAGES) expect(res.text).toContain(`<loc>https://pandorabrains.com${p.path === '/' ? '/' : p.path}</loc>`);
    expect(res.text).toContain('<loc>https://pandorabrains.com/course-details/42</loc>');
    expect(res.text).toContain('<loc>https://pandorabrains.com/course-details/c-2</loc>');
    expect(res.text).toMatch(/marketing<\/loc>\s*<lastmod>2026-09-30<\/lastmod>/);
    expect(res.text).not.toMatch(/\/admin|\/espace|\/api\//);
  });

  it('escapes XML and still answers when the courses are unreadable', () => {
    const xml = seo.sitemapXml({ courses: [{ id: 'a&b<c', created_at: 'x' }] });
    expect(xml).toContain('/course-details/a%26b%3Cc');
    expect(xml).not.toMatch(/<loc>[^<]*[<&][^/]/);
  });

  it('adds hreflang alternates only when an English version exists', async () => {
    seed([{ key: 'seo.contact.title', lang: 'en', type: 'texte', value: 'Contact PBTM | AI and marketing consultation' }]);
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('hreflang="en-CA" href="https://pandorabrains.com/contact?lang=en"');
    expect((res.text.match(/hreflang="en-CA"/g) || []).length).toBe(1);
  });
});

describe('/robots.txt and /llms.txt', () => {
  it('robots points to the sitemap and blocks /admin, /espace and /api', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    for (const p of ['/admin', '/espace', '/api']) expect(res.text).toContain(`Disallow: ${p}\n`);
    expect(res.text).toContain('Sitemap: https://pandorabrains.com/sitemap.xml');
    expect(res.text).toMatch(/User-agent: \*\nAllow: \//);
  });

  it('llms.txt summarises the company with its key links and courses', async () => {
    const res = await request(app).get('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toBe('# PBTM (Panda Business Tech & Marketing)');
    expect(res.text).toMatch(/^> .*québécoise/m);
    expect(res.text).toContain('## Pages clés');
    expect(res.text).toContain('(https://pandorabrains.com/faq)');
    expect(res.text).toContain('[IA <pour> PME](https://pandorabrains.com/course-details/42)');
    expect(res.text).toContain('## Réponses courtes');
  });

  it('uses SITE_URL for absolute links', () => {
    expect(seo.robotsTxt({ SITE_URL: 'https://pbtm.ca/' })).toContain('Sitemap: https://pbtm.ca/sitemap.xml');
    expect(seo.baseUrl({ SITE_URL: 'javascript:alert(1)' })).toBe('https://pandorabrains.com');
  });
});

describe('seo-head on every public page', () => {
  it.each(LEGACY.map((p) => [p.id]))('%s: one title, one description, canonical, OG, Twitter and valid JSON-LD', async (id) => {
    const res = await request(app).get(`/rendu/${id}`);
    expect(res.status).toBe(200);
    const h = head(res.text);
    expect((h.match(/<title>/g) || []).length).toBe(1);
    expect((h.match(/<meta name="description"/g) || []).length).toBe(1);
    expect(h).toMatch(/<link rel="canonical" href="https:\/\/pandorabrains\.com\//);
    expect(h).toContain('<meta property="og:title"');
    expect(h).toContain('<meta property="og:locale" content="fr_CA">');
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
    const blocks = jsonLd(res.text).map((b) => JSON.parse(b));
    const types = blocks.map((b) => b['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'BreadcrumbList']));
    expect(blocks.every((b) => b['@context'] === 'https://schema.org')).toBe(true);
    const site = blocks.find((b) => b['@type'] === 'WebSite');
    expect(site.potentialAction['@type']).toBe('SearchAction');
    expect(site.potentialAction.target.urlTemplate).toContain('{search_term_string}');
    expect(types).not.toContain('FAQPage');
    expect(h).not.toContain('aeo.css');
  });

  it('titles and descriptions are unique per page', () => {
    const titles = seo.PAGES.map((p) => seo.buildSeo(p.id).title);
    const descriptions = seo.PAGES.map((p) => seo.buildSeo(p.id).description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('the course page has a Course block and a breadcrumb down to the course', async () => {
    const res = await request(app).get('/rendu/cours-detail');
    const blocks = jsonLd(res.text).map((b) => JSON.parse(b));
    const course = blocks.find((b) => b['@type'] === 'Course');
    expect(course).toMatchObject({ name: 'IA <pour> PME', url: 'https://pandorabrains.com/course-details/42', offers: { price: '49.00', priceCurrency: 'CAD' } });
    expect(course.provider.name).toBe('PBTM');
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name);
    expect(crumbs).toEqual(['Accueil', 'Éducation', 'Tous les cours', 'IA <pour> PME']);
    expect(head(res.text)).toContain('<title>IA &lt;pour&gt; PME | Cours en ligne PBTM</title>');
  });

  it('takes the title and description from the CMS (seo.<page>.*), escaped', async () => {
    seed([
      { key: 'seo.marketing.title', lang: 'fr', type: 'texte', value: 'Marketing "Québec" <b>PME</b> | PBTM' },
      { key: 'seo.marketing.description', lang: 'fr', type: 'texte', value: 'Une description éditée dans le CMS pour la page marketing, assez longue pour être utile.' },
    ]);
    const res = await request(app).get('/rendu/marketing');
    expect(res.text).toContain('<title>Marketing &#34;Québec&#34; &lt;b&gt;PME&lt;/b&gt; | PBTM</title>');
    expect(res.text).toContain('content="Une description éditée dans le CMS pour la page marketing, assez longue pour être utile."');
    expect(res.text).not.toContain('<b>PME</b>');
  });

  it('a FAQ in the CMS adds the FAQPage block and the visible block; JSON-LD cannot be broken out of', async () => {
    const faq = [{ q: 'Que fait PBTM ?', r: 'De l’IA </script><script>alert(1)</script> & du marketing.' }];
    seed([
      { key: 'faq.techai', lang: 'fr', type: 'json', value: JSON.stringify(faq) },
      { key: 'aeo.techai.reponse', lang: 'fr', type: 'texte', value: 'PBTM conçoit des agents IA pour les PME.' },
    ]);
    const res = await request(app).get('/rendu/techai');
    const blocks = jsonLd(res.text);
    expect(blocks.join('')).not.toMatch(/<\/script|<script/i);
    const faqLd = blocks.map((b) => JSON.parse(b)).find((b) => b['@type'] === 'FAQPage');
    expect(faqLd.mainEntity[0]).toEqual({ '@type': 'Question', name: 'Que fait PBTM ?', acceptedAnswer: { '@type': 'Answer', text: faq[0].r } });
    expect(res.text).toContain('<link rel="stylesheet" href="/assets/css/aeo.css">');
    expect(res.text).toContain('<p class="aeo-bref"><strong>En bref :</strong> PBTM conçoit des agents IA pour les PME.</p>');
    expect(res.text).toContain('&lt;/script&gt;&lt;script&gt;alert(1)');
    expect(res.text).not.toContain('<script>alert(1)');
  });

  it('hreflang fr-CA / en-CA when an English title exists', async () => {
    seed([{ key: 'seo.contact.title', lang: 'en', type: 'texte', value: 'Contact PBTM | AI and marketing consultation' }]);
    const fr = await request(app).get('/rendu/contact');
    expect(fr.text).toContain('<link rel="alternate" hreflang="fr-CA" href="https://pandorabrains.com/contact">');
    expect(fr.text).toContain('<link rel="alternate" hreflang="en-CA" href="https://pandorabrains.com/contact?lang=en">');
    const en = await request(app).get('/rendu/contact?lang=en');
    expect(en.text).toContain('<link rel="canonical" href="https://pandorabrains.com/contact?lang=en">');
    expect(en.text).toContain('<title>Contact PBTM | AI and marketing consultation</title>');
    const other = await request(app).get('/rendu/marketing');
    expect(other.text).not.toContain('hreflang');
  });
});

describe('empty CMS: the visible page is unchanged', () => {
  // The template without the SEO and AEO includes, as it was before them.
  const STRIP = [/<%-\s*include\('partials\/seo-head'[^%]*%>/g, /<%-\s*include\('partials\/aeo-bloc'[^%]*%>/g];
  const locals = (page) => ({
    ...viewLocals(page, { course: COURSE }),
    content: (k, f) => f,
    lang: 'fr',
    seoFor: (id, extra) => seo.buildSeo(id, { extra }),
    aeoFor: (id) => seo.aeoFor(id, (k, f) => f),
  });

  it.each(LEGACY.map((p) => [p.id, p]))('%s: same <body> byte for byte', async (id, page) => {
    const file = path.join(VIEWS, `${page.view}.ejs`);
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("include('partials/seo-head'");
    expect(src).toContain("include('partials/aeo-bloc'");
    let before = src;
    for (const re of STRIP) before = before.replace(re, '');
    const now = await ejs.renderFile(file, locals(page));
    const was = ejs.render(before, locals(page), { filename: file });
    expect(body(now)).toBe(body(was));
    expect(now.length).toBeGreaterThan(was.length); // the head gained the SEO tags
  });

  it('the AEO partial renders nothing at all without CMS content', async () => {
    const out = await ejs.renderFile(path.join(VIEWS, 'partials', 'aeo-bloc.ejs'), { aeoPage: 'accueil', aeoFor: (id) => seo.aeoFor(id, (k, f) => f) });
    expect(out).toBe('');
  });

  it('only adds loading="lazy" decoding="async" to images (no size change)', () => {
    for (const page of LEGACY) {
      const src = fs.readFileSync(path.join(VIEWS, `${page.view}.ejs`), 'utf8');
      for (const tag of src.match(/<img loading="lazy" decoding="async" [^>]*>/g) || []) {
        expect((tag.match(/loading=/g) || []).length).toBe(1);
      }
    }
  });
});

describe('/faq and /presse', () => {
  it('/faq lists the default FAQ with FAQPage JSON-LD and a search', async () => {
    const res = await request(app).get('/faq');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="fr-CA">');
    expect(res.text).toContain('Que fait PBTM ?');
    const types = jsonLd(res.text).map((b) => JSON.parse(b)['@type']);
    expect(types).toContain('FAQPage');
    expect(res.text).not.toContain('noindex');
    expect(res.text).not.toMatch(/<script>(?!\s*$)|<script(?![^>]*(src=|type="application\/ld\+json"))[^>]*>/);
    expect(res.text).not.toMatch(/\sstyle="/);
    const search = await request(app).get('/faq?q=langue');
    expect(search.text).toContain('Dans quelle langue travaillez-vous ?');
    expect(search.text).not.toContain('Que fait PBTM ?</summary>');
  });

  it('/faq includes the FAQ of the pages', async () => {
    seed([{ key: 'faq.marketing', lang: 'fr', type: 'json', value: JSON.stringify([{ q: 'Faites-vous du SEO local ?', r: 'Oui, pour les PME du Québec.' }]) }]);
    const res = await request(app).get('/faq');
    expect(res.text).toContain('Faites-vous du SEO local ?');
    expect(res.text).toContain('href="/marketing"');
  });

  it('/presse shows the press kit from the CMS, escaped', async () => {
    seed([
      { key: 'presse.courriel', lang: 'fr', type: 'texte', value: 'presse@pbtm.ca' },
      { key: 'presse.contact_nom', lang: 'fr', type: 'texte', value: 'Alex <Tremblay>' },
    ]);
    const res = await request(app).get('/presse');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="mailto:presse@pbtm.ca"');
    expect(res.text).toContain('Alex &lt;Tremblay&gt;');
    expect(res.text).toContain('cropped-LogoPB512gold-1.webp');
    const org = jsonLd(res.text).map((b) => JSON.parse(b)).find((b) => b['@type'] === 'Organization');
    expect(org.contactPoint.email).toBe('presse@pbtm.ca');
  });

  it('/presse ignores a malformed e-mail', async () => {
    seed([{ key: 'presse.courriel', lang: 'fr', type: 'texte', value: 'javascript:alert(1)' }]);
    const res = await request(app).get('/presse');
    expect(res.text).not.toContain('mailto:javascript');
  });
});

describe('SEO audit', () => {
  it('renders every page and scores it out of 100', async () => {
    const audit = await auditSite({ course: COURSE });
    expect(audit.pages.map((p) => p.id)).toEqual([...seo.PAGES.map((p) => p.id), 'cours-detail']);
    for (const p of audit.pages) {
      expect(p.error).toBeUndefined();
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p.checks.reduce((s, c) => s + c.max, 0)).toBe(100);
      expect(p.checks.find((c) => c.id === 'jsonld').ok).toBe(true);
      expect(p.checks.find((c) => c.id === 'canonical').ok).toBe(true);
    }
    expect(audit.moyenne).toBe(Math.round(audit.pages.reduce((s, p) => s + p.score, 0) / audit.pages.length));
  });

  it('finds missing tags, several H1, images without alt, broken links and missing keywords', () => {
    const html = '<html><head><title>Court</title></head><body><h1>A</h1><h1>B</h1><img src="/x.png"><img src="/y.png" alt="">'
      + '<a href="/inconnue">x</a><a href="/contact">ok</a><a href="https://ex.com">ext</a><a href="index.html">rel</a></body></html>';
    const r = analyse(html, { path: '/', motsCles: ['IA'] });
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.title.points).toBe(8);
    expect(by.description.points).toBe(0);
    expect(by.h1.points).toBe(8);
    expect(by.alt.points).toBe(5);
    expect(by.canonical.points).toBe(0);
    expect(by.jsonld.points).toBe(0);
    expect(by.motscles.points).toBe(0);
    expect(by.liens.points).toBe(0);
    expect(r.stats.broken).toEqual(['/inconnue', 'index.html → /index.html']);
    expect(r.corrections.join(' ')).toMatch(/H1/);
    expect(r.corrections.join(' ')).toMatch(/sans attribut alt/);
  });

  it('flags invalid JSON-LD', () => {
    const html = '<html><head><script type="application/ld+json">{oops}</script></head><body></body></html>';
    expect(analyse(html, { path: '/' }).checks.find((c) => c.id === 'jsonld').points).toBe(0);
  });

  it('resolves relative asset links against the page URL', () => {
    expect(brokenLinks('<a href="assets/img/logo/cropped-LogoPB512gold-1.webp">l</a>', '/')).toEqual([]);
    expect(brokenLinks('<a href="assets/img/logo/cropped-LogoPB512gold-1.webp">l</a>', '/course-details/4')).toHaveLength(1);
  });
});

describe('CMS zones of the SEO', () => {
  it('each page has its title and description zones, with the same fallbacks as utils/seo', () => {
    for (const p of seo.PAGES) {
      const t = cms.REGISTRY.find((z) => z.key === `seo.${p.id}.title`);
      const d = cms.REGISTRY.find((z) => z.key === `seo.${p.id}.description`);
      expect(t.fallback).toBe(seo.buildSeo(p.id).title);
      expect(d.fallback).toBe(seo.buildSeo(p.id).description);
      expect(t.fallback.length).toBeGreaterThanOrEqual(30);
      expect(t.fallback.length).toBeLessThanOrEqual(65);
      expect(d.fallback.length).toBeGreaterThanOrEqual(70);
      expect(d.fallback.length).toBeLessThanOrEqual(160);
    }
    expect(cms.REGISTRY.find((z) => z.key === 'faq.generale').fallback).toBe(seoData.FAQ_GENERALE);
    expect(cms.validateEntry({ key: 'faq.accueil', lang: 'fr', type: 'json', value: '[{"q":"a","r":"b"}]' }).entry).toBeTruthy();
  });
});

describe('server.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('mounts the SEO middleware after the CMS, the public routes before the 404 and the admin API', () => {
    const at = (s) => src.indexOf(s);
    expect(at("require('./routes(api)/utils/seo').middleware")).toBeGreaterThan(at("require('./routes(api)/utils/cms').middleware"));
    expect(at("require('./routes(api)/seoRoutes.js')")).toBeGreaterThan(0);
    expect(at("require('./routes(api)/seoRoutes.js')")).toBeLessThan(at("app.get('*'"));
    expect(at("app.use('/api/admin/croissance'")).toBeLessThan(at("app.use('/api/admin', require"));
  });
});
