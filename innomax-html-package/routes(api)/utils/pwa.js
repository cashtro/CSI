// PWA de PBTM (PWA.md) : manifeste, service worker, couleurs de la marque.
//
// Les couleurs viennent du BLOC MARQUE de assets/css/pilotage.css (lu au
// démarrage) : changer la marque change aussi le manifeste et la barre du
// téléphone, sans autre fichier à toucher.
//
// Le service worker (/sw.js) est assemblé ici à partir de
// assets/js/pwa/sw-regles.js (les règles de cache, testées par jest) et de
// assets/js/pwa/sw-corps.js. Sa version est une empreinte de ces fichiers et
// de la coquille : un déploiement qui change un CSS ou un JS de la coquille
// installe une nouvelle version, et l'app propose « Mettre à jour ».

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const PILOTAGE_CSS = path.join(ASSETS, 'css', 'pilotage.css');
const SW_REGLES = path.join(ASSETS, 'js', 'pwa', 'sw-regles.js');
const SW_CORPS = path.join(ASSETS, 'js', 'pwa', 'sw-corps.js');

const NOM = 'PBTM — Panda Business Tech & Marketing';
const NOM_COURT = 'PBTM';
const DESCRIPTION = 'Robots IA, formations, marketing et boutique de PBTM, et le cockpit pour piloter l’entreprise.';

const ICONES = {
  i96: '/assets/img/pwa/icone-96.png',
  i192: '/assets/img/pwa/icone-192.png',
  i512: '/assets/img/pwa/icone-512.png',
  masquable: '/assets/img/pwa/icone-512-masquable.png',
  apple: '/assets/img/pwa/apple-touch-icon.png',
  badge: '/assets/img/pwa/badge-96.png',
};
const CAPTURES = {
  large: { src: '/assets/img/pwa/capture-large.png', sizes: '1280x720' },
  etroite: { src: '/assets/img/pwa/capture-etroite.png', sizes: '390x844' },
};

// Ce que le service worker garde dès l'installation (aucune page personnelle).
const COQUILLE = [
  '/hors-ligne',
  '/connexion-requise',
  '/assets/css/pilotage.css',
  '/assets/css/vitrine.css',
  '/assets/css/pwa.css',
  '/assets/css/robots.css',
  '/assets/css/croissance.css',
  '/assets/css/aeo.css',
  '/assets/js/theme.js',
  '/assets/js/reflets.js',
  '/assets/js/espace.js',
  '/assets/js/dictee.js',
  '/assets/js/pwa/pwa.js',
  ICONES.i96,
  ICONES.i192,
  ICONES.i512,
  ICONES.masquable,
  ICONES.apple,
  ICONES.badge,
];

// ------------------------------------------------------------------ couleurs

function variables(bloc) {
  const out = {};
  for (const m of String(bloc || '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// Jetons du BLOC MARQUE : { clair, sombre }, chacun { nom: valeur résolue }.
function jetonsMarque(css = fs.readFileSync(PILOTAGE_CSS, 'utf8')) {
  const debut = css.indexOf('/* 0. BLOC MARQUE');
  const fin = css.indexOf('/* FIN DU BLOC MARQUE');
  if (debut === -1 || fin === -1) throw new Error('BLOC MARQUE introuvable dans pilotage.css');
  const bloc = css.slice(debut, fin);
  const racine = /:root\s*\{([\s\S]*?)\n\}/.exec(bloc);
  const sombre = /:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/.exec(bloc);
  const clair = variables(racine && racine[1]);
  const fonce = { ...clair, ...variables(sombre && sombre[1]) };
  const resoudre = (table) => {
    const out = {};
    for (const k of Object.keys(table)) {
      let v = table[k];
      for (let i = 0; i < 5; i += 1) {
        const ref = /^var\(--([\w-]+)\)$/.exec(v);
        if (!ref) break;
        v = table[ref[1]];
      }
      out[k] = v;
    }
    return out;
  };
  return { clair: resoudre(clair), sombre: resoudre(fonce) };
}

// Couleurs de l'app : la barre du téléphone suit le cadre (blanc ou noir),
// le manifeste prend l'indigo néon et le fond noir du panda.
function couleurs(jetons = jetonsMarque()) {
  return {
    theme: jetons.clair.indigo,
    fond: jetons.clair['panda-black'],
    barreClaire: jetons.clair.frame,
    barreSombre: jetons.sombre.frame,
  };
}

// ------------------------------------------------------------------ manifeste

function manifeste(c = couleurs()) {
  return {
    id: '/?source=pwa',
    name: NOM,
    short_name: NOM_COURT,
    description: DESCRIPTION,
    lang: 'fr-CA',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    theme_color: c.theme,
    background_color: c.fond,
    categories: ['business', 'productivity', 'education'],
    icons: [
      { src: ICONES.i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICONES.i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICONES.masquable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: CAPTURES.large.src, sizes: CAPTURES.large.sizes, type: 'image/png', form_factor: 'wide', label: 'La vitrine de PBTM sur ordinateur' },
      { src: CAPTURES.etroite.src, sizes: CAPTURES.etroite.sizes, type: 'image/png', form_factor: 'narrow', label: 'La vitrine de PBTM sur téléphone' },
    ],
    shortcuts: [
      { name: '⚡ Activer un robot', short_name: 'Robots', description: 'Choisir et activer un robot IA', url: '/robots', icons: [{ src: ICONES.i96, sizes: '96x96', type: 'image/png' }] },
      { name: '🎛️ Mon cockpit', short_name: 'Cockpit', description: 'Ce qui demande mon attention', url: '/admin/console', icons: [{ src: ICONES.i96, sizes: '96x96', type: 'image/png' }] },
      { name: '🤖 Agents', short_name: 'Agents', description: 'Les agents en direct', url: '/admin/console?vue=agents', icons: [{ src: ICONES.i96, sizes: '96x96', type: 'image/png' }] },
      { name: '💰 Finances', short_name: 'Finances', description: 'Revenus, dépenses et marge', url: '/admin/console?vue=finances', icons: [{ src: ICONES.i96, sizes: '96x96', type: 'image/png' }] },
    ],
  };
}

// ------------------------------------------------------------------ service worker

const fichierPublic = (url) => path.join(ROOT, url.replace(/^\//, ''));

let memo = null;

// { version, source } du service worker. Calculé une fois par processus.
function serviceWorker({ frais = false } = {}) {
  if (memo && !frais) return memo;
  const regles = fs.readFileSync(SW_REGLES, 'utf8');
  const corps = fs.readFileSync(SW_CORPS, 'utf8');
  const h = crypto.createHash('sha256').update(regles).update(corps).update(JSON.stringify(COQUILLE));
  for (const url of COQUILLE) {
    if (!url.startsWith('/assets/')) continue;
    try {
      h.update(fs.readFileSync(fichierPublic(url)));
    } catch {
      h.update(`absent:${url}`);
    }
  }
  // Les pages hors ligne dépendent de leurs gabarits.
  for (const v of ['hors-ligne.ejs', 'connexion-requise.ejs']) {
    try {
      h.update(fs.readFileSync(path.join(ROOT, 'views', v)));
    } catch {
      h.update(`absent:${v}`);
    }
  }
  const version = h.digest('hex').slice(0, 12);
  const source = `/* PBTM service worker, version ${version} */\n${regles}\n${corps
    .replace("var VERSION = '__PBTM_VERSION__';", `var VERSION = ${JSON.stringify(version)};`)
    .replace('var COQUILLE = __PBTM_COQUILLE__;', `var COQUILLE = ${JSON.stringify(COQUILLE)};`)}`;
  if (/var (VERSION|COQUILLE) = (')?__PBTM_/.test(source)) throw new Error('sw-corps.js : marqueurs __PBTM_VERSION__ / __PBTM_COQUILLE__ introuvables');
  memo = { version, source };
  return memo;
}

module.exports = {
  NOM, NOM_COURT, DESCRIPTION, ICONES, CAPTURES, COQUILLE,
  jetonsMarque, couleurs, manifeste, serviceWorker, fichierPublic,
};
