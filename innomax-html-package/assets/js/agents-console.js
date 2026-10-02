// Agent tabs of the admin console (/admin/console?vue=agents|conseil|travail|
// recherche|reglages-agents). Reproduces the "Centre de commande" artifact on
// top of the agent engine API (/api/admin/agents, admin + 2FA + CSRF).
//
// - Live log: EventSource on /stream; after repeated errors it falls back to
//   polling /activity every 5 s.
// - Every text from the server is written with textContent (never innerHTML).
//   Links to sources are kept only when they are https URLs.
// - Static file, no inline script or style (CSP). Colours come from CSS custom
//   properties (agents-console.css); the canvas reads them through a probe.
// - prefers-reduced-motion: the network is drawn still, without animation.
(function () {
  'use strict';

  var root = document.querySelector('[data-agents-vue]');
  if (!root || !window.fetch) return;
  var VUE = root.getAttribute('data-agents-vue');
  var API = '/api/admin/agents';
  var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ------------------------------------------------------------ helpers

  function el(tag, props) {
    var n = document.createElement(tag);
    var p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i += 1) append(n, arguments[i]);
    return n;
  }
  function append(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(n, k); }); return; }
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function $(sel, scope) { return (scope || root).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || root).querySelectorAll(sel)); }
  var txt = function (v) { return v === null || v === undefined ? '' : String(v); };
  var arr = function (v) { return Array.isArray(v) ? v : []; };
  var clip = function (s, n) { s = txt(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function csrfToken() {
    var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function api(path, opts) {
    var o = opts || {};
    var headers = { Accept: 'application/json' };
    if (o.method && o.method !== 'GET') {
      headers['X-CSRF-Token'] = csrfToken();
      headers['Content-Type'] = 'application/json';
    }
    return fetch(API + path, {
      method: o.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { window.location.href = '/login'; throw new Error('Session expirée.'); }
        if (!res.ok) {
          var e = new Error((data && data.error) || ('Erreur ' + res.status));
          e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  }

  function say(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'status' + (kind ? ' is-' + kind : '');
  }

  var TZ = 'America/Toronto';
  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
  }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
  }
  function usd(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('fr-CA', { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 3 : 2 }) + ' $';
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? (many || one + 's') : one); }
  function initials(name) {
    return txt(name).split(/[\s-]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function safeHttps(url) {
    try {
      var u = new URL(String(url));
      return u.protocol === 'https:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function debounce(fn, ms) {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  var KIND = { order: ['🚦', 'Ordre'], debate: ['🧠', 'Conseil'], research: ['🔎', 'Recherche'] };
  var STATUS = {
    queued: ['⏳', 'En file', 'file'],
    running: ['🔥', 'En cours', 'run'],
    done: ['✅', 'Terminé', 'ok'],
    error: ['⚠️', 'Erreur', 'bad'],
    cancelled: ['✖️', 'Annulé', 'off'],
    budget_refused: ['💸', 'Refusé (budget)', 'bad'],
  };
  var FEED_EMOJI = {
    job_queued: '📥', job_started: '▶️', phase: '🧠', job_done: '✅', job_error: '⚠️', job_retry: '🔁',
    job_cancelled: '✖️', job_cancel_requested: '✖️', job_budget_refused: '💸', settings: '⚙️', import: '👥', emergency_stop: '🛑',
  };
  var PHASES = [['plan', 'Plan et tâches'], ['propositions', 'Propositions'], ['objections', 'Contradiction'], ['revisions', 'Révisions'], ['vote', 'Vote'], ['revision_finale', 'Consensus']];
  var CONSENSUS = 0.7;

  function pill(status) {
    var s = STATUS[status] || ['•', status, ''];
    return el('span', { class: 'ag-pill ag-pill--' + s[2] }, s[0] + ' ' + s[1]);
  }
  function kindLabel(kind) { var k = KIND[kind] || ['•', kind]; return k[0] + ' ' + k[1]; }
  function entrepriseName(id) {
    if (!id) return 'Pour Pandora';
    var opt = document.querySelector('select[name="entreprise_id"] option[value="' + String(id).replace(/[^0-9a-f-]/gi, '') + '"]');
    return opt ? 'Pour ' + opt.textContent : 'Client ' + String(id).slice(0, 8);
  }
  function jobSubject(j) {
    var p = j.payload || {};
    return txt(p.instruction || p.question || p.sujet || '');
  }
  function out(text) { return el('div', { class: 'ag-out' }, txt(text)); }

  // <details> keep their open state across refreshes (key = data-k).
  function openKeys(scope) {
    var keys = {};
    $$('details[data-k]', scope).forEach(function (d) { keys[d.getAttribute('data-k')] = d.open; });
    return keys;
  }
  function restoreOpen(scope, keys) {
    $$('details[data-k]', scope).forEach(function (d) {
      var k = d.getAttribute('data-k');
      if (Object.prototype.hasOwnProperty.call(keys, k)) d.open = keys[k];
    });
  }

  // ------------------------------------------------------------ state

  var S = { teams: [], agents: [], byId: {}, lastActivity: 0, feed: [], focus: null };
  function teamOf(key) {
    for (var i = 0; i < S.teams.length; i += 1) if (S.teams[i].key === key) return S.teams[i];
    return { key: key, name: key || 'Sans équipe', short: key || '?', emoji: '•' };
  }
  function agentName(id) { return id && S.byId[id] ? S.byId[id].name : (id || ''); }

  function loadAgents() {
    return api('/agents').then(function (data) {
      S.teams = arr(data.teams);
      S.agents = arr(data.agents);
      S.byId = {};
      S.agents.forEach(function (a) { S.byId[a.id] = a; });
      return S;
    });
  }

  // ------------------------------------------------------------ live stream

  var liveHandlers = [];
  function onLive(fn) { liveHandlers.push(fn); }
  function setLiveState(text, cls) {
    $$('[data-live-state]').forEach(function (n) { n.textContent = text; n.className = 'ag-live ag-live--' + cls; });
  }
  function deliver(rows) {
    var fresh = arr(rows).filter(function (r) { return Number(r.id) > S.lastActivity; });
    if (!fresh.length) return;
    fresh.forEach(function (r) { S.lastActivity = Math.max(S.lastActivity, Number(r.id)); });
    liveHandlers.forEach(function (fn) { fn(fresh); });
  }
  function startLive() {
    var polling = false;
    var fails = 0;
    var es = null;
    function poll() {
      var path = S.lastActivity ? '/activity?after=' + S.lastActivity : '/activity';
      api(path).then(deliver).catch(function () { setLiveState('Hors ligne, nouvel essai…', 'wait'); })
        .then(function () { setTimeout(poll, 5000); });
    }
    function startPolling() {
      if (polling) return;
      polling = true;
      if (es) es.close();
      setLiveState('Relève toutes les 5 s', 'poll');
      poll();
    }
    if (!window.EventSource) { startPolling(); return; }
    try {
      es = new EventSource(API + '/stream');
    } catch (e) {
      startPolling();
      return;
    }
    es.addEventListener('open', function () { fails = 0; setLiveState('En direct', 'on'); });
    es.addEventListener('activity', function (e) {
      try { deliver([JSON.parse(e.data)]); } catch (err) { /* ignore a malformed event */ }
    });
    es.addEventListener('error', function () {
      fails += 1;
      setLiveState('Reconnexion…', 'wait');
      if (fails >= 3 || es.readyState === 2) startPolling();
    });
  }

  // ------------------------------------------------------------ shared renderers

  function frieze(job) {
    var r = job.result || {};
    var done = job.status === 'done' && r.phase === 'termine';
    var at = -1;
    for (var i = 0; i < PHASES.length; i += 1) if (PHASES[i][0] === r.phase) at = i;
    if (job.status === 'running' && at < 0) at = 0;
    var live = job.status === 'running';
    return el('ol', { class: 'ag-frieze', 'aria-label': 'Étapes du Conseil' }, PHASES.map(function (p, idx) {
      var st = done || idx < at ? 'is-done' : idx === at && live ? 'is-on' : '';
      return el('li', { class: st, 'aria-current': st === 'is-on' ? 'step' : null },
        el('span', { class: 'ag-node', 'aria-hidden': 'true' }, st === 'is-done' ? '✓' : String(idx + 1)), el('span', {}, p[1]));
    }));
  }

  function gauge(tour) {
    var pct = Math.round((Number(tour.accord) || 0) * 100);
    var need = Math.round(CONSENSUS * 100);
    var reach = (Number(tour.accord) || 0) >= CONSENSUS;
    var votes = arr(tour.votes);
    var pour = votes.filter(function (v) { return v.vote === 'pour'; }).length;
    var bar = el('div', { class: 'ag-gauge-track' + (reach ? ' is-reach' : ''), role: 'meter', 'aria-label': 'Accord du Conseil', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
      el('i', { class: 'ag-gauge-fill' }), el('span', { class: 'ag-gauge-thr', title: 'seuil ' + need + ' %' }));
    bar.style.setProperty('--pct', pct + '%');
    bar.style.setProperty('--thr', need + '%');
    return el('div', { class: 'ag-gauge' },
      el('div', { class: 'ag-gauge-top' }, el('span', {}, 'Tour ' + tour.tour + ' · ' + pour + ' pour, ' + (votes.length - pour) + ' contre'),
        el('b', { class: reach ? 'is-reach' : 'is-short' }, pct + ' % d’accord')),
      bar,
      el('div', { class: 'ag-gauge-foot' },
        el('span', { class: 'ag-votes', 'aria-hidden': 'true' }, votes.map(function (v) { return el('i', { class: v.vote === 'pour' ? 'is-pour' : 'is-contre', title: txt(v.nom || v.agent) + ' : ' + v.vote }); })),
        el('span', { class: reach ? 'ag-ok' : 'dim' }, reach ? '🎉 Consensus atteint' : 'Il manque ' + (need - pct) + ' points (seuil ' + need + ' %)')));
  }

  function section(k, title, kids) {
    return el('details', { class: 'ag-sub', 'data-k': k }, el('summary', {}, title), el('div', { class: 'ag-sub-body' }, kids));
  }
  function bullets(list) { return el('ul', { class: 'ag-bullets' }, arr(list).map(function (x) { return el('li', {}, txt(typeof x === 'string' ? x : x && (x.titre || JSON.stringify(x)))); })); }
  function conf(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    return Math.round(n <= 1 ? n * 100 : n) + ' %';
  }

  function debateBody(job) {
    var r = job.result || {};
    var key = 'd-' + job.id;
    var tours = arr(r.tours);
    var last = tours[tours.length - 1];
    var dec = r.decision || null;
    var phaseLabel = '';
    PHASES.forEach(function (p) { if (p[0] === r.phase) phaseLabel = p[1]; });
    var nbObj = arr(r.objections).reduce(function (t, o) { return t + arr(o.objections).length; }, 0);
    return [
      frieze(job),
      job.status === 'running' ? el('p', { class: 'ag-liveline' }, '🧠 Le Conseil travaille : ' + (phaseLabel || 'préparation') + '…') : null,
      job.status === 'queued' ? el('p', { class: 'dim' }, '⏳ En file : le moteur le prendra à son prochain passage.') : null,
      last ? gauge(last) : null,
      dec ? el('div', { class: 'ag-decision' }, el('b', {}, '🏆 Décision : '), txt(dec.decision)) : null,
      dec && dec.dissidence ? el('p', { class: 'dim' }, '🗣️ Dissidence : ' + txt(dec.dissidence)) : null,
      r.plan ? section(key + '-plan', '🗂️ Plan · ' + arr(r.plan.questions).length + ' questions, ' + arr(r.plan.taches).length + ' tâches', [
        el('b', {}, 'Questions'), bullets(r.plan.questions), el('b', {}, 'Critères'), bullets(r.plan.criteres), el('b', {}, 'Tâches d’analyse'), bullets(r.plan.taches)]) : null,
      arr(r.propositions).length ? section(key + '-props', '💡 Propositions · ' + r.propositions.length, r.propositions.map(function (p, i) {
        return el('div', { class: 'ag-entry' }, el('b', {}, 'P' + (i + 1) + ' · ' + txt(p.nom || p.agent) + ' (confiance ' + conf(p.confiance) + ') : '), txt(p.position),
          arr(p.arguments).length ? bullets(p.arguments) : null,
          p.premiere_action ? el('div', { class: 'dim' }, 'Première action : ' + txt(p.premiere_action)) : null);
      })) : null,
      arr(r.objections).length ? section(key + '-obj', '😈 Contradiction · ' + plural(nbObj, 'objection'), r.objections.map(function (o) {
        return el('div', { class: 'ag-entry' },
          arr(o.objections).map(function (x) {
            var g = Number(x.gravite) || 0;
            return el('div', {}, el('b', { class: 'ag-t-contra' }, txt(o.nom || o.agent) + ' → ' + txt(x.cible) + ' '),
              el('span', { class: 'ag-pill ' + (g >= 4 ? 'ag-pill--bad' : g >= 3 ? 'ag-pill--run' : 'ag-pill--file') }, 'gravité ' + g), ' ', txt(x.objection));
          }),
          o.contre_proposition ? el('div', { class: 'dim' }, 'Contre-proposition : ' + txt(o.contre_proposition)) : null);
      })) : null,
      arr(r.revisions).length ? section(key + '-rev', '✏️ Révisions · ' + r.revisions.length, r.revisions.map(function (v) {
        var concede = Array.isArray(v.concede) ? v.concede.join(' ; ') : txt(v.concede);
        return el('div', { class: 'ag-entry' }, el('b', {}, txt(v.nom || v.agent) + ' : '), txt(v.position),
          concede ? el('div', { class: 'dim' }, 'Concède : ' + concede) : null);
      })) : null,
      tours.length ? section(key + '-votes', '🗳️ Votes · ' + plural(tours.length, 'tour'), tours.map(function (t) {
        return el('div', { class: 'ag-entry' },
          el('b', {}, 'Tour ' + t.tour + ' · ' + Math.round((Number(t.accord) || 0) * 100) + ' % : '), txt(t.arbitre && t.arbitre.proposition),
          arr(t.votes).map(function (v) {
            return el('div', {}, el('span', { class: 'ag-pill ' + (v.vote === 'pour' ? 'ag-pill--ok' : 'ag-pill--bad') }, (v.vote === 'pour' ? '👍 pour ' : '👎 contre ') + conf(v.confiance)),
              ' ' + txt(v.nom || v.agent) + ' : ' + txt(v.raison), v.condition ? el('span', { class: 'dim' }, ' (condition : ' + txt(v.condition) + ')') : null);
          }));
      })) : null,
      dec ? section(key + '-final', '✅ Plan final et tâches · ' + plural(Number(r.taches_creees) || arr(dec.taches).length, 'tâche') + ' à valider', [
        el('b', {}, 'Justification'), el('p', {}, txt(dec.justification)),
        el('b', {}, 'Plan'), el('ol', { class: 'ag-bullets' }, arr(dec.plan).map(function (x) { return el('li', {}, txt(x)); })),
        el('b', {}, 'Tâches'), bullets(arr(dec.taches).map(function (t) { return txt(t.titre) + (t.responsable ? ' (' + txt(t.responsable) + ')' : '') + (t.detail ? ' : ' + txt(t.detail) : ''); })),
        el('b', {}, 'Risques'), bullets(dec.risques),
        el('b', {}, 'À valider par toi'), bullets(dec.points_a_valider)]) : null,
      arr(r.erreurs).length ? el('p', { class: 'dim' }, '⚠️ ' + plural(r.erreurs.length, 'agent') + ' n’a pas répondu correctement (le Conseil a continué sans).') : null,
      job.error ? el('p', { class: 'status is-error' }, txt(job.error)) : null,
    ];
  }

  function sourcesList(sources) {
    var list = arr(sources).map(function (s) {
      var href = safeHttps(s.url);
      if (!href) return null;
      return el('li', {},
        el('a', { href: href, target: '_blank', rel: 'noopener noreferrer nofollow' }, txt(s.titre || href)),
        el('span', { class: 'dim' }, ' · ' + hostOf(href)),
        s.cite ? el('span', { class: 'ag-pill ag-pill--ok' }, 'cité') : null,
        s.extrait ? el('q', { class: 'ag-extrait' }, txt(s.extrait)) : null);
    }).filter(Boolean);
    return list.length ? el('ol', { class: 'ag-sources' }, list) : el('p', { class: 'dim' }, 'Aucune source https retenue.');
  }

  function researchBody(job) {
    var r = job.result || {};
    var p = job.payload || {};
    return [
      el('div', { class: 'item-meta' }, agentName(p.agent_id) + ' · ' + entrepriseName(job.entreprise_id) + ' · ' + when(job.created_at)
        + (r.recherches ? ' · ' + plural(r.recherches, 'recherche web', 'recherches web') : '') + (Number(job.cost_usd) ? ' · ' + usd(job.cost_usd) : '')),
      job.status === 'queued' ? el('p', { class: 'dim' }, '⏳ En file : le moteur la prendra à son prochain passage.') : null,
      job.status === 'running' ? el('p', { class: 'ag-liveline' }, '🔎 ' + agentName(p.agent_id) + ' cherche sur le web…') : null,
      r.texte ? el('h3', {}, 'Synthèse') : null,
      r.texte ? out(r.texte) : null,
      r.tronque ? el('p', { class: 'dim' }, 'Réponse tronquée : relance avec une question plus précise.') : null,
      job.status === 'done' || arr(r.sources).length ? el('h3', {}, 'Sources (' + arr(r.sources).length + ')') : null,
      job.status === 'done' || arr(r.sources).length ? sourcesList(r.sources) : null,
      arr(r.erreurs_recherche).length ? el('p', { class: 'dim' }, 'Recherches en erreur : ' + r.erreurs_recherche.join(', ')) : null,
      job.error ? el('p', { class: 'status is-error' }, txt(job.error)) : null,
    ];
  }

  function cancelButton(job, after) {
    if (job.status !== 'queued' && job.status !== 'running') return null;
    var st = el('span', { class: 'status', role: 'status' });
    var b = el('button', {
      class: 'btn btn--danger btn--sm',
      type: 'button',
      onclick: function () {
        if (!window.confirm('Annuler ce travail ?')) return;
        b.disabled = true;
        api('/jobs/' + job.id + '/cancel', { method: 'POST', body: {} })
          .then(function () { say(st, 'Annulation demandée.', 'ok'); if (after) after(); })
          .catch(function (e) { say(st, e.message, 'error'); b.disabled = false; });
      },
    }, '✖️ Annuler');
    return el('div', { class: 'actions' }, b, st);
  }

  // Cache of job details: done jobs are fetched once, live ones again.
  var details = {};
  function jobDetail(id, force) {
    var c = details[id];
    if (c && !force && (c.status === 'done' || c.status === 'error' || c.status === 'cancelled' || c.status === 'budget_refused')) return Promise.resolve(c);
    return api('/jobs/' + id).then(function (j) { details[id] = j; return j; });
  }

  // ------------------------------------------------------------ console: rooms

  function agentButton(a) {
    var working = a.status === 'working';
    var paused = a.active === false;
    var t = teamOf(a.team);
    return el('button', {
      class: 'ag-agent-btn ag-t-' + t.key + (working ? ' is-working' : '') + (paused ? ' is-paused' : ''),
      type: 'button',
      'aria-pressed': String(S.focus === a.id),
      'data-agent': a.id,
      onclick: function () { focusAgent(S.focus === a.id ? null : a.id); },
    },
    el('span', { class: 'ag-avatar', 'aria-hidden': 'true' }, initials(a.name), el('i', { class: 'ag-mood' }, working ? '🔥' : paused ? '😴' : '😊')),
    el('span', { class: 'ag-nm' }, txt(a.name), el('span', { class: 'ag-pill ' + (working ? 'ag-pill--run' : paused ? 'ag-pill--off' : 'ag-pill--ok') }, working ? 'au travail' : paused ? 'en pause' : 'disponible')),
    el('span', { class: 'ag-st' }, working ? 'Au travail : ' + clip(a.current_task || 'une tâche', 90) : txt(a.role)));
  }

  function roomBox(t) {
    var members = S.agents.filter(function (a) { return a.team === t.key; });
    var busy = members.filter(function (a) { return a.status === 'working'; }).length;
    var paused = members.filter(function (a) { return a.active === false; }).length;
    var idle = members.length - busy - paused;
    return el('section', { class: 'ag-room ag-t-' + t.key, 'aria-label': 'Salle ' + t.name },
      el('header', {}, el('h3', {}, el('span', { class: 'ag-emb', 'aria-hidden': 'true' }, t.emoji), t.name), el('small', {}, plural(members.length, 'agent'))),
      el('div', { class: 'ag-seg', role: 'img', 'aria-label': busy + ' au travail, ' + idle + ' disponibles, ' + paused + ' en pause' },
        members.length ? members.map(function (a) { return el('i', { class: a.status === 'working' ? 'is-w' : a.active === false ? 'is-p' : '' }); }) : el('i', { class: 'is-none' })),
      el('p', { class: 'ag-legend2' }, el('span', { class: busy ? 'is-w' : '' }, '🔥 ' + busy + ' au travail'), el('span', {}, '😊 ' + idle + ' dispo'), paused ? el('span', {}, '😴 ' + paused + ' en pause') : null),
      members.length ? members.map(agentButton) : el('p', { class: 'empty' }, 'Salle vide pour l’instant.'));
  }

  function renderRooms() {
    var prod = $('[data-rooms="prod"]');
    var delib = $('[data-rooms="delib"]');
    if (!prod) return;
    var pt = S.teams.filter(function (t) { return !t.delib; });
    var dt = S.teams.filter(function (t) { return t.delib; });
    clear(prod);
    clear(delib);
    if (!S.agents.length) prod.appendChild(el('p', { class: 'empty' }, 'Aucun agent. Importe les agents de départ dans ⚙️ Réglages agents.'));
    else pt.forEach(function (t) { prod.appendChild(roomBox(t)); });
    dt.forEach(function (t) { delib.appendChild(roomBox(t)); });
    var c = $('[data-count="prod"]');
    if (c) c.textContent = plural(pt.length, 'équipe');
  }

  function focusAgent(id) {
    S.focus = id;
    $$('[data-agent]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-agent') === id)); });
    renderAgentPanel();
    drawOnce();
  }

  function renderAgentPanel() {
    var panel = $('[data-agent-panel]');
    if (!panel) return;
    var a = S.focus && S.byId[S.focus];
    if (!a) { panel.hidden = true; clear(panel); return; }
    var t = teamOf(a.team);
    var working = a.status === 'working';
    var list = el('div', { class: 'ag-list' }, el('p', { class: 'dim' }, 'Chargement de ses travaux…'));
    clear(panel);
    append(panel, [
      el('div', { class: 'panel-head' }, el('h2', {}, el('span', { class: 'ag-emb ag-t-' + t.key, 'aria-hidden': 'true' }, t.emoji), ' ' + a.name + ' ', working ? '🔥' : a.active === false ? '😴' : '😊'),
        el('button', { class: 'icon-btn ag-close', type: 'button', 'aria-label': 'Fermer la fiche de ' + a.name, onclick: function () { focusAgent(null); } }, '✕')),
      el('p', { class: 'item-meta' }, txt(a.role) + ' · ' + t.name + ' · ' + (a.engine === 'maison' ? 'méthode maison' : 'travaille avec Claude')),
      working ? el('p', { class: 'ag-liveline' }, 'Au travail : ' + txt(a.current_task)) : null,
      arr(a.tools).length ? el('p', { class: 'ag-tools' }, arr(a.tools).map(function (x) { return el('span', { class: 'tag' }, '🧰 ' + txt(x)); })) : null,
      a.method ? el('details', { class: 'ag-sub', 'data-k': 'm-' + a.id }, el('summary', {}, '📋 Sa méthode'), out(a.method)) : null,
      el('div', { class: 'actions' }, el('button', {
        class: 'btn btn--gold btn--sm',
        type: 'button',
        onclick: function () {
          var who = document.getElementById('ag-o-who');
          var text = document.getElementById('ag-o-text');
          if (who) who.value = 'a:' + a.id;
          if (text) { text.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' }); text.focus({ preventScroll: true }); }
        },
      }, '🚦 Lui donner un ordre'), el('a', { class: 'btn btn--ghost btn--sm', href: '/admin/console?vue=travail&agent=' + encodeURIComponent(a.id) }, 'Tout son travail →')),
      el('h3', {}, 'Ce qu’il a fait'),
      list,
    ]);
    panel.hidden = false;
    api('/jobs?agent_id=' + encodeURIComponent(a.id) + '&limit=5').then(function (jobs) {
      clear(list);
      if (!jobs.length) { list.appendChild(el('p', { class: 'empty' }, 'Aucun travail pour l’instant.')); return; }
      jobs.forEach(function (j) {
        list.appendChild(el('div', { class: 'item' }, el('div', { class: 'item-head' }, el('span', {}, kindLabel(j.kind) + ' · ' + clip(jobSubject(j), 80)), pill(j.status)),
          el('div', { class: 'item-meta' }, when(j.created_at))));
      });
    }).catch(function () { clear(list).appendChild(el('p', { class: 'dim' }, 'Lecture impossible.')); });
  }

  // ------------------------------------------------------------ console: network canvas

  var Net = { canvas: null, tip: null, nodes: [], hover: null, looping: false, C: null };

  function resolveColors() {
    var probe = el('span', { class: 'ag-probe', 'aria-hidden': 'true' });
    root.appendChild(probe);
    // A computed color-mix() may read back as color(srgb …): paint it on a
    // 1×1 canvas to get plain rgb() for the 2D context.
    var pix = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var get = function (name) {
      probe.style.color = 'var(' + name + ')';
      var value = getComputedStyle(probe).color;
      if (!pix || /^rgba?\(/.test(value)) return value;
      pix.clearRect(0, 0, 1, 1);
      pix.fillStyle = value;
      pix.fillRect(0, 0, 1, 1);
      var d = pix.getImageData(0, 0, 1, 1).data;
      return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
    };
    var C = {
      line: get('--ag-line'), ink: get('--ag-ink'), muted: get('--ag-muted'), surface: get('--ag-surface'),
      work: get('--ag-work'), accent: get('--ag-accent'), core: get('--ag-core'), coreInk: get('--ag-core-ink'), team: {},
    };
    S.teams.forEach(function (t) { C.team[t.key] = get('--ag-team-' + t.key); });
    root.removeChild(probe);
    Net.C = C;
  }

  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function packet(g, ax, ay, bx, by, p, color, size) {
    var x = lerp(ax, bx, p);
    var y = lerp(ay, by, p);
    var s = size || 2.4;
    g.save();
    for (var k = 1; k <= 3; k += 1) {
      var q = Math.max(0, p - k * 0.025);
      g.globalAlpha = 0.28 / k;
      g.fillStyle = color;
      circle(g, lerp(ax, bx, q), lerp(ay, by, q), s * (1 - k * 0.18));
      g.fill();
    }
    g.globalAlpha = 1;
    g.shadowColor = color;
    g.shadowBlur = 12;
    circle(g, x, y, s * 1.15);
    g.fill();
    g.restore();
  }

  function drawNet(t) {
    var c = Net.canvas;
    if (!c || !c.isConnected) return;
    var w = c.clientWidth;
    var h = c.clientHeight;
    if (!w || !h) return;
    if (!Net.C) resolveColors();
    var C = Net.C;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var still = calm.matches;
    var s = (still ? 0 : t) / 1000;
    var narrow = w < 520;
    var cx = w / 2;
    var cy = h / 2;
    var rx = Math.min(w * (narrow ? 0.3 : 0.36), 440);
    var ry = h * 0.3;

    // Soft rings and a slow sweep around the core.
    g.strokeStyle = C.line;
    g.lineWidth = 1;
    [0.45, 0.8, 1.15].forEach(function (k) {
      g.save(); g.globalAlpha = 0.8; g.setLineDash([2, 6]); g.beginPath(); g.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    });
    if (!still) {
      g.save(); g.globalAlpha = 0.6; g.strokeStyle = C.accent; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.ellipse(cx, cy, rx * 0.45, ry * 0.45, 0, s * 0.8, s * 0.8 + 0.9); g.stroke(); g.restore();
    }

    // Production rooms on the outer ring, deliberation rooms near the core.
    var prodT = S.teams.filter(function (x) { return !x.delib; });
    var delT = S.teams.filter(function (x) { return x.delib; });
    var hubs = prodT.map(function (tm, i) {
      var a = -Math.PI / 2 - Math.PI / prodT.length + (2 * Math.PI * i) / prodT.length;
      return { key: tm.key, short: tm.short, emoji: tm.emoji, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, col: C.team[tm.key] || C.muted, inner: false };
    }).concat(delT.map(function (tm, i) {
      var a = -Math.PI / 2 + (2 * Math.PI * i) / delT.length;
      return { key: tm.key, short: tm.short, emoji: tm.emoji, x: cx + Math.cos(a) * rx * 0.42, y: cy + Math.sin(a) * ry * 0.5, col: C.team[tm.key] || C.muted, inner: true };
    }));
    var busyAll = S.agents.filter(function (a) { return a.status === 'working'; }).length;

    var outer = hubs.filter(function (hb) { return !hb.inner; });
    outer.forEach(function (hb, i) {
      var nx = outer[(i + 1) % outer.length];
      g.save(); g.strokeStyle = busyAll ? C.work : C.line; g.globalAlpha = 0.8; g.setLineDash([4, 5]); g.lineDashOffset = -s * 12;
      g.beginPath(); g.moveTo(hb.x, hb.y); g.lineTo(nx.x, nx.y); g.stroke(); g.restore();
      if (busyAll && !still) packet(g, hb.x, hb.y, nx.x, nx.y, (s * 0.35 + i * 0.25) % 1, C.work, 3);
    });
    hubs.forEach(function (hb) { g.save(); g.strokeStyle = hb.col; g.globalAlpha = 0.35; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(hb.x, hb.y); g.stroke(); g.restore(); });

    Net.nodes = [];
    var agentR = Math.min(narrow ? 46 : 80, h * 0.2);
    hubs.forEach(function (hb) {
      var members = S.agents.filter(function (a) { return a.team === hb.key; });
      var base = Math.atan2(hb.y - cy, hb.x - cx);
      var spread = members.length > 1 ? Math.min(2.4, (narrow ? 0.42 : 0.48) * members.length) : 0;
      var R = hb.inner ? agentR * 0.55 : agentR;
      members.forEach(function (a, j) {
        var ang = base + (members.length > 1 ? -spread / 2 + spread * j / (members.length - 1) : 0);
        var x = Math.max(30, Math.min(w - 30, hb.x + Math.cos(ang) * R));
        var y = Math.max(26, Math.min(h - 26, hb.y + Math.sin(ang) * R));
        var busy = a.status === 'working';
        var paused = a.active === false;
        var focus = S.focus === a.id || Net.hover === a.id;
        g.save(); g.strokeStyle = busy ? C.work : hb.col; g.globalAlpha = paused ? 0.3 : busy ? 0.9 : 0.5; g.lineWidth = 1.2; if (paused) g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(hb.x, hb.y); g.lineTo(x, y); g.stroke(); g.restore();
        if (busy && !still) {
          var p = (s * 0.7 + j * 0.37) % 1;
          packet(g, x, y, hb.x, hb.y, p, C.work);
          packet(g, hb.x, hb.y, cx, cy, (p + 0.5) % 1, C.work, 2);
        }
        var r = busy ? 10 + (still ? 0 : Math.sin(s * 4) * 1.2) : 8;
        g.save(); circle(g, x, y, r);
        g.fillStyle = busy ? C.work : hb.col; g.globalAlpha = paused ? 0.15 : busy ? 1 : 0.28; if (busy) { g.shadowColor = C.work; g.shadowBlur = 16; }
        g.fill();
        g.globalAlpha = paused ? 0.45 : 1; g.shadowBlur = 0; g.strokeStyle = busy ? C.work : hb.col; g.lineWidth = 2; g.stroke(); g.restore();
        if (focus) { g.save(); g.strokeStyle = C.accent; g.lineWidth = 2; circle(g, x, y, r + 6); g.stroke(); g.restore(); }
        if (!narrow || busy || focus) {
          g.save(); g.font = '600 ' + (narrow ? 10 : 11) + 'px system-ui, sans-serif'; g.textAlign = 'center';
          g.fillStyle = paused ? C.muted : busy || focus ? C.ink : C.muted;
          g.fillText(txt(a.name), x, y + (y >= hb.y ? r + 14 : -r - 7)); g.restore();
        }
        Net.nodes.push({ id: a.id, x: x, y: y });
      });
      // Hub: a round badge with the team emoji.
      var load = members.filter(function (a) { return a.status === 'working'; }).length;
      var HR = narrow ? 16 : 19;
      g.save(); circle(g, hb.x, hb.y, HR); g.fillStyle = C.surface; g.fill(); g.lineWidth = 2; g.strokeStyle = hb.col; g.shadowColor = hb.col; g.shadowBlur = load ? 16 : 4; g.stroke(); g.restore();
      g.save(); g.font = (narrow ? 14 : 16) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(hb.emoji, hb.x, hb.y + 1); g.restore();
      if (!narrow || hb.inner) {
        var inward = hb.inner ? 0 : hb.x > cx + 4 ? -1 : hb.x < cx - 4 ? 1 : 0;
        var label = hb.short + ' · ' + members.length;
        g.save(); g.font = '700 ' + (narrow ? 10.5 : 12) + 'px system-ui, sans-serif';
        g.textAlign = inward > 0 ? 'left' : inward < 0 ? 'right' : 'center'; g.textBaseline = 'middle';
        var lw = g.measureText(label).width;
        var lx = hb.x + inward * (HR + 8);
        var ly = inward ? hb.y : hb.y + (hb.y <= cy ? HR + 12 : -HR - 12) * (hb.inner ? -1 : 1);
        var left = inward > 0 ? lx - 5 : inward < 0 ? lx - lw - 5 : lx - lw / 2 - 5;
        g.fillStyle = C.surface; g.beginPath();
        if (g.roundRect) g.roundRect(left, ly - 10, lw + 10, 20, 10); else g.rect(left, ly - 10, lw + 10, 20);
        g.fill(); g.fillStyle = C.ink; g.fillText(label, lx, ly + 0.5); g.restore();
      }
    });

    // Core: a disc that breathes slowly while agents work.
    var R0 = 30 + (still ? 0 : Math.sin(s * 1.6) * (busyAll ? 2 : 1));
    g.save(); g.globalAlpha = 0.35; circle(g, cx, cy, R0 + 8); g.strokeStyle = C.core; g.lineWidth = 1; g.stroke(); g.restore();
    g.save(); circle(g, cx, cy, R0); g.fillStyle = C.core; g.shadowColor = C.core; g.shadowBlur = busyAll ? 26 : 12; g.fill(); g.restore();
    g.save(); g.fillStyle = C.coreInk; g.font = '800 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PANDORA', cx, cy); g.restore();
  }

  function drawOnce() { if (Net.canvas) drawNet(performance.now()); }
  function netLoop(t) {
    if (!Net.canvas || !Net.canvas.isConnected || calm.matches || document.hidden) { Net.looping = false; return; }
    drawNet(t);
    window.requestAnimationFrame(netLoop);
  }
  function animate() {
    drawOnce();
    if (!Net.looping && !calm.matches && !document.hidden) { Net.looping = true; window.requestAnimationFrame(netLoop); }
  }

  function showTip(id) {
    var n = null;
    Net.nodes.forEach(function (x) { if (x.id === id) n = x; });
    var a = id && S.byId[id];
    Net.hover = n && a ? id : null;
    if (!Net.hover) { Net.tip.hidden = true; drawOnce(); return; }
    var t = teamOf(a.team);
    var working = a.status === 'working';
    clear(Net.tip);
    append(Net.tip, [
      el('b', {}, t.emoji + ' ' + a.name + ' ' + (working ? '🔥' : a.active === false ? '😴' : '😊')),
      el('div', { class: 'dim' }, txt(a.role) + ' · ' + t.name),
      working ? el('div', {}, 'Au travail : ' + clip(a.current_task, 80)) : el('div', {}, a.active === false ? 'En pause' : 'Disponible'),
      el('div', { class: 'dim' }, 'Clic ou Entrée pour ouvrir sa fiche'),
    ]);
    Net.tip.hidden = false;
    var W = Net.canvas.clientWidth;
    var tw = Net.tip.offsetWidth;
    var th = Net.tip.offsetHeight;
    var x = n.x + 16;
    if (x + tw > W - 8) x = n.x - tw - 16;
    Net.tip.style.left = Math.max(8, x) + 'px';
    Net.tip.style.top = Math.max(8, Math.min(Net.canvas.clientHeight - th - 8, n.y - th / 2)) + 'px';
    drawOnce();
  }

  function setupNet() {
    Net.canvas = $('[data-net]');
    Net.tip = $('[data-net-tip]');
    if (!Net.canvas) return;
    var c = Net.canvas;
    var pick = function (e) {
      var r = c.getBoundingClientRect();
      var x = e.clientX - r.left;
      var y = e.clientY - r.top;
      var hit = null;
      Net.nodes.forEach(function (n) { if (Math.sqrt((n.x - x) * (n.x - x) + (n.y - y) * (n.y - y)) < 18) hit = n; });
      return hit;
    };
    c.addEventListener('click', function (e) { var hit = pick(e); if (hit) focusAgent(S.focus === hit.id ? null : hit.id); });
    c.addEventListener('mousemove', function (e) {
      var hit = pick(e);
      c.classList.toggle('is-pointing', Boolean(hit));
      if ((hit ? hit.id : null) !== Net.hover) showTip(hit ? hit.id : null);
    });
    c.addEventListener('mouseleave', function () { showTip(null); });
    c.addEventListener('blur', function () { showTip(null); });
    c.addEventListener('keydown', function (e) {
      if (!Net.nodes.length) return;
      var i = -1;
      Net.nodes.forEach(function (n, k) { if (n.id === Net.hover) i = k; });
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].indexOf(e.key) >= 0) {
        e.preventDefault();
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        showTip(Net.nodes[(i + d + Net.nodes.length) % Net.nodes.length].id);
      } else if ((e.key === 'Enter' || e.key === ' ') && Net.hover) {
        e.preventDefault();
        focusAgent(Net.hover);
      } else if (e.key === 'Escape') showTip(null);
    });
    if (window.ResizeObserver) new ResizeObserver(function () { drawOnce(); }).observe(c);
    else window.addEventListener('resize', drawOnce);
    // Theme switch (system or the ☀️/🌙 button): read the colours again.
    var recolor = function () { Net.C = null; drawOnce(); };
    if (window.matchMedia) {
      var dark = window.matchMedia('(prefers-color-scheme: dark)');
      if (dark.addEventListener) dark.addEventListener('change', recolor);
    }
    new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (calm.addEventListener) calm.addEventListener('change', animate);
    document.addEventListener('visibilitychange', animate);
  }

  function updateNetLabel() {
    if (!Net.canvas) return;
    var active = S.agents.filter(function (a) { return a.active !== false; }).length;
    var busy = S.agents.filter(function (a) { return a.status === 'working'; }).length;
    Net.canvas.setAttribute('aria-label', 'Carte des ' + S.teams.length + ' salles : ' + busy + ' agent(s) au travail sur ' + active
      + '. Flèches pour parcourir les agents, Entrée pour en ouvrir un. La liste des salles plus bas donne les mêmes informations.');
  }

  // ------------------------------------------------------------ console: KPIs, feed, orders

  function renderSummary(s) {
    var set = function (k, v) { var n = $('[data-kpi="' + k + '"]'); if (n) n.textContent = v; };
    set('working', s.working + ' / ' + s.agents);
    set('running', String(s.running));
    set('queued', String(s.queued));
    set('consensus', String(s.consensus));
  }

  function feedItem(r) {
    var a = r.agent_id && S.byId[r.agent_id];
    var t = a ? teamOf(a.team) : null;
    return el('li', { class: t ? 'ag-t-' + t.key : '' },
      el('time', { datetime: txt(r.created_at) }, clock(r.created_at)),
      el('span', { class: 'ag-feed-emo', 'aria-hidden': 'true' }, FEED_EMOJI[r.kind] || '•'),
      el('span', {}, a ? el('b', {}, (t ? t.emoji + ' ' : '') + a.name + ' ') : null, txt(r.message || r.kind)));
  }

  function renderFeed() {
    var list = $('[data-feed]');
    if (!list) return;
    clear(list);
    var items = S.feed.slice(-50).reverse();
    if (!items.length) list.appendChild(el('li', { class: 'empty' }, 'Rien encore : donne un ordre, chaque action des agents apparaît ici.'));
    items.forEach(function (r) { list.appendChild(feedItem(r)); });
    var c = $('[data-feed-count]');
    if (c) c.textContent = plural(items.length, 'évènement');
  }

  function orderCard(j) {
    var p = j.payload || {};
    var d = details[j.id];
    var body = el('div', { class: 'ag-card-body' },
      el('div', { class: 'item-meta' }, entrepriseName(j.entreprise_id) + ' · ' + when(j.created_at) + (Number(j.cost_usd) ? ' · ' + usd(j.cost_usd) : '')),
      el('p', { class: 'ag-instr' }, txt(p.instruction)),
      d && d.result && d.result.texte ? out(d.result.texte)
        : j.status === 'running' ? el('p', { class: 'ag-liveline' }, '🤔 ' + agentName(p.agent_id) + ' écrit…')
          : j.status === 'queued' ? el('p', { class: 'dim' }, '⏳ En file.') : j.status === 'done' ? el('p', { class: 'dim' }, 'Ouvre pour lire le résultat.') : null,
      j.error ? el('p', { class: 'status is-error' }, txt(j.error)) : null,
      cancelButton(j, refreshConsole),
      el('a', { href: '/admin/console?vue=travail&job=' + encodeURIComponent(j.id) }, 'Voir le détail →'));
    var card = el('details', { class: 'ag-card', 'data-k': 'o-' + j.id, open: j.status === 'running' ? true : null },
      el('summary', {}, pill(j.status), ' ', el('b', {}, agentName(p.agent_id)), ' : ' + clip(p.instruction, 90)), body);
    card.addEventListener('toggle', function () {
      if (card.open && !details[j.id]) jobDetail(j.id, true).then(renderOrders).catch(function () {});
    });
    return card;
  }

  var lastOrders = [];
  function renderOrders() {
    var box = $('[data-orders]');
    if (!box) return;
    var keys = openKeys(box);
    clear(box);
    if (!lastOrders.length) box.appendChild(el('p', { class: 'empty' }, 'Aucun ordre pour l’instant : choisis un agent et dis-lui quoi faire.'));
    lastOrders.forEach(function (j) { box.appendChild(orderCard(j)); });
    restoreOpen(box, keys);
  }
  function refreshOrders() {
    return api('/jobs?kind=order&limit=12').then(function (jobs) {
      lastOrders = jobs;
      var live = jobs.filter(function (j) { return j.status === 'running' || (details[j.id] && details[j.id].status !== j.status); });
      return Promise.all(live.map(function (j) { return jobDetail(j.id, true).catch(function () {}); })).then(renderOrders);
    }).catch(function () {});
  }

  function refreshConsole() {
    return Promise.all([
      loadAgents().then(function () { renderRooms(); renderAgentPanel(); updateNetLabel(); drawOnce(); }),
      api('/summary').then(renderSummary),
      refreshOrders(),
      engineBanner(),
    ]).catch(function () {});
  }

  function engineBanner() {
    var n = $('[data-engine-state]');
    if (!n) return Promise.resolve();
    return api('/settings').then(function (s) {
      var why = [];
      if (!s.enabled) why.push('le moteur est arrêté dans les réglages');
      if (!s.env_enabled) why.push('AGENTS_ENABLED n’est pas « true » sur le serveur');
      if (!s.api_key_configured) why.push('la clé ANTHROPIC_API_KEY manque');
      n.hidden = !why.length;
      clear(n);
      if (why.length) append(n, ['⏸️ Les ordres attendent en file : ' + why.join(', ') + '. ', el('a', { href: '/admin/console?vue=reglages-agents' }, 'Réglages →')]);
    }).catch(function () {});
  }

  function setupOrderForm() {
    var form = $('[data-ag-form="order"]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var st = form.querySelector('[data-status]');
      var who = form.elements.who.value;
      var instruction = form.elements.instruction.value.trim();
      var ent = form.elements.entreprise_id.value || null;
      if (!instruction) { say(st, 'Écris ou dicte d’abord ce que l’agent doit faire.', 'error'); form.elements.instruction.focus(); return; }
      var ids = who.indexOf('t:') === 0
        ? S.agents.filter(function (a) { return a.team === who.slice(2) && a.active !== false; }).map(function (a) { return a.id; })
        : [who.slice(2)];
      if (!ids.length || !ids[0]) { say(st, 'Aucun agent disponible pour cet ordre.', 'error'); return; }
      var button = form.querySelector('[type="submit"]');
      button.disabled = true;
      say(st, 'Envoi…');
      var sent = 0;
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return api('/jobs/order', { method: 'POST', body: { agent_id: id, instruction: instruction, entreprise_id: ent } }).then(function () { sent += 1; });
        });
      });
      chain.then(function () {
        say(st, sent > 1 ? 'Ordre envoyé à ' + sent + ' agents.' : 'Ordre envoyé à ' + agentName(ids[0]) + '.', 'ok');
        form.elements.instruction.value = '';
      }).catch(function (err) {
        say(st, (sent ? sent + ' ordre(s) envoyé(s), puis : ' : '') + err.message, 'error');
      }).then(function () { button.disabled = false; refreshConsole(); });
    });
  }

  function initConsole() {
    setupNet();
    setupOrderForm();
    var later = debounce(refreshConsole, 700);
    onLive(function (rows) {
      S.feed = S.feed.concat(rows).slice(-100);
      renderFeed();
      later();
    });
    loadAgents().then(function () {
      renderRooms();
      updateNetLabel();
      animate();
      startLive();
    }).catch(function (e) {
      var prod = $('[data-rooms="prod"]');
      if (prod) clear(prod).appendChild(el('p', { class: 'status is-error' }, e.message));
      startLive();
    });
    refreshConsole();
    setInterval(refreshConsole, 15000);
  }

  // ------------------------------------------------------------ Conseil

  // The cast follows the artifact: one proposer per chosen team (two when
  // fewer than 4 teams), at most 6; the deliberation rooms fill the roles.
  function councilCast(teams) {
    var pool = function (team) { return S.agents.filter(function (a) { return a.team === team && a.active !== false; }); };
    var prod = teams.length ? teams : S.teams.filter(function (t) { return !t.delib; }).map(function (t) { return t.key; });
    var per = prod.length >= 4 ? 1 : 2;
    var proposeurs = [];
    prod.forEach(function (k) { pool(k).slice(0, per).forEach(function (a) { proposeurs.push(a.id); }); });
    var revue = pool('revue');
    var find = function (list, re) { for (var i = 0; i < list.length; i += 1) if (re.test(txt(list[i].role))) return list[i]; return null; };
    var arbitre = find(revue, /consensus|arbitr|facilit/i) || revue[0];
    var reviseur = find(revue, /qualit|conform/i) || revue[revue.length - 1];
    var planif = pool('planif')[0];
    return {
      proposeurs: proposeurs.slice(0, 6),
      contradicteurs: pool('contra').slice(0, 3).map(function (a) { return a.id; }),
      planificateur: planif ? planif.id : null,
      arbitre: arbitre ? arbitre.id : null,
      reviseur: reviseur ? reviseur.id : null,
    };
  }

  function debateCard(j) {
    var p = j.payload || {};
    var d = details[j.id] || j;
    return el('details', { class: 'ag-card', 'data-k': 'd-' + j.id, open: j.status === 'running' ? true : null },
      el('summary', {}, pill(d.status), ' ', clip(p.sujet, 110)),
      el('div', { class: 'ag-card-body' },
        el('div', { class: 'item-meta' }, entrepriseName(j.entreprise_id) + ' · ' + when(j.created_at) + (Number(d.cost_usd) ? ' · ' + usd(d.cost_usd) : '')),
        debateBody(d),
        cancelButton(d, refreshDebates)));
  }

  var lastDebates = [];
  function renderDebates() {
    var box = $('[data-debates]');
    if (!box) return;
    var keys = openKeys(box);
    clear(box);
    if (!lastDebates.length) box.appendChild(el('p', { class: 'empty' }, 'Aucune délibération encore : soumets un sujet, tu verras chaque proposition, objection et vote.'));
    lastDebates.forEach(function (j) { box.appendChild(debateCard(j)); });
    restoreOpen(box, keys);
  }
  function refreshDebates() {
    return api('/jobs?kind=debate&limit=8').then(function (jobs) {
      lastDebates = jobs;
      return Promise.all(jobs.map(function (j) {
        var live = j.status === 'running' || j.status === 'queued' || !details[j.id] || details[j.id].status !== j.status;
        return jobDetail(j.id, live).catch(function () {});
      }));
    }).then(renderDebates).catch(function () {});
  }

  function initConseil() {
    var form = $('[data-ag-form="council"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var st = form.querySelector('[data-status]');
      var sujet = form.elements.sujet.value.trim();
      if (!sujet) { say(st, 'Écris ou dicte d’abord le sujet du Conseil.', 'error'); form.elements.sujet.focus(); return; }
      var teams = $$('input[name="equipes"]:checked', form).map(function (i) { return i.value; });
      var cast = councilCast(teams);
      if (!cast.proposeurs.length) { say(st, 'Aucun agent disponible dans ces équipes.', 'error'); return; }
      var body = { sujet: sujet, entreprise_id: form.elements.entreprise_id.value || null, contexte: form.elements.contexte.value.trim() || null };
      Object.keys(cast).forEach(function (k) { body[k] = cast[k]; });
      var b = form.querySelector('[type="submit"]');
      b.disabled = true;
      say(st, 'Ouverture du Conseil…');
      api('/jobs/council', { method: 'POST', body: body }).then(function () {
        say(st, 'Conseil ouvert avec ' + plural(cast.proposeurs.length, 'proposeur') + ' : suis-le ci-dessous.', 'ok');
        form.elements.sujet.value = '';
        refreshDebates();
      }).catch(function (err) { say(st, err.message, 'error'); }).then(function () { b.disabled = false; });
    });
    var later = debounce(refreshDebates, 500);
    onLive(function () { later(); });
    loadAgents().then(refreshDebates).catch(refreshDebates);
    startLive();
    setInterval(refreshDebates, 10000);
  }

  // ------------------------------------------------------------ Travail

  var selectedJob = null;
  function jobRow(j) {
    var open = function () { showJob(j.id); };
    return el('tr', { class: selectedJob === j.id ? 'is-selected' : '' },
      el('td', { class: 'num' }, when(j.created_at)),
      el('td', {}, kindLabel(j.kind)),
      el('td', {}, el('button', { class: 'ag-linkbtn', type: 'button', onclick: open },
        (j.payload && j.payload.agent_id ? agentName(j.payload.agent_id) + ' : ' : '') + clip(jobSubject(j), 90))),
      el('td', {}, pill(j.status)),
      el('td', { class: 'right num' }, usd(j.cost_usd)));
  }

  function filterQuery() {
    var f = $('[data-ag-form="filters"]');
    var qs = ['limit=100'];
    ['status', 'kind', 'agent_id', 'entreprise_id'].forEach(function (k) {
      var v = f.elements[k].value;
      if (v) qs.push(k + '=' + encodeURIComponent(v));
    });
    return '?' + qs.join('&');
  }

  function refreshJobs() {
    var tbody = $('[data-jobs]');
    return api('/jobs' + filterQuery()).then(function (jobs) {
      clear(tbody);
      if (!jobs.length) tbody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'empty' }, 'Aucun travail pour ces filtres.')));
      jobs.forEach(function (j) { tbody.appendChild(jobRow(j)); });
      if (selectedJob && jobs.some(function (j) { return j.id === selectedJob && (j.status === 'running' || j.status === 'queued' || (details[j.id] && details[j.id].status !== j.status)); })) showJob(selectedJob, true);
    }).catch(function (e) { clear(tbody).appendChild(el('tr', {}, el('td', { colspan: '5', class: 'status is-error' }, e.message))); });
  }

  function showJob(id, quiet) {
    selectedJob = id;
    var panel = $('[data-job-detail]');
    return jobDetail(id, true).then(function (j) {
      var keys = openKeys(panel);
      var p = j.payload || {};
      clear(panel);
      append(panel, [
        el('div', { class: 'panel-head' }, el('h2', {}, kindLabel(j.kind) + ' · ' + clip(jobSubject(j), 70)), pill(j.status)),
        el('dl', { class: 'ag-dl' },
          p.agent_id ? [el('dt', {}, 'Agent'), el('dd', {}, agentName(p.agent_id))] : null,
          [el('dt', {}, 'Client'), el('dd', {}, entrepriseName(j.entreprise_id))],
          [el('dt', {}, 'Créé'), el('dd', {}, when(j.created_at))],
          j.finished_at ? [el('dt', {}, 'Fini'), el('dd', {}, when(j.finished_at))] : null,
          [el('dt', {}, 'Coût'), el('dd', { class: 'num' }, usd(j.cost_usd) + ' · ' + (Number(j.tokens_in) || 0).toLocaleString('fr-CA') + ' jetons lus, ' + (Number(j.tokens_out) || 0).toLocaleString('fr-CA') + ' écrits')],
          [el('dt', {}, 'Tentatives'), el('dd', { class: 'num' }, (j.attempts || 0) + ' / ' + (j.max_attempts || 3))]),
        el('h3', {}, j.kind === 'debate' ? 'Sujet' : j.kind === 'research' ? 'Question' : 'Instruction'),
        el('p', { class: 'ag-instr' }, jobSubject(j)),
        j.kind === 'debate' ? debateBody(j) : j.kind === 'research' ? researchBody(j)
          : [j.result && j.result.texte ? [el('h3', {}, 'Résultat'), out(j.result.texte)] : el('p', { class: 'dim' }, j.status === 'done' ? 'Aucun texte.' : 'Pas encore de résultat.'),
            j.error ? el('p', { class: 'status is-error' }, txt(j.error)) : null],
        cancelButton(j, function () { refreshJobs(); showJob(id, true); }),
        arr(j.activity).length ? el('details', { class: 'ag-sub', 'data-k': 'act-' + j.id }, el('summary', {}, '📡 Journal de ce travail · ' + j.activity.length),
          el('ol', { class: 'ag-feed' }, j.activity.map(feedItem))) : null,
      ]);
      restoreOpen(panel, keys);
      panel.hidden = false;
      if (!quiet) panel.focus({ preventScroll: true });
      if (!quiet) panel.scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' });
      $$('[data-jobs] tr').forEach(function (tr) { tr.classList.remove('is-selected'); });
    }).catch(function (e) { panel.hidden = false; clear(panel).appendChild(el('p', { class: 'status is-error' }, e.message)); });
  }

  var TASK_STATUS = { a_valider: '👀 À valider', a_faire: '📝 À faire', fait: '✅ Fait', rejete: '✖️ Rejeté' };
  function refreshTasks() {
    var list = $('[data-tasks]');
    return api('/tasks?limit=100').then(function (tasks) {
      clear(list);
      if (!tasks.length) list.appendChild(el('li', { class: 'empty' }, 'Aucune tâche : le Conseil en crée à la fin de chaque délibération.'));
      tasks.forEach(function (t) {
        list.appendChild(el('li', { class: 'item' },
          el('div', { class: 'item-head' }, el('h3', {}, txt(t.title)), el('span', { class: 'badge' }, TASK_STATUS[t.status] || t.status)),
          t.detail ? el('p', {}, txt(t.detail)) : null,
          el('div', { class: 'item-meta' }, [t.owner ? 'Responsable : ' + t.owner : null, t.due ? 'Échéance : ' + t.due : null, when(t.created_at)].filter(Boolean).join(' · '),
            t.job_id ? [' · ', el('button', { class: 'ag-linkbtn', type: 'button', onclick: function () { showJob(t.job_id); } }, 'voir le Conseil')] : null)));
      });
    }).catch(function (e) { clear(list).appendChild(el('li', { class: 'status is-error' }, e.message)); });
  }

  function initTravail() {
    var f = $('[data-ag-form="filters"]');
    var params = new URLSearchParams(window.location.search);
    if (params.get('agent')) f.elements.agent_id.value = params.get('agent');
    f.addEventListener('change', refreshJobs);
    f.addEventListener('submit', function (e) { e.preventDefault(); refreshJobs(); });
    loadAgents().catch(function () {}).then(function () {
      refreshJobs();
      refreshTasks();
      var job = params.get('job');
      if (job && /^[0-9a-f-]{36}$/i.test(job)) showJob(job);
    });
    var later = debounce(function () { refreshJobs(); refreshTasks(); }, 800);
    onLive(function () { later(); });
    startLive();
  }

  // ------------------------------------------------------------ Recherche

  var currentResearch = null;
  var researchTimer = null;
  function showResearch(id) {
    currentResearch = id;
    clearTimeout(researchTimer);
    var box = $('[data-research-current]');
    return jobDetail(id, true).then(function (j) {
      if (currentResearch !== id) return;
      clear(box);
      append(box, [
        el('div', { class: 'panel-head' }, el('h2', {}, '🔎 ' + clip(j.payload && j.payload.question, 120)), pill(j.status)),
        researchBody(j),
        cancelButton(j, function () { showResearch(id); refreshHistory(); }),
      ]);
      box.hidden = false;
      if (j.status === 'queued' || j.status === 'running') researchTimer = setTimeout(function () { showResearch(id); }, 3000);
    }).catch(function (e) { box.hidden = false; clear(box).appendChild(el('p', { class: 'status is-error' }, e.message)); });
  }

  function refreshHistory() {
    var list = $('[data-research-history]');
    return api('/jobs?kind=research&limit=30').then(function (jobs) {
      clear(list);
      if (!jobs.length) list.appendChild(el('li', { class: 'empty' }, 'Aucune recherche encore.'));
      jobs.forEach(function (j) {
        var p = j.payload || {};
        list.appendChild(el('li', { class: 'item' + (currentResearch === j.id ? ' is-selected' : '') },
          el('div', { class: 'item-head' },
            el('button', { class: 'ag-linkbtn', type: 'button', onclick: function () { showResearch(j.id); $('[data-research-current]').scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' }); } }, clip(p.question, 140)),
            pill(j.status)),
          el('div', { class: 'item-meta' }, agentName(p.agent_id) + ' · ' + when(j.created_at) + (Number(j.cost_usd) ? ' · ' + usd(j.cost_usd) : ''))));
      });
      if (!currentResearch && jobs.length) showResearch(jobs[0].id);
    }).catch(function (e) { clear(list).appendChild(el('li', { class: 'status is-error' }, e.message)); });
  }

  function initRecherche() {
    var form = $('[data-ag-form="research"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var st = form.querySelector('[data-status]');
      var question = form.elements.question.value.trim();
      if (!question) { say(st, 'Écris ou dicte d’abord ta question.', 'error'); form.elements.question.focus(); return; }
      var b = form.querySelector('[type="submit"]');
      b.disabled = true;
      say(st, 'Envoi…');
      api('/jobs/research', {
        method: 'POST',
        body: { question: question, agent_id: form.elements.agent_id.value || null, entreprise_id: form.elements.entreprise_id.value || null, max_uses: parseInt(form.elements.max_uses.value, 10) || 5 },
      }).then(function (job) {
        say(st, 'Recherche lancée : ' + agentName(form.elements.agent_id.value) + ' s’y met.', 'ok');
        form.elements.question.value = '';
        showResearch(job.id);
        refreshHistory();
      }).catch(function (err) { say(st, err.message, 'error'); }).then(function () { b.disabled = false; });
    });
    var later = debounce(refreshHistory, 800);
    onLive(function () { later(); });
    loadAgents().catch(function () {}).then(refreshHistory);
    startLive();
  }

  // ------------------------------------------------------------ Réglages agents

  function renderEngine(s) {
    var on = s.enabled && s.env_enabled && s.api_key_configured;
    var badge = $('[data-engine-badge]');
    badge.textContent = on ? '▶️ En marche' : '⏸️ À l’arrêt';
    badge.className = 'badge ' + (on ? 'badge--approuve' : 'badge--annule');
    $('[data-engine-text]').textContent = on
      ? 'Le moteur traite les ordres, les recherches et les Conseils en file.'
      : 'Le moteur ne traite rien : les travaux restent en file jusqu’à la remise en marche.';
    var checks = clear($('[data-engine-checks]'));
    [[s.enabled, 'Interrupteur des réglages (ci-dessous)'], [s.env_enabled, 'AGENTS_ENABLED=true sur le serveur'], [s.api_key_configured, 'Clé ANTHROPIC_API_KEY présente']].forEach(function (c) {
      checks.appendChild(el('li', { class: c[0] ? 'is-ok' : 'is-ko' }, (c[0] ? '✅ ' : '❌ ') + c[1]));
    });
    $('[data-action="emergency-stop"]').hidden = !s.enabled;
    $('[data-action="start"]').hidden = Boolean(s.enabled);
    var f = $('[data-ag-form="budget"]');
    if (document.activeElement !== f.elements.monthly_budget_usd) f.elements.monthly_budget_usd.value = Number(s.monthly_budget_usd);
    var m = $('[data-ag-form="models"]');
    ['model_quick', 'model_default', 'model_complex'].forEach(function (k) { if (document.activeElement !== m.elements[k]) m.elements[k].value = s[k] || ''; });
    if (document.activeElement !== m.elements.concurrency) m.elements.concurrency.value = s.concurrency || 2;
  }

  function renderUsage(u) {
    var pct = u.budget_usd > 0 ? Math.min(100, Math.round((u.spent_usd / u.budget_usd) * 100)) : 100;
    var meter = $('[data-usage-meter]');
    meter.style.setProperty('--pct', pct + '%');
    meter.setAttribute('aria-valuenow', String(pct));
    meter.classList.toggle('is-high', pct >= 80);
    $('[data-usage-text]').textContent = usd(u.spent_usd) + ' dépensés sur ' + usd(u.budget_usd) + ' (' + pct + ' %) · reste ' + usd(u.remaining_usd)
      + ' · ' + plural(u.totals.calls || 0, 'appel');
    $('[data-usage-month]').textContent = 'mois du ' + u.month;
    var by = {};
    arr(u.rows).forEach(function (r) {
      var k = r.model;
      by[k] = by[k] || { cost: 0, calls: 0 };
      by[k].cost += Number(r.cost_usd) || 0;
      by[k].calls += Number(r.calls) || 0;
    });
    var list = clear($('[data-usage-rows]'));
    Object.keys(by).sort(function (a, b) { return by[b].cost - by[a].cost; }).forEach(function (k) {
      list.appendChild(el('li', { class: 'item' }, el('div', { class: 'item-head' },
        el('span', { class: 'mono' }, k === 'web_search' ? '🔎 recherches web (à vérifier : 10 $ / 1000)' : k), el('span', { class: 'num' }, usd(by[k].cost))),
        el('div', { class: 'item-meta' }, plural(by[k].calls, 'appel'))));
    });
    if (!Object.keys(by).length) list.appendChild(el('li', { class: 'empty' }, 'Aucune dépense ce mois-ci.'));
  }

  function refreshSettings() {
    return Promise.all([api('/settings').then(renderEngine), api('/usage').then(renderUsage)]).catch(function (e) {
      say($('[data-status="engine"]'), e.message, 'error');
    });
  }

  function initReglages() {
    var st = $('[data-status="engine"]');
    $('[data-action="emergency-stop"]').addEventListener('click', function (e) {
      if (!window.confirm('Arrêt d’urgence : couper le moteur et annuler tous les travaux en file ou en cours ?')) return;
      e.currentTarget.disabled = true;
      var b = e.currentTarget;
      api('/emergency-stop', { method: 'POST', body: {} }).then(function (r) {
        say(st, '🛑 Moteur arrêté. ' + plural(r.cancelled, 'travail annulé', 'travaux annulés') + '.', 'ok');
      }).catch(function (err) { say(st, err.message, 'error'); }).then(function () { b.disabled = false; refreshSettings(); });
    });
    $('[data-action="start"]').addEventListener('click', function (e) {
      var b = e.currentTarget;
      b.disabled = true;
      api('/settings', { method: 'PUT', body: { enabled: true } }).then(function () { say(st, '▶️ Moteur remis en marche.', 'ok'); })
        .catch(function (err) { say(st, err.message, 'error'); }).then(function () { b.disabled = false; refreshSettings(); });
    });

    var budget = $('[data-ag-form="budget"]');
    budget.addEventListener('submit', function (e) {
      e.preventDefault();
      var s2 = budget.querySelector('[data-status]');
      api('/settings', { method: 'PUT', body: { monthly_budget_usd: Number(budget.elements.monthly_budget_usd.value) } })
        .then(function () { say(s2, 'Budget enregistré.', 'ok'); refreshSettings(); }).catch(function (err) { say(s2, err.message, 'error'); });
    });
    var models = $('[data-ag-form="models"]');
    models.addEventListener('submit', function (e) {
      e.preventDefault();
      var s3 = models.querySelector('[data-status]');
      var body = {};
      ['model_quick', 'model_default', 'model_complex'].forEach(function (k) { body[k] = models.elements[k].value.trim() || null; });
      var c = parseInt(models.elements.concurrency.value, 10);
      if (c) body.concurrency = c;
      api('/settings', { method: 'PUT', body: body }).then(function () { say(s3, 'Modèles enregistrés.', 'ok'); refreshSettings(); })
        .catch(function (err) { say(s3, err.message, 'error'); });
    });

    var seedStatus = $('[data-status="seed"]');
    $('[data-action="seed"]').addEventListener('click', function (e) {
      var b = e.currentTarget;
      b.disabled = true;
      say(seedStatus, 'Import…');
      api('/seed', { method: 'POST', body: {} }).then(function (r) {
        say(seedStatus, '🌱 ' + plural(r.inserted, 'agent ajouté', 'agents ajoutés') + ', ' + r.skipped + ' déjà présent(s).', 'ok');
      }).catch(function (err) { say(seedStatus, err.message, 'error'); }).then(function () { b.disabled = false; });
    });

    var imp = $('[data-ag-form="import"]');
    imp.addEventListener('submit', function (e) {
      e.preventDefault();
      var s4 = imp.querySelector('[data-status]');
      var file = imp.elements.file.files && imp.elements.file.files[0];
      if (!file) { say(s4, 'Choisis d’abord un fichier JSON.', 'error'); return; }
      if (file.size > 1024 * 1024) { say(s4, 'Fichier trop gros (1 Mo au plus).', 'error'); return; }
      file.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (err) { throw new Error('Ce fichier n’est pas du JSON valide.'); }
        return api('/import', { method: 'POST', body: Array.isArray(data) ? { agents: data } : data });
      }).then(function (r) { say(s4, plural(r.imported, 'agent importé', 'agents importés') + '.', 'ok'); imp.reset(); })
        .catch(function (err) { say(s4, err.message, 'error'); });
    });

    refreshSettings();
    setInterval(refreshSettings, 20000);
  }

  // ------------------------------------------------------------ start

  var INIT = { agents: initConsole, conseil: initConseil, travail: initTravail, recherche: initRecherche, 'reglages-agents': initReglages };
  if (INIT[VUE]) INIT[VUE]();
})();
