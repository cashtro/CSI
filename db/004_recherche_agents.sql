-- Recherche web des agents et onglet Agents de l'admin (voir MOTEUR-AGENTS.md).
--
-- ORDRE D'EXECUTION OBLIGATOIRE : 001_fulfillments.sql, 002_espace_entreprises.sql,
-- 003_moteur_agents.sql, puis ce fichier (004). Il modifie la table
-- public.agent_jobs creee par 003.
--
-- Safe to re-run: every statement is idempotent.

-- New job kind 'research': one agent answers a question with Anthropic's
-- server-side web search (read only). The inline check of 003 is named
-- agent_jobs_kind_check by Postgres.
alter table public.agent_jobs drop constraint if exists agent_jobs_kind_check;
alter table public.agent_jobs
  add constraint agent_jobs_kind_check check (kind in ('order', 'debate', 'research'));

-- The "Travail" tab filters jobs by agent (payload->>'agent_id').
create index if not exists agent_jobs_agent_idx
  on public.agent_jobs ((payload ->> 'agent_id'), created_at desc);
