# Finances : l’argent de PBTM dans la console admin

L’onglet **💰 Finances** de `/admin/console?vue=finances` montre en une page
l’argent de toute l’entreprise : ce qui entre, ce qui sort, ce qui reste, les
taxes à déclarer et les objectifs du mois.

Il est réservé à un **administrateur connecté avec la double authentification
(2FA)**, comme le reste de la console.

## Mise en place (une seule fois)

1. Dans Supabase, ouvrir l’éditeur SQL.
2. Exécuter les migrations **dans l’ordre** : 001, 002, 003, 004, 005, puis
   **006** (`db/006_robots.sql`), puis **`db/007_finances.sql`**, puis 008 (`db/008_croissance.sql`).
   Le fichier 007 crée deux tables : `depenses` et `objectifs_financiers`.
   On peut le relancer sans danger.
3. (Facultatif) Variables d’environnement :
   - `STRIPE_SECRET_KEY` (déjà utilisée pour les paiements) : si elle est
     présente, l’onglet lit aussi Stripe (abonnements et factures) pour un MRR
     exact, les renouvellements et le taux d’annulation. Les données sont
     gardées 5 minutes en mémoire. `FINANCES_STRIPE=false` coupe cette lecture.
   - `FINANCES_USD_CAD` : taux pour convertir le coût IA (en $ US) en $ CA.
     Par défaut : `1.38`. Mettez-le à jour de temps en temps.

Sans Stripe, l’onglet fonctionne quand même avec la table `bills` (chaque
paiement Stripe Checkout reçu par le webhook). Le MRR est alors marqué
**« estimé »**.

## Ce que montre l’onglet

### Indicateurs du mois

| Indicateur | Comment il est calculé |
|---|---|
| Revenus du mois | Ventes payées du mois, **avant taxes**, en $ CA |
| MRR | Total mensuel des abonnements actifs (Stripe), ou estimation : abonnements payés dans les 35 derniers jours |
| Revenus ponctuels | Revenus du mois moins les abonnements |
| Dépenses du mois | Dépenses saisies, avant taxes |
| Coût IA du mois | Coût du moteur des agents (`agent_usage`), converti en $ CA, avec le budget en $ US |
| Marge brute | Revenus − dépenses − coût IA, en $ et en % des revenus |
| Flux de trésorerie | Argent entré (taxes incluses) − argent sorti (taxes incluses + IA) |
| Clients payants | Clients différents ayant payé ce mois (ou abonnés actifs) |
| Revenu moyen par client | Revenus du mois ÷ clients payants |
| Taux d’annulation | Abonnements terminés ce mois ÷ abonnements actifs au début du mois. Affiche « — » sans Stripe |

Les pastilles indiquent l’état : **✅ Bon**, **⚠️ Attention**, **⛔ Critique**.

### Graphiques

- Revenus contre coûts sur 12 mois (barres).
- MRR sur 12 mois (courbe).
- Répartition des coûts du mois par catégorie.
- Progression vers l’objectif du mois.

Survolez un mois (ou passez dessus au clavier avec Tab) pour lire ses chiffres.
Sous chaque graphique, « Voir les données » affiche le tableau des valeurs.

### Alertes

- **Marge sous l’objectif** : attention, critique à 10 points d’écart ou plus,
  ou si la marge est négative.
- **Coût IA au-dessus de 80 % du budget** du moteur (critique à 100 %).
- **Dépense inhabituelle** : plus de 3 fois la médiane de sa catégorie sur
  les 12 derniers mois (ou plus de 2 000 $ s’il n’y a pas encore d’historique).

### Objectifs mensuels

Pour chaque mois : un revenu visé (avant taxes) et une marge visée (en %).
Le tableau montre l’écart en $ et en points. Enregistrer un objectif pour un
mois qui en a déjà un le remplace.

### Période, tableaux et exports CSV

Choisissez une période (raccourcis : ce mois, mois dernier, trimestre, année,
12 derniers mois, ou deux dates). Elle s’applique aux tableaux **Revenus**,
**Dépenses**, **Factures**, au résumé des **taxes** et aux exports.

Chaque tableau a un bouton **⬇️ CSV**. Le fichier s’ouvre dans Excel ou Google
Sheets. Par sécurité, un texte qui commence par `=`, `+`, `-` ou `@` est
précédé d’une apostrophe : le tableur ne l’exécutera jamais comme une formule.

### Dépenses

« ➕ Ajouter une dépense » : date, catégorie (outils, IA, publicité,
sous-traitance, salaires, autres), fournisseur, montant **avant taxes**, TPS et
TVQ payées, récurrente ou non, lien https vers la pièce jointe (facture dans
Drive, Dropbox…), note.

- Cochez « Calculer la TPS et la TVQ » pour que le serveur les calcule
  (5 % et 9,975 % du montant).
- Un fournisseur étranger qui ne facture pas de taxes : laissez TPS et TVQ à 0.
- Le coût du **moteur des agents** est compté automatiquement : n’ajoutez pas
  sa facture Anthropic en dépense, sinon il sera compté deux fois. La catégorie
  « IA » sert aux autres abonnements IA.
- « Récurrente » est un repère : chaque mois, saisissez la dépense du mois.

Chaque ligne a « Modifier » et « Supprimer ».

## Taxes du Québec

Le résumé donne, pour la période choisie :

- la TPS (5 %) et la TVQ (9,975 %) **perçues** sur les ventes (lues dans Stripe) ;
- la TPS et la TVQ **payées** sur les dépenses (crédits CTI et RTI) ;
- le **net à remettre** (ou le remboursement si négatif).

Il signale aussi les ventes où Stripe n’a calculé aucune taxe, les autres
taxes (TVH d’une autre province) et les ventes dans une autre devise.

> **À valider par ton comptable.** Ce résumé aide à préparer la déclaration.
> Il ne remplace pas l’avis d’un professionnel (petit fournisseur, méthode
> rapide, règles particulières, etc.).

## Sécurité

- Accès : administrateur + 2FA, sur la page comme sur l’API
  `/api/admin/finances`.
- Toute modification (dépense, objectif) exige le jeton CSRF.
- Les revenus ne sont **jamais** envoyés par le navigateur : le serveur les
  calcule à partir de `bills`, de Stripe et des tables de la base.
- Les tables `depenses` et `objectifs_financiers` ont la RLS activée sans
  aucune règle pour le navigateur : seule la clé service du serveur y accède.
- Les textes sont échappés, la page n’a ni script ni style en ligne ; les
  graphiques sont dessinés par `assets/js/finances.js`.

## Démo locale

```
cd innomax-html-package
DEMO_MODE=true node scripts/demo-admin.js
```

Puis ouvrir `http://127.0.0.1:3999/demo/connexion?vue=finances`.
Les données sont fictives et marquées « exemple » (clients `@exemple.demo`,
fournisseurs « (exemple) »). Elles vivent en mémoire et disparaissent à l’arrêt.

## Fichiers

- `db/007_finances.sql` : tables et RLS.
- `innomax-html-package/routes(api)/utils/finances.js` : tous les calculs.
- `innomax-html-package/routes(api)/utils/finances-stripe.js` : lecture Stripe (facultative).
- `innomax-html-package/routes(api)/financesAdmin.js` : API (dépenses, objectifs, export, résumé).
- `innomax-html-package/views/partials/finances/` : la page.
- `innomax-html-package/assets/css/finances.css`, `assets/js/finances.js` : style et graphiques.
- `innomax-html-package/scripts/demo/finances-data.js` : données d’exemple.
- Tests : `test/finances-calc.test.js`, `test/finances-routes.test.js`.
