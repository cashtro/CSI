# Moteur des agents IA

Ce guide explique le moteur qui fait travailler les agents IA de Pandora sur le serveur,
24 heures sur 24, au lieu de la routine Claude horaire de l'artifact.

**Il est livré éteint.** Rien ne se passe tant que vous n'avez pas fait les étapes
d'activation ci-dessous. Même allumé, il ne coûte rien tant qu'aucun travail n'est en file.

## 1. Ce que fait le moteur

- Il lit une **file de travaux** (table `agent_jobs`) et les traite un par un.
- Trois sortes de travaux :
  - **Ordre simple** : un agent (son rôle et sa méthode) exécute une instruction, pour un client
    ou non. Le résultat est un texte.
  - **Recherche web** : un agent répond à une question en lisant le web (outil de recherche
    d'Anthropic) ; le résultat est une synthèse en français et la liste des sources (section 8).
  - **Conseil** : plusieurs agents débattent selon le protocole de l'artifact :
    1. un planificateur prépare les questions, les critères et les tâches ;
    2. jusqu'à 6 proposeurs donnent chacun leur position, sans voir celle des autres ;
    3. jusqu'à 3 contradicteurs cherchent les failles (gravité de 1 à 5) ;
    4. les proposeurs révisent leur position ;
    5. un arbitre rédige une proposition commune et tout le monde vote. Le Conseil s'arrête
       dès que l'accord atteint 70 % (accord = confiance des « pour » ÷ confiance totale).
       Sinon, il refait un tour, au maximum 3 tours, et l'arbitre doit répondre aux raisons des « contre » ;
    6. un réviseur rend la décision finale, le plan, les risques et les points à valider ;
    7. les tâches finales sont ajoutées à la liste des tâches (table `agent_tasks`) avec le statut
       « à valider ».
- La progression est enregistrée après chaque étape : vous voyez le Conseil avancer.

**Ce que le moteur ne fait jamais.** Il n'a aucun outil d'action : son seul outil est la recherche
web, en lecture seule, exécutée chez Anthropic. Il n'envoie aucun courriel,
ne publie rien, ne paie rien et ne contacte personne. Il écrit du texte, que vous ou votre équipe
relisez et validez avant toute utilisation.

**Règles données aux agents.** Contexte de Pandora, français (Loi 96), protection des renseignements
personnels (Loi 25), consentement pour les messages commerciaux (LCAP), et interdiction d'inventer des
chiffres : une donnée manquante est marquée « [à vérifier] ».

**Données des clients.** Tout ce qui vient d'un client (ou d'un autre agent) est encadré comme des
*données à analyser*, jamais comme des instructions. Un client qui écrirait « ignore tes règles »
dans ses notes ne change pas le comportement des agents.

## 2. Activer le moteur

Faites les étapes dans l'ordre.

### a) Créer les tables dans Supabase

Ouvrez l'éditeur SQL de Supabase et exécutez les fichiers **dans cet ordre, obligatoirement** :
`db/001_fulfillments.sql`, puis `db/002_espace_entreprises.sql`, puis `db/003_moteur_agents.sql`,
puis `db/004_protection_comptes.sql` (protection des comptes, audit), puis
`db/005_recherche_agents.sql` (recherche web des agents), puis `db/006_robots.sql` (robots clients, voir `ROBOTS.md`).
Chaque fichier peut être exécuté plusieurs fois sans danger.

003 ajoute une règle qui permet à un membre (table `membres` de 002) de lire l'état des travaux de
son entreprise, sans le contenu, le coût ni le débat interne. Si 003 a été exécuté avant 002, la
règle est sautée : relancez 003.

### b) Compléter le `.env` du serveur

```
ANTHROPIC_API_KEY=sk-ant-...      # clé créée sur console.anthropic.com
AGENTS_ENABLED=true               # interrupteur du serveur (absent ou autre valeur = éteint)

# Facultatif : choix des modèles par niveau (valeurs par défaut ci-dessous)
AGENTS_MODEL_QUICK=claude-haiku-4-5-20251001
AGENTS_MODEL_DEFAULT=claude-sonnet-5-5
AGENTS_MODEL_COMPLEX=claude-opus-5-5
```

Autres réglages facultatifs, pour plus tard :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AGENTS_PRICES_JSON` | Prix par million de jetons, ex. `{"claude-opus-5-5":{"in":4,"out":20}}` | voir section 3 |
| `AGENTS_LLM_TIMEOUT_MS` | Délai maximal d'un appel | 180000 (3 min) |
| `AGENTS_LLM_MAX_RETRIES` | Nouvelles tentatives sur erreur temporaire | 4 |
| `AGENTS_BREAKER_THRESHOLD` / `AGENTS_BREAKER_COOLDOWN_MS` | Pause automatique après N échecs de suite | 5 / 60000 |
| `AGENTS_MAX_TOKENS_QUICK` / `_DEFAULT` / `_COMPLEX` | Longueur maximale d'une réponse | 2048 / 8192 / 16000 |
| `AGENTS_REFUSAL_FALLBACK` | `false` désactive le repli automatique d'Anthropic quand un modèle refuse une demande | activé |
| `AGENTS_POLL_MS` | Fréquence de lecture de la file | 5000 |

Ne mettez jamais la clé dans le code ni dans Git : seulement dans `.env`.

### c) Lancer le worker avec PM2

Le moteur tourne dans un processus séparé du site, pour qu'un long Conseil ne ralentisse jamais
pandorabrains.com. Le dépôt n'a pas de fichier `ecosystem.config.js` ; lancez-le ainsi :

```
cd /home/<utilisateur>/pandorabrains.com/innomax-html-package
pm2 start scripts/agents-worker.js --name pandora-agents --kill-timeout 30000
pm2 save
pm2 logs pandora-agents
```

`--kill-timeout 30000` laisse au worker le temps de finir proprement à l'arrêt.
Après une mise à jour du code : `pm2 restart pandora-agents`.

Sans `ANTHROPIC_API_KEY`, le worker écrit « worker au repos : ANTHROPIC_API_KEY absente » dans le
journal et ne fait rien. C'est normal.

### d) Allumer et fixer le budget

Le moteur a **deux interrupteurs** qui doivent être allumés tous les deux :
`AGENTS_ENABLED=true` dans `.env`, et `enabled` dans les réglages (éteint au départ).

Depuis la console du navigateur, connecté au site comme administrateur (avec la double authentification) :

```js
const csrf = document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1];
const api = (method, url, body) => fetch(url, {
  method, credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: body && JSON.stringify(body),
}).then((r) => r.json());

await api('PUT', '/api/admin/agents/settings', { enabled: true, monthly_budget_usd: 60, concurrency: 2 });
```

- `monthly_budget_usd` : plafond du mois en dollars américains (défaut 60 $). Quand le prochain appel
  risquerait de dépasser ce plafond, le travail s'arrête avec le statut **`budget_refused`** et un
  message clair. Le compteur repart à zéro le 1er du mois (heure du Québec).
- `concurrency` : nombre d'agents qui travaillent en même temps dans un Conseil (1 à 6, défaut 2).
- `model_quick`, `model_default`, `model_complex` : remplacent les modèles du `.env` sans redémarrer.

Vérifiez ensuite `https://pandorabrains.com/healthz` : `db` doit valoir `ok` et
`worker.seen_seconds_ago` doit être petit (moins d'une minute).

## 3. Coûts (estimation)

Toutes les valeurs de cette section sont des **estimations**. Le coût réel dépend de la longueur des
textes et de la réflexion des modèles. La page `/api/admin/agents/usage` donne le coût réel du mois.

Prix utilisés par défaut, en dollars américains par million de jetons, **à vérifier** sur
https://www.anthropic.com/pricing avant la mise en ligne (relevés le 2026-09-25) :

| Niveau | Modèle | Entrée | Sortie |
| --- | --- | --- | --- |
| quick (votes) | claude-haiku-4-5 | 1 $ | 5 $ |
| default (plan, propositions, objections, révisions, ordres) | claude-sonnet-5-5 | 2 $ | 10 $ |
| complex (arbitre, réviseur final) | claude-opus-5-5 | 4 $ | 20 $ |

Un modèle absent de la table est compté au prix prudent de 10 $ / 50 $, pour que le budget ne soit
jamais sous-estimé. Les prix se corrigent avec `AGENTS_PRICES_JSON`, sans changer le code.

Ordres de grandeur (**estimation**, en supposant environ 3 000 jetons lus et 2 000 écrits par appel) :

| Travail | Appels | Coût estimé |
| --- | --- | --- |
| Ordre simple | 1 | environ 0,03 $ |
| Petit Conseil (3 proposeurs, 1 contradicteur, 1 tour) | environ 15 | 0,25 $ à 0,40 $ |
| Grand Conseil (6 proposeurs, 3 contradicteurs, 3 tours) | environ 45 | 0,70 $ à 1,00 $ |

Avec le budget par défaut de 60 $, cela représente environ 60 à 80 grands Conseils par mois
(**estimation**). Le moteur réserve le pire cas avant chaque appel (réponse de longueur maximale),
donc il peut refuser un travail un peu avant d'atteindre exactement le plafond.

## 4. Importer les agents

**Les 38 agents de départ** (ceux du « Centre de commande ») sont dans `db/seed_agents.json`.
Trois façons de les importer, au choix :

- dans l'admin : **⚙️ Réglages agents → 🌱 Importer les 38 agents de départ** ;
- en ligne de commande, depuis `innomax-html-package/` : `node scripts/seed-agents.js` ;
- par l'API : `POST /api/admin/agents/seed`.

C'est sans danger de le refaire : seuls les agents **absents** sont ajoutés (on compare l'`id`),
ceux qui existent déjà gardent vos modifications. Pour remettre les fiches d'origine :
`node scripts/seed-agents.js --force`. Autre fichier : `--file chemin/agents.json`.

**Un autre fichier d'agents** (exporté de l'artifact ou de l'admin) :

1. Dans l'artifact Claude, exportez la collection `agents` en JSON.
2. Envoyez-la au moteur (console du navigateur, avec la fonction `api` de la section 2d) :

```js
const agents = [ /* collez ici le tableau exporté */ ];
await api('POST', '/api/admin/agents/import', { agents });
// -> { imported: 26 }
```

Les noms de champs français ou anglais sont acceptés : `nom`/`name`, `equipe`/`team`, `role`,
`methode`/`method`, `outils`/`tools`, `moteur`/`engine` (`claude` ou `maison`), `modele`/`model`
(`quick`, `default`, `complex` ou un nom de modèle), `actif`/`active`. Sans `id`, l'identifiant est
fabriqué à partir du nom (ex. « Analyste Marché » → `analyste-marche`). Un agent qui existe déjà est
mis à jour. Si une seule fiche est invalide, rien n'est importé et la liste des erreurs est renvoyée.

Pour sauvegarder : `GET /api/admin/agents/export` télécharge `agents-pandora.json`.

Les outils listés dans une fiche sont seulement descriptifs : le moteur n'exécute aucun outil.

## 5. Utiliser le moteur

Toutes les routes exigent un compte administrateur qui a **passé le code 2FA dans ce navigateur**
(cookie signé `mfa`, la même garde que la console `/admin/console`). Avoir la 2FA activée sur le
compte ne suffit pas : reconnectez-vous avec votre code si la réponse est « Double authentification
requise ». Les créations sont limitées à 10 par minute.

| Action | Route |
| --- | --- |
| Lister les travaux (`?status=`, `?kind=`, `?agent_id=`, `?entreprise_id=`) | `GET /api/admin/agents/jobs` |
| Créer un ordre | `POST /api/admin/agents/jobs/order` |
| Créer un Conseil | `POST /api/admin/agents/jobs/council` |
| Lancer une recherche web | `POST /api/admin/agents/jobs/research` |
| Agents et leur statut, équipes | `GET /api/admin/agents/agents` |
| Chiffres de la console | `GET /api/admin/agents/summary` |
| Activité après un numéro (repli du direct) | `GET /api/admin/agents/activity?after=` |
| Importer les 38 agents de départ | `POST /api/admin/agents/seed` |
| Arrêt d'urgence (tout couper) | `POST /api/admin/agents/emergency-stop` |
| Voir un travail et son activité | `GET /api/admin/agents/jobs/:id` |
| Annuler un travail | `POST /api/admin/agents/jobs/:id/cancel` |
| Tâches produites par les Conseils | `GET /api/admin/agents/tasks` |
| Réglages | `GET` / `PUT /api/admin/agents/settings` |
| Usage et budget du mois | `GET /api/admin/agents/usage` |
| Activité en direct (SSE) | `GET /api/admin/agents/stream` |
| Export / import des agents | `GET /api/admin/agents/export`, `POST /api/admin/agents/import` |

Exemples :

```js
await api('POST', '/api/admin/agents/jobs/order', {
  agent_id: 'redaction', instruction: 'Rédige une infolettre sur notre offre de chatbot.',
  client: { nom: 'Client X', notes: '...' },
});

await api('POST', '/api/admin/agents/jobs/council', {
  sujet: 'Faut-il lancer un forfait IA pour les cliniques dentaires?',
  contexte: 'Ce que nous savons déjà…',
  proposeurs: ['strategie', 'ventes', 'marketing'],
  contradicteurs: ['finance'],
  arbitre: 'direction', reviseur: 'direction',
});

const flux = new EventSource('/api/admin/agents/stream');
flux.addEventListener('activity', (e) => console.log(JSON.parse(e.data)));
```

Statuts d'un travail : `queued` (en file), `running` (en cours), `done` (terminé), `error`,
`cancelled` (annulé), `budget_refused` (budget du mois atteint).

Si le serveur redémarre pendant un travail, celui-ci revient en file après 15 minutes et reprend
depuis le début (au plus 3 tentatives). Une erreur temporaire d'Anthropic (surcharge, réseau) est
réessayée automatiquement.

**Espace client.** Les routes `/api/agents/jobs` (lecture seule) montrent à un membre les travaux
de son entreprise (table `membres`), avec le livrable une fois terminé. Jamais le coût, la demande
ni le débat interne. Un travail sans entreprise (travail interne) n'est visible par aucun client.

## 6. Arrêt d'urgence

Du plus doux au plus radical :

0. **Le gros bouton** : admin → ⚙️ Réglages agents → **🛑 Arrêt d'urgence**. Il coupe le moteur et
   annule tous les travaux en file ou en cours (`POST /api/admin/agents/emergency-stop`).
1. **Couper depuis les réglages** (aucun redémarrage) :
   `await api('PUT', '/api/admin/agents/settings', { enabled: false })`.
   Le worker ne prend plus de nouveau travail ; celui en cours se termine.
2. **Annuler les travaux** : `POST /api/admin/agents/jobs/:id/cancel`. Un Conseil s'arrête à la fin
   de l'étape en cours.
3. **Arrêter le processus** : `pm2 stop pandora-agents`. Le travail en cours est remis en file.
4. **Tout couper dans Supabase** (éditeur SQL) :
   ```sql
   update agent_settings set enabled = false;
   update agent_jobs set status = 'cancelled', finished_at = now() where status in ('queued', 'running');
   ```
5. **Révoquer la clé** sur console.anthropic.com → API Keys. Plus aucun appel n'est possible,
   même si le serveur est compromis.

Mettre `monthly_budget_usd` à 0 bloque aussi toute dépense.

## 7. Surveillance

`GET /healthz` répond sans rien révéler de sensible :

```json
{ "status": "ok", "db": "ok", "queue": { "queued": 0, "running": 1 }, "worker": { "seen_seconds_ago": 4 } }
```

Il répond 503 si la base de données ne répond pas. Un `seen_seconds_ago` de plus de 2 minutes
veut dire que le worker est arrêté : regardez `pm2 logs pandora-agents`.

## 8. L'onglet Agents de l'admin

Tout le « Centre de commande » est maintenant dans le site, au même endroit que le reste :
connectez-vous normalement (courriel, mot de passe, code 2FA), allez sur `/admin/console`, puis
utilisez les nouveaux onglets. Ils ont la même protection que le reste de la console : un compte
administrateur qui a passé le code 2FA dans ce navigateur.

| Onglet | Ce qu'on y fait |
| --- | --- |
| **🤖 Agents** (`?vue=agents`) | La console : les chiffres (agents au travail, travaux en cours, en file, consensus), le **réseau en direct** (chaque pastille est un agent relié au moyeu de son équipe ; elle s'allume et des paquets circulent quand il travaille ; survol ou flèches du clavier pour voir un agent, clic ou Entrée pour ouvrir sa fiche), les **salles** par équipe, le **journal en direct**, le formulaire **Donner un ordre** (un agent ou toute une équipe, un client facultatif, l'instruction écrite ou dictée 🎤) et les **ordres récents**, dont le texte apparaît dès qu'il est prêt. |
| **🧠 Conseil** (`?vue=conseil`) | Soumettre un sujet : cochez les équipes qui proposent, choisissez un client si besoin, ajoutez du contexte. Les délibérations se suivent en direct : la frise des étapes, la jauge d'accord (seuil 70 %), les propositions, objections, révisions, votes, puis la décision et les tâches. |
| **🗂️ Travail** (`?vue=travail`) | Tous les travaux, filtrés par statut, type, agent ou client. Cliquez un travail pour voir sa demande, son résultat, son coût et son journal, ou pour l'annuler. En bas : les tâches créées par le Conseil, à valider par un humain. |
| **🔎 Recherche** (`?vue=recherche`) | Posez une question (écrite ou dictée). Un agent (Cap, le consultant stratégie, par défaut) cherche sur le web et rend une synthèse en français avec ses **sources cliquables**. L'historique des recherches est en dessous. |
| **⚙️ Réglages agents** (`?vue=reglages-agents`) | Marche / arrêt du moteur et **arrêt d'urgence**, budget du mois et barre de dépense (recherches web à part), modèles, import des 38 agents de départ, export et import d'un fichier JSON. |

**Le direct.** La page s'abonne au flux `/api/admin/agents/stream`. Si le flux ne passe pas (proxy,
coupure), elle bascule toute seule sur une relève toutes les 5 secondes ; le petit voyant en haut à
droite indique « En direct » ou « Relève toutes les 5 s ».

**Ce que la page n'affiche jamais.** Tout le texte venant des agents ou du web est affiché comme du
texte simple (aucun code n'est exécuté). Seuls les liens `https://` des sources sont cliquables ;
ils s'ouvrent dans un nouvel onglet.

**Le micro.** Les grands champs ont un bouton « Dicter » (français du Canada). Si le navigateur ne le
permet pas, le bouton explique comment utiliser la dictée du clavier.

### La recherche web

- L'agent utilise l'outil de recherche web d'Anthropic (`web_search_20250305`, 5 recherches au plus
  par question). Il **lit** le web, c'est tout : il n'envoie rien, ne remplit aucun formulaire et ne
  contacte personne. Les pages lues sont traitées comme des données, jamais comme des consignes.
- Le résultat garde la synthèse et la liste des sources (adresse et titre), les sources citées en
  premier.
- **Coût** : en plus des jetons, chaque recherche est facturée. Par défaut le moteur compte
  **10 $ pour 1 000 recherches (à vérifier** sur anthropic.com/pricing). Pour changer ce prix :
  `AGENTS_WEB_SEARCH_USD_PER_1000=10` dans le `.env`. Les recherches ont leur propre ligne
  « web_search » dans l'usage du mois, et elles comptent dans le budget. Une recherche est refusée
  d'avance (réponse 402) si le budget du mois ne peut plus la couvrir.
- Variante plus récente de l'outil (filtrage dynamique, modèles récents seulement) :
  `AGENTS_WEB_SEARCH_TOOL=web_search_20260209`.

### Essayer en local (démo)

Pour voir les onglets sans base de données ni clé API :

```
cd innomax-html-package
DEMO_MODE=true node scripts/demo-admin.js
```

puis ouvrez `http://127.0.0.1:3999/demo/connexion`. Vous arrivez connecté comme administrateur
(avec la 2FA déjà validée), avec les 38 agents, quelques travaux, une délibération terminée
(l'exemple « concept de rupture ») et de l'activité. Les vrais écrans et le vrai moteur tournent,
mais sur une base en mémoire et une **fausse API Anthropic** : les réponses sont simulées (elles
le disent), rien n'est envoyé ni payé, tout disparaît à l'arrêt (Ctrl + C). Réglages : `DEMO_PORT`
(3999), `DEMO_AMBIENT=false` pour couper les ordres automatiques de démonstration.

La démo **refuse de démarrer** sans `DEMO_MODE=true`, avec `NODE_ENV=production`, ou sous PM2. Elle
ne lit pas le `.env`, efface les variables secrètes de son propre processus et n'écoute que sur
`127.0.0.1`. Le site lui-même (`server.js`) ne la charge jamais.

## Limites connues

- Les prix par défaut et les noms de modèles sont à vérifier avant la mise en ligne.
- Le budget est vérifié avant chaque appel ; deux workers qui démarrent au même instant peuvent
  dépasser le plafond d'au plus un appel chacun. Un seul worker est recommandé.
- Un travail repris après une panne recommence depuis le début (les appels déjà faits sont payés).
- La double authentification est vérifiée comme « activée sur le compte » ; la connexion par mot de
  passe du site impose déjà le code aux administrateurs.
- Recherche web : le prix par recherche (10 $ / 1 000) est à vérifier ; la ligne « web_search » de
  l'usage compte des appels qui ont cherché, pas le nombre exact de recherches (il est dans le
  journal de chaque travail).
- Le réseau en direct est un dessin (canevas) : la liste des salles juste en dessous donne les mêmes
  informations aux lecteurs d'écran.
- L'import de départ lit `db/seed_agents.json` à la racine du dépôt : ce dossier doit être déployé
  avec le site.
- L'espace client attend le modèle d'appartenance de la branche `espace-entreprises`.
