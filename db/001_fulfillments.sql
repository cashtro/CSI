-- Ordre complet : 001_fulfillments, 002_espace_entreprises, 003_moteur_agents,
-- 004_protection_comptes, 005_recherche_agents, 006_robots, 007_finances, 008_croissance,
-- 009_pwa.
-- ORDRE D'EXECUTION OBLIGATOIRE : ce fichier (001), puis
-- 002_espace_entreprises.sql, puis 003_moteur_agents.sql.
-- Idempotency ledger for Stripe fulfilment (routes(api)/utils/fulfill.js).
-- Run once in the Supabase SQL editor BEFORE deploying: without this table
-- paid sessions are refused (the webhook answers 500 and Stripe retries).
create table if not exists public.fulfillments (
  key        text primary key,          -- 'fulfill:<checkout session id>'
  type       text,                      -- rendez_vous | course | subscription | lottery_entry | product
  created_at timestamptz not null default now()
);

-- Only the server (service role) reads or writes the ledger.
alter table public.fulfillments enable row level security;
