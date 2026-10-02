// Web Push sans dépendance (PWA.md), avec le module crypto de Node :
//   - VAPID (RFC 8292) : un JWT ES256 signé avec VAPID_PRIVATE_KEY ;
//   - chiffrement du message (RFC 8291, encodage aes128gcm de la RFC 8188).
// La librairie web-push n'est pas dans node_modules ; ce module en fait le
// minimum, vérifié par les tests (vecteur de l'annexe A de la RFC 8291 et
// aller-retour de déchiffrement).
//
// Sans VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT valides, config()
// rend null et rien n'est jamais envoyé.
//
// Le serveur n'envoie qu'aux services de push connus des navigateurs
// (SERVICES_PERMIS) : une adresse d'abonnement est fournie par le navigateur,
// on ne la laisse pas viser n'importe quel serveur.

const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const deB64u = (s) => Buffer.from(String(s || ''), 'base64url');

const SERVICES_PERMIS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

function endpointPermis(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return SERVICES_PERMIS.some((re) => re.test(u.hostname));
}

// Clés VAPID de l'environnement, ou null si l'une manque ou est invalide.
function config(env = process.env) {
  const publique = deB64u(env.VAPID_PUBLIC_KEY);
  const privee = deB64u(env.VAPID_PRIVATE_KEY);
  const sujet = String(env.VAPID_SUBJECT || '').trim();
  if (publique.length !== 65 || publique[0] !== 4 || privee.length !== 32) return null;
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(sujet) && !/^https:\/\/\S+$/.test(sujet)) return null;
  try {
    // La clé privée doit correspondre à la clé publique.
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(privee);
    if (!ecdh.getPublicKey().equals(publique)) return null;
  } catch {
    return null;
  }
  return { publique, privee, sujet, cle: b64u(publique) };
}

const actif = (env = process.env) => Boolean(config(env));

// Nouvelle paire de clés VAPID (équivalent de `npx web-push generate-vapid-keys`).
function genererCles() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function clePrivee({ publique, privee }) {
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(privee), x: b64u(publique.subarray(1, 33)), y: b64u(publique.subarray(33, 65)) },
    format: 'jwk',
  });
}

// JWT VAPID pour un service de push (audience = son origine), valable 12 h.
function jetonVapid(audience, cfg, maintenant = Math.floor(Date.now() / 1000)) {
  const entete = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64u(JSON.stringify({ aud: audience, exp: maintenant + 12 * 3600, sub: cfg.sujet }));
  const entree = `${entete}.${corps}`;
  const signature = crypto.sign('sha256', Buffer.from(entree), { key: clePrivee(cfg), dsaEncoding: 'ieee-p1363' });
  return `${entree}.${b64u(signature)}`;
}

const hkdf = (ikm, sel, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, sel, info, n));

// Chiffre `message` pour un abonnement (RFC 8291). Les options sel et
// clePriveeServeur ne servent qu'aux tests (vecteur de la RFC).
function chiffrer(message, { p256dh, auth }, { sel = crypto.randomBytes(16), clePriveeServeur } = {}) {
  const uaPublique = deB64u(p256dh);
  const secret = deB64u(auth);
  if (uaPublique.length !== 65 || uaPublique[0] !== 4 || secret.length !== 16) throw new Error('clés d’abonnement invalides');
  const ecdh = crypto.createECDH('prime256v1');
  if (clePriveeServeur) ecdh.setPrivateKey(clePriveeServeur);
  else ecdh.generateKeys();
  const asPublique = ecdh.getPublicKey();
  const partage = ecdh.computeSecret(uaPublique);
  const infoCle = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublique, asPublique]);
  const ikm = hkdf(partage, secret, infoCle, 32);
  const cek = hkdf(ikm, sel, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, sel, Buffer.from('Content-Encoding: nonce\0'), 12);
  const clair = Buffer.concat([Buffer.from(message), Buffer.from([2])]);
  if (clair.length > 3993) throw new Error('message trop long pour un seul enregistrement');
  const chiffreur = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([chiffreur.update(clair), chiffreur.final(), chiffreur.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sel, rs, Buffer.from([asPublique.length]), asPublique, chiffre]);
}

// Envoie un message à un abonnement { endpoint, p256dh, auth }.
// Rend { ok, status, expire } ; expire = l'abonnement n'existe plus (404, 410).
async function envoyer(abonnement, donnees, { cfg = config(), fetchImpl = globalThis.fetch, ttl = 24 * 3600, urgence = 'normal' } = {}) {
  if (!cfg) return { ok: false, status: 0, expire: false, raison: 'vapid-absent' };
  if (!abonnement || !endpointPermis(abonnement.endpoint)) return { ok: false, status: 0, expire: false, raison: 'service-refuse' };
  const corps = chiffrer(typeof donnees === 'string' ? donnees : JSON.stringify(donnees), abonnement);
  const audience = new URL(abonnement.endpoint).origin;
  const res = await fetchImpl(abonnement.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl),
      Urgency: urgence,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jetonVapid(audience, cfg)}, k=${cfg.cle}`,
    },
    body: corps,
    redirect: 'error',
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, expire: res.status === 404 || res.status === 410 };
}

module.exports = { config, actif, genererCles, jetonVapid, chiffrer, envoyer, endpointPermis, SERVICES_PERMIS, b64u, deB64u };
