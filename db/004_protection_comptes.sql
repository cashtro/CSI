-- Protection des comptes et des tables du serveur (audit plateforme).
--
-- ORDRE D'EXECUTION : 001_fulfillments.sql, puis 002_espace_entreprises.sql,
-- puis 003_moteur_agents.sql, puis ce fichier (004). Safe to re-run: every
-- statement is idempotent, and each block skips a table that does not exist.
--
-- Why: the public anon key is in every page, so anyone can call Supabase
-- directly with their own JWT. The server never relies on the browser to
-- write these rows, so the browser must not be able to either.
--
--   1. public."Users": an account may never give itself isAdmin (or
--      isTeacher). Only the server (service role) or the SQL editor may set
--      isAdmin; isTeacher may also be changed by an admin's own JWT (the
--      teacher request routes use it). Without this, a direct insert/update
--      of "isAdmin": true would open the admin console to any account that
--      then enrols its own authenticator.
--   2. "Users_2fa", temp_sessions, fulfillments: server-only. A user who
--      could write their own "Users_2fa" row could switch their 2FA off.
--   3. Tables of 002: writes go through the server only (RLS already has no
--      write policy; the grants are removed too).

-- ---------------------------------------------------------------- 1. Users roles

create or replace function public.proteger_roles_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  caller_is_admin boolean := false;
begin
  -- Service role (the server) and sessions without a JWT (SQL editor,
  -- migrations) keep full control.
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;

  select coalesce(u."isAdmin", false) into caller_is_admin
    from public."Users" u
   where u."userId"::text = auth.uid()::text;
  caller_is_admin := coalesce(caller_is_admin, false);

  if tg_op = 'INSERT' then
    new."isAdmin" := false;
    if not caller_is_admin then new."isTeacher" := false; end if;
  else
    if new."isAdmin" is distinct from old."isAdmin" then
      raise exception 'isAdmin ne peut etre modifie que par le serveur' using errcode = '42501';
    end if;
    if new."isTeacher" is distinct from old."isTeacher" and not caller_is_admin then
      raise exception 'isTeacher ne peut etre modifie que par un administrateur' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.proteger_roles_users() from public, anon, authenticated;

do $$
begin
  if to_regclass('public."Users"') is not null then
    execute 'drop trigger if exists proteger_roles_users on public."Users"';
    execute 'create trigger proteger_roles_users before insert or update on public."Users"
               for each row execute function public.proteger_roles_users()';
    raise notice 'Users: roles proteges (isAdmin, isTeacher).';
  else
    raise notice 'Users: table absente, trigger saute.';
  end if;
end;
$$;

-- ---------------------------------------------------------------- 2. Server-only tables

do $$
declare
  t text;
begin
  foreach t in array array['Users_2fa', 'temp_sessions', 'fulfillments'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
      raise notice '%: reserve au serveur.', t;
    end if;
  end loop;
end;
$$;

-- validate_temp_session (temp 2FA sessions) is called by the server only.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'validate_temp_session' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 3. Tables of 002

do $$
declare
  t text;
begin
  foreach t in array array['entreprises', 'membres', 'mandats', 'livrables', 'site_content'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
    end if;
  end loop;
end;
$$;
