// « Tout est en mouvement » : petits reflets pour /espace et /admin/console.
// Le logo (boîte de Pandora) s'entrouvre au chargement grâce au CSS seul ;
// ce script relance l'ouverture à chaque survol ou focus du lien de marque,
// en alternant deux classes qui pointent vers deux copies des mêmes images
// clés (changer de nom d'animation la redémarre, sans style en ligne).
// Avec prefers-reduced-motion, le CSS coupe tout et ce script ne fait rien.
(function () {
  'use strict';
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) return;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.brand').forEach(function (brand) {
      var mark = brand.querySelector('[data-pandora-mark]');
      if (!mark) return;
      var flip = false;
      function replay() {
        flip = !flip;
        mark.classList.toggle('is-replay-a', flip);
        mark.classList.toggle('is-replay-b', !flip);
      }
      brand.addEventListener('mouseenter', replay);
      brand.addEventListener('focus', replay);
    });
  });
})();
