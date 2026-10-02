// URL of this server's own API for a page that renders API data. A path
// parameter from the visitor is encoded as ONE segment: "../../admin/x" must
// not walk to another internal route.
function selfApiUrl(base, prefix, param) {
  return `${base}${prefix}${encodeURIComponent(String(param))}`;
}

module.exports = { selfApiUrl };
