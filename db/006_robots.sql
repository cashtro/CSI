-- Robots clients : catalogue des offres d'agents, robots actifs (abonnements
-- Stripe), connexions aux outils des clients (OAuth, jetons chiffres) et
-- livrables des robots a valider par PBTM. Voir ROBOTS.md.
--
-- Ordre complet : 001_fulfillments, 002_espace_entreprises, 003_moteur_agents,
-- 004_protection_comptes, 005_recherche_agents, 006_robots, 007_finances, 008_croissance,
-- 009_pwa.
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, 002_espace_entreprises.sql,
-- 003_moteur_agents.sql, 004_protection_comptes.sql, 005_recherche_agents.sql,
-- puis ce fichier (006). Il lit public.entreprises, public.membres,
-- public.mon_entreprise() (002), public.livrables (002) et public.agent_jobs (003).
--
-- Safe to re-run: every statement is idempotent.
--
-- Access model (same as 002 / 003):
--   - the server reads and writes with the service role, after checking
--     membership (client routes) or admin + 2FA (admin routes);
--   - RLS is the second wall for direct calls with the anon key: anyone may
--     read the ACTIVE offers; a member may read their own company's robots
--     and the harmless columns of their connections (never the tokens);
--     nobody but the server ever writes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 1. Catalogue

create table if not exists public.robots_offres (
  slug               text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  nom                text not null check (char_length(nom) between 1 and 120),
  emoji              text not null default '🤖' check (char_length(emoji) <= 16),
  pitch              text not null default '' check (char_length(pitch) <= 400),
  fait               jsonb not null default '[]'::jsonb check (jsonb_typeof(fait) = 'array'),     -- ce qu'il fait (liste)
  pour_qui           text not null default '' check (char_length(pour_qui) <= 400),
  prix_mensuel       numeric(10, 2) not null check (prix_mensuel >= 0),                          -- $ CA par mois (estimation)
  prix_mise_en_place numeric(10, 2) not null default 0 check (prix_mise_en_place >= 0),          -- $ CA une fois
  stripe_price_id    text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]{3,200}$'),
  agents             jsonb not null default '[]'::jsonb check (jsonb_typeof(agents) = 'array'),  -- ids de public.agents, le premier travaille
  equipes            jsonb not null default '[]'::jsonb check (jsonb_typeof(equipes) = 'array'),
  mode               text not null default 'ordre' check (mode in ('ordre', 'conseil')),
  quota_taches_mois  integer not null default 20 check (quota_taches_mois between 0 and 10000),
  actif              boolean not null default true,
  ordre              integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists robots_offres_ordre_idx on public.robots_offres (ordre, slug);

-- Robots a company pays for (one row per Stripe subscription).
create table if not exists public.robots_actifs (
  id                     uuid primary key default gen_random_uuid(),
  entreprise_id          uuid not null references public.entreprises (id) on delete cascade,
  robot                  text not null references public.robots_offres (slug) on update cascade,
  statut                 text not null default 'actif' check (statut in ('actif', 'en_pause', 'annule')),
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  depuis                 timestamptz not null default now(),
  annulation_prevue_le   timestamptz,                     -- cancel_at_period_end : date de fin
  reglages               jsonb not null default '{}'::jsonb check (jsonb_typeof(reglages) = 'object'),
  stripe_event_at        timestamptz,                     -- date du dernier evenement Stripe applique (ordre des evenements)
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists robots_actifs_entreprise_idx on public.robots_actifs (entreprise_id, created_at desc);
-- A company has at most one live (not cancelled) subscription per robot.
create unique index if not exists robots_actifs_un_vivant_idx
  on public.robots_actifs (entreprise_id, robot) where statut <> 'annule';

-- ---------------------------------------------------------------- 2. Connexions

-- Tools a company connected (or asked PBTM to connect). jetons holds the OAuth
-- tokens (or the website key) ENCRYPTED with AES-256-GCM under TOTP_ENC_KEY
-- (routes(api)/utils/crypto2fa.js, prefix enc:v1:). The server refuses to store
-- a token when the key is missing. The column is never sent to a browser.
create table if not exists public.connexions (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises (id) on delete cascade,
  fournisseur   text not null check (fournisseur in (
                  'google_business', 'google_workspace', 'microsoft365', 'meta', 'site_web', 'hubspot', 'shopify')),
  statut        text not null default 'demandee' check (statut in ('demandee', 'connectee', 'erreur')),
  portee        jsonb not null default '[]'::jsonb check (jsonb_typeof(portee) = 'array'),   -- permissions demandees
  compte        text check (char_length(compte) <= 300),       -- adresse du site, boutique Shopify…
  jetons        text check (jetons is null or jetons like 'enc:v1:%'),
  expire_at     timestamptz,
  erreur        text check (char_length(erreur) <= 500),
  consenti_par  uuid references auth.users (id) on delete set null,
  consenti_at   timestamptz,                                    -- consentement explicite (Loi 25)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entreprise_id, fournisseur)
);

-- One-time OAuth states (anti-CSRF) with the PKCE verifier, encrypted. Read
-- once and deleted by /connexions/:fournisseur/retour. Server only.
create table if not exists public.connexions_etats (
  state          text primary key check (char_length(state) between 32 and 128),
  entreprise_id  uuid not null references public.entreprises (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  fournisseur    text not null,
  code_verifier  text check (code_verifier is null or code_verifier like 'enc:v1:%'),
  compte         text,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);
create index if not exists connexions_etats_expire_idx on public.connexions_etats (expires_at);

-- ---------------------------------------------------------------- 3. Jobs and deliverables of the robots

-- The robot a job works for (quota per month and per robot).
alter table public.agent_jobs add column if not exists robot text;
create index if not exists agent_jobs_robot_idx on public.agent_jobs (entreprise_id, robot, created_at desc)
  where robot is not null;

-- A robot's result becomes a deliverable that PBTM validates first:
--   a_valider (PBTM, hidden from the client) -> en_attente (the client decides)
--   or refuse (PBTM refused it, never shown to the client).
alter table public.livrables add column if not exists robot text;
alter table public.livrables add column if not exists job_id uuid;
alter table public.livrables add column if not exists contenu text;
alter table public.livrables drop constraint if exists livrables_contenu_check;
alter table public.livrables add constraint livrables_contenu_check check (contenu is null or char_length(contenu) <= 100000);
alter table public.livrables drop constraint if exists livrables_statut_check;
alter table public.livrables add constraint livrables_statut_check
  check (statut in ('a_valider', 'refuse', 'en_attente', 'approuve', 'modification_demandee'));
create unique index if not exists livrables_job_idx on public.livrables (job_id) where job_id is not null;

-- ---------------------------------------------------------------- 4. RLS

alter table public.robots_offres    enable row level security;
alter table public.robots_actifs    enable row level security;
alter table public.connexions       enable row level security;
alter table public.connexions_etats enable row level security;

revoke all on public.robots_offres, public.robots_actifs, public.connexions, public.connexions_etats
  from anon, authenticated;

-- The catalogue is public, active offers only.
grant select on public.robots_offres to anon, authenticated;
drop policy if exists robots_offres_lecture on public.robots_offres;
create policy robots_offres_lecture on public.robots_offres
  for select to anon, authenticated using (actif);

-- A member reads their company's robots, without the Stripe ids.
grant select (id, entreprise_id, robot, statut, depuis, annulation_prevue_le, created_at) on public.robots_actifs to authenticated;
drop policy if exists robots_actifs_membre_lecture on public.robots_actifs;
create policy robots_actifs_membre_lecture on public.robots_actifs
  for select to authenticated using (entreprise_id = public.mon_entreprise());

-- A member reads the state of their company's connections, never the tokens.
grant select (id, entreprise_id, fournisseur, statut, portee, compte, expire_at, consenti_at, created_at) on public.connexions to authenticated;
drop policy if exists connexions_membre_lecture on public.connexions;
create policy connexions_membre_lecture on public.connexions
  for select to authenticated using (entreprise_id = public.mon_entreprise());

-- connexions_etats: no policy, no grant: server only.

-- A deliverable PBTM has not validated yet (or refused) is invisible to the client.
drop policy if exists livrables_membre_lecture on public.livrables;
create policy livrables_membre_lecture on public.livrables
  for select to authenticated using (entreprise_id = public.mon_entreprise() and statut not in ('a_valider', 'refuse'));

-- ---------------------------------------------------------------- 5. Starting robots (prices: ESTIMATION, see ROBOTS.md)
-- Same list as ROBOTS_DEPART in routes(api)/utils/robots.js. Existing rows are
-- left alone (the admin may have edited them).

insert into public.robots_offres
  (slug, nom, emoji, pitch, fait, pour_qui, prix_mensuel, prix_mise_en_place, agents, equipes, mode, quota_taches_mois, actif, ordre)
values
  ('receptionniste', 'Réceptionniste IA', '🧾',
   'Elle répond à vos clients, trie vos courriels et prépare vos rendez-vous, même le soir.',
   '["Prépare les réponses à vos courriels et messages", "Propose des rendez-vous selon votre agenda", "Résume les appels et les demandes du jour", "Répond aux questions fréquentes avec vos infos"]',
   'Cliniques, salons, bureaux de services et commerces qui manquent de temps au téléphone.',
   349, 499, '["marketing-courriel", "ventes-strategie"]', '["marketing", "ventes"]', 'ordre', 200, true, 10),
  ('redacteur', 'Rédacteur de contenu', '✍️',
   'Vos articles de blogue, publications et infolettres, écrits dans votre ton, en français.',
   '["Rédige des articles de blogue optimisés", "Prépare un mois de publications pour vos réseaux", "Écrit votre infolettre", "Adapte vos textes en anglais au besoin"]',
   'PME qui veulent publier chaque semaine sans y passer leurs soirées.',
   299, 299, '["contenu-strategie", "contenu-redaction", "contenu-social", "marketing-courriel"]', '["contenu", "marketing"]', 'ordre', 30, true, 20),
  ('seo-aeo', 'Agent SEO et AEO', '📈',
   'Il fait monter votre site dans Google et dans les réponses des assistants IA.',
   '["Audite vos pages et propose les corrections", "Trouve les questions que vos clients posent", "Rédige des pages et des FAQ pensées pour l’IA (AEO)", "Suit vos positions chaque mois"]',
   'Entreprises locales et boutiques en ligne qui veulent être trouvées.',
   399, 499, '["marketing-seo", "contenu-strategie", "web-architecte"]', '["marketing", "web"]', 'ordre', 20, true, 30),
  ('prospecteur', 'Prospecteur de ventes', '🤝',
   'Il trouve des clients potentiels et prépare des messages personnalisés, que vous validez.',
   '["Dresse des listes de prospects ciblés", "Rédige des messages et des relances personnalisés", "Prépare vos appels avec une fiche par prospect", "Respecte la LCAP : rien n’est envoyé sans votre accord"]',
   'Entreprises B2B et services professionnels qui veulent plus de rencontres.',
   449, 499, '["ventes-strategie", "marketing-growth", "contenu-redaction"]', '["ventes", "marketing"]', 'ordre', 40, true, 40),
  ('conseil', 'Le Conseil', '🧭',
   'Un comité de décision IA : plusieurs agents débattent de votre question et votent.',
   '["Analyse une décision sous plusieurs angles", "Fait critiquer chaque option par des contradicteurs", "Vote jusqu’au consensus (70 %)", "Rend un plan d’action, les risques et les points à valider"]',
   'Dirigeants qui veulent un deuxième avis solide avant une grosse décision.',
   599, 0, '["conseil-strategie", "conseil-marketing", "conseil-donnees", "contra-diable", "contra-client", "revue-arbitre", "revue-qualite"]', '["conseil", "contra", "revue"]', 'conseil', 8, true, 50),
  ('studio-video', 'Studio vidéo courte', '🎬',
   'Des idées et des scripts de vidéos courtes pour TikTok, Reels et Shorts, prêts à tourner.',
   '["Propose des idées de vidéos selon les tendances", "Écrit les scripts, plan par plan", "Prépare les sous-titres et les descriptions", "Planifie votre calendrier de publication"]',
   'Commerces et marques qui veulent exister sur les réseaux en vidéo.',
   499, 299, '["marketing-video-courte", "contenu-video", "studio-video"]', '["marketing", "studio"]', 'ordre', 12, true, 60)
on conflict (slug) do nothing;
