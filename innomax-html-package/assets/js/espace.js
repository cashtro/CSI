// Actions of the client space and the admin console.
//
// A form with data-api="<url>" is sent with fetch (JSON, or multipart when it
// has data-multipart), with the CSRF token from the XSRF-TOKEN cookie in the
// X-CSRF-Token header. Messages are written with textContent only. On success
// the page reloads so the server re-renders the fresh data.
// With data-redirect, a response { url } is followed instead (Stripe Checkout,
// the billing portal, a provider's OAuth page): only https:// addresses or
// paths of this site. A response { message } replaces data-ok.
(function () {
  'use strict';

  function csrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function say(form, text, kind) {
    var el = form.querySelector('[data-status]');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function send(url, method, body, multipart) {
    var headers = { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' };
    if (!multipart) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: headers,
      body: multipart ? body : JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
          throw new Error('Session expirée.');
        }
        if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
        return data;
      });
    });
  }

  // Where a response may send the browser: https, or a path of this site.
  function safeUrl(url) {
    if (typeof url !== 'string' || url.length > 4000) return null;
    if (/^\/(?![\/\\])/.test(url)) return url;
    try {
      return new URL(url).protocol === 'https:' ? url : null;
    } catch (e) {
      return null;
    }
  }

  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 🎉 Light CSS confetti and a message when a deliverable is approved. The
  // pieces are positioned by :nth-child rules in pilotage.css (no inline
  // style); with reduced motion only the message is shown.
  function celebrate(text) {
    if (!calm) {
      var rain = document.createElement('div');
      rain.className = 'confetti';
      rain.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 18; i += 1) rain.appendChild(document.createElement('i'));
      document.body.appendChild(rain);
    }
    var note = document.createElement('p');
    note.className = 'celebrate';
    note.setAttribute('role', 'status');
    note.textContent = text;
    document.body.appendChild(note);
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.matches || !form.matches('form[data-api]')) return;
    event.preventDefault();

    var question = form.getAttribute('data-confirm');
    if (question && !window.confirm(question)) return;

    var multipart = form.hasAttribute('data-multipart');
    var fd = new FormData(form);
    var body = fd;
    if (!multipart) {
      body = {};
      fd.forEach(function (value, key) { body[key] = value; });
    }
    var submitter = event.submitter || form.querySelector('[type="submit"]');
    var party = form.getAttribute('data-celebrate');
    var willCelebrate = Boolean(party && submitter && submitter.value === party);
    if (submitter && submitter.name) {
      if (multipart) body.set(submitter.name, submitter.value);
      else body[submitter.name] = submitter.value;
    }

    var buttons = form.querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = true; });
    say(form, 'Envoi…');

    send(form.getAttribute('data-api'), form.getAttribute('data-method') || 'POST', body, multipart)
      .then(function (data) {
        var go = form.hasAttribute('data-redirect') && data && safeUrl(data.url);
        say(form, (data && data.message) || (go ? 'Redirection…' : form.getAttribute('data-ok') || 'Enregistré.'), 'ok');
        if (go) {
          window.location.href = go;
          return;
        }
        if (willCelebrate) celebrate('🎉 Livrable approuvé, merci !');
        var next = form.getAttribute('data-next');
        window.setTimeout(function () {
          if (next) window.location.href = next;
          else window.location.reload();
        }, willCelebrate ? (calm ? 1200 : 2200) : (data && data.message ? 1800 : 400));
      })
      .catch(function (err) {
        say(form, err.message, 'error');
        buttons.forEach(function (b) { b.disabled = false; });
      });
  });

  // On phones the section tabs scroll sideways: bring the active one into view.
  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.pl-nav');
    var active = nav && nav.querySelector('[aria-current="page"]');
    if (active && nav.scrollWidth > nav.clientWidth) {
      var left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
      nav.scrollLeft = left - (nav.clientWidth - active.offsetWidth) / 2;
    }
  });

  // Logout uses the existing /api/auth/logout route.
  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-logout]');
    if (!target) return;
    event.preventDefault();
    send('/api/auth/logout', 'POST', {}).catch(function () {}).then(function () {
      window.location.href = '/login';
    });
  });
})();
