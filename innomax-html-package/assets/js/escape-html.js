// Escape text before it is interpolated into an innerHTML template.
// Use for every value that comes from the API, the URL or user input:
//   el.innerHTML = `<h3>${escapeHtml(course.nom)}</h3>`;
// For URLs placed in href/src, use safeUrl() so javascript: links are dropped.
(function () {
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }
  function safeUrl(value) {
    var url = String(value === null || value === undefined ? '' : value).trim();
    if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|assets\/)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return escapeHtml(url);
    }
    return '#';
  }
  window.escapeHtml = escapeHtml;
  window.safeUrl = safeUrl;
})();
