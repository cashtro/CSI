# Croissance : SEO, AEO, backlinks, campagnes et presse

Ce document explique, en mots simples, ce qui a été ajouté pour faire connaître PBTM
(Panda Business Tech & Marketing) : le référencement du site public et l'onglet
**📣 Croissance** de la console admin.

**Règle d'or : rien n'est publié ni envoyé automatiquement.** Les agents proposent,
tu relis, puis tu appliques toi-même.

---

## 1. Le site public

### Ce que Google et les moteurs IA voient maintenant

| Adresse | À quoi ça sert |
|---|---|
| `/sitemap.xml` | La liste de toutes les pages publiques, des cours de la base et de `/faq` et `/presse`, avec la date de la dernière modification faite dans le CMS. |
| `/robots.txt` | Dit aux robots où est le sitemap et leur interdit `/admin`, `/espace`, `/api` (et les pages de connexion ou de paiement). |
| `/llms.txt` | Un résumé de PBTM pour les moteurs IA (ChatGPT, Perplexity…) : qui nous sommes, les liens clés, les cours, les réponses courtes. |
| `/faq` | Les questions fréquentes, avec une recherche (`/faq?q=formation`). |
| `/presse` | Le kit média : description, logo officiel, contacts presse. |

### Dans chaque page publique

Le partial `views/partials/seo-head.ejs` remplace l'ancien `<title>` et l'ancienne
description (souvent vides ou celles du gabarit). Il écrit :

- un **titre** et une **description** uniques, en français ;
- l'**adresse canonique**, les balises **Open Graph** (Facebook, LinkedIn) et **Twitter** ;
- les balises **hreflang** fr-CA / en-CA, seulement si une version anglaise existe
  (c'est-à-dire si le titre anglais `seo.<page>.title` est rempli dans le CMS) ;
- les **données structurées JSON-LD** : Organization (PBTM), WebSite avec recherche,
  BreadcrumbList (fil d'Ariane), Course sur les pages de cours, FAQPage quand la page
  a une FAQ.

**Le rendu visible n'a pas changé.** Avec le CMS vide, le `<body>` de chaque page est
identique, octet pour octet, à ce qu'il était avant (un test le vérifie à chaque
`npm test`). Seule la partie invisible `<head>` a changé.

### Modifier les textes SEO

Console → **✏️ Contenu du site**, sections « SEO · … » :

- `seo.<page>.title` : titre (30 à 65 caractères) ;
- `seo.<page>.description` : description (70 à 160 caractères) ;
- `aeo.<page>.reponse` : une réponse courte affichée en tête du bloc FAQ ;
- `faq.<page>` : la FAQ de la page, en JSON : `[{"q": "Question ?", "r": "Réponse."}]` ;
- `faq.generale` : la FAQ générale de `/faq` ;
- « Presse · Kit média » : description, personne-ressource, courriel, téléphone, logo.

Pages : `accueil`, `techai`, `marketing`, `education`, `cours`, `nft`, `tirage`,
`boutique`, `portfolio`, `contact`, `faq`, `presse`.

Quand une FAQ ou une réponse courte est remplie, un bloc « Questions fréquentes »
apparaît au bas de la page (au-dessus du pied de page), avec le style de la page.
Vide : rien n'apparaît.

### Images

Les images sous la première section des vues principales ont reçu
`loading="lazy" decoding="async"` (elles se chargent quand on s'en approche). Les
images des carrousels et bandeaux défilants n'ont pas été touchées, pour ne pas
casser leur animation. Les attributs `width` et `height` n'ont **pas** été ajoutés :
les feuilles de style du gabarit ne garantissent pas `height: auto` partout, et des
images pourraient se déformer.

### Adresse du site

Les liens absolus utilisent `SITE_URL` (ou `APP_URL`) du `.env`, sinon
`https://pandorabrains.com`.

---

## 2. L'onglet 📣 Croissance (console admin)

Réservé à l'admin qui a passé la double authentification. Chaque action envoie le
jeton CSRF. Six sections :

### 📊 Tableau de bord

Score SEO moyen, backlinks obtenus, contenus prévus et publiés cette semaine,
campagnes actives, pages à améliorer, derniers travaux des agents.

### 🔍 SEO

- **Audit automatique** : chaque page publique est rendue comme un visiteur la voit,
  puis vérifiée (titre, description, H1, texte alternatif, canonique, JSON-LD, longueur
  du texte, mots-clés cibles, liens internes cassés). Score sur 100 et corrections
  proposées. L'audit a déjà trouvé de vrais problèmes : pages sans H1 (Éducation,
  Portfolio) et liens vers des pages `.html` du gabarit qui n'existent pas.
- **« Faire corriger par Racine »** : l'agent SEO reçoit l'audit de la page et propose
  un titre, une description et des questions. Sa proposition s'affiche dans la page ;
  tu la modifies si besoin, puis **« Appliquer au CMS »**. Rien ne change sur le site
  avant ce clic.

### 💬 AEO (réponses aux moteurs IA)

1. Liste les questions que les clients posent aux IA (à la main, ou « Suggérer des
   questions » par Racine).
2. « Proposer des réponses » : Racine écrit des réponses courtes (40 à 60 mots).
3. Tu relis et cliques **« Valider la réponse »**.
4. **« Publier dans la FAQ »** l'ajoute à `faq.<page>` dans le CMS : elle apparaît sur
   la page, sur `/faq` et dans le JSON-LD FAQPage. Impossible de publier sans validation.

### 🔗 Backlinks

- Suivi : site, adresse, type (annuaire québécois, média, partenaire, blogue invité,
  balado), statut (idée, contacté, en attente, obtenu, refusé), autorité estimée, date
  de suivi, note.
- **« Trouver des opportunités »** : Racine fait une recherche web (annuaires d'affaires
  du Québec, chambres de commerce, médias tech, balados). Quand c'est terminé,
  **« Ajouter comme idées »** crée une ligne « idée » par source, avec la source notée.
- **Courriel d'approche** : Tribune (agent RP) rédige un brouillon. **La console
  n'envoie aucun courriel.** Tu le copies dans ta messagerie et tu l'envoies toi-même,
  seulement si la LCAP le permet (adresse publiée à des fins professionnelles et
  message lié à la fonction, ou consentement), avec ton identification et une façon de
  refuser d'autres messages.

### 🗓️ Campagnes

- Une campagne : nom, objectif, cible, canaux, budget, dates, KPI visés et réels, statut.
- **Calendrier éditorial** (vue mois, flèches pour changer de mois). Sur téléphone,
  il devient une liste des jours qui ont du contenu.
- **« Générer la campagne »** : un Conseil des agents marketing (ceux des canaux
  choisis + Élan, avec contradicteurs, arbitre et réviseur) délibère. Quand c'est
  terminé, **« Créer les contenus en brouillon »** transforme ses tâches en contenus au
  statut **Idée**, placés dans le calendrier, et garde sa décision dans la campagne.
- La publication reste **manuelle** : publie sur le canal, puis mets le contenu à
  « Publié » (la date est notée).

### 📰 Médias

- **Communiqués** : donne un titre et les faits ; Tribune rédige un brouillon
  (structure de communiqué, « – 30 – », citation à valider). Tu relis, approuves,
  diffuses toi-même.
- **Liste de médias** : nom, contact, courriel, site, sujets et **consentement LCAP**
  (aucun, tacite, exprès).
- **Kit média** : la page `/presse`, modifiable dans « Contenu du site ».

### Export

Chaque liste s'exporte en CSV (lien « Exporter (CSV) »). Réservé à l'admin ; les
cellules qui commencent par `=`, `+`, `-` ou `@` sont neutralisées pour Excel.

### Les agents utilisés

Racine (`marketing-seo`), Tribune (`marketing-rp`), et pour les campagnes : Enchère,
Missive, Blason, Agora, Levier, Élan, Rythme vidéo courte, plus les contradicteurs,
le planificateur, l'arbitre et le réviseur. Si un agent manque, la console demande
d'importer les agents de départ (onglet Réglages agents). Les travaux passent par le
moteur d'agents habituel (budget mensuel, arrêt d'urgence, onglet Travail).

---

## 3. Mise en place

1. Base de données : exécuter **`db/008_croissance.sql`** dans Supabase, **après 007**.
   Ordre : 001, 002, 003, 004, 005, 006 (robots), 007 (finances), puis 008.
   Le fichier peut être relancé sans risque. Les tables ont la RLS activée **sans aucune
   politique** : seul le serveur (clé service) y accède.
2. `.env` : `SITE_URL=https://pandorabrains.com` (facultatif).
3. Redémarrer : `pm2 restart pandorabrains.com`.
4. Vérifier : `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/faq`, `/presse`, puis
   Console → 📣 Croissance.
5. Soumettre `https://pandorabrains.com/sitemap.xml` dans Google Search Console et
   Bing Webmaster Tools.

## 4. Démo locale

```
DEMO_MODE=true node scripts/demo-admin.js
```

Ouvrir `http://127.0.0.1:3999/demo/connexion?vue=croissance`. Données fictives en
mémoire, réponses d'agents simulées (rien n'est appelé ni payé). `/faq`, `/presse`,
`/sitemap.xml`, `/robots.txt` et `/llms.txt` sont servis aussi.

## 5. Fichiers

- `routes(api)/utils/seo-data.js` : pages, titres et descriptions par défaut, FAQ générale, zones CMS.
- `routes(api)/utils/seo.js` : balises SEO, JSON-LD, sitemap, robots, llms.txt.
- `routes(api)/utils/seoAudit.js` : l'audit.
- `routes(api)/utils/croissance.js` : validation, travaux d'agents, imports, données de l'onglet.
- `routes(api)/seoRoutes.js` : routes publiques. `routes(api)/croissanceAdmin.js` : API admin.
- `views/partials/seo-head.ejs`, `aeo-bloc.ejs`, `public-head.ejs`, `public-nav.ejs`, `views/faq.ejs`, `views/presse.ejs`.
- `views/partials/croissance/*.ejs`, `assets/css/croissance.css`, `assets/css/aeo.css`.
- Tests : `test/croissance-seo.test.js`, `test/croissance-admin.test.js`.

## 6. Limites connues

- La page `<html lang>` des anciennes vues est restée telle quelle (`zxx` ou `en`) :
  leur texte est surtout en anglais. Traduire ces pages en français (Loi 96) est la
  prochaine étape ; le titre et la description sont déjà en français.
- Le JSON-LD est un bloc de données (`application/ld+json`), pas un script exécuté.
- Les connexions de publication (réseaux sociaux, infolettre) ne sont pas branchées :
  la publication reste manuelle.
