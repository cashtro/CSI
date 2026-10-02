# Espace entreprises et console de pilotage

Branche `espace-entreprises`, créée à partir de `security-hardening`.
Rien n'est en ligne tant que vous n'avez pas fusionné, exécuté la migration et redémarré le serveur.

## Ce qui a été construit

### 1. L'espace client : `/espace`

Une entreprise inscrite se connecte comme d'habitude, puis va sur `pandorabrains.com/espace`.
Elle y trouve cinq onglets :

| Onglet | Ce qu'elle voit ou fait |
| --- | --- |
| Aperçu | Total payé, mandats actifs, livrables à approuver, abonnements |
| Mandats | Ses projets, avec une barre d'étapes : Réception → Analyse → Production → Révision → Livraison |
| Livrables | Ce que vos agents ont produit, avec un lien, et les boutons **Approuver** et **Demander une modification** (un commentaire est alors obligatoire) |
| Achats et factures | Ses paiements Stripe déjà enregistrés (table `bills`) : date, type (achat ou abonnement), montant, référence |
| Nouveau mandat | Un formulaire : titre, besoin, budget indicatif, échéance |

Chaque entreprise ne voit **que ses propres données**. Le serveur trouve l'entreprise à partir du compte connecté. Il ne se fie jamais à ce que le navigateur envoie.
Un compte qui n'est rattaché à aucune entreprise voit un message d'attente.

### 2. La console admin : `/admin/console`

C'est votre poste de pilotage, avec un contrôle total :

| Onglet | Ce que vous faites |
| --- | --- |
| Aperçu | Revenus encaissés, nombre d'entreprises, mandats actifs, livrables en attente |
| Entreprises | Créer une entreprise, y rattacher un compte déjà inscrit (par son courriel), retirer un membre |
| Clients | Tous les comptes inscrits et leur entreprise |
| Paiements | Tous les paiements Stripe enregistrés, avec le client et l'entreprise |
| Mandats | Ouvrir un mandat pour un client, faire avancer son étape, changer son statut |
| Livrables | Déposer un livrable pour un client (titre, lien https, agent, description), voir les décisions et les commentaires |
| Contenu du site | Modifier les textes, les images et les offres de la page d'accueil, en français ou en anglais, sans toucher au code |

Les liens « Espace entreprise » et « Console de pilotage » ont été ajoutés en haut des anciens tableaux de bord.

### 3. Le CMS (contenu du site)

- Chaque zone modifiable a une clé, par exemple `home.hero.title`.
- **Tant que vous n'avez rien modifié, le site affiche exactement le même texte qu'avant.** Le rendu de la page d'accueil a été comparé avant et après : il est identique.
- Zones déjà branchées sur la page d'accueil :
  - le grand titre ;
  - les deux lignes du sous-titre ;
  - le bouton « Live Consultation » ;
  - l'image du bandeau ;
  - le titre de la section « Our work » ;
  - les 5 offres (titre et liste de points).
- Les images s'envoient depuis la console. Elles sont stockées dans Supabase Storage (bucket `site-content`). Seules les images JPEG, PNG, WebP, GIF et AVIF sont acceptées, jusqu'à 5 Mo. Les SVG sont refusés.
- Le bouton « Rétablir » remet le texte d'origine.
- Une modification est visible tout de suite sur le serveur où elle a été faite. Si un jour plusieurs serveurs tournent en parallèle, les autres la verront dans les 5 minutes au plus.

### 4. Dictée vocale

Un bouton **Dicter** apparaît sous les grands champs de texte :

- côté client : le besoin du nouveau mandat ;
- côté admin : la description d'un mandat, celle d'un livrable et les textes du CMS.

Vous parlez, et le texte s'ajoute à la suite de ce qui est déjà écrit, sans rien effacer. Pendant l'écoute, le bouton devient orange. Touchez-le de nouveau pour arrêter.

Si le navigateur ne gère pas la dictée, ou si le micro est refusé, un message explique comment utiliser la dictée du clavier :

- touche 🎤 sur téléphone ;
- touche Fn deux fois sur Mac ;
- Windows + H sur Windows.

La dictée vocale du navigateur est surtout fiable dans Chrome, Edge et Safari.

### 5. Sécurité

- **Admin** : le serveur vérifie `Users.isAdmin` avec la clé service à chaque requête. Il exige aussi que ce navigateur ait passé la **double authentification (2FA)**.
  - Après le code 2FA, le serveur pose un cookie signé `mfa`.
  - Un jeton Supabase obtenu sans passer par le code 2FA est refusé.
- **Client** : chaque route vérifie que le compte est membre de l'entreprise. Toutes les lectures et écritures filtrent sur cette entreprise.
- **CSRF** : toutes les actions des deux espaces exigent le jeton CSRF, même si `CSRF_ENFORCE` n'est pas activé.
- **Affichage** : toutes les valeurs sont échappées.
  - Les liens de livrables doivent commencer par `https://`.
  - Les images du CMS doivent être en `https://` ou se trouver sous `assets/`.
- **CSP** : aucun style ni script en ligne. Le CSS est dans `assets/css/pilotage.css`, le JS dans `assets/js/espace.js` et `assets/js/dictee.js`.
- **Pages privées** : elles ne sont jamais mises en cache (`Cache-Control: no-store`) et ne sont pas indexées.
- **Journal** : chaque action importante est notée dans le logger (création, décision, refus d'accès), sans données personnelles.
- **Base de données** : la RLS de Supabase protège aussi les tables si quelqu'un appelle Supabase directement. Un membre ne peut que **lire** les lignes de son entreprise. Toutes les écritures passent par le serveur.

## Comment l'activer

1. **Fusionner** la branche après relecture. `security-hardening` doit déjà être en ligne : cette branche en dépend.
2. **Exécuter la migration** : ouvrez Supabase, puis SQL Editor, collez le contenu de `db/002_espace_entreprises.sql` et cliquez sur Run.
   - Le script crée les tables `entreprises`, `membres`, `mandats`, `livrables` et `site_content`, avec leurs règles RLS.
   - Il crée aussi le bucket public `site-content`.
   - Vous pouvez le relancer sans risque.
3. **Vérifier le `.env` du serveur** :
   ```
   TWOFA_SETUP_KEY=<déjà présent si vous avez suivi DEPLOIEMENT-SECURITE.md>
   # Facultatif :
   SITE_LANG=fr          # langue affichée par défaut aux visiteurs (fr ou en)
   CMS_BUCKET=site-content
   ```
   Sans `TWOFA_SETUP_KEY` (ou `TOTP_ENC_KEY`), la preuve 2FA change à chaque redémarrage. Il faudrait alors se reconnecter après chaque redémarrage.
4. **Redémarrer** :
   ```
   cd innomax-html-package
   npm ci
   npm test
   pm2 restart server.js --name "pandorabrains.com"
   ```
5. **Vous reconnecter avec votre code 2FA** (obligatoire une fois : c'est ce qui pose le cookie `mfa`), puis ouvrir `/admin/console`.
6. **Premier client** :
   - Dans l'onglet Entreprises, créez l'entreprise.
   - Rattachez-y le compte du client. Il doit d'abord s'être inscrit sur le site avec ce courriel.
   - Le client voit alors ses données sur `/espace`.

## Décisions prises (à valider)

- **Une personne appartient à une seule entreprise.** C'est le plus simple et le plus sûr. Pour gérer plusieurs entreprises avec un même compte, il faudra retirer la contrainte `unique` sur `membres.user_id` et ajouter un sélecteur.
- **Les achats d'une entreprise** sont les paiements de tous ses membres (table `bills`). Les paiements faits avant le rattachement apparaissent donc aussi.
- **Le serveur lit avec la clé service** et filtre lui-même par entreprise. La RLS est une deuxième barrière, pas la seule.
- **Les livrables sont des liens** (Google Drive, Dropbox, etc.), pas des fichiers déposés sur le serveur. On évite ainsi d'héberger des PDF ou des fichiers exécutables.
- **Une décision sur un livrable est définitive.** Pour une nouvelle version, déposez un nouveau livrable.
- **Le rattachement d'un compte se fait par courriel exact**, en respectant les majuscules telles qu'elles sont enregistrées dans `Users`.
- **La langue** : les visiteurs voient le français par défaut (`SITE_LANG`), ou l'anglais avec `?lang=en` ou un cookie `lang`. Si une zone n'a pas de texte dans la langue demandée, le texte d'origine du site (actuellement en anglais) s'affiche.
- **Micro** : helmet n'envoie aucune `Permissions-Policy`, et le site n'en avait pas. Les pages `/espace` et `/admin/console` envoient maintenant `microphone=(self), camera=(), geolocation=()`. Le micro n'est donc permis que pour pandorabrains.com, et seulement sur ces pages. Si un proxy (nginx, Cloudflare) ajoute sa propre `Permissions-Policy`, vérifiez qu'il ne bloque pas `microphone`.

## Ce qui reste à faire

- **Test en vrai** : se connecter avec un compte admin (2FA) et un compte client sur un environnement de test Supabase. Les tests automatiques utilisent une fausse base en mémoire.
- **Autres pages** : seule la page d'accueil est branchée sur le CMS. Pour une autre page, il suffit d'appeler `content('cle', 'texte actuel')` dans la vue et d'ajouter la zone dans `REGISTRY` (`routes(api)/utils/cms.js`) pour qu'elle apparaisse dans la console. Les pages TechAi, Marketing et Education sont les prochaines candidates.
- **Notifications par courriel** (SendGrid) : prévenir le client quand un livrable est déposé, et vous prévenir quand un mandat est créé ou qu'une modification est demandée.
- **Invitation de clients** : aujourd'hui, le client doit s'inscrire avant d'être rattaché. Un lien d'invitation serait plus simple pour lui.
- **Factures Stripe en PDF** : la liste montre les paiements enregistrés, sans lien vers la facture Stripe. On pourrait ajouter un lien vers le portail client Stripe.
- **Dépôt de fichiers** pour les livrables : si vous le voulez, il faudra un bucket privé et des liens signés à durée limitée.
- **Historique des modifications du CMS** : seule la dernière version est gardée, avec qui l'a faite et quand.
- **Polices** : elles viennent de Google Fonts. Si la CSP devient bloquante un jour, il faudra garder `fonts.googleapis.com` et `fonts.gstatic.com` dans la liste autorisée (c'est déjà le cas dans `utils/csp.js`).
