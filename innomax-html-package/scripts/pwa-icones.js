#!/usr/bin/env node
// Génère les icônes PNG de la PWA (PWA.md) à partir du panda PROVISOIRE
// assets/img/pwa/panda-source.svg, avec Chromium (Playwright) :
//
//   PLAYWRIGHT=/opt/node-tools/node_modules/playwright node scripts/pwa-icones.js
//
// Quand le logo final sera choisi : remplacer panda-source.svg, relancer ce
// script, puis committer les PNG de assets/img/pwa/. Les couleurs du fond
// viennent du BLOC MARQUE (pilotage.css, lu par utils/pwa.js).
//
// Icônes produites :
//   icone-96.png, icone-192.png, icone-512.png  « any » : carré arrondi néon
//   icone-512-masquable.png                     « maskable » : fond plein, le
//       panda tient dans le cercle de sécurité (rayon 40 % du côté)
//   apple-touch-icon.png (180)                  fond plein (iOS arrondit lui-même)
//   badge-96.png                                silhouette blanche (barre d'état Android)
//
// Avec CAPTURES_URL (adresse de la démo, ex. http://127.0.0.1:3999), le script
// prend aussi les captures du manifeste : capture-large.png (1280 × 720) et
// capture-etroite.png (390 × 844), sur la page d'accueil.

const fs = require('fs');
const path = require('path');
const pwa = require('../routes(api)/utils/pwa');

const DOSSIER = path.join(__dirname, '..', 'assets', 'img', 'pwa');
const SOURCE = path.join(DOSSIER, 'panda-source.svg');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

// Part du côté occupée par le carré de 512 du SVG source.
const ICONES = [
  { fichier: 'icone-96.png', taille: 96, forme: 'any', echelle: 0.8 },
  { fichier: 'icone-192.png', taille: 192, forme: 'any', echelle: 0.8 },
  { fichier: 'icone-512.png', taille: 512, forme: 'any', echelle: 0.8 },
  { fichier: 'icone-512-masquable.png', taille: 512, forme: 'maskable', echelle: 0.66 },
  { fichier: 'apple-touch-icon.png', taille: 180, forme: 'plein', echelle: 0.76 },
  { fichier: 'badge-96.png', taille: 96, forme: 'badge', echelle: 0.92 },
];

function page(svg, { taille, forme, echelle }, j) {
  const fond = `radial-gradient(circle at 50% 46%, color-mix(in srgb, ${j['cyan-neon']} 34%, transparent) 0%, transparent 52%),
    radial-gradient(circle at 82% 12%, color-mix(in srgb, ${j.magenta} 40%, transparent) 0%, transparent 42%),
    linear-gradient(135deg, ${j.indigo} 0%, color-mix(in srgb, ${j.indigo} 45%, ${j.violet}) 55%, ${j.violet} 100%)`;
  const arrondi = forme === 'any' ? '22%' : '0';
  const bord = forme === 'any' ? `box-shadow: inset 0 0 0 ${Math.max(2, Math.round(taille / 110))}px color-mix(in srgb, ${j['cyan-neon']} 70%, transparent);` : '';
  const filtre = forme === 'badge' ? 'filter: brightness(0) invert(1);' : `filter: drop-shadow(0 ${taille / 64}px ${taille / 24}px color-mix(in srgb, ${j['panda-black']} 55%, transparent));`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    .t { width: ${taille}px; height: ${taille}px; display: grid; place-items: center; overflow: hidden;
         border-radius: ${arrondi}; ${forme === 'badge' ? '' : `background: ${fond};`} ${bord} }
    .t svg { width: ${Math.round(taille * echelle)}px; height: ${Math.round(taille * echelle)}px; ${filtre} }
  </style></head><body><div class="t">${svg}</div></body></html>`;
}

async function main() {
  const svg = fs.readFileSync(SOURCE, 'utf8').replace(/ width="\d+" height="\d+"/, '');
  const j = pwa.jetonsMarque().clair;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    for (const icone of ICONES) {
      await p.setViewportSize({ width: icone.taille, height: icone.taille });
      await p.setContent(page(svg, icone, j));
      await p.locator('.t').screenshot({ path: path.join(DOSSIER, icone.fichier), omitBackground: true });
      process.stdout.write(`${icone.fichier} (${icone.taille}px, ${icone.forme})\n`);
    }
    if (process.env.CAPTURES_URL) {
      for (const [nom, c] of Object.entries(pwa.CAPTURES)) {
        const [w, h] = c.sizes.split('x').map(Number);
        const cp = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 600, hasTouch: w < 600 });
        // Polices Google bloquées si le réseau ne les sert pas : la capture ne doit pas attendre.
        if (process.env.CAPTURES_SANS_POLICES) await cp.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (r) => r.abort());
        const pg = await cp.newPage();
        await pg.goto(new URL('/', process.env.CAPTURES_URL).href, { waitUntil: 'load' });
        await pg.waitForTimeout(500);
        await pg.screenshot({ path: path.join(DOSSIER, path.basename(c.src)) });
        await cp.close();
        process.stdout.write(`${path.basename(c.src)} (${c.sizes}, capture ${nom})\n`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
