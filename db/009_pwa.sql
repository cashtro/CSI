-- PWA de PBTM : abonnements aux notifications push (Web Push), voir PWA.md.
--
-- Ordre complet : 001_fulfillments, 002_espace_entreprises, 003_moteur_agents,
-- 004_protection_comptes, 005_recherche_agents, 006_robots, 007_finances, 008_croissance,
-- 009_pwa.
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, 002_espace_entreprises.sql,
-- 003_moteur_agents.sql, 004_protection_comptes.sql, 005_recherche_agents.sql,
-- 006_robots.sql, 007_finances.sql, 008_croissance.sql, puis ce fichier (009).
-- Il reference public.entreprises (002) et auth.users.
--
-- Securite : RLS activee, AUCUNE politique. Seul le serveur (cle service, qui
-- contourne la RLS) lit et ecrit, apres la connexion et le jeton CSRF
-- (routes(api)/pwaRoutes.js). Le navigateur (anon, authenticated) n'a aucun
-- acces : une adresse d'abonnement permet d'envoyer des notifications a
-- l'appareil, elle ne doit jamais etre lisible par un autre compte.
--
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

create table if not exists public.push_abonnements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- role 'admin' : alertes du cockpit ; 'client' : livrables de son entreprise.
  role          text not null check (role in ('admin', 'client')),
  entreprise_id uuid references public.entreprises (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh        text not null check (char_length(p256dh) between 80 and 100),
  auth          text not null check (char_length(auth) between 16 and 30),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  constraint push_abonnements_client_entreprise check (role = 'admin' or entreprise_id is not null)
);

create index if not exists push_abonnements_role_idx on public.push_abonnements (role, entreprise_id);
create index if not exists push_abonnements_user_idx on public.push_abonnements (user_id);

alter table public.push_abonnements enable row level security;
revoke all on public.push_abonnements from anon, authenticated;
