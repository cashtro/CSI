// "Connecter mes outils" (ROBOTS.md): generic OAuth routes for every provider
// of utils/connexions.js, plus the website key and the withdrawal of consent.
//
//   POST   /connexions/:fournisseur/debut   explicit consent (Loi 25) then either
//            - OAuth configured: one-time state (+ PKCE) and the provider's URL,
//            - not configured:   a request for the PBTM team ("demandee"),
//            - site_web:         the site address and its key, encrypted.
//   GET    /connexions/:fournisseur/retour  the provider sends the user back here;
//            the state must exist, be unexpired, belong to this user and match
//            the browser's state cookie. It is deleted on first use.
//   DELETE /api/connexions/:fournisseur     withdraw consent: the tokens are erased.
//
// The owner of the company manages the connections. Writes need the CSRF
// header. Tokens are encrypted (TOTP_ENC_KEY), never sent to a browser and
// never logged.

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { createSupabaseAdmin } = require('./utils/supabaseUtil');
const { requireCsrf } = require('./utils/csrf');
const { cookieSecure } = require('./utils/cookies');
const { requireMember, noStore, text } = require('./utils/espace');
const cx = require('./utils/connexions');
const { encryptSecret, decryptSecret } = require('./utils/crypto2fa');

const router = express.Router();

const debutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de demandes de connexion, réessayez dans quelques minutes.' },
});

const PAGE = '/espace?vue=connexions';
const retourVers = (res, query) => res.redirect(`${PAGE}&${query}`);
const stateCookie = { httpOnly: true, sameSite: 'Lax', path: '/connexions', maxAge: cx.STATE_TTL_MS };

function fournisseur(req, res, next) {
  if (!cx.IDS.includes(req.params.fournisseur)) return res.status(404).json({ error: 'Outil inconnu.' });
  req.fournisseur = req.params.fournisseur;
  next();
}

function owner(req, res, next) {
  if (req.membership.role !== 'proprietaire') {
    return res.status(403).json({ error: 'Seul le propriétaire du compte de l’entreprise peut connecter ou retirer un outil.' });
  }
  next();
}

const consentGiven = (b) => b && (b.consentement === true || b.consentement === 'on' || b.consentement === 'true');

async function upsertConnexion(admin, entrepriseId, f, patch) {
  const now = new Date().toISOString();
  const { data: existing, error } = await admin.from('connexions').select('id').eq('entreprise_id', entrepriseId).eq('fournisseur', f).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) {
    const { error: updateError } = await admin.from('connexions').update({ ...patch, updated_at: now }).eq('id', existing.id);
    if (updateError) throw new Error(updateError.message);
    return existing.id;
  }
  const { data, error: insertError } = await admin.from('connexions')
    .insert({ entreprise_id: entrepriseId, fournisseur: f, ...patch, updated_at: now }).select('id').single();
  if (insertError) throw new Error(insertError.message);
  return data.id;
}

router.get('/connexions/:fournisseur/debut', (req, res) => res.redirect(PAGE));

router.post('/connexions/:fournisseur/debut', noStore, requireCsrf, fournisseur, requireMember(), owner, debutLimiter, async (req, res) => {
  const f = req.fournisseur;
  const def = cx.FOURNISSEURS[f];
  const b = req.body || {};
  if (!consentGiven(b)) return res.status(400).json({ error: 'Cochez la case de consentement pour autoriser cette connexion.' });
  const admin = createSupabaseAdmin();
  const entrepriseId = req.membership.entreprise_id;
  const consent = { consenti_par: req.user.id, consenti_at: new Date().toISOString(), portee: def.permissions };

  // Website: address + key (application password, API key), encrypted.
  if (def.cle) {
    const site = cx.sitePublic(b.site);
    const cle = typeof b.cle === 'string' ? b.cle.trim() : '';
    if (!site) return res.status(400).json({ error: 'Adresse du site invalide (https://…).' });
    if (cle.length < 8 || cle.length > 500) return res.status(400).json({ error: 'Clé invalide (8 à 500 caractères).' });
    if (!cx.canEncrypt()) {
      logger.error('[connexions] TOTP_ENC_KEY missing: website key refused');
      return res.status(503).json({ error: 'Le chiffrement n’est pas configuré sur le serveur : la clé n’a pas été enregistrée.' });
    }
    await upsertConnexion(admin, entrepriseId, f, { ...consent, statut: 'connectee', compte: site, jetons: cx.encryptTokens({ cle }), erreur: null, expire_at: null });
    logger.info(`[connexions] ${f} connected for entreprise ${entrepriseId}`);
    return res.json({ statut: 'connectee', message: 'Site connecté. La clé est chiffrée et ne sera plus jamais affichée.' });
  }

  let compte = null;
  if (def.compte) {
    compte = text(b.compte, 200).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (f === 'shopify' && !cx.SHOP.test(compte)) return res.status(400).json({ error: 'Adresse de boutique invalide (ex. ma-boutique.myshopify.com).' });
  }

  // No OAuth app for this provider yet: the PBTM team takes over.
  if (!cx.isConfigured(f) || !cx.canEncrypt()) {
    await upsertConnexion(admin, entrepriseId, f, { ...consent, statut: 'demandee', compte, erreur: null });
    logger.info(`[connexions] ${f} requested for entreprise ${entrepriseId} (not configured)`);
    return res.json({ statut: 'demandee', message: 'Demande envoyée à l’équipe PBTM. Nous vous écrivons pour finir la connexion.' });
  }

  const state = cx.newState();
  const pkce = def.oauth.pkce ? cx.pkcePair() : null;
  const { error } = await admin.from('connexions_etats').insert({
    state, entreprise_id: entrepriseId, user_id: req.user.id, fournisseur: f, compte,
    code_verifier: pkce ? encryptSecret(pkce.verifier) : null,
    expires_at: new Date(Date.now() + cx.STATE_TTL_MS).toISOString(),
  });
  if (error) {
    logger.error('[connexions] state insert failed:', error.message);
    return res.status(500).json({ error: 'La connexion n’a pas pu démarrer.' });
  }
  await upsertConnexion(admin, entrepriseId, f, { ...consent, statut: 'demandee', compte, erreur: null });
  res.cookie(cx.STATE_COOKIE, state, { ...stateCookie, secure: cookieSecure() });
  res.json({ statut: 'redirection', url: cx.authorizeUrl(f, { state, challenge: pkce && pkce.challenge, compte }) });
});

router.get('/connexions/:fournisseur/retour', noStore, requireMember({ page: true }), async (req, res) => {
  const f = req.params.fournisseur;
  if (!cx.IDS.includes(f) || !req.membership) return retourVers(res, 'erreur=etat');
  const q = req.query || {};
  const state = typeof q.state === 'string' ? q.state : '';
  res.clearCookie(cx.STATE_COOKIE, { ...stateCookie, maxAge: undefined, secure: cookieSecure() });
  if (!state || state.length < 32 || state.length > 128 || req.cookies[cx.STATE_COOKIE] !== state) {
    logger.warn(`[connexions] ${f}: state missing or not this browser's (user ${req.user.id})`);
    return retourVers(res, 'erreur=etat');
  }
  const admin = createSupabaseAdmin();
  // Read and delete: a state is used once.
  const { data: rows, error } = await admin.from('connexions_etats').delete().eq('state', state).select('*');
  if (error) throw new Error(error.message);
  const etat = (rows || [])[0];
  if (!etat || etat.fournisseur !== f || etat.user_id !== req.user.id || etat.entreprise_id !== req.membership.entreprise_id
      || Date.parse(etat.expires_at) < Date.now()) {
    logger.warn(`[connexions] ${f}: invalid or expired state (user ${req.user.id})`);
    return retourVers(res, 'erreur=etat');
  }
  if (q.error || typeof q.code !== 'string' || !q.code) {
    await upsertConnexion(admin, etat.entreprise_id, f, { statut: 'erreur', erreur: 'Connexion annulée ou refusée chez le fournisseur.' });
    return retourVers(res, `erreur=refus&outil=${f}`);
  }
  if (f === 'shopify' && etat.compte && q.shop && q.shop !== etat.compte) return retourVers(res, 'erreur=etat');
  try {
    const verifier = etat.code_verifier ? decryptSecret(etat.code_verifier) : null;
    const { tokens, scope, expireAt } = await cx.exchangeCode(f, { code: q.code.slice(0, 2000), verifier, compte: etat.compte });
    await upsertConnexion(admin, etat.entreprise_id, f, {
      statut: 'connectee', jetons: cx.encryptTokens(tokens), expire_at: expireAt, erreur: null,
      ...(scope ? { portee: cx.FOURNISSEURS[f].permissions } : {}),
    });
    logger.info(`[connexions] ${f} connected for entreprise ${etat.entreprise_id}`);
    return retourVers(res, `ok=${f}`);
  } catch (err) {
    logger.error(`[connexions] ${f} token exchange failed:`, err.message);
    await upsertConnexion(admin, etat.entreprise_id, f, { statut: 'erreur', erreur: 'L’échange avec le fournisseur a échoué. Réessayez.' });
    return retourVers(res, `erreur=echange&outil=${f}`);
  }
});

router.delete('/api/connexions/:fournisseur', noStore, requireCsrf, fournisseur, requireMember(), owner, async (req, res) => {
  const admin = createSupabaseAdmin();
  const { data: row, error } = await admin.from('connexions').select('id, jetons')
    .eq('entreprise_id', req.membership.entreprise_id).eq('fournisseur', req.fournisseur).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return res.status(404).json({ error: 'Cet outil n’est pas connecté.' });
  await cx.revokeAtProvider(req.fournisseur, row.jetons);
  const { error: deleteError } = await admin.from('connexions').delete().eq('id', row.id);
  if (deleteError) throw new Error(deleteError.message);
  logger.info(`[connexions] ${req.fournisseur} withdrawn for entreprise ${req.membership.entreprise_id} by ${req.user.id}`);
  res.json({ ok: true, message: 'Autorisation retirée : les accès enregistrés sont effacés.' });
});

module.exports = router;
