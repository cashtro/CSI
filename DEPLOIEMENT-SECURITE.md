# Mise en ligne de la branche `security-hardening`

Cette branche corrige les failles relevées par l'audit de `Evolu-Jeunes/Panda@afab512`.
Le code seul ne suffit pas : les étapes ci-dessous se font dans Supabase, Stripe,
SendGrid, Google et sur le serveur. Faites-les **dans l'ordre**, sur un environnement
de test d'abord si possible.

## 1. Remplacer les clés exposées (urgent, avant tout le reste)

Le `.env` de production a été commité dans l'historique de Panda (commits
`96b14f3`, `38e1a2e`, `5505e3f`). Toute personne ayant eu accès au dépôt peut
le lire. Régénérez chaque clé, puis mettez la nouvelle valeur dans le `.env`
du serveur :

| Service | Où | Clé |
| --- | --- | --- |
| Supabase | Project Settings → API | `service_role` (et `anon` si possible) → `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` |
| Stripe | Developers → API keys | la clé restreinte `rk_live_…` et la clé secrète → `STRIPE_SECRET_KEY` |
| SendGrid | Settings → API Keys | supprimer l'ancienne, en créer une → `SENDGRID_API_KEY` |
| Google | Compte → Sécurité → Mots de passe d'application | révoquer l'ancien → `EMAIL_PASSWORD` |

Le dépôt `cashtro/CSI` ne contient pas cet historique.

## 2. Créer la table `fulfillments` dans Supabase

Exécutez `db/001_fulfillments.sql` dans l'éditeur SQL de Supabase. Sans cette
table, les paiements ne sont plus livrés (le serveur refuse plutôt que de
livrer deux fois) et le webhook répond 500 jusqu'à sa création.

## 3. Configurer le webhook Stripe

Stripe → Developers → Webhooks → Add endpoint :

- URL : `https://pandorabrains.com/webhook`
- Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- Copiez le « Signing secret » dans `STRIPE_WEBHOOK_SECRET`.

## 4. Compléter le `.env` du serveur

```
NODE_ENV=production
STRIPE_WEBHOOK_SECRET=whsec_...
TOTP_ENC_KEY=<openssl rand -hex 32>   # à garder précieusement : la perdre bloque tous les comptes 2FA
TWOFA_SETUP_KEY=<openssl rand -hex 32>
LOG_LEVEL=info
```

Ne mettez **pas** `COOKIE_SECURE=false` ni `ALLOW_DEGRADED_BOOT=true` en production.
Sans les clés obligatoires, le serveur refuse maintenant de démarrer (c'est voulu).

## 5. Installer et redémarrer

```
cd innomax-html-package
npm ci
npm test
pm2 restart server.js --name "pandorabrains.com"
```

## 6. Resserrer les règles RLS de Supabase (à vérifier)

Les politiques RLS ne sont pas dans le dépôt, donc l'audit n'a pas pu les lire.
Le serveur écrit maintenant les tables sensibles avec la clé `service_role` ;
les navigateurs n'ont plus besoin d'y écrire. Vérifiez que les rôles `anon` et
`authenticated` **ne peuvent pas** insérer, modifier ou supprimer dans :

`Entry`, `cours_students`, `rendez_vous`, `disponibilites` (champ `taken`),
`bills`, `fulfillments`, `Users_2fa`, `Lottery` (champ `totalEntries`),
`Achat` (boutique), et la colonne `isAdmin`/`isTeacher` de `Users`.

Sinon un utilisateur peut encore, par exemple, augmenter lui-même son nombre
d'entrées à la loterie avec la clé `anon` publique.

La table `temp_access_tokens` n'est plus utilisée : videz-la (elle contient des
jetons de connexion d'acheteurs), puis supprimez-la.

## 7. Tests manuels après la mise en ligne

- Connexion avec mot de passe, avec et sans 2FA ; connexion Google.
- Un compte admin ou prof sans 2FA doit être obligé de la configurer.
- Achat d'un billet de loterie, d'un cours, d'un rendez-vous et d'un produit :
  recharger la page de succès ne doit rien livrer de plus.
- Tableaux de bord élève, prof et admin (les scripts et styles ont été sortis
  des pages ; un test visuel automatisé n'a montré aucune différence).

## Ce qui reste ouvert

- Renouvellements et annulations d'abonnements Stripe (aucun traitement des
  événements `invoice.*` / `customer.subscription.*`).
- Remboursement automatique quand un créneau est déjà pris ou qu'une loterie
  est fermée au moment du paiement (aujourd'hui : journalisé seulement).
- Récupération de compte quand un admin ou un prof perd son application 2FA
  (aujourd'hui : intervention manuelle).
- Facebook Pixel chargé sans consentement, absence de politique de
  confidentialité et site public en anglais seulement (Loi 25, Loi 96).
- Poids des pages (accueil ~32 Mo, `/nft` ~44 Mo) et 21 vulnérabilités `npm audit`.
- Les branches `pandora-wealth-os-3501` et `hnsw-vector-index` n'ont pas été
  fusionnées (voir l'audit des branches).
