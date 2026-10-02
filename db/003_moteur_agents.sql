-- Moteur des agents IA (innomax-html-package/agents/, voir MOTEUR-AGENTS.md).
-- Run once in the Supabase SQL editor BEFORE starting the worker. Safe to
-- re-run: every statement is idempotent.
--
-- The engine ships switched off: agent_settings.enabled defaults to false and
-- the worker also needs AGENTS_ENABLED=true and ANTHROPIC_API_KEY.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- Agents (the 26 agents of the Claude artifact are imported through
-- POST /api/admin/agents/import). id is text so the artifact ids are kept.
create table if not exists public.agents (
  id           text primary key,
  name         text not null,
  team         text,
  role         text,
  method       text,
  tools        jsonb not null default '[]'::jsonb,   -- descriptive only: the engine runs no tools
  engine       text not null default 'claude' check (engine in ('claude', 'maison')),
  model        text,                                  -- quick | default | complex, or an explicit model id
  active       boolean not null default true,
  status       text not null default 'idle',          -- idle | working
  current_task text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Work queue. status 'budget_refused' = the monthly budget would be exceeded.
create table if not exists public.agent_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('order', 'debate')),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'error', 'cancelled', 'budget_refused')),
  priority      integer not null default 0,            -- higher runs first
  attempts      integer not null default 0,
  max_attempts  integer not null default 3 check (max_attempts between 1 and 10),
  locked_by     text,
  locked_at     timestamptz,                           -- refreshed by the worker heartbeat
  run_after     timestamptz not null default now(),
  result        jsonb,                                 -- progress is written here after each phase
  error         text,
  cost_usd      numeric(12, 6) not null default 0,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  entreprise_id uuid,                                  -- nullable: internal Pandora work has none
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create index if not exists agent_jobs_queue_idx
  on public.agent_jobs (priority desc, created_at) where status = 'queued';
create index if not exists agent_jobs_running_idx
  on public.agent_jobs (locked_at) where status = 'running';
create index if not exists agent_jobs_status_created_idx on public.agent_jobs (status, created_at desc);
create index if not exists agent_jobs_entreprise_idx on public.agent_jobs (entreprise_id, created_at desc)
  where entreprise_id is not null;

-- Live activity feed (read by the SSE stream).
create table if not exists public.agent_activity (
  id         bigserial primary key,
  job_id     uuid references public.agent_jobs (id) on delete cascade,
  agent_id   text,
  kind       text not null,          -- job_started | phase | job_done | job_error | ...
  message    text,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_activity_job_idx on public.agent_activity (job_id, id);

-- Tasks produced by the Council (step 7). A human validates each one.
create table if not exists public.agent_tasks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references public.agent_jobs (id) on delete set null,
  title       text not null,
  detail      text,
  owner       text,
  due         text,
  status      text not null default 'a_valider' check (status in ('a_valider', 'a_faire', 'fait', 'rejete')),
  entreprise_id uuid,
  created_at  timestamptz not null default now()
);
create index if not exists agent_tasks_job_idx on public.agent_tasks (job_id);

-- Usage per day and per model (the monthly budget sums this table).
create table if not exists public.agent_usage (
  day        date not null,
  model      text not null,
  calls      integer not null default 0,
  tokens_in  bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd   numeric(12, 6) not null default 0,
  primary key (day, model)
);

-- One settings row (id = 1).
create table if not exists public.agent_settings (
  id                 integer primary key default 1 check (id = 1),
  enabled            boolean not null default false,
  monthly_budget_usd numeric(10, 2) not null default 60 check (monthly_budget_usd >= 0),
  model_quick        text,      -- null = AGENTS_MODEL_QUICK or the built-in default
  model_default      text,
  model_complex      text,
  concurrency        integer not null default 2 check (concurrency between 1 and 6),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
insert into public.agent_settings (id) values (1) on conflict (id) do nothing;

-- Worker heartbeats (for /healthz: "worker seen N seconds ago").
create table if not exists public.agent_workers (
  worker  text primary key,
  state   text,
  seen_at timestamptz not null default now()
);

-- Claim the next runnable job. SKIP LOCKED lets several workers poll at once
-- without ever handing the same job to two of them.
create or replace function public.claim_agent_job(worker text)
returns setof public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.agent_jobs j
     set status     = 'running',
         locked_by  = worker,
         locked_at  = now(),
         attempts   = j.attempts + 1,
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id = (
     select q.id from public.agent_jobs q
      where q.status = 'queued' and q.run_after <= now()
      order by q.priority desc, q.created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

-- Jobs left 'running' by a worker that died (no heartbeat for stale_minutes)
-- go back to the queue, or to 'error' once max_attempts is spent.
create or replace function public.requeue_stale_agent_jobs(stale_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  with stale as (
    select id from public.agent_jobs
     where status = 'running' and locked_at < now() - make_interval(mins => stale_minutes)
     for update skip locked
  )
  update public.agent_jobs j
     set status     = case when j.attempts >= j.max_attempts then 'error' else 'queued' end,
         error      = case when j.attempts >= j.max_attempts
                           then 'Abandonné : le worker a cessé de répondre (' || j.attempts || ' tentatives).'
                           else j.error end,
         finished_at = case when j.attempts >= j.max_attempts then now() else j.finished_at end,
         locked_by  = null,
         locked_at  = null,
         updated_at = now()
    from stale
   where j.id = stale.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Atomic usage upsert (several calls may finish at the same time).
create or replace function public.record_agent_usage(p_model text, p_tokens_in integer, p_tokens_out integer, p_cost numeric)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.agent_usage (day, model, calls, tokens_in, tokens_out, cost_usd)
  values ((now() at time zone 'America/Toronto')::date, p_model, 1, p_tokens_in, p_tokens_out, p_cost)
  on conflict (day, model) do update
     set calls      = agent_usage.calls + 1,
         tokens_in  = agent_usage.tokens_in + excluded.tokens_in,
         tokens_out = agent_usage.tokens_out + excluded.tokens_out,
         cost_usd   = agent_usage.cost_usd + excluded.cost_usd;
$$;

-- Only the server (service role) may call these functions.
revoke all on function public.claim_agent_job(text) from public, anon, authenticated;
revoke all on function public.requeue_stale_agent_jobs(integer) from public, anon, authenticated;
revoke all on function public.record_agent_usage(text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.claim_agent_job(text) to service_role;
grant execute on function public.requeue_stale_agent_jobs(integer) to service_role;
grant execute on function public.record_agent_usage(text, integer, integer, numeric) to service_role;

-- RLS: enabled with no policy, so only the service role (which bypasses RLS)
-- reads or writes. The browser never talks to these tables directly.
alter table public.agents          enable row level security;
alter table public.agent_jobs      enable row level security;
alter table public.agent_activity  enable row level security;
alter table public.agent_tasks     enable row level security;
alter table public.agent_usage     enable row level security;
alter table public.agent_settings  enable row level security;
alter table public.agent_workers   enable row level security;

-- Optional: members of an entreprise may READ that entreprise's jobs and
-- tasks. Created only when a membership table exists with the expected shape
-- public.entreprise_membres(entreprise_id uuid, user_id uuid). If the
-- espace-entreprises branch names it differently, adapt the two names below
-- and re-run this file. Writes always stay service-role only.
do $$
begin
  if to_regclass('public.entreprise_membres') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'entreprise_membres' and column_name = 'entreprise_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'entreprise_membres' and column_name = 'user_id') then
    execute 'drop policy if exists agent_jobs_member_read on public.agent_jobs';
    execute 'create policy agent_jobs_member_read on public.agent_jobs for select to authenticated using (
               entreprise_id is not null and entreprise_id in (
                 select m.entreprise_id from public.entreprise_membres m where m.user_id = auth.uid()))';
    execute 'drop policy if exists agent_tasks_member_read on public.agent_tasks';
    execute 'create policy agent_tasks_member_read on public.agent_tasks for select to authenticated using (
               entreprise_id is not null and entreprise_id in (
                 select m.entreprise_id from public.entreprise_membres m where m.user_id = auth.uid()))';
    raise notice 'agents: member read policies created (entreprise_membres found).';
  else
    raise notice 'agents: no entreprise_membres table, member read policies skipped (service role only).';
  end if;
end;
$$;
