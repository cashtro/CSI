# L'app PBTM (PWA)

PBTM s'installe comme une vraie app, sur le téléphone ou sur l'ordinateur, sans passer par
l'App Store ni Google Play. Une seule app, deux sections :

- **🛍️ Vitrine** : le site public pour vendre (accueil, robots, formations, boutique). Tout le
  monde la voit.
- **🎛️ Mon cockpit** : vos activités à vous (agents, ventes, finances, croissance). Seul
  l'admin connecté avec la 2FA le voit.

En haut de l'écran, un sélecteur passe de l'une à l'autre. L'admin voit « Vitrine » et
« Mon cockpit », un client voit « Vitrine » et « Mon espace », un visiteur ne voit que la vitrine.
Sur téléphone et dans l'app installée, une barre d'onglets en bas donne les écrans principaux.

---

## 1. Installer l'app

### iPhone ou iPad (Safari)

1. Ouvrez `https://pandorabrains.com` dans **Safari** (pas Chrome : sur iPhone, seul Safari installe).
2. Touchez **Partager** (le carré avec une flèche vers le haut).
3. Choisissez **Sur l'écran d'accueil**, puis **Ajouter**.

L'icône du panda PBTM apparaît avec vos apps. Le bouton « 📲 Installer l'app PBTM » du site
ouvre ce mode d'emploi.

### Android (Chrome, Edge, Samsung Internet)

1. Ouvrez `https://pandorabrains.com`.
2. Touchez **📲 Installer l'app PBTM** en haut de la page (ou le menu ⋮ → **Installer l'application**).
3. Confirmez. L'app s'ouvre en plein écran, sans barre d'adresse.

### Ordinateur (Chrome ou Edge, Windows, Mac, Linux)

1. Ouvrez `https://pandorabrains.com`.
2. Cliquez **📲 Installer l'app PBTM**, ou l'icône d'installation au bout de la barre d'adresse.
3. PBTM s'ouvre dans sa propre fenêtre. Un clic droit sur l'icône donne les raccourcis
   **⚡ Activer un robot**, **🎛️ Mon cockpit**, **🤖 Agents** et **💰 Finances**.

Le bouton d'installation disparaît quand l'app est déjà installée.

---

## 2. Ce qui marche hors ligne

| Situation | Ce que vous voyez |
| --- | --- |
| Une page de la vitrine déjà ouverte (accueil, robots, FAQ…) | La dernière version gardée sur l'appareil. |
| Une page publique jamais ouverte | La page « Vous êtes hors ligne », avec le bouton **Réessayer**. |
| Le cockpit, votre espace, les paiements, la connexion | La page **Connexion requise**. |

**Règle de sécurité** : les pages privées (`/admin`, `/espace`, `/connexions`, `/api`,
`/robots/merci`, la démo) ne sont **jamais** gardées sur l'appareil. Hors ligne, personne ne peut
y lire vos chiffres, même avec votre téléphone en main. À la déconnexion, l'app efface aussi les
copies des pages publiques.

Quand une nouvelle version est mise en ligne, l'app affiche « **Nouvelle version de PBTM
disponible** » avec le bouton **Mettre à jour**. Rien ne change tant que vous n'avez pas touché le
bouton.

---

## 3. Les notifications

### Ce que vous recevez

- **Admin** : un livrable de robot est à valider ; un robot vient d'être activé (nouveau client
  payant) ; le Conseil a atteint le consensus ; une alerte finance critique se déclenche (une seule
  fois par alerte et par mois).
- **Client** : un nouveau livrable est prêt pour son entreprise.

Les notifications ne contiennent qu'un titre court, jamais le contenu d'un livrable.

### Les activer sur un appareil

- **Admin** : cockpit → écran **🔔 Mon attention** → panneau **Notifications** → **Activer sur cet appareil**.
- **Client** : **Mon espace** → **Aperçu** → panneau **Notifications**.

Sur iPhone, installez d'abord l'app (section 1) : Apple n'envoie les notifications qu'aux apps
installées (iOS 16.4 et plus).

### Les clés VAPID (une seule fois, sur le serveur)

Sans ces trois variables, les notifications sont **désactivées** : rien n'est envoyé, et le
panneau Notifications l'explique.

1. Sur le serveur, dans `innomax-html-package` :

   ```
   npm run pwa:vapid
   ```

   La commande affiche trois lignes (`VAPID_PUBLIC_KEY=…`, `VAPID_PRIVATE_KEY=…`, `VAPID_SUBJECT=…`).
   Elle équivaut à `npx web-push generate-vapid-keys`.
2. Copiez-les dans le `.env` du serveur. Remplacez l'adresse de `VAPID_SUBJECT` par la vôtre
   (`mailto:…`) : les services de push s'en servent pour vous joindre en cas de problème.
3. Exécutez `db/009_pwa.sql` dans Supabase (après 008), puis `pm2 restart pandorabrains.com`.

| Variable | À quoi elle sert |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Clé publique, donnée aux navigateurs. |
| `VAPID_PRIVATE_KEY` | Clé privée : signe chaque envoi. **Secrète**, à garder dans le gestionnaire de mots de passe. |
| `VAPID_SUBJECT` | `mailto:votre@adresse` (ou une adresse `https://`). |

**Ne changez pas ces clés** : tous les abonnements existants cesseraient de fonctionner, et chaque
appareil devrait réactiver les notifications.

### Comment c'est fait (pour l'équipe technique)

- La librairie `web-push` n'est pas installée. `routes(api)/utils/webpush.js` fait le minimum avec
  le module `crypto` de Node : le jeton VAPID (JWT ES256, RFC 8292) et le chiffrement du message
  (`aes128gcm`, RFC 8291). Les tests vérifient le vecteur officiel de la RFC 8291, un aller-retour
  de déchiffrement et la signature du jeton.
- Le serveur n'envoie qu'aux services de push des navigateurs (Google, Mozilla, Apple, Microsoft),
  en `https` : une adresse d'abonnement ne peut pas viser un autre serveur.
- Les abonnements sont dans `public.push_abonnements` (`db/009_pwa.sql`) : RLS activée, aucune
  politique, seul le serveur y accède. Le rôle (admin ou client) est décidé par le serveur, jamais
  par le navigateur. Un abonnement expiré (réponse 404 ou 410) est effacé.
- Routes : `GET /api/push/etat`, `POST /api/push/abonnement`, `POST /api/push/desabonnement`,
  `POST /api/push/test` (connexion et jeton CSRF obligatoires).

---

## 4. Les fichiers de l'app

| Fichier | Rôle |
| --- | --- |
| `routes(api)/pwaRoutes.js` | `/manifest.webmanifest`, `/sw.js`, `/hors-ligne`, `/connexion-requise`, routes push, rôle du visiteur. |
| `routes(api)/utils/pwa.js` | Manifeste, couleurs lues dans le BLOC MARQUE de `pilotage.css`, assemblage et version du service worker. |
| `assets/js/pwa/sw-regles.js` | Les règles de cache (testées par jest) : ce qui est privé, ce qui peut être gardé. |
| `assets/js/pwa/sw-corps.js` | Le service worker : coquille, réseau d'abord pour les pages, copie puis mise à jour pour les fichiers. |
| `assets/js/pwa/pwa.js` | Enregistrement, toast de mise à jour, bouton d'installation, aide iOS, notifications, bouton ⚡. |
| `assets/css/pwa.css`, `assets/css/vitrine.css` | Couches de l'app et de la vitrine (jetons du BLOC MARQUE seulement). |
| `views/accueil.ejs` | La nouvelle page d'accueil sur `/` (l'ancienne reste sur `/ancien-accueil`, non indexée). |
| `scripts/pwa-icones.js` | Régénère les icônes et les captures du manifeste. |

La **version** du service worker est une empreinte de ses fichiers et de la coquille : un
déploiement qui change un CSS ou un JS de la coquille propose automatiquement la mise à jour.

### Changer le logo

Les icônes partent du panda **provisoire** `assets/img/pwa/panda-source.svg`. Le jour où le logo
final est choisi :

```
cp nouveau-logo.svg assets/img/pwa/panda-source.svg
PLAYWRIGHT=/chemin/vers/node_modules/playwright npm run pwa:icones
```

Avec `CAPTURES_URL=http://127.0.0.1:3999` (la démo lancée), le script refait aussi les captures
d'écran du manifeste. L'icône « maskable » garde le panda dans le cercle de sécurité (rayon 40 %),
pour qu'Android puisse la découper en rond ou en goutte sans couper les oreilles.

---

## 5. Les textes de la vitrine

Les textes de la nouvelle accueil sont modifiables dans le cockpit : **✏️ Contenu du site** →
sections « Accueil PBTM · … ». Une zone vide affiche le texte prévu. Les témoignages et les œuvres
NFT portent l'étiquette **Exemple** : remplacez-les par de vrais témoignages (avec l'accord écrit
du client) avant de retirer l'étiquette.

La galerie NFT présente des **objets de collection**, sans promesse de rendement ni de revente.
N'ajoutez jamais de chiffres de gains : la vente d'un actif présenté comme un placement relève
des règles des valeurs mobilières (Autorité des marchés financiers).

---

## 6. Concours et tirages : conformité

L'accueil n'a **aucun tirage payant**. L'emplacement « 🎁 Concours (bientôt) » annonce un concours
**gratuit, sans achat requis**, et rien ne s'y vend.

Pourquoi :

- **Code criminel** (art. 206) : une loterie où l'on paie une chance de gagner un prix est
  interdite, sauf si elle est mise sur pied par une province ou par un organisme qui détient une
  licence (organisme de bienfaisance ou religieux, par exemple). Une entreprise comme PBTM ne peut
  pas vendre de billets de tirage.
- **Québec, RACJ** (Régie des alcools, des courses et des jeux) : un **concours publicitaire**
  ouvert à des résidents du Québec doit respecter la *Loi sur les loteries, les concours
  publicitaires et les appareils d'amusement* et ses règles : règlement publié (prix, date, mode
  d'attribution, moyen de participer sans achat), déclaration à la Régie et paiement des droits
  avant le début lorsque la valeur des prix dépasse le seuil prévu (100 $ au moment d'écrire ces
  lignes, à vérifier auprès de la RACJ), et une **question d'habileté** pour le gagnant.
- Les anciennes pages `/luckydraw` et l'achat de billets restent dans le code de l'ancien gabarit :
  à faire valider par un avocat avant toute mise en avant, ou à retirer.

Avant de lancer un concours : faire relire le règlement par un juriste, le déclarer à la RACJ si
nécessaire, puis seulement remplacer l'emplacement « bientôt » par le concours.

---

## 7. Vérifier l'app (équipe technique)

- Tests : `NODE_ENV=test npm test` (fichier `test/pwa.test.js` : manifeste, `/sw.js`, règles du
  service worker, service worker exécuté dans un bac à sable, pages hors ligne, accueil,
  sélecteur, cockpit, routes et envoi push).
- Démo locale : `DEMO_MODE=true node scripts/demo-admin.js`, puis `http://127.0.0.1:3999/`
  (vitrine), `/demo/connexion` (cockpit admin) et `/demo/client` (espace client). La démo n'a pas
  de clés VAPID : le panneau Notifications y montre l'état « désactivé ».
- Le service worker ne s'installe qu'en `https` ou sur `localhost` / `127.0.0.1`.
