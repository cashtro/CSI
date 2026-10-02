-- Onglet Croissance de la console admin : SEO, AEO, backlinks, campagnes,
-- contenus, medias et communiques (voir CROISSANCE.md).
--
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, 002_espace_entreprises.sql,
-- 003_moteur_agents.sql, 004_protection_comptes.sql, 005_recherche_agents.sql,
-- puis 006 et 007 (crees par d'autres equipes), puis ce fichier (008).
-- Il reference public.agent_jobs (003) et auth.users.
--
-- Securite : RLS activee sur chaque table, AUCUNE politique. Seul le serveur
-- (cle service, qui contourne la RLS) lit et ecrit, apres requireAdmin (admin +
-- 2FA) et le jeton CSRF. Le navigateur (anon, authenticated) n'a aucun acces.
--
-- Aucun envoi automatique : ces tables gardent des idees, des brouillons et
-- des statuts. Publier un contenu ou envoyer un courriel reste un geste humain.
--
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- Backlinks: sites that could link to pbtm (annuaires, medias, partenaires...).
create table if not exists public.backlinks (
  id            uuid primary key default gen_random_uuid(),
  cible         text not null check (char_length(cible) between 1 and 200),   -- site or page that would host the link
  domaine       text check (char_length(domaine) <= 200),
  url           text check (url is null or url ~ '^https?://'),
  page_visee    text not null default '/' check (char_length(page_visee) <= 200), -- our page the link should point to
  type          text not null default 'annuaire_qc'
                check (type in ('annuaire_qc', 'media', 'partenaire', 'blogue_invite', 'podcast')),
  statut        text not null default 'idee'
                check (statut in ('idee', 'contacte', 'en_attente', 'obtenu', 'refuse')),
  autorite      integer check (autorite between 0 and 100),                     -- estimated authority, 0 to 100
  date_suivi    date,
  note          text check (char_length(note) <= 4000),
  source        text check (char_length(source) <= 500),                        -- where the idea came from (search, person)
  courriel_approche text check (char_length(courriel_approche) <= 8000),       -- draft only, never sent by the app
  job_id        uuid references public.agent_jobs (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists backlinks_statut_idx on public.backlinks (statut, created_at desc);
create unique index if not exists backlinks_url_uidx on public.backlinks (lower(url)) where url is not null;

-- Marketing campaigns.
create table if not exists public.campagnes (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (char_length(nom) between 1 and 200),
  objectif    text check (char_length(objectif) <= 2000),
  cible       text check (char_length(cible) <= 1000),                          -- audience
  canaux      text[] not null default '{}',
  budget      numeric(12, 2) check (budget >= 0),
  date_debut  date,
  date_fin    date,
  kpi_vises   text check (char_length(kpi_vises) <= 2000),
  kpi_reels   text check (char_length(kpi_reels) <= 2000),
  statut      text not null default 'brouillon'
              check (statut in ('brouillon', 'planifiee', 'active', 'terminee', 'annulee')),
  decision    text check (char_length(decision) <= 8000),                       -- decision of the agents' Council
  job_id      uuid references public.agent_jobs (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (date_fin is null or date_debut is null or date_fin >= date_debut)
);
create index if not exists campagnes_statut_idx on public.campagnes (statut, date_debut);

-- Editorial calendar: one piece of content per row. Published by hand only.
create table if not exists public.contenus (
  id           uuid primary key default gen_random_uuid(),
  campagne_id  uuid references public.campagnes (id) on delete set null,
  canal        text not null default 'blogue' check (char_length(canal) between 1 and 60),
  format       text check (char_length(format) <= 60),
  titre        text not null check (char_length(titre) between 1 and 300),
  texte        text check (char_length(texte) <= 20000),
  media_url    text check (media_url is null or media_url ~ '^https://'),
  date_prevue  date,
  statut       text not null default 'idee' check (statut in ('idee', 'redige', 'approuve', 'publie')),
  publie_le    timestamptz,
  job_id       uuid references public.agent_jobs (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists contenus_date_idx on public.contenus (date_prevue);
create index if not exists contenus_campagne_idx on public.contenus (campagne_id);

-- AEO: questions customers ask answer engines, and the validated answers.
create table if not exists public.aeo_questions (
  id          uuid primary key default gen_random_uuid(),
  question    text not null check (char_length(question) between 1 and 300),
  page        text not null default 'generale' check (char_length(page) <= 40),  -- FAQ it goes to (faq.<page>)
  source      text check (char_length(source) <= 300),
  reponse     text check (char_length(reponse) <= 2000),
  statut      text not null default 'a_repondre'
              check (statut in ('a_repondre', 'suggeree', 'validee', 'publiee')),
  job_id      uuid references public.agent_jobs (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists aeo_questions_statut_idx on public.aeo_questions (statut, created_at desc);

-- Media list (journalists, outlets, podcasts). The consent basis is kept for
-- the LCAP (Canada's anti-spam law): no commercial e-mail without consent.
create table if not exists public.medias (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null check (char_length(nom) between 1 and 200),
  contact       text check (char_length(contact) <= 200),
  courriel      text check (char_length(courriel) <= 320),
  site          text check (site is null or site ~ '^https?://'),
  sujets        text check (char_length(sujets) <= 1000),
  consentement  text not null default 'aucun' check (consentement in ('aucun', 'tacite', 'expres')),
  note          text check (char_length(note) <= 4000),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Press releases, drafted by the agent Tribune and approved by a person.
create table if not exists public.communiques (
  id              uuid primary key default gen_random_uuid(),
  titre           text not null check (char_length(titre) between 1 and 300),
  sujet           text check (char_length(sujet) <= 4000),
  texte           text check (char_length(texte) <= 20000),
  statut          text not null default 'en_redaction'
                  check (statut in ('en_redaction', 'brouillon', 'approuve', 'diffuse')),
  date_diffusion  date,
  job_id          uuid references public.agent_jobs (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Agent jobs started from the Croissance tab, and whether their result was
-- imported (an import is never done twice).
create table if not exists public.croissance_jobs (
  job_id      uuid primary key references public.agent_jobs (id) on delete cascade,
  type        text not null check (type in ('seo', 'aeo_questions', 'aeo_reponses', 'backlinks', 'approche', 'campagne', 'communique')),
  ref         text check (char_length(ref) <= 100),                              -- page id or row id
  importe_le  timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists croissance_jobs_type_idx on public.croissance_jobs (type, created_at desc);

-- ---------------------------------------------------------------- RLS (service only)

alter table public.backlinks       enable row level security;
alter table public.campagnes       enable row level security;
alter table public.contenus        enable row level security;
alter table public.aeo_questions   enable row level security;
alter table public.medias          enable row level security;
alter table public.communiques     enable row level security;
alter table public.croissance_jobs enable row level security;

revoke all on public.backlinks, public.campagnes, public.contenus, public.aeo_questions,
  public.medias, public.communiques, public.croissance_jobs from anon, authenticated;
