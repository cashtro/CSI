// "Connecter mes outils" (ROBOTS.md): the providers a company can connect to
// its robots, the generic OAuth pieces (state, PKCE, token exchange) and the
// encryption of the tokens at rest.
//
// A provider is "configured" only when its environment variables exist (the
// OAuth app of PBTM). Otherwise the client's click records a request that the
// PBTM team handles by hand ("demande envoyée à l'équipe PBTM").
//
// Tokens are encrypted with AES-256-GCM under TOTP_ENC_KEY (utils/crypto2fa,
// the same mechanism as the 2FA secrets). Without the key nothing is stored:
// encryptTokens() throws instead of writing a token in clear. Tokens are never
// sent to a browser and never written to the logs.

const crypto = require('crypto');
const { encryptSecret, decryptSecret, isEncrypted } = require('./crypto2fa');

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = 'cx_etat';

// scopes: what PBTM asks the provider for. permissions: the same thing, in
// plain French, shown to the client before consent (Loi 25).
const FOURNISSEURS = {
  google_business: {
    nom: 'Google Business Profile', emoji: '📍',
    usage: 'Lire et préparer vos réponses aux avis, mettre à jour vos heures et publier vos nouvelles (après votre accord).',
    permissions: ['Voir et gérer votre fiche d’établissement Google', 'Lire les avis et y préparer des réponses'],
    oauth: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
      scopes: ['https://www.googleapis.com/auth/business.manage'], pkce: true, extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    },
  },
  google_workspace: {
    nom: 'Gmail et Google Agenda', emoji: '📬',
    usage: 'Lire vos courriels pour préparer des brouillons de réponse, et proposer des rendez-vous dans votre agenda. Rien n’est envoyé sans vous.',
    permissions: ['Lire vos courriels', 'Créer des brouillons (jamais d’envoi automatique)', 'Voir et créer des événements dans votre agenda'],
    oauth: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/calendar.events'],
      pkce: true, extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    },
  },
  microsoft365: {
    nom: 'Microsoft 365 (Outlook)', emoji: '🗓️',
    usage: 'Lire vos courriels Outlook pour préparer des brouillons, et voir votre calendrier pour proposer des rendez-vous.',
    permissions: ['Lire vos courriels Outlook', 'Créer des brouillons', 'Voir et créer des événements dans votre calendrier', 'Garder l’accès sans vous redemander (jeton de renouvellement)'],
    oauth: {
      authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Calendars.ReadWrite'], pkce: true, extra: { response_mode: 'query' },
      env: ['MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET'],
    },
  },
  meta: {
    nom: 'Facebook et Instagram', emoji: '📣',
    usage: 'Voir vos pages, lire les commentaires et préparer vos publications. Une publication part seulement après votre accord.',
    permissions: ['Voir la liste de vos pages Facebook', 'Lire l’activité de vos pages', 'Publier sur vos pages et sur Instagram, après votre accord'],
    oauth: {
      authorize: 'https://www.facebook.com/v21.0/dialog/oauth', token: 'https://graph.facebook.com/v21.0/oauth/access_token',
      scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'], pkce: false, scopeSep: ',',
      env: ['META_APP_ID', 'META_APP_SECRET'],
    },
  },
  hubspot: {
    nom: 'HubSpot', emoji: '🧲',
    usage: 'Lire vos contacts et vos transactions pour préparer la prospection, et y noter les suivis.',
    permissions: ['Lire vos contacts', 'Créer et mettre à jour des contacts', 'Lire vos transactions'],
    oauth: {
      authorize: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token',
      scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.deals.read'], pkce: false,
      env: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
    },
  },
  shopify: {
    nom: 'Shopify', emoji: '🛍️',
    usage: 'Lire vos produits et vos commandes pour écrire vos fiches, vos infolettres et répondre aux clients.',
    permissions: ['Lire vos produits', 'Lire vos commandes', 'Lire vos clients'],
    compte: { label: 'Adresse de votre boutique', placeholder: 'ma-boutique.myshopify.com', motif: '[a-z0-9][a-z0-9-]{0,60}\\.myshopify\\.com' },
    oauth: {
      authorize: 'https://{boutique}/admin/oauth/authorize', token: 'https://{boutique}/admin/oauth/access_token',
      scopes: ['read_products', 'read_orders', 'read_customers'], pkce: false, scopeSep: ',',
      env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'],
    },
  },
  site_web: {
    nom: 'Votre site web', emoji: '🌐',
    usage: 'Lire votre site et y préparer des pages ou des articles (en brouillon) avec la clé que vous nous donnez.',
    permissions: ['Lire les pages de votre site', 'Créer des brouillons avec la clé fournie (ex. mot de passe d’application WordPress)'],
    cle: true,
  },
};
const IDS = Object.keys(FOURNISSEURS);
const SHOP = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

const envOf = (f, env) => {
  const o = FOURNISSEURS[f] && FOURNISSEURS[f].oauth;
  return o ? { id: env[o.env[0]], secret: env[o.env[1]] } : null;
};

// OAuth is available for this provider (its app's credentials exist).
function isConfigured(f, env = process.env) {
  const c = envOf(f, env);
  return Boolean(c && c.id && c.secret);
}

function canEncrypt(env = process.env) {
  return Boolean(env.TOTP_ENC_KEY);
}

// { access_token, refresh_token, ... } -> 'enc:v1:...'. Throws without a key:
// a token is never stored in clear.
function encryptTokens(tokens, env = process.env) {
  if (!canEncrypt(env)) throw new Error('TOTP_ENC_KEY manquante : impossible de chiffrer les jetons.');
  const out = encryptSecret(JSON.stringify(tokens));
  if (!isEncrypted(out)) throw new Error('chiffrement des jetons impossible');
  return out;
}

function decryptTokens(stored) {
  if (!isEncrypted(stored)) return null;
  return JSON.parse(decryptSecret(stored));
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newState = () => b64url(crypto.randomBytes(32));
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

const appUrl = (env) => String(env.APP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const redirectUri = (f, env = process.env) => `${appUrl(env)}/connexions/${f}/retour`;
const withShop = (url, compte) => url.replace('{boutique}', compte || '');

function authorizeUrl(f, { state, challenge, compte }, env = process.env) {
  const o = FOURNISSEURS[f].oauth;
  const url = new URL(withShop(o.authorize, compte));
  url.searchParams.set('client_id', envOf(f, env).id);
  url.searchParams.set('redirect_uri', redirectUri(f, env));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', o.scopes.join(o.scopeSep || ' '));
  url.searchParams.set('state', state);
  if (o.pkce && challenge) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(o.extra || {})) url.searchParams.set(k, v);
  return url.toString();
}

// Exchange the code for tokens (server to server). Error messages never
// contain the response body (it may hold a token).
async function exchangeCode(f, { code, verifier, compte }, env = process.env, fetchImpl = globalThis.fetch) {
  const o = FOURNISSEURS[f].oauth;
  const creds = envOf(f, env);
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(f, env), client_id: creds.id, client_secret: creds.secret,
  });
  if (o.pkce && verifier) body.set('code_verifier', verifier);
  const res = await fetchImpl(withShop(o.token, compte), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`échange du code refusé par ${FOURNISSEURS[f].nom} (HTTP ${res.status})`);
  const data = await res.json().catch(() => null);
  if (!data || typeof data.access_token !== 'string') throw new Error(`réponse illisible de ${FOURNISSEURS[f].nom}`);
  const tokens = { access_token: data.access_token };
  if (typeof data.refresh_token === 'string') tokens.refresh_token = data.refresh_token;
  if (typeof data.token_type === 'string') tokens.token_type = data.token_type;
  const expiresIn = Number(data.expires_in);
  return {
    tokens,
    scope: typeof data.scope === 'string' ? data.scope.split(/[ ,]+/).filter(Boolean) : null,
    expireAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  };
}

// Best effort: tell the provider to revoke the token (Google only exposes a
// simple endpoint). Failures are ignored and never logged with the token.
async function revokeAtProvider(f, stored, fetchImpl = globalThis.fetch) {
  const o = FOURNISSEURS[f] && FOURNISSEURS[f].oauth;
  if (!o || !o.revoke || !stored) return false;
  try {
    const t = decryptTokens(stored);
    const token = t && (t.refresh_token || t.access_token);
    if (!token) return false;
    const res = await fetchImpl(o.revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
    return res.ok;
  } catch {
    return false;
  }
}

// What the page may show of a connection row: never the tokens.
function vuePublique(row) {
  if (!row) return null;
  return {
    id: row.id, fournisseur: row.fournisseur, statut: row.statut, portee: Array.isArray(row.portee) ? row.portee : [],
    compte: row.compte || null, expire_at: row.expire_at || null, consenti_at: row.consenti_at || null, erreur: row.erreur || null,
    updated_at: row.updated_at || row.created_at || null,
  };
}

function sitePublic(v) {
  if (typeof v !== 'string' || v.length > 300) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')) : null;
  } catch {
    return null;
  }
}

module.exports = {
  FOURNISSEURS, IDS, SHOP, STATE_TTL_MS, STATE_COOKIE,
  isConfigured, canEncrypt, encryptTokens, decryptTokens, newState, pkcePair, redirectUri, authorizeUrl, exchangeCode, revokeAtProvider,
  vuePublique, sitePublic,
};
