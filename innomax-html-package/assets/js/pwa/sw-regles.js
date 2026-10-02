// Règles du service worker de PBTM (PWA.md) : quelle requête passe par le
// réseau seulement, laquelle peut être mise en cache, et comment.
//
// Le même fichier sert au navigateur (concaténé dans /sw.js, il définit
// self.PBTM_REGLES) et aux tests jest (require), pour que la règle de
// sécurité soit vérifiée sur le code qui tourne vraiment.
//
// RÈGLE ABSOLUE : rien de privé n'est jamais mis en cache. Les chemins
// privés, toute requête avec Authorization et toute requête autre que GET
// passent par le réseau ; hors ligne, une navigation privée reçoit la page
// « Connexion requise », jamais une copie.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBTM_REGLES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Chemins privés (comparés en minuscules : Express ignore la casse).
  var PRIVES = [
    /^\/api(\/|$)/,
    /^\/admin/,
    /^\/espace/,
    /^\/connexions/,
    /^\/robots\/merci(\/|$)/,
    /^\/robots\/[^/]+\/activer(\/|$)/,
    /^\/demo/,
    /^\/dashboard/,
    /^\/login(\/|$)/,
    /^\/signup/,
    /^\/reset-password/,
    /^\/oauth-callback/,
    /^\/email-confirmed-callback/,
    /^\/purchase-lottery-tickets/,
    /^\/submit-contact/,
    /^\/webhook/,
    /^\/healthz/,
  ];
  // Jamais servis depuis un cache : le navigateur doit voir chaque mise à jour.
  var TOUJOURS_RESEAU = ['/sw.js', '/manifest.webmanifest'];
  // Polices Google : publiques, gardées pour que l'app reste belle hors ligne.
  var POLICES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

  var PREFIXE = 'pbtm-';
  function caches(version) {
    return {
      coquille: PREFIXE + 'coquille-' + version,
      pages: PREFIXE + 'pages-' + version,
      statiques: PREFIXE + 'statiques-' + version,
    };
  }
  // Caches vidés à la déconnexion (tout sauf la coquille, qui n'a rien de personnel).
  function cachesDynamiques(version) {
    var c = caches(version);
    return [c.pages, c.statiques];
  }

  function entete(headers, nom) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(nom);
    var cle = Object.keys(headers).find(function (k) { return k.toLowerCase() === nom.toLowerCase(); });
    return cle ? headers[cle] : null;
  }

  // Chemin normalisé : décodé, en minuscules, barres obliques regroupées. Un
  // chemin indécodable est traité comme privé.
  function chemin(url) {
    var p;
    try {
      p = decodeURIComponent(new URL(url, 'https://pbtm.invalid').pathname);
    } catch (e) {
      return null;
    }
    return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
  }

  function origineDe(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return null;
    }
  }

  function estPrive(url) {
    var p = chemin(url);
    if (p === null) return true;
    return PRIVES.some(function (re) { return re.test(p); });
  }

  // Ce que le service worker fait d'une requête :
  //   'reseau'         il ne s'en mêle pas (le navigateur va au réseau)
  //   'prive'          réseau seulement ; hors ligne, « Connexion requise »
  //   'reseau-dabord'  page publique : réseau, puis copie, puis /hors-ligne
  //   'swr'            fichier statique : copie tout de suite, mise à jour en arrière-plan
  function strategie(req, origine) {
    var methode = String(req.method || 'GET').toUpperCase();
    if (methode !== 'GET') return 'reseau';
    if (entete(req.headers, 'authorization')) return 'reseau';
    var url;
    try {
      url = new URL(req.url, origine);
    } catch (e) {
      return 'reseau';
    }
    if (url.origin !== origine) return POLICES.indexOf(url.origin) !== -1 ? 'swr' : 'reseau';
    if (estPrive(url.href)) return 'prive';
    var p = chemin(url.href);
    if (TOUJOURS_RESEAU.indexOf(p) !== -1) return 'reseau';
    if (p.indexOf('/assets/') === 0) return 'swr';
    return 'reseau-dabord';
  }

  // Une réponse peut-elle être copiée ? Seulement une réponse 200 complète,
  // sans redirection, d'une requête publique, et que le serveur n'a pas
  // marquée no-store ou private.
  function peutCacher(req, res) {
    if (!req || !res) return false;
    if (String(req.method || 'GET').toUpperCase() !== 'GET') return false;
    if (entete(req.headers, 'authorization')) return false;
    if (estPrive(req.url)) return false;
    // Feuille de style Google Fonts chargée sans CORS : réponse opaque, publique.
    if (res.type === 'opaque') return origineDe(req.url) === POLICES[0];
    if (res.status !== 200 || res.redirected) return false;
    if (res.type && res.type !== 'basic' && res.type !== 'cors' && res.type !== 'default') return false;
    var cc = String(entete(res.headers, 'cache-control') || '').toLowerCase();
    if (/(^|[\s,])(no-store|private)([\s,]|$)/.test(cc)) return false;
    var vary = String(entete(res.headers, 'vary') || '');
    if (vary.trim() === '*') return false;
    return true;
  }

  // Adresse sûre pour l'ouverture d'une notification : un chemin du site.
  function urlSure(url) {
    if (typeof url !== 'string' || url.length > 500) return '/';
    return /^\/(?![/\\])/.test(url) ? url : '/';
  }

  return {
    PRIVES: PRIVES,
    TOUJOURS_RESEAU: TOUJOURS_RESEAU,
    PREFIXE: PREFIXE,
    caches: caches,
    cachesDynamiques: cachesDynamiques,
    chemin: chemin,
    estPrive: estPrive,
    strategie: strategie,
    peutCacher: peutCacher,
    urlSure: urlSure,
  };
});
