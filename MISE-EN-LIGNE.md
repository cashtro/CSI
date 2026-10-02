# Mise en ligne de pandorabrains.com

La liste complète, dans l'ordre. Faites une étape à la fois et cochez-la.
Les détails sont dans `AUDIT-PLATEFORME.md`, `DEPLOIEMENT-SECURITE.md`, `ESPACE-ENTREPRISES.md` et
`MOTEUR-AGENTS.md`.

---

## 1. Changer toutes les clés (l'ancien `.env` a fuité)

L'ancien `.env` de production se trouve dans l'historique de l'ancien dépôt Panda. Considérez
toutes ses clés comme connues de tous.

- [ ] **Supabase** → Project Settings → API : régénérez la clé `service_role` et la clé `anon`.
- [ ] **Stripe** → Developers → API keys : régénérez la clé secrète (et les clés restreintes).
- [ ] **SendGrid** → Settings → API Keys : créez une nouvelle clé, supprimez l'ancienne.
- [ ] **Google** (compte de `EMAIL_USER`) : supprimez l'ancien mot de passe d'application et créez-en un nouveau.
- [ ] **Anthropic** (console.anthropic.com) : créez une clé réservée au serveur et mettez une
      **limite de dépense** mensuelle sur le compte.
- [ ] Notez les nouvelles clés dans un gestionnaire de mots de passe, **jamais** dans le dépôt.

## 2. Base de données : les fichiers SQL 001 à 005

Supabase → SQL Editor. Collez un fichier, cliquez sur **Run**, passez au suivant. **L'ordre est
obligatoire.** Chaque fichier peut être relancé sans danger.

- [ ] `db/001_fulfillments.sql` (les achats ne sont livrés qu'une fois)
- [ ] `db/002_espace_entreprises.sql` (espace client, console admin, contenu du site)
- [ ] `db/003_moteur_agents.sql` (moteur des agents)
- [ ] `db/004_protection_comptes.sql` (un compte ne peut pas se donner le rôle admin)
- [ ] `db/005_recherche_agents.sql` (recherche web des agents)
- [ ] `db/006_robots.sql` (robots clients, connexions : voir ROBOTS.md)
- [ ] Supabase → Authentication → Policies : vérifiez que `anon` et `authenticated` ne peuvent
      **pas écrire** dans `Entry`, `cours_students`, `rendez_vous`, `disponibilites`, `bills`,
      `Lottery`, `Achat`.

## 3. Le fichier `.env` du serveur

Il est à la racine du dépôt, à côté du dossier `innomax-html-package`. Une ligne par variable.
Pour fabriquer une clé au hasard : `openssl rand -hex 32`.

**Obligatoires (le site refuse de démarrer sans elles)**

| Variable | À quoi elle sert |
| --- | --- |
| `SUPABASE_URL` | Adresse de votre projet Supabase. |
| `SUPABASE_ANON_KEY` | Clé publique Supabase (la nouvelle, étape 1). |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` Supabase (la nouvelle). Donne tous les droits : ne la montrez à personne. |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (la nouvelle). |
| `STRIPE_PUBLIC_KEY` | Clé publique Stripe. |
| `APP_URL` | `https://pandorabrains.com` (liens des paiements et des courriels). |

**Fortement recommandées**

| Variable | À quoi elle sert |
| --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Secret du webhook Stripe (étape 4). Sans lui, aucun achat n'est livré. |
| `TOTP_ENC_KEY` | Chiffre les secrets 2FA. `openssl rand -hex 32`. **À ne jamais perdre ni changer.** |
| `TWOFA_SETUP_KEY` | Signe l'activation de la 2FA et la preuve 2FA des admins. `openssl rand -hex 32`. |
| `SENDGRID_API_KEY` | Envoi des courriels (la nouvelle clé). |
| `SENDGRID_EMAIL` | Adresse d'expéditeur vérifiée dans SendGrid. |
| `OWNER_EMAIL` | Votre adresse : vous recevez les avis (achats, demandes). |
| `EMAIL_USER` | Compte Gmail utilisé pour certains courriels (loterie, cours). |
| `EMAIL_PASSWORD` | Mot de passe d'application de ce compte Gmail (le nouveau). |
| `TRUST_PROXY` | `1` si nginx est devant Node (cas normal). Jamais `true`. |
| `PORT` | `3004` en production (le port que nginx attend). |

**Moteur des agents**

| Variable | À quoi elle sert |
| --- | --- |
| `ANTHROPIC_API_KEY` | Clé Anthropic du serveur (étape 1). |
| `AGENTS_ENABLED` | `true` pour permettre au moteur de travailler. Absent = éteint. |
| `AGENTS_WEB_SEARCH_USD_PER_1000` | Facultatif. Prix compté par 1 000 recherches web (10 par défaut, **à vérifier** sur anthropic.com/pricing). |
| `AGENTS_MODEL_QUICK`, `AGENTS_MODEL_DEFAULT`, `AGENTS_MODEL_COMPLEX` | Facultatif. Modèles par niveau (sinon ceux par défaut, aussi réglables dans l'admin). |

**Facultatives**

| Variable | À quoi elle sert |
| --- | --- |
| `FACEBOOK_PIXEL_ID` | Pixel Facebook des pages publiques. |
| `SITE_LANG` | Langue par défaut du contenu du site : `fr` (défaut) ou `en`. |
| `CMS_BUCKET` | Dossier Supabase des images du site (défaut `site-content`). |
| `COOKIE_DOMAIN` | Seulement si les cookies doivent couvrir plusieurs sous-domaines. |
| `LOG_LEVEL` | `info` par défaut (`warn` pour moins de lignes). |
| `OMIT_BODY_TOKENS` | `true` pour ne plus renvoyer les jetons de connexion dans les réponses. |
| `CSRF_ENFORCE` | `true` **après** l'étape 8 (premier test réussi). |

**À ne jamais mettre en production** : `COOKIE_SECURE=false`, `ALLOW_DEGRADED_BOOT=true`, `DEMO_MODE=true`.

- [ ] Le `.env` contient toutes les variables obligatoires et recommandées.
- [ ] Le `.env` n'est lisible que par le compte du serveur : `chmod 600 .env`.

## 4. Webhook Stripe

Stripe → Developers → Webhooks → **Add endpoint**.

- [ ] URL : `https://pandorabrains.com/webhook`
- [ ] Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` et `customer.subscription.deleted` (robots, voir ROBOTS.md)
- [ ] Copiez le **Signing secret** (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET` du `.env`.

## 5. Installer et lancer avec PM2 (le site + un seul worker)

Sur le serveur, depuis le dossier du dépôt :

```
cd innomax-html-package
npm ci --omit=dev
pm2 restart server.js --name "pandorabrains.com"
pm2 start scripts/agents-worker.js --name pandora-agents --kill-timeout 30000
pm2 save
```

- [ ] Le site tourne : `pm2 status` montre `pandorabrains.com` en `online`.
- [ ] **Un seul** worker `pandora-agents` (jamais en mode cluster : le budget est compté dans ce processus).
- [ ] Le site tourne en **un seul processus** (mode fork).
- [ ] `pm2 logs pandorabrains.com` : aucune ligne « missing » au démarrage.

## 6. Importer les 38 agents de départ

Au choix :

- [ ] dans l'admin : **⚙️ Réglages agents → 🌱 Importer les 38 agents de départ** (après l'étape 7) ;
- ou sur le serveur : `cd innomax-html-package && node scripts/seed-agents.js`.

Relancer l'import ne crée pas de doublon : il ajoute seulement les agents manquants.

## 7. Se reconnecter comme administrateur

- [ ] Connectez-vous sur `https://pandorabrains.com/login` avec courriel, mot de passe **et code 2FA**
      (chaque admin doit le refaire une fois).
- [ ] Ouvrez `https://pandorabrains.com/admin/console` : les onglets **🤖 Agents, 🧠 Conseil,
      🗂️ Travail, 🔎 Recherche, ⚙️ Réglages agents** sont là.
- [ ] Dans **⚙️ Réglages agents** : fixez le **budget du mois** (60 $ par défaut), puis cliquez
      **▶️ Remettre en marche**. Les trois cases doivent être ✅.

## 8. Premier test

- [ ] `https://pandorabrains.com/healthz` répond avec `"db":"ok"` et un `seen_seconds_ago` de moins de 60.
- [ ] **🤖 Agents** : donnez un petit ordre à un agent (« Résume notre offre en 3 points »). Le journal
      en direct bouge, l'agent passe « au travail », puis le texte apparaît dans « Ordres récents ».
- [ ] **🔎 Recherche** : posez une question simple. La synthèse arrive avec des sources cliquables.
- [ ] **⚙️ Réglages agents** : la dépense du mois a augmenté de quelques cents, recherches web à part.
- [ ] Faites un **achat test** par type (loterie, cours, rendez-vous, produit, boutique) avec la
      carte de test Stripe, puis rechargez la page de succès : rien ne doit être livré deux fois.
- [ ] Testez l'espace client `/espace` avec un compte rattaché à une entreprise.
- [ ] Tout va bien : ajoutez `CSRF_ENFORCE=true` au `.env`, puis `pm2 restart pandorabrains.com`.

## En cas de problème

- **Arrêter les agents tout de suite** : admin → ⚙️ Réglages agents → **🛑 Arrêt d'urgence**,
  ou `pm2 stop pandora-agents`. Dernier recours : révoquer la clé sur console.anthropic.com.
- **Le site ne démarre pas** : `pm2 logs pandorabrains.com` dit quelle variable manque.
