// Public SEO and AEO routes (see CROISSANCE.md):
//   /sitemap.xml  pages of the registry + courses of the database, lastmod from the CMS
//   /robots.txt   points to the sitemap, keeps /admin, /espace and /api out
//   /llms.txt     Markdown summary for answer engines (llmstxt.org)
//   /faq          every FAQ of the CMS (FAQPage), with a search (WebSite SearchAction)
//   /presse       press kit, editable in the CMS (presse.*)
// Mount after cms.middleware and seo.middleware.
const express = require('express');
const seo = require('./utils/seo');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');

const router = express.Router();

const PUBLIC_CACHE = 'public, max-age=3600';

// Courses of the database, newest first. An error gives an empty list: the
// static pages are still listed.
async function listCourses() {
  try {
    const { data, error } = await createSupabaseAdmin().from('cours').select('id, nom, created_at').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return data || [];
  } catch (err) {
    logger.warn('[seo] courses unavailable for the sitemap:', err.message);
    return [];
  }
}

async function listCmsDates() {
  try {
    const { data, error } = await createSupabaseAdmin().from('site_content').select('key, updated_at');
    if (error) throw new Error(error.message);
    return data || [];
  } catch (err) {
    return [];
  }
}

router.get('/sitemap.xml', async (req, res) => {
  const [courses, cmsRows] = await Promise.all([listCourses(), listCmsDates()]);
  res.set('Cache-Control', PUBLIC_CACHE);
  res.type('application/xml').send(seo.sitemapXml({ courses, cmsRows }));
});

router.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', PUBLIC_CACHE);
  res.type('text/plain').send(seo.robotsTxt());
});

router.get('/llms.txt', async (req, res) => {
  const courses = await listCourses();
  res.set('Cache-Control', PUBLIC_CACHE);
  res.type('text/plain; charset=utf-8').send(seo.llmsTxt({ courses, content: res.locals.content }));
});

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

router.get('/faq', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  let groups = seo.allFaq(res.locals.content);
  if (q) {
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    groups = groups
      .map((g) => ({ ...g, items: g.items.filter((x) => words.every((w) => norm(`${x.q} ${x.r}`).includes(w))) }))
      .filter((g) => g.items.length);
  }
  const faqItems = groups.flatMap((g) => g.items);
  res.render('faq', {
    groups,
    faqItems,
    q,
    total: faqItems.length,
    reponse: res.locals.content('presse.description', seo.ORG_DESCRIPTION),
  });
});

router.get('/presse', (req, res) => {
  res.render('presse', { orgDescription: seo.ORG_DESCRIPTION });
});

module.exports = router;
