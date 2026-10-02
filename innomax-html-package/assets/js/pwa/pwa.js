// L'app PBTM côté navigateur (PWA.md) :
//   - enregistre le service worker (/sw.js) et garde une copie de la page
//     publique ouverte en premier ;
//   - toast « Nouvelle version de PBTM disponible » (mise à jour sur demande) ;
//   - bouton « 📲 Installer l'app PBTM » (beforeinstallprompt), aide iOS,
//     caché quand l'app est déjà installée ;
//   - notifications push (abonnement avec le jeton CSRF) ;
//   - action rapide ⚡ du cockpit (dialog), feuilles de la barre d'onglets ;
//   - à la déconnexion, vide les copies des pages (message au service worker).
// Aucun style en ligne : uniquement des classes et l'attribut hidden.
(function () {
  'use strict';

  var sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  var installee = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (installee) document.documentElement.classList.add('pwa-installee');

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function poster(url, corps) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf() },
      body: JSON.stringify(corps || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok) throw new Error(d.error || 'Erreur ' + res.status);
        return d;
      });
    });
  }

  function quand(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ---------------------------------------------------------------- toast de mise à jour

  function toast(texte, bouton, action) {
    var t = document.createElement('div');
    t.className = 'pwa-toast';
    t.setAttribute('role', 'status');
    var p = document.createElement('p');
    p.textContent = texte;
    t.appendChild(p);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--accent btn--sm';
    b.textContent = bouton;
    b.addEventListener('click', function () { b.disabled = true; action(); });
    t.appendChild(b);
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'pwa-toast-fermer';
    x.setAttribute('aria-label', 'Plus tard');
    x.textContent = '✕';
    x.addEventListener('click', function () { t.remove(); });
    t.appendChild(x);
    document.body.appendChild(t);
  }

  function proposerMiseAJour(attente) {
    if (!attente || document.querySelector('.pwa-toast')) return;
    toast('Nouvelle version de PBTM disponible', 'Mettre à jour', function () {
      attente.postMessage({ type: 'SKIP_WAITING' });
    });
  }

  // ---------------------------------------------------------------- service worker

  var enregistrement = null;
  if (sw && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // Au chargement complet, ou après 3 s si une ressource externe (police)
    // tarde : l'app ne doit pas dépendre d'un serveur tiers pour s'installer.
    var lance = false;
    var enregistrer = function () {
      if (lance) return;
      lance = true;
      sw.register('/sw.js', { scope: '/' }).then(function (reg) {
        enregistrement = reg;
        if (reg.waiting && sw.controller) proposerMiseAJour(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var nouveau = reg.installing;
          if (!nouveau) return;
          nouveau.addEventListener('statechange', function () {
            if (nouveau.state === 'installed' && sw.controller) proposerMiseAJour(reg.waiting || nouveau);
          });
        });
        document.dispatchEvent(new CustomEvent('pbtm:sw', { detail: reg }));
      }).catch(function () {});
      sw.ready.then(function (reg) {
        if (reg.active) reg.active.postMessage({ type: 'MEMORISER', url: location.href });
      });
    };
    if (document.readyState === 'complete') enregistrer();
    else {
      window.addEventListener('load', enregistrer);
      window.setTimeout(enregistrer, 3000);
    }
    var recharge = false;
    sw.addEventListener('controllerchange', function () {
      if (recharge || !document.querySelector('.pwa-toast')) return;
      recharge = true;
      location.reload();
    });
  }

  // Déconnexion : les copies des pages publiques peuvent montrer le sélecteur
  // de l'admin ; on les efface (le serveur envoie aussi Clear-Site-Data).
  document.addEventListener('click', function (e) {
    var cible = e.target.closest && e.target.closest('[data-logout]');
    if (cible && sw && sw.controller) sw.controller.postMessage({ type: 'DECONNEXION' });
  }, true);

  // ---------------------------------------------------------------- installation

  var invite = null;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function boutons() { return document.querySelectorAll('[data-installer]'); }
  function montrer(oui) {
    boutons().forEach(function (b) { b.hidden = !oui || installee; });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    invite = e;
    quand(function () { montrer(true); });
  });
  window.addEventListener('appinstalled', function () {
    installee = true;
    invite = null;
    montrer(false);
  });

  quand(function () {
    if (ios && !installee) montrer(true);
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-installer]');
      if (b) {
        if (invite) {
          invite.prompt();
          var choix = invite.userChoice;
          invite = null;
          if (choix && choix.then) choix.then(function () { montrer(false); });
          else montrer(false);
        } else {
          var aide = document.querySelector('[data-aide-ios]');
          if (aide) aide.hidden = !aide.hidden;
        }
        return;
      }
      if (e.target.closest && e.target.closest('[data-aide-ios-fermer]')) {
        var a = document.querySelector('[data-aide-ios]');
        if (a) a.hidden = true;
      }
    });
  });

  // ---------------------------------------------------------------- hors ligne

  quand(function () {
    if (!document.body.hasAttribute('data-hors-ligne')) return;
    document.querySelectorAll('[data-reessayer]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); location.reload(); });
    });
    window.addEventListener('online', function () { location.reload(); });
  });

  // ---------------------------------------------------------------- feuilles et action rapide

  quand(function () {
    var feuilles = document.querySelectorAll('[data-feuille]');
    feuilles.forEach(function (f) {
      f.addEventListener('toggle', function () {
        if (f.open) feuilles.forEach(function (o) { if (o !== f) o.open = false; });
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-feuille]')) return;
      feuilles.forEach(function (f) { f.open = false; });
    });

    var dialogue = document.querySelector('[data-ordre]');
    var ouvrir = document.querySelector('[data-ordre-ouvrir]');
    if (dialogue && ouvrir && typeof dialogue.showModal === 'function') {
      ouvrir.addEventListener('click', function (e) {
        e.preventDefault();
        dialogue.showModal();
        var champ = dialogue.querySelector('textarea');
        if (champ) champ.focus();
      });
      dialogue.addEventListener('click', function (e) {
        if (e.target === dialogue || (e.target.closest && e.target.closest('[data-ordre-fermer]'))) dialogue.close();
      });
    }
  });

  // ---------------------------------------------------------------- notifications push

  function octets(b64) {
    var s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var brut = atob(s);
    var out = new Uint8Array(brut.length);
    for (var i = 0; i < brut.length; i += 1) out[i] = brut.charCodeAt(i);
    return out;
  }

  quand(function () {
    var panneau = document.querySelector('[data-push="actif"]');
    if (!panneau) return;
    var statut = panneau.querySelector('[data-push-statut]');
    var activer = panneau.querySelector('[data-push-activer]');
    var essai = panneau.querySelector('[data-push-test]');
    var couper = panneau.querySelector('[data-push-desactiver]');
    function dire(t, sorte) {
      statut.textContent = t;
      statut.className = 'status' + (sorte ? ' is-' + sorte : '');
    }
    function etat(abonne) {
      activer.hidden = abonne;
      essai.hidden = !abonne;
      couper.hidden = !abonne;
    }
    if (!sw || !('PushManager' in window) || !('Notification' in window)) {
      activer.disabled = true;
      dire(ios && !installee ? 'Sur iPhone, installez d’abord l’app (Partager → Sur l’écran d’accueil), puis activez les notifications depuis l’app.' : 'Ce navigateur ne gère pas les notifications.');
      return;
    }
    if (Notification.permission === 'denied') dire('Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.', 'error');
    sw.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { etat(Boolean(s)); }).catch(function () {});

    activer.addEventListener('click', function () {
      activer.disabled = true;
      dire('Activation…');
      fetch('/api/push/etat', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cfg) {
        if (!cfg.actif || !cfg.cle) throw new Error('Notifications désactivées sur le serveur.');
        return Notification.requestPermission().then(function (p) {
          if (p !== 'granted') throw new Error('Permission refusée : rien n’a été activé.');
          return sw.ready;
        }).then(function (reg) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets(cfg.cle) });
        });
      }).then(function (abonnement) {
        return poster('/api/push/abonnement', abonnement.toJSON());
      }).then(function () {
        etat(true);
        dire('Notifications activées sur cet appareil.', 'ok');
      }).catch(function (err) {
        dire(err.message, 'error');
      }).then(function () { activer.disabled = false; });
    });

    essai.addEventListener('click', function () {
      poster('/api/push/test', {}).then(function (d) { dire(d.message || 'Envoyé.', 'ok'); }).catch(function (err) { dire(err.message, 'error'); });
    });

    couper.addEventListener('click', function () {
      sw.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) {
        if (!s) return null;
        var endpoint = s.endpoint;
        return s.unsubscribe().then(function () { return poster('/api/push/desabonnement', { endpoint: endpoint }); });
      }).then(function () {
        etat(false);
        dire('Notifications désactivées sur cet appareil.', 'ok');
      }).catch(function (err) { dire(err.message, 'error'); });
    });
  });

  window.PBTM_PWA = { enregistrement: function () { return enregistrement; } };
})();
