// Voice dictation for the large text fields of /espace and /admin/console.
//
// Any <input> or <textarea> with data-dictee gets a "Dicter" button. It uses
// the Web Speech API (fr-CA, interim results): what is said is added after
// the text already there, never replacing it. When the API is missing or the
// microphone is refused, the button explains how to use the keyboard's own
// dictation instead. Static file, no inline script (CSP).
(function () {
  'use strict';

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var HELP = 'Dictée intégrée indisponible ici. Utilisez la dictée du clavier : '
    + 'touche 🎤 du clavier sur téléphone, touche Fn deux fois sur Mac, Windows + H sur Windows.';
  var DENIED = 'Micro refusé. Autorisez le micro pour ce site (icône à gauche de l’adresse), '
    + 'ou utilisez la dictée du clavier : touche 🎤 sur téléphone, Fn deux fois sur Mac, Windows + H sur Windows.';
  var active = null; // { rec, stop } of the field being dictated

  function join(base, added) {
    var text = added.replace(/\s+/g, ' ').trim();
    if (!text) return base;
    var sep = base && !/\s$/.test(base) ? ' ' : '';
    return base + sep + text;
  }

  function setup(field) {
    var bar = document.createElement('div');
    bar.className = 'dictee';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost btn--sm dictee-btn';
    button.setAttribute('aria-pressed', 'false');
    if (field.id) button.setAttribute('aria-controls', field.id);
    var label = document.createElement('span');
    label.textContent = 'Dicter';
    button.appendChild(label);
    var note = document.createElement('p');
    note.className = 'dictee-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    bar.appendChild(button);
    bar.appendChild(note);
    field.insertAdjacentElement('afterend', bar);

    function setListening(on) {
      button.classList.toggle('is-listening', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      label.textContent = on ? 'Écoute… toucher pour arrêter' : 'Dicter';
      field.classList.toggle('is-listening', on);
    }

    function help(message) {
      note.textContent = message;
      note.classList.add('is-help');
    }

    button.addEventListener('click', function () {
      if (active && active.field === field) { active.stop(); return; }
      if (active) active.stop();
      if (!Recognition) { help(HELP); return; }

      var rec;
      try {
        rec = new Recognition();
      } catch (e) {
        help(HELP);
        return;
      }
      rec.lang = 'fr-CA';
      rec.interimResults = true;
      rec.continuous = true;

      var base = field.value;
      var finals = '';
      var max = field.maxLength > 0 ? field.maxLength : Infinity;
      var write = function (text) {
        field.value = text.slice(0, max);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };

      rec.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i += 1) {
          var result = event.results[i];
          if (result.isFinal) finals += ' ' + result[0].transcript;
          else interim += ' ' + result[0].transcript;
        }
        write(join(base, finals + ' ' + interim));
      };
      rec.onerror = function (event) {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') help(DENIED);
        else if (event.error === 'no-speech') note.textContent = 'Rien entendu. Réessayez.';
        else if (event.error !== 'aborted') help(HELP);
      };
      rec.onend = function () {
        write(join(base, finals));
        setListening(false);
        if (active && active.rec === rec) active = null;
      };

      active = { field: field, rec: rec, stop: function () { rec.stop(); } };
      note.textContent = 'Parlez : le texte s’ajoute à la suite.';
      note.classList.remove('is-help');
      setListening(true);
      try {
        rec.start();
      } catch (e) {
        setListening(false);
        active = null;
        help(HELP);
      }
    });

    // Typing by hand ends the dictation so it never overwrites the keyboard.
    field.addEventListener('keydown', function () {
      if (active && active.field === field) active.stop();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[data-dictee], textarea[data-dictee]').forEach(setup);
  });
})();
