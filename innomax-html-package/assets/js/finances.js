// Charts of the Finances tab (/admin/console?vue=finances, FINANCES.md).
//
// - Data comes from data-serie attributes written (escaped) by the server;
//   amounts are integer cents computed on the server.
// - Drawn by hand in SVG at the container's real width, redrawn on resize,
//   so text keeps its size from 390 px to desktop.
// - Colours come from CSS classes (finances.css, BLOC MARQUE tokens); no
//   inline style, text written with textContent only.
// - Each chart also has a data table in the page (details "Voir les données").
(function () {
  'use strict';

  var root = document.querySelector('[data-fin]');
  if (!root) return;
  var NS = 'http://www.w3.org/2000/svg';

  var money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  var compact = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 });
  var $ = function (c) { return money.format(c / 100); };
  var short = function (c) { return Math.abs(c) < 100000 ? money.format(Math.round(c / 100)).replace(/,00\s/, ' ') : compact.format(c / 100); };

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function label(parent, x, y, txt, cls, anchor) {
    var t = svg('text', { x: x, y: y, class: cls || 'fin-axis', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = txt;
    return t;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function read(fig) {
    try { return JSON.parse(fig.getAttribute('data-serie') || 'null'); } catch (e) { return null; }
  }

  // Round axis maximum and ticks (1, 2, 2.5, 5 x 10^n).
  function niceMax(v) {
    if (!(v > 0)) return 100000;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i += 1) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  // Bar with rounded top corners (4 px), anchored to the baseline.
  function barPath(x, y, w, h) {
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function frame(plot, height) {
    clear(plot);
    var W = Math.max(260, Math.floor(plot.clientWidth));
    var s = svg('svg', { width: W, height: height, viewBox: '0 0 ' + W + ' ' + height, role: 'img', class: 'fin-svg' }, plot);
    return { s: s, W: W, H: height };
  }

  function yAxis(s, left, right, top, bottom, max) {
    var ticks = 4;
    for (var i = 0; i <= ticks; i += 1) {
      var v = (max / ticks) * i;
      var y = bottom - ((bottom - top) * i) / ticks;
      svg('line', { x1: left, x2: right, y1: y, y2: y, class: i === 0 ? 'fin-baseline' : 'fin-grid' }, s);
      label(s, left - 8, y + 4, short(v), 'fin-axis', 'end');
    }
  }

  // Month labels: all on wide charts, one in three (ending on the current
  // month) on phones so they never collide.
  function showTick(i, n, narrow) { return !narrow || (n - 1 - i) % 3 === 0; }

  // Hover / keyboard layer: one focusable band per month.
  function bands(s, n, left, step, top, bottom, onPick) {
    for (var i = 0; i < n; i += 1) {
      (function (i) {
        var r = svg('rect', { x: left + i * step, y: top, width: step, height: bottom - top, class: 'fin-hit', tabindex: 0 }, s);
        var pick = function () {
          Array.prototype.forEach.call(s.querySelectorAll('.is-active'), function (el) { el.classList.remove('is-active'); });
          r.classList.add('is-active');
          onPick(i);
        };
        r.addEventListener('mouseenter', pick);
        r.addEventListener('focus', pick);
        r.addEventListener('touchstart', pick, { passive: true });
      })(i);
    }
  }

  // ---------------------------------------------------- revenue vs costs
  function drawRevDep(fig) {
    var data = read(fig) || [];
    var plot = fig.querySelector('[data-plot]');
    var out = fig.querySelector('[data-readout]');
    var narrow = plot.clientWidth < 520;
    var f = frame(plot, narrow ? 230 : 280);
    f.s.setAttribute('aria-label', 'Revenus et coûts des 12 derniers mois');
    var left = narrow ? 52 : 64;
    var right = f.W - 6;
    var top = 12;
    var bottom = f.H - 30;
    var max = niceMax(Math.max.apply(null, data.map(function (d) { return Math.max(d.revenus, d.couts); }).concat([0])));
    yAxis(f.s, left, right, top, bottom, max);
    var step = (right - left) / Math.max(1, data.length);
    var bw = Math.max(3, Math.min(20, (step - 8) / 2 - 1));
    var scale = function (v) { return ((bottom - top) * Math.max(0, v)) / max; };
    data.forEach(function (d, i) {
      var cx = left + i * step + step / 2;
      var hr = scale(d.revenus);
      var hc = scale(d.couts);
      svg('path', { d: barPath(cx - bw - 1, bottom - hr, bw, hr), class: 'fin-bar fin-bar--rev' }, f.s);
      svg('path', { d: barPath(cx + 1, bottom - hc, bw, hc), class: 'fin-bar fin-bar--dep' }, f.s);
      if (showTick(i, data.length, narrow)) label(f.s, cx, f.H - 10, d.label, 'fin-axis', 'middle');
    });
    bands(f.s, data.length, left, step, top, bottom, function (i) {
      var d = data[i];
      out.textContent = d.label + ' · Revenus ' + $(d.revenus) + ' · Coûts ' + $(d.couts) + ' · Marge ' + $(d.marge);
    });
  }

  // ---------------------------------------------------- MRR
  function drawMrr(fig) {
    var data = read(fig) || [];
    var plot = fig.querySelector('[data-plot]');
    var out = fig.querySelector('[data-readout]');
    var narrow = plot.clientWidth < 520;
    var f = frame(plot, 220);
    f.s.setAttribute('aria-label', 'MRR des 12 derniers mois');
    var left = narrow ? 52 : 60;
    var right = f.W - 14;
    var top = 14;
    var bottom = f.H - 30;
    var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.mrr; }).concat([0])));
    yAxis(f.s, left, right, top, bottom, max);
    var step = (right - left) / Math.max(1, data.length);
    var pts = data.map(function (d, i) { return [left + i * step + step / 2, bottom - ((bottom - top) * Math.max(0, d.mrr)) / max]; });
    if (pts.length) {
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('');
      svg('path', { d: line + 'L' + pts[pts.length - 1][0] + ',' + bottom + 'L' + pts[0][0] + ',' + bottom + 'Z', class: 'fin-area' }, f.s);
      svg('path', { d: line, class: 'fin-line' }, f.s);
      var last = pts[pts.length - 1];
      svg('circle', { cx: last[0], cy: last[1], r: 5, class: 'fin-dot' }, f.s);
    }
    var dots = pts.map(function (p) { return svg('circle', { cx: p[0], cy: p[1], r: 5, class: 'fin-dot fin-dot--hover' }, f.s); });
    data.forEach(function (d, i) {
      if (showTick(i, data.length, narrow)) label(f.s, left + i * step + step / 2, f.H - 10, d.label, 'fin-axis', 'middle');
    });
    bands(f.s, data.length, left, step, top, bottom, function (i) {
      dots.forEach(function (c, j) { c.classList.toggle('is-shown', j === i); });
      out.textContent = data[i].label + ' · MRR ' + $(data[i].mrr);
    });
  }

  // ---------------------------------------------------- cost breakdown
  function drawRepartition(fig) {
    var rows = (read(fig) || []).filter(function (r) { return r.cents > 0; }).sort(function (a, b) { return b.cents - a.cents; });
    var plot = fig.querySelector('[data-plot]');
    if (!rows.length) { clear(plot); return; }
    var total = rows.reduce(function (s, r) { return s + r.cents; }, 0);
    var rowH = 46;
    var f = frame(plot, rows.length * rowH + 4);
    f.s.setAttribute('aria-label', 'Répartition des coûts du mois par catégorie');
    var max = rows[0].cents;
    rows.forEach(function (r, i) {
      var y = i * rowH;
      label(f.s, 0, y + 16, r.label, 'fin-cat');
      label(f.s, f.W, y + 16, $(r.cents) + ' · ' + Math.round((r.cents / total) * 100) + ' %', 'fin-cat fin-cat--num', 'end');
      svg('rect', { x: 0, y: y + 24, width: f.W, height: 12, rx: 6, class: 'fin-track' }, f.s);
      svg('rect', { x: 0, y: y + 24, width: Math.max(6, (f.W * r.cents) / max), height: 12, rx: 6, class: 'fin-bar fin-bar--cat' }, f.s);
    });
  }

  // ---------------------------------------------------- monthly goal
  function drawObjectif(fig) {
    var d = read(fig);
    var plot = fig.querySelector('[data-plot]');
    if (!plot || !d || !d.vise) return;
    var f = frame(plot, 58);
    f.s.setAttribute('aria-label', 'Progression vers l’objectif de revenu du mois');
    var scaleMax = Math.max(d.vise, d.revenus) || 1;
    var x = function (v) { return (f.W * Math.max(0, v)) / scaleMax; };
    svg('rect', { x: 0, y: 8, width: f.W, height: 18, rx: 9, class: 'fin-track' }, f.s);
    svg('rect', { x: 0, y: 8, width: Math.max(9, x(d.revenus)), height: 18, rx: 9, class: 'fin-bar fin-bar--goal' + (d.revenus >= d.vise ? ' is-done' : '') }, f.s);
    var mx = Math.min(f.W - 1, x(d.vise));
    svg('line', { x1: mx, x2: mx, y1: 2, y2: 32, class: 'fin-target' }, f.s);
    label(f.s, 0, 50, $(d.revenus) + ' encaissés', 'fin-axis');
    label(f.s, mx, 50, 'Objectif ' + short(d.vise), 'fin-axis', mx > f.W - 80 ? 'end' : 'middle');
  }

  var DRAW = { revdep: drawRevDep, mrr: drawMrr, repartition: drawRepartition, objectif: drawObjectif };
  function drawAll() {
    Array.prototype.forEach.call(root.querySelectorAll('[data-fin-chart]'), function (fig) {
      var fn = DRAW[fig.getAttribute('data-fin-chart')];
      if (fn) fn(fig);
    });
  }

  var timer = null;
  var lastW = 0;
  window.addEventListener('resize', function () {
    if (Math.abs(window.innerWidth - lastW) < 8) return;
    clearTimeout(timer);
    timer = setTimeout(function () { lastW = window.innerWidth; drawAll(); }, 150);
  });
  lastW = window.innerWidth;
  drawAll();
})();
