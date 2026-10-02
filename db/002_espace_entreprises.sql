-- Espace entreprises + CMS du site (routes(api)/espaceCRUD.js, adminCRUD.js,
-- utils/cms.js).
--
-- Ordre complet : 001_fulfillments, 002_espace_entreprises, 003_moteur_agents,
-- 004_protection_comptes, 005_recherche_agents, 006_robots, 007_finances, 008_croissance,
-- 009_pwa.
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, puis ce fichier (002),
-- puis 003_moteur_agents.sql. 003 lit public.membres et public.mon_entreprise()
-- crees ici ; si 003 a deja ete execute avant ce fichier, relancez 003.
--
-- Run once in the Supabase SQL editor. Safe to re-run: every statement is
-- idempotent.
--
-- Access model:
--   - The server reads and writes these tables with the service role key, after
--     checking on its own side that the user is a member of the company (client
--     routes) or an admin who passed 2FA (admin routes). The service role
--     bypasses RLS.
--   - RLS is the second wall for anyone calling Supabase directly with the
--     public anon key and their own JWT: a member may only SELECT the rows of
--     their own company, and may never write. site_content is public read-only.

create extension if not exists pgcrypto;

-- Companies (clients). One row per registered business.
create table if not exists public.entreprises (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null check (char_length(nom) between 1 and 200),
  courriel   text,                      -- contact e-mail for the company
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Who belongs to which company. A user belongs to at most one company.
create table if not exists public.membres (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises (id) on delete cascade,
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  role          text not null default 'membre' check (role in ('proprietaire', 'membre')),
  created_at    timestamptz not null default now()
);
create index if not exists membres_entreprise_idx on public.membres (entreprise_id);

-- Mandates (projects) a company ordered, tracked step by step.
create table if not exists public.mandats (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references public.entreprises (id) on delete cascade,
  titre          text not null check (char_length(titre) between 1 and 200),
  description    text check (char_length(description) <= 5000),
  budget         numeric(12, 2) check (budget is null or budget >= 0),
  echeance       date,
  statut         text not null default 'actif' check (statut in ('actif', 'en_pause', 'termine', 'annule')),
  -- Index into the fixed step list in utils/espace.js (0 = Réception ... 4 = Livraison).
  etape          smallint not null default 0 check (etape between 0 and 4),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mandats_entreprise_idx on public.mandats (entreprise_id, created_at desc);

-- Deliverables produced by the agents for a mandate, approved by the client.
create table if not exists public.livrables (
  id                 uuid primary key default gen_random_uuid(),
  entreprise_id      uuid not null references public.entreprises (id) on delete cascade,
  mandat_id          uuid references public.mandats (id) on delete set null,
  titre              text not null check (char_length(titre) between 1 and 200),
  description        text check (char_length(description) <= 5000),
  url                text check (url is null or url ~ '^https://'),
  produit_par        text,              -- agent or person who produced it
  statut             text not null default 'en_attente'
                       check (statut in ('en_attente', 'approuve', 'modification_demandee')),
  commentaire_client text check (char_length(commentaire_client) <= 2000),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists livrables_entreprise_idx on public.livrables (entreprise_id, created_at desc);

-- Editable site texts and images (CMS). An absent row means "use the value
-- written in the template", so an empty table changes nothing on the site.
create table if not exists public.site_content (
  key        text not null check (key ~ '^[a-z0-9][a-z0-9_.-]{0,99}$'),
  lang       text not null default 'fr' check (lang in ('fr', 'en')),
  value      text not null check (char_length(value) <= 20000),
  type       text not null default 'texte' check (type in ('texte', 'image', 'json')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);

-- ---------------------------------------------------------------- RLS

alter table public.entreprises  enable row level security;
alter table public.membres      enable row level security;
alter table public.mandats      enable row level security;
alter table public.livrables    enable row level security;
alter table public.site_content enable row level security;

-- Company of the signed-in user. SECURITY DEFINER so the policies below can
-- read membres without recursing into membres' own policy.
create or replace function public.mon_entreprise()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select entreprise_id from public.membres where user_id = auth.uid()
$$;
revoke all on function public.mon_entreprise() from public, anon;
grant execute on function public.mon_entreprise() to authenticated;

drop policy if exists entreprises_membre_lecture on public.entreprises;
create policy entreprises_membre_lecture on public.entreprises
  for select to authenticated using (id = public.mon_entreprise());

drop policy if exists membres_membre_lecture on public.membres;
create policy membres_membre_lecture on public.membres
  for select to authenticated using (entreprise_id = public.mon_entreprise());

drop policy if exists mandats_membre_lecture on public.mandats;
create policy mandats_membre_lecture on public.mandats
  for select to authenticated using (entreprise_id = public.mon_entreprise());

drop policy if exists livrables_membre_lecture on public.livrables;
create policy livrables_membre_lecture on public.livrables
  for select to authenticated using (entreprise_id = public.mon_entreprise());

-- Site texts are public; only the server (service role) writes them.
drop policy if exists site_content_lecture on public.site_content;
create policy site_content_lecture on public.site_content
  for select to anon, authenticated using (true);

-- No INSERT / UPDATE / DELETE policy on purpose: every write goes through the
-- server, which checks membership or admin + 2FA first.

-- ---------------------------------------------------------------- Storage
-- Public bucket for CMS images (the server uploads with the service role).
insert into storage.buckets (id, name, public)
values ('site-content', 'site-content', true)
on conflict (id) do nothing;
