// Return to the page a visitor came from after signing in or signing up
// (ex. « ⚡ Activer ce robot » sends /login?next=/robots/redacteur/activer).
//
// ?next= is kept for 30 minutes in localStorage (the e-mail confirmation of a
// sign-up opens a new tab), and only a path of THIS site is accepted: never
// "//host", a backslash or a full URL (no open redirect).
// window.pbtmRetour() returns that path, or "/". The saved path is removed on
// the first call and remembered for the rest of the page (the 2FA flow of
// login.js redirects from two places).
(function () {
  'use strict';

  var KEY = 'pbtm_retour';
  var TTL = 30 * 60 * 1000;

  function safePath(p) {
    if (typeof p !== 'string' || p.length > 300) return null;
    if (!/^\/(?![\/\\])[A-Za-z0-9\-._~\/?=&%#]*$/.test(p)) return null;
    return p;
  }

  try {
    var next = safePath(new URLSearchParams(window.location.search).get('next'));
    if (next) window.localStorage.setItem(KEY, JSON.stringify({ path: next, at: Date.now() }));
  } catch (e) { /* storage blocked: plain "/" */ }

  var memo;
  window.pbtmRetour = function () {
    if (memo) return memo;
    var path = null;
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      window.localStorage.removeItem(KEY);
      if (saved && Date.now() - saved.at < TTL) path = safePath(saved.path);
    } catch (e) { path = null; }
    memo = path || '/';
    return memo;
  };
})();
