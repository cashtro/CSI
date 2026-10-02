// Actions of the client space and the admin console.
//
// A form with data-api="<url>" is sent with fetch (JSON, or multipart when it
// has data-multipart), with the CSRF token from the XSRF-TOKEN cookie in the
// X-CSRF-Token header. Messages are written with textContent only. On success
// the page reloads so the server re-renders the fresh data.
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
          window.location.href = '/login';
          throw new Error('Session expirée.');
        }
        if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
        return data;
      });
    });
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
    if (submitter && submitter.name) {
      if (multipart) body.set(submitter.name, submitter.value);
      else body[submitter.name] = submitter.value;
    }

    var buttons = form.querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = true; });
    say(form, 'Envoi…');

    send(form.getAttribute('data-api'), form.getAttribute('data-method') || 'POST', body, multipart)
      .then(function () {
        say(form, form.getAttribute('data-ok') || 'Enregistré.', 'ok');
        var next = form.getAttribute('data-next');
        window.setTimeout(function () {
          if (next) window.location.href = next;
          else window.location.reload();
        }, 400);
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
