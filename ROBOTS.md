# Robots clients

Ce guide explique les **robots** : des offres d'agents IA que vos clients paient chaque mois pour
qu'ils travaillent pour eux. Branche `robots-clients`, créée à partir de `plateforme`.

## 1. Ce que c'est

Un robot est une petite équipe d'agents du moteur (`MOTEUR-AGENTS.md`), vendue comme un abonnement.

Le parcours du client :

1. Il visite **`/robots`**, la vitrine publique (aucune connexion requise). Il voit les robots, leurs
   prix, « Comment ça marche », les garanties et la FAQ.
2. Il clique **« ⚡ Activer ce robot »**. S'il n'est pas connecté, il passe par la connexion ou
   l'inscription, puis il revient sur la page d'activation.
3. S'il n'a pas encore d'entreprise, il en donne le nom. Son espace est alors créé, et il en est le
   propriétaire.
4. Il paie sur la page sécurisée de Stripe (abonnement mensuel, plus les frais de mise en place).
5. Dans **`/espace` → 🤖 Mes robots**, il voit ses robots, leur statut, son quota du mois et ce
   que chaque robot a fait. Il clique **« Donner une tâche »**, à l'écrit ou au micro 🎤.
6. Le moteur fait la tâche. Le résultat devient un **livrable à valider par PBTM**, et le client
   ne le voit pas encore.
7. Un admin le relit (et le corrige au besoin) dans **`/admin/console` → ⚡ Robots**, puis il clique
   « Publier pour le client » ou « Refuser ».
8. Une fois publié, le livrable apparaît dans **Livrables**. Le client l'approuve ou demande une
   modification. **Rien ne part sans validation humaine.**

Le client peut aussi **mettre en pause**, **réactiver** ou **annuler** un robot, et ouvrir le
**portail de facturation** de Stripe (carte, factures). Il le fait dans **🔌 Connecter mes outils** :
c'est là qu'il relie ses outils (Google, Microsoft 365, Facebook et Instagram, HubSpot, Shopify,
son site).

Qui peut faire quoi dans une entreprise :

| Action | Propriétaire | Membre |
| --- | --- | --- |
| Activer un robot, pause, annulation, facturation | ✅ | ❌ |
| Connecter ou retirer un outil | ✅ | ❌ |
| Donner une tâche, écrire les consignes permanentes | ✅ | ✅ |

## 2. Les 6 robots de départ (prix : ESTIMATION)

Les prix ci-dessous sont des **estimations** pour le lancement, en dollars canadiens, taxes en sus.
**Fixez vos vrais prix** dans l'onglet Robots avant la mise en ligne.

| Robot | Prix / mois | Mise en place | Tâches / mois | Agents (le premier travaille) |
| --- | --- | --- | --- | --- |
| 🧾 Réceptionniste IA | 349 $ | 499 $ | 200 | marketing-courriel, ventes-strategie |
| ✍️ Rédacteur de contenu | 299 $ | 299 $ | 30 | contenu-strategie, contenu-redaction, contenu-social, marketing-courriel |
| 📈 Agent SEO et AEO | 399 $ | 499 $ | 20 | marketing-seo, contenu-strategie, web-architecte |
| 🤝 Prospecteur de ventes | 449 $ | 499 $ | 40 | ventes-strategie, marketing-growth, contenu-redaction |
| 🧭 Le Conseil | 599 $ | 0 $ | 8 décisions | conseil-*, contra-diable, contra-client, revue-arbitre, revue-qualite |
| 🎬 Studio vidéo courte | 499 $ | 299 $ | 12 | marketing-video-courte, contenu-video, studio-video |

Ordre de grandeur du coût IA (**estimation**, voir la section 3 de `MOTEUR-AGENTS.md`) : une tâche
simple coûte environ 0,03 $, et une décision du Conseil entre 0,25 $ et 1 $. Le budget mensuel du
moteur s'applique à tous les robots.

Les emplacements de témoignages de `/robots` sont **marqués « Exemple »**. Remplacez-les par de vrais
témoignages (avec la permission écrite des clients) dans `views/robots.ejs`, ou retirez-les.

## 3. Mise en route

1. **SQL** : dans l'éditeur SQL de Supabase, exécutez `db/006_robots.sql` **après** 001 à 005. Le
   fichier peut être relancé sans danger. Il crée les tables, les règles RLS et les 6 robots de
   départ.
2. **Stripe** : voir la section 5.
3. **`.env`** : voir la section 7. `TOTP_ENC_KEY` est obligatoire pour connecter des outils.
4. **Moteur** : il doit tourner (`MOTEUR-AGENTS.md`, section 2) pour que les tâches soient faites.
   Éteint, les tâches restent en file.
5. Redémarrez le site (`pm2 restart`), puis visitez `/robots`.

## 4. Ajouter ou modifier un robot

Tout se fait dans **`/admin/console` → ⚡ Robots** (admin + code 2FA), sans toucher au code.

- **Nouveau robot** (en bas de l'onglet) :
  - l'**identifiant** apparaît dans l'adresse (`/robots/<identifiant>/activer`) : il ne change plus ;
  - le **nom**, l'**emoji**, l'**accroche** ;
  - **ce qu'il fait** : une ligne par point ;
  - **pour qui** ;
  - le **prix mensuel**, la **mise en place** et les **tâches par mois** ;
  - le **price id Stripe**, qui est facultatif ;
  - le **mode** : *Ordre* (le premier agent fait la tâche) ou *Conseil* (débat entre les agents) ;
  - les **agents** : leurs ids, séparés par des virgules (liste dans l'onglet 🤖 Agents) ;
  - les **équipes**.
- **Modifier** : cliquez un robot du catalogue, changez les champs, puis cliquez « Enregistrer ».
- **Masquer** : décochez « Visible sur /robots ». Le robot disparaît de la vitrine. Les clients déjà
  abonnés le gardent.
- **Ordonner** : le champ « Ordre d'affichage » (les petits nombres en premier).
- **🌱 Ajouter les 6 robots de départ manquants** : remet ceux qui manquent, sans toucher aux autres.

Un changement de prix touche seulement les **nouveaux** abonnements. Si vous utilisez un price id,
créez un nouveau prix dans Stripe et collez son id. Les abonnements en cours ne bougent pas.

Pour le mode Conseil, les agents `contra-*` sont les contradicteurs, le premier `revue-*` est
l'arbitre et le second est le réviseur. Les autres agents proposent.

## 5. Stripe

**Paiement.** « Activer » crée une session Stripe Checkout en mode **abonnement** :
- avec le **price id** du robot s'il existe, sinon avec le prix mensuel du catalogue (`price_data`,
  mensuel, en $ CA) ;
- avec les frais de mise en place ajoutés à la première facture ;
- avec `type=robot`, `entreprise_id`, `robot` et `user_id` dans les **metadata**, écrits par le
  serveur sur la session et sur l'abonnement.

**Livraison du robot**, une seule fois (registre `fulfillments`, comme les autres achats), par :
- le webhook signé `checkout.session.completed`, ou
- la page de retour `/robots/merci` (le serveur relit la session chez Stripe).

Le premier des deux qui arrive crée la ligne `robots_actifs`. L'autre ne fait rien.

**Webhook.** Dans Stripe → Developers → Webhooks, l'adresse `https://<votre-site>/webhook` doit
recevoir ces événements :
- `checkout.session.completed` et `checkout.session.async_payment_succeeded` (déjà en place) ;
- **`customer.subscription.updated`** : met le robot en pause (pause de facturation, paiement en
  retard) ou le réactive, et note une annulation prévue en fin de période ;
- **`customer.subscription.deleted`** : annule le robot.

Chaque événement est appliqué une seule fois. Un événement plus ancien que le dernier appliqué est
ignoré, et un robot annulé ne revient jamais.

**Portail client.** Dans Stripe → Settings → Billing → Customer portal :
- activez le portail ;
- permettez l'**annulation** (en fin de période, recommandé) et l'accès aux factures.

Le bouton « Annuler » ouvre le portail directement sur l'annulation du robot. Le portail de Stripe ne
sait pas mettre en pause : « Mettre en pause » utilise donc la pause de facturation de Stripe
(`pause_collection`, factures annulées pendant la pause), et « Réactiver » la retire.

**Tester.** Avec une clé `sk_test_...`, faites un abonnement avec la carte 4242 4242 4242 4242, puis
mettez-le en pause, réactivez-le et annulez-le. Vérifiez chaque fois le statut dans « Mes robots » et
dans l'onglet admin. Les tests automatiques n'ont besoin d'aucune clé : Stripe y est simulé.

## 6. Connecter les outils (OAuth)

Page **`/espace?vue=connexions`**. Pour chaque outil, le client voit à quoi il sert, les
**permissions demandées** en français, et l'état de la connexion :
- Non connecté ;
- 📨 Demande envoyée ;
- ✅ Connecté ;
- ⚠️ Erreur.

Il doit **cocher le consentement** avant de connecter (Loi 25). Il peut **retirer l'autorisation**
en tout temps : la ligne et les accès enregistrés sont alors effacés. Pour Google, le jeton est aussi
révoqué chez Google.

**Fonctionnement :**

- `POST /connexions/<outil>/debut` : consentement, puis création d'un **state** à usage unique
  (10 minutes, lié au compte et au navigateur par un témoin httpOnly) et du **PKCE** (S256), quand
  le fournisseur le permet (Google, Microsoft). Le serveur renvoie l'adresse du fournisseur.
- `GET /connexions/<outil>/retour` : le state doit exister, ne pas être expiré, appartenir à ce
  compte et correspondre au témoin. Il est effacé dès sa lecture. Le serveur échange ensuite le code
  contre les jetons, directement avec le fournisseur.
- **Les jetons sont chiffrés** (AES-256-GCM, avec la même clé `TOTP_ENC_KEY` que les secrets 2FA).
  Sans cette clé, rien n'est enregistré. Ils ne sont **jamais renvoyés au navigateur ni écrits dans
  les journaux**. La base refuse même un jeton qui ne serait pas chiffré.
- **Outil pas encore configuré** (ses variables d'environnement sont absentes) : le clic enregistre
  une **« demande envoyée à l'équipe PBTM »**. Vous la voyez dans l'onglet ⚡ Robots (« Connexions
  des clients ») et vous la traitez à la main avec le client.
- **Votre site web** : le client donne l'adresse (https) et une clé (par exemple un mot de passe
  d'application WordPress). La clé est chiffrée, puis plus jamais affichée.

**Activer un fournisseur.** Créez l'application OAuth chez lui, avec cette adresse de retour :
`https://<votre-site>/connexions/<outil>/retour`. Mettez ensuite ses deux variables dans le `.env`
(section 7), puis redémarrez le site.

| Outil (`<outil>`) | Où créer l'application | Remarques |
| --- | --- | --- |
| Google Business Profile (`google_business`) | Google Cloud Console → Identifiants | API Business Profile, accès à demander à Google |
| Gmail et Google Agenda (`google_workspace`) | Google Cloud Console (même application) | Les permissions Gmail exigent la vérification de Google |
| Microsoft 365 (`microsoft365`) | Azure → App registrations | Comptes de toute organisation |
| Facebook et Instagram (`meta`) | developers.facebook.com | Revue d'application Meta pour les permissions de publication |
| HubSpot (`hubspot`) | developers.hubspot.com → Apps | |
| Shopify (`shopify`) | Shopify Partners → Apps | Le client donne l'adresse `ma-boutique.myshopify.com` |

**Important.** Le cadre enregistre les accès. **Aucun robot ne s'en sert encore automatiquement** :
le moteur n'a toujours aucun outil d'action (`MOTEUR-AGENTS.md`). Brancher un outil sur un robot, par
exemple pour lire les avis Google, est un chantier à part, à faire outil par outil. Il gardera la même
règle : rien ne part sans validation humaine.

## 7. Variables d'environnement

| Variable | Rôle | Obligatoire |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Paiements (déjà en place) | Oui |
| `STRIPE_WEBHOOK_SECRET` | Webhook signé (déjà en place) | Oui |
| `APP_URL` | Adresses de retour Stripe et OAuth, ex. `https://pandorabrains.com` | Oui |
| `TOTP_ENC_KEY` | Chiffrement des jetons des outils (et 2FA) | Oui, pour connecter un outil |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Business Profile, Gmail, Agenda | Non |
| `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` | Microsoft 365 | Non |
| `META_APP_ID`, `META_APP_SECRET` | Facebook et Instagram | Non |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | HubSpot | Non |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Shopify | Non |

Sans les variables d'un fournisseur, ses connexions passent par une demande à l'équipe PBTM.

**Ne changez jamais `TOTP_ENC_KEY`** une fois en place : les jetons enregistrés (et les secrets 2FA)
deviendraient illisibles.

## 8. Sécurité, en bref

- Un client ne voit et ne touche **que son entreprise** : le serveur la trouve à partir du compte
  connecté et ne se fie jamais au navigateur. Les règles RLS de 006 sont le deuxième mur.
- Le texte que le client écrit dans une tâche est transmis aux agents comme une **donnée**, jamais
  comme une consigne : « ignore tes règles » ne change rien.
- Le résultat brut d'un robot n'est jamais servi au client. Seul le livrable publié par PBTM l'est.
- Toutes les écritures exigent le jeton CSRF. Les routes admin exigent un compte admin qui a passé
  le code 2FA.
- Limites de débit :
  - activations : 10 par 10 minutes ;
  - tâches : 10 par minute ;
  - connexions : 20 par 10 minutes.
- Les pages n'ont aucun script ni style en ligne, et tout le texte est échappé.

## 9. Essayer en local (démo)

```
cd innomax-html-package
DEMO_MODE=true node scripts/demo-admin.js
```

Puis ouvrez une de ces adresses :

- `http://127.0.0.1:3999/robots` : la vitrine ;
- `http://127.0.0.1:3999/demo/client` : vous êtes la propriétaire de la clinique de démo, avec deux
  robots, des tâches, des livrables et des connexions ;
- `http://127.0.0.1:3999/demo/connexion` : vous êtes l'admin. Voyez l'onglet ⚡ Robots.

Dans la démo, Stripe est **simulé** : « Activer et payer » revient directement en « payé », sans rien
facturer. Les tâches sont faites par la fausse API Anthropic de la démo.

## Limites connues

- **Le quota** compte les tâches en file, en cours ou terminées depuis le 1er du mois. Deux tâches
  envoyées à la même seconde peuvent dépasser le quota d'une tâche. La limite de débit réduit ce
  risque.
- **Les prix** du catalogue sont des estimations à fixer. Le revenu mensuel récurrent de l'admin
  multiplie les robots actifs par le prix **actuel** du catalogue : ce n'est pas le montant facturé
  par Stripe (coupons, anciens prix).
- **Deux paiements pour le même robot** (deux onglets) donnent une seule ligne active, mais deux
  abonnements Stripe : le journal le signale. Annulez le second dans Stripe.
- **Shopify** : le state protège le retour, mais la signature HMAC de Shopify n'est pas encore
  vérifiée.
- **Le rafraîchissement des jetons** expirés n'est pas encore écrit. Il viendra avec le premier robot
  qui utilise un outil.
