-- Module Finances de la console admin (voir FINANCES.md).
--
-- Ordre complet : 001_fulfillments, 002_espace_entreprises, 003_moteur_agents,
-- 004_protection_comptes, 005_recherche_agents, 006_robots, 007_finances, 008_croissance,
-- 009_pwa.
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, 002_espace_entreprises.sql,
-- 003_moteur_agents.sql, 004_protection_comptes.sql, 005_recherche_agents.sql,
-- 006_robots.sql,
-- puis ce fichier (007).
-- Il ne modifie aucune table existante : il cree depenses et objectifs_financiers.
--
-- Safe to re-run: every statement is idempotent.
--
-- Amounts are in Canadian dollars. depenses.montant is the amount BEFORE tax;
-- tps and tvq are the sales taxes paid on it (input tax credits / refunds).
-- Revenue is never stored here: the server computes it from public.bills and
-- Stripe.

create table if not exists public.depenses (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  categorie     text not null check (categorie in ('outils', 'ia', 'publicite', 'sous_traitance', 'salaires', 'autres')),
  fournisseur   text not null check (char_length(fournisseur) between 1 and 200),
  montant       numeric(12, 2) not null check (montant >= 0 and montant <= 10000000),
  tps           numeric(12, 2) not null default 0 check (tps >= 0),
  tvq           numeric(12, 2) not null default 0 check (tvq >= 0),
  recurrente    boolean not null default false,
  piece_jointe  text check (piece_jointe is null or (piece_jointe ~ '^https://' and char_length(piece_jointe) <= 2000)),
  note          text check (note is null or char_length(note) <= 2000),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists depenses_date_idx on public.depenses (date desc);
create index if not exists depenses_categorie_idx on public.depenses (categorie, date desc);

-- One target per month (first day of the month). marge_visee is a percentage
-- of revenue (gross margin = revenue - expenses - AI cost).
create table if not exists public.objectifs_financiers (
  mois          date primary key check (extract(day from mois) = 1),
  revenu_vise   numeric(12, 2) not null check (revenu_vise >= 0),
  marge_visee   numeric(5, 2) not null check (marge_visee between -100 and 100),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- RLS: enabled with no policy, so only the service role (which bypasses RLS)
-- reads or writes. The browser never talks to these tables directly, even
-- with its own JWT and the public anon key.
alter table public.depenses              enable row level security;
alter table public.objectifs_financiers  enable row level security;
revoke all on public.depenses from anon, authenticated;
revoke all on public.objectifs_financiers from anon, authenticated;
grant select, insert, update, delete on public.depenses to service_role;
grant select, insert, update, delete on public.objectifs_financiers to service_role;
