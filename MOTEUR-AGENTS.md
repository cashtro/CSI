# Moteur des agents IA

Ce guide explique le moteur qui fait travailler les agents IA de Pandora sur le serveur,
24 heures sur 24, au lieu de la routine Claude horaire de l'artifact.

**Il est livré éteint.** Rien ne se passe tant que vous n'avez pas fait les étapes
d'activation ci-dessous. Même allumé, il ne coûte rien tant qu'aucun travail n'est en file.

## 1. Ce que fait le moteur

- Il lit une **file de travaux** (table `agent_jobs`) et les traite un par un.
- Deux sortes de travaux :
  - **Ordre simple** : un agent (son rôle et sa méthode) exécute une instruction, pour un client
    ou non. Le résultat est un texte.
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

**Ce que le moteur ne fait jamais.** Il n'a aucun outil d'action. Il n'envoie aucun courriel,
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

Ouvrez l'éditeur SQL de Supabase et exécutez `db/003_moteur_agents.sql`. Le fichier peut être
exécuté plusieurs fois sans danger.

Si l'espace entreprises est installé avec une table `entreprise_membres(entreprise_id, user_id)`,
le fichier ajoute aussi une règle qui permet à un membre de lire les travaux de son entreprise.
Si cette table porte un autre nom, adaptez les deux noms à la fin du fichier, puis exécutez-le à nouveau.

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

## 4. Importer les 26 agents de l'artifact

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
| Lister les travaux (`?status=`, `?kind=`) | `GET /api/admin/agents/jobs` |
| Créer un ordre | `POST /api/admin/agents/jobs/order` |
| Créer un Conseil | `POST /api/admin/agents/jobs/council` |
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

**Espace client.** Les routes `/api/agents/jobs` (lecture seule) sont prêtes, mais elles ne montrent
encore rien : le lien entre un compte et son entreprise arrive avec la branche `espace-entreprises`
(TODO documenté dans `routes(api)/agentsClient.js`).

## 6. Arrêt d'urgence

Du plus doux au plus radical :

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

## Limites connues

- Les prix par défaut et les noms de modèles sont à vérifier avant la mise en ligne.
- Le budget est vérifié avant chaque appel ; deux workers qui démarrent au même instant peuvent
  dépasser le plafond d'au plus un appel chacun. Un seul worker est recommandé.
- Un travail repris après une panne recommence depuis le début (les appels déjà faits sont payés).
- La double authentification est vérifiée comme « activée sur le compte » ; la connexion par mot de
  passe du site impose déjà le code aux administrateurs.
- L'espace client attend le modèle d'appartenance de la branche `espace-entreprises`.
