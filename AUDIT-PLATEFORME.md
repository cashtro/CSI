# Audit de la branche `plateforme`

Date : 2 octobre 2026. Portée : tout `git diff main...plateforme` (espace entreprises, console admin,
CMS, moteur d'agents, Stripe, SQL), plus les chemins critiques plus anciens (connexion, 2FA,
paiements, routes admin).

Résultat des tests : `NODE_ENV=test npm test`, **351 tests, tous verts** (296 au départ).

## Résumé

| Gravité | Trouvés | Corrigés dans le code | Restent à faire (vous ou plus tard) |
| --- | --- | --- | --- |
| Critique | 1 | 1 (le fichier SQL 004 doit encore être exécuté) | 0 |
| Élevée | 6 | 5 | 1 |
| Moyenne | 13 | 11 | 2 |
| Faible | 10 | 5 | 5 |

## Tableau des problèmes

| # | Problème | Gravité | Corrigé | Commit |
| --- | --- | --- | --- | --- |
| 1 | Un compte pouvait se donner lui-même `isAdmin = true` dans `Users` avec la clé publique (si la règle RLS de `Users` le permet, ce que le dépôt ne montre pas), puis ouvrir la console admin. | Critique | Oui, par `db/004` (à exécuter) | 52cfe12 |
| 2 | API admin des agents : seule la 2FA *activée* était vérifiée. Un jeton Supabase obtenu avec le mot de passe, sans le code, suffisait. | Élevée | Oui | 0080a0e |
| 3 | Anciennes routes admin (produits, loteries, portfolio, demandes de profs, liste des utilisateurs) : rôle admin seul, sans preuve 2FA. | Élevée | Oui | 4178dac |
| 4 | Flux SSE des agents : un client parti pendant la première lecture gardait sa place et ses minuteries pour toujours. Après 20 départs, le flux était bloqué (503). | Élevée | Oui | 5c20fde |
| 5 | Derrière nginx, toutes les requêtes viennent de 127.0.0.1 : les limites (connexion, 2FA, paiements) sont partagées par tous. 5 mauvais codes 2FA de n'importe qui bloquent tout le monde pendant 15 min. | Élevée | Oui, avec `TRUST_PROXY=1` | 8ffe0b0 |
| 6 | `npm audit` (production) : express, path-to-regexp, body-parser, qs, lodash, js-yaml, ws, validator, axios, etc. | Élevée | Oui (sans saut de version majeure) | a1eae14 |
| 7 | `npm audit` restant : nodemailer 6 (injection SMTP, saut majeur vers 10), sharp 0.34 (libvips, saut vers 0.35). | Élevée | Non (voir « Ce qui reste ») | — |
| 8 | Routes client des agents : `memberEntreprises()` renvoyait toujours une liste vide (TODO). | Moyenne | Oui, branchée sur `membres` + test d'isolation A/B | a5bf81d |
| 9 | `db/003` cherchait `entreprise_membres` (n'existe pas) ; et la règle aurait montré aux membres la demande, le résultat interne et le coût. | Moyenne | Oui : `membres`, colonnes limitées, ordre 001 → 002 → 003 noté | 2c66455 |
| 10 | Budget mensuel des agents : un Conseil lance jusqu'à 6 appels en même temps, qui lisaient tous le même « dépensé » et pouvaient dépasser le plafond 6 fois. | Moyenne | Oui (réservation avant l'appel) | 2233ea7 |
| 11 | Images du CMS : seuls le type déclaré et le nom étaient vérifiés. Une page HTML ou SVG nommée `photo.png` passait. | Moyenne | Oui (signature des octets, extension recalculée) | 6cd8b48 |
| 12 | Démarrage : aucune alerte sans `STRIPE_WEBHOOK_SECRET`, `TOTP_ENC_KEY`, SendGrid, `OWNER_EMAIL`, ni avec `COOKIE_SECURE=false`. | Moyenne | Oui (alertes au démarrage) | 84fb3e5 |
| 13 | Boutique (`/api/achats`) : courriel envoyé à chaque rechargement de la page de succès, pas de facture, ignorée par le webhook, appel de courriel cassé, HTML non échappé. | Moyenne | Oui (passe par `fulfill`, une seule fois) | 76ee5c1 |
| 14 | Courriels loterie et produit : nom d'utilisateur et adresse insérés en HTML sans échappement. | Moyenne | Oui | 76ee5c1 |
| 15 | Loterie : paiement possible pour un tirage fermé (puis remboursement manuel). | Moyenne | Oui (409 avant Stripe) | 56d9195 |
| 16 | Client LLM : une réponse illisible pouvait bloquer le disjoncteur jusqu'au redémarrage du worker. | Moyenne | Oui | d89f874 |
| 17 | IDOR : `/api/course/student-courses/:studentId` montrait les cours de n'importe quel élève. | Moyenne | Oui (soi-même ou admin) | aa603b8 |
| 18 | Rendez-vous et fiche utilisateur : pouvoirs admin sans preuve 2FA. | Moyenne | Oui | 8ea2ae6 |
| 19 | CSRF : la vérification des anciennes routes `/api` est éteinte tant que `CSRF_ENFORCE` n'est pas `true`. Les cookies `SameSite=Lax` limitent le risque. | Moyenne | Non (à activer par vous après un test) | — |
| 20 | Content-Security-Policy seulement en mode rapport (scripts en ligne et ~20 CDN). | Moyenne | Non (chantier à part) | — |
| 21 | Déconnexion sans session valide : 401 et les cookies (dont `mfa`) restaient. | Faible | Oui | 33cf19b |
| 22 | Deux décisions simultanées sur un livrable : la seconde écrasait la première. | Faible | Oui | 70137d0 |
| 23 | `/course-details/:courseId` : `../../` dans l'identifiant visait une autre route interne. | Faible | Oui | f7f2246 |
| 24 | Journaux : l'identifiant de session 2FA temporaire était écrit en clair. | Faible | Oui (masquage automatique) | 1c06eba |
| 25 | Cookie `XSRF-TOKEN` de `/api/csrf-token` sans `Secure` ni `SameSite`. | Faible | Oui | 2c857fa |
| 26 | Le cookie `mfa` n'est pas révocable côté serveur : il reste valable jusqu'à son expiration (7 ou 30 jours), même s'il est effacé à la déconnexion. | Faible | Non | — |
| 27 | `/api/auth/check-email` et `check-linked` disent si un courriel existe (énumération des comptes). | Faible | Non | — |
| 28 | `cookie` < 0.7 sous `csurf` (paquet abandonné), utilisé seulement par `/api/csrf-token`. | Faible | Non | — |
| 29 | Plusieurs processus worker ne voient pas les réservations de budget les uns des autres. | Faible | Non : lancez un seul worker (documenté) | — |
| 30 | `/dashboard` affiche le modèle admin sans preuve 2FA (sans données : elles passent par les routes protégées). | Faible | Non | — |

### Faux positifs (vérifiés, rien à corriger)

- **Secrets dans l'historique** : `git grep` sur les 71 commits de la branche. Seulement des exemples ou des valeurs de test (`sk_t***`, `whse***`, `sk-a***`, `rk_l***`). L'URL du projet Supabase (`jjol***`) dans `oauth-callback.ejs` est publique par nature.
- **XSS dans les vues EJS** : toutes les données passent par `<%= %>`. Les seuls `<%-` sont des `include` et un JSON qui échappe `<`.
- **Liens de livrables `javascript:` / `data:`** : refusés par le serveur (`https://` exigé), par la base (contrainte) et par la vue.
- **CSRF contourné avec un en-tête `Authorization`** : un site tiers ne peut pas ajouter cet en-tête.
- **SSE, fuite entre utilisateurs** : le flux est réservé aux admins avec 2FA ; il montre toute l'activité, comme prévu.
- **Injection de prompt** : les données client sont encadrées et neutralisées, le moteur n'a aucun outil, et tout sort en texte validé par un humain.
- **`/healthz`** : seulement ok/ko, deux compteurs et l'âge du dernier signal du worker.
- **Webhook Stripe** : signature vérifiée sur le corps brut ; montants calculés côté serveur ; livraison une seule fois (`fulfillments`).
- **Worker** : double prise impossible (`FOR UPDATE SKIP LOCKED` + `locked_by`) ; un travail abandonné revient en file après 15 min.
- **Tailles des corps** : 100 ko par défaut (JSON, formulaires, webhook) ; images 5 Mo, un fichier.
- **Fonctions `security definer`** : toutes ont `search_path` fixé (test automatique).

## Ce que vous devez faire avant la mise en ligne

### 1. Remplacer les clés

Aucune clé réelle n'est dans ce dépôt. Mais le `.env` de production a déjà fuité dans l'historique
de l'ancien dépôt Panda (voir `DEPLOIEMENT-SECURITE.md`). Si ce n'est pas déjà fait, régénérez :
Supabase `service_role` (et `anon`), Stripe (clé secrète et clé restreinte), SendGrid, le mot de
passe d'application Google (`EMAIL_PASSWORD`). Créez aussi une clé `ANTHROPIC_API_KEY` dédiée au
serveur, avec une limite de dépense dans la console Anthropic.

### 2. Exécuter les fichiers SQL dans cet ordre

Dans l'éditeur SQL de Supabase, un fichier à la fois :

1. `db/001_fulfillments.sql`
2. `db/002_espace_entreprises.sql`
3. `db/003_moteur_agents.sql`
4. `db/004_protection_comptes.sql` (nouveau, **fortement recommandé**)
5. `db/005_recherche_agents.sql` (recherche web des agents, onglet Agents de l'admin)
6. `db/006_robots.sql` (robots clients et connexions, voir `ROBOTS.md`)
7. `db/007_finances.sql` (onglet Finances, voir `FINANCES.md`)
8. `db/008_croissance.sql` (onglet Croissance, voir `CROISSANCE.md`)

Chaque fichier peut être relancé sans danger. Si 003 a été exécuté avant 002, relancez 003.
Les huit fichiers ont été essayés dans cet ordre, deux fois de suite, sur PostgreSQL 16 avec
les rôles de Supabase.

Ensuite, dans Supabase → Authentication → Policies, vérifiez que `anon` et `authenticated` ne
peuvent pas écrire dans `Entry`, `cours_students`, `rendez_vous`, `disponibilites`, `bills`,
`Lottery`, `Achat`. Le dépôt ne contient pas ces règles. Vérifiez aussi que la fonction
`validate_temp_session` supprime la session après usage (un code 2FA = une session).

### 3. Compléter le `.env` du serveur

```
STRIPE_WEBHOOK_SECRET=whsec_...          # voir point 4
TOTP_ENC_KEY=<openssl rand -hex 32>      # à garder précieusement
TWOFA_SETUP_KEY=<openssl rand -hex 32>
TRUST_PROXY=1                            # 1 = un proxy (nginx) devant Node. Jamais "true".
OWNER_EMAIL=...
SENDGRID_API_KEY=...
SENDGRID_EMAIL=...
APP_URL=https://pandorabrains.com
ANTHROPIC_API_KEY=sk-ant-...             # seulement si le moteur d'agents est utilisé
AGENTS_ENABLED=true                      # idem
```

Ne mettez pas `COOKIE_SECURE=false` ni `ALLOW_DEGRADED_BOOT=true`. Au démarrage, le journal
liste maintenant ce qui manque : lisez-le après chaque redémarrage.

Après un test sur un environnement d'essai (connexion, achat, tableaux de bord), ajoutez
`CSRF_ENFORCE=true`.

### 4. Webhook Stripe

Stripe → Developers → Webhooks → Add endpoint :

- URL : `https://pandorabrains.com/webhook`
- Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` et `customer.subscription.deleted` (robots)
- Copiez le « Signing secret » dans `STRIPE_WEBHOOK_SECRET`.

Les achats de la boutique (`/achats`) passent maintenant aussi par ce webhook.

### 5. PM2

```
cd innomax-html-package
npm ci --omit=dev
pm2 restart server.js --name "pandorabrains.com"
pm2 start scripts/agents-worker.js --name pandora-agents --kill-timeout 30000
pm2 save
```

- **Un seul** worker d'agents (pas de mode cluster) : le plafond de budget compte les appels en
  cours dans ce processus.
- `--kill-timeout 30000` laisse au worker le temps de remettre en file le travail en cours. Sans
  cette option, PM2 le coupe après 1,6 s.
- Le site lui-même doit aussi tourner en **un seul processus** (mode fork), sauf si
  `TOTP_ENC_KEY` est défini : sans cette clé, chaque processus signe la preuve 2FA avec sa
  propre clé.

### 6. Après la mise en ligne

- Chaque admin doit **se reconnecter une fois avec son code 2FA** : les anciennes routes admin
  exigent maintenant le cookie `mfa`, comme la console.
- Vérifiez `/healthz` (doit répondre `"db":"ok"`).
- Faites un achat test par type (loterie, cours, rendez-vous, produit, boutique) et rechargez la
  page de succès : rien ne doit être livré deux fois.

## Ce qui reste

- **nodemailer 6 → 10** et **sharp 0.34 → 0.35** : sauts de version majeure, à faire avec un
  test des courriels Gmail et de `optimize-images.js`. Pour nodemailer, les failles connues
  visent des options que le site ne remplit pas avec des données de visiteurs.
- **CSP** à rendre bloquante, après avoir sorti les scripts en ligne restants.
- **`CSRF_ENFORCE=true`** à activer après test.
- Énumération des comptes par `check-email` / `check-linked`.
- Révocation côté serveur de la preuve 2FA (aujourd'hui : expiration à 7 ou 30 jours).
- Points déjà notés dans `DEPLOIEMENT-SECURITE.md` : renouvellements d'abonnements Stripe,
  remboursements automatiques, récupération 2FA perdue, Loi 25 / Loi 96.
