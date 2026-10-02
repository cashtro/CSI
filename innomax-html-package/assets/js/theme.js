// Light / dark theme for /espace and /admin/console.
// Loaded in <head> without defer so a saved choice applies before the first
// paint. The choice is kept in localStorage (wrapped in try/catch: private
// windows and blocked storage simply fall back to the system preference).
(function () {
  'use strict';
  var KEY = 'pandora-theme';
  var root = document.documentElement;

  function read() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* storage unavailable */ }
  }
  function current() {
    var chosen = root.getAttribute('data-theme');
    if (chosen === 'light' || chosen === 'dark') return chosen;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var saved = read();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  function paint(button) {
    var dark = current() === 'dark';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute('aria-label', dark ? 'Passer au thème clair' : 'Passer au thème sombre');
    button.setAttribute('title', dark ? 'Thème clair' : 'Thème sombre');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    buttons.forEach(function (button) {
      button.hidden = false;
      paint(button);
      button.addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        write(next);
        buttons.forEach(paint);
      });
    });
  });
})();
