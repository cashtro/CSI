// Corps du service worker de PBTM. Servi par GET /sw.js (routes(api)/pwaRoutes.js)
// après sw-regles.js, avec la version et la liste de la coquille injectées à
// la place de __PBTM_VERSION__ et __PBTM_COQUILLE__. Voir PWA.md.
/* global self, caches, clients, fetch, Response, Request, URL */
'use strict';

var VERSION = '__PBTM_VERSION__';
var COQUILLE = __PBTM_COQUILLE__;
var R = self.PBTM_REGLES;
var C = R.caches(VERSION);
var HORS_LIGNE = '/hors-ligne';
var CONNEXION_REQUISE = '/connexion-requise';

// Installation : la coquille (CSS, JS, icônes, pages hors ligne), téléchargée
// sans cookie pour qu'elle ne contienne rien de personnel.
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(C.coquille).then(function (cache) {
    return cache.addAll(COQUILLE.map(function (u) { return new Request(u, { cache: 'reload', credentials: 'omit' }); }));
  }));
});

// Activation : on efface les caches des versions précédentes.
self.addEventListener('activate', function (event) {
  var gardes = [C.coquille, C.pages, C.statiques];
  event.waitUntil(caches.keys().then(function (noms) {
    return Promise.all(noms.filter(function (n) { return n.indexOf(R.PREFIXE) === 0 && gardes.indexOf(n) === -1; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

function copier(nomCache, req, res) {
  if (!R.peutCacher(req, res)) return Promise.resolve();
  var copie = res.clone();
  return caches.open(nomCache).then(function (cache) { return cache.put(req, copie); }).catch(function () {});
}

// Page publique : le réseau d'abord ; sinon la dernière copie (la même
// adresse, ou la même page sans paramètres) ; sinon /hors-ligne.
function reseauDabord(event) {
  var req = event.request;
  return fetch(req).then(function (res) {
    event.waitUntil(copier(C.pages, req, res));
    return res;
  }).catch(function () {
    return caches.match(req).then(function (copie) {
      if (copie) return copie;
      if (req.mode !== 'navigate') return Response.error();
      return caches.open(C.pages)
        .then(function (cache) { return cache.match(req, { ignoreSearch: true }); })
        .then(function (proche) { return proche || caches.match(HORS_LIGNE); })
        .then(function (page) { return page || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
    });
  });
}

// Fichier statique : la copie tout de suite, et une mise à jour en arrière-plan.
function swr(event) {
  var req = event.request;
  var reseau = fetch(req).then(function (res) {
    return copier(C.statiques, req, res).then(function () { return res; });
  });
  event.waitUntil(reseau.catch(function () {}));
  return caches.match(req).then(function (copie) { return copie || reseau; });
}

// Page privée : le réseau seulement. Hors ligne : « Connexion requise ».
function prive(event) {
  return fetch(event.request).catch(function () {
    return caches.match(CONNEXION_REQUISE).then(function (page) {
      return page || new Response('Connexion requise', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var s = R.strategie({ url: req.url, method: req.method, headers: req.headers }, self.location.origin);
  if (s === 'reseau') return;
  if (s === 'prive') {
    // Une requête privée qui n'est pas une navigation (fetch d'API) n'est pas
    // touchée : le navigateur va au réseau, rien n'est copié.
    if (req.mode === 'navigate') event.respondWith(prive(event));
    return;
  }
  if (s === 'swr') event.respondWith(swr(event));
  else event.respondWith(reseauDabord(event));
});

self.addEventListener('message', function (event) {
  var m = event.data || {};
  if (m.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (m.type === 'DECONNEXION') {
    // Déconnexion : on vide les copies des pages et des fichiers.
    event.waitUntil(Promise.all(R.cachesDynamiques(VERSION).map(function (n) { return caches.delete(n); })));
  } else if (m.type === 'MEMORISER' && typeof m.url === 'string') {
    // La page où l'app a été ouverte la première fois n'est pas passée par le
    // service worker : on en garde une copie, si elle est publique.
    var url;
    try { url = new URL(m.url, self.location.origin); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;
    if (R.strategie({ url: url.href, method: 'GET', headers: {} }, self.location.origin) !== 'reseau-dabord') return;
    var req = new Request(url.href, { credentials: 'same-origin' });
    event.waitUntil(fetch(req).then(function (res) { return copier(C.pages, req, res); }).catch(function () {}));
  } else if (m.type === 'VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

// Notifications (Web Push). Le contenu vient du serveur de PBTM ; l'adresse
// ouverte au toucher est toujours un chemin du site.
self.addEventListener('push', function (event) {
  var d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  var titre = String(d.title || 'PBTM').slice(0, 120);
  event.waitUntil(self.registration.showNotification(titre, {
    body: String(d.body || '').slice(0, 300),
    icon: '/assets/img/pwa/icone-192.png',
    badge: '/assets/img/pwa/badge-96.png',
    tag: typeof d.tag === 'string' ? d.tag.slice(0, 64) : undefined,
    lang: 'fr-CA',
    data: { url: R.urlSure(d.url) },
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var cible = new URL(R.urlSure(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (liste) {
    for (var i = 0; i < liste.length; i += 1) {
      if (liste[i].url === cible && 'focus' in liste[i]) return liste[i].focus();
    }
    return clients.openWindow(cible);
  }));
});
