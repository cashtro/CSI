// Static checks on the SQL migrations in ../db: execution order notes, the
// real membership table, RLS on every table, pinned search_path.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'db');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
// SQL without "--" comments, to check what actually runs.
const code = (f) => read(f).replace(/--.*$/gm, '');
const FILES = ['001_fulfillments.sql', '002_espace_entreprises.sql', '003_moteur_agents.sql', '004_protection_comptes.sql', '005_recherche_agents.sql', '006_robots.sql'];

describe('SQL migrations', () => {
  it('002 and 003 state the mandatory order 001, 002, 003', () => {
    for (const f of ['002_espace_entreprises.sql', '003_moteur_agents.sql']) {
      const head = read(f).split('\n').slice(0, 15).join('\n');
      expect(head).toMatch(/ORDRE D'EXECUTION OBLIGATOIRE/);
      expect(head).toMatch(/001_fulfillments\.sql[\s\S]*002_espace_entreprises\.sql|001_fulfillments\.sql[\s\S]*ce fichier \(002\)/);
      expect(head).toMatch(/003/);
    }
  });

  it('003 reads the real membership table (public.membres), never entreprise_membres', () => {
    const sql = code('003_moteur_agents.sql');
    expect(sql).not.toMatch(/entreprise_membres/);
    expect(sql).toMatch(/to_regclass\('public\.membres'\)/);
    expect(sql).toMatch(/public\.mon_entreprise\(\)/);
    expect(code('002_espace_entreprises.sql')).toMatch(/create table if not exists public\.membres/);
  });

  it('agent jobs are readable by members only through harmless columns', () => {
    const sql = code('003_moteur_agents.sql');
    const grant = /grant select \(([^)]*)\) on public\.agent_jobs to authenticated/.exec(sql);
    expect(grant).not.toBeNull();
    for (const col of ['payload', 'result', 'cost_usd', 'error', 'created_by']) expect(grant[1]).not.toMatch(new RegExp(`\\b${col}\\b`));
    expect(sql).not.toMatch(/create policy agent_tasks_member_read/);
  });

  it('every table has RLS enabled', () => {
    for (const f of FILES) {
      const sql = code(f);
      const tables = [...sql.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]);
      for (const t of tables) {
        expect({ file: f, table: t, rls: new RegExp(`alter table ${t.replace('.', '\\.')}\\s+enable row level security`).test(sql) })
          .toEqual({ file: f, table: t, rls: true });
      }
    }
  });

  it('every security definer function pins its search_path', () => {
    for (const f of FILES) {
      const sql = code(f);
      const fns = sql.split(/create or replace function/).slice(1);
      for (const body of fns) {
        if (/security definer/.test(body.split('$$')[0])) expect(body.split('$$')[0]).toMatch(/set search_path = public/);
      }
    }
  });

  it('no policy writes on behalf of the browser', () => {
    for (const f of FILES) expect(code(f)).not.toMatch(/for (insert|update|delete|all) to (anon|authenticated|public)/);
  });

  it('004 stops an account from granting itself admin and locks server-only tables', () => {
    const sql = code('004_protection_comptes.sql');
    expect(sql).toMatch(/create trigger proteger_roles_users before insert or update on public\."Users"/);
    expect(sql).toMatch(/new\."isAdmin" := false/);
    expect(sql).toMatch(/isAdmin ne peut etre modifie que par le serveur/);
    expect(sql).toMatch(/'Users_2fa', 'temp_sessions', 'fulfillments'/);
    expect(sql).toMatch(/revoke all on public\.%I from anon, authenticated/);
    expect(read('004_protection_comptes.sql')).toMatch(/003_moteur_agents\.sql, puis ce fichier \(004\)/);
  });

  it('005 runs after 004 and allows the research job kind', () => {
    const head = read('005_recherche_agents.sql').split('\n').slice(0, 10).join('\n');
    expect(head).toMatch(/ORDRE D'EXECUTION OBLIGATOIRE[\s\S]*004_protection_comptes\.sql/);
    const sql = code('005_recherche_agents.sql');
    expect(sql).toMatch(/drop constraint if exists agent_jobs_kind_check/);
    expect(sql).toMatch(/check \(kind in \('order', 'debate', 'research'\)\)/);
  });

  it('006 runs after 005, hides the tokens and the unvalidated deliverables from members', () => {
    const head = read('006_robots.sql').split('\n').slice(0, 12).join('\n');
    expect(head).toMatch(/ORDRE D'EXECUTION OBLIGATOIRE[\s\S]*005_recherche_agents\.sql, *\n?[\s\S]*ce fichier \(006\)/);
    const sql = code('006_robots.sql');
    const grant = /grant select \(([^)]*)\) on public\.connexions to authenticated/.exec(sql);
    expect(grant).not.toBeNull();
    expect(grant[1]).not.toMatch(/jetons/);
    expect(sql).toMatch(/jetons is null or jetons like 'enc:v1:%'/);
    expect(sql).not.toMatch(/grant [^;]* on public\.connexions_etats/);
    expect(sql).toMatch(/statut not in \('a_valider', 'refuse'\)/);
    expect(sql).toMatch(/revoke all on public\.robots_offres, public\.robots_actifs, public\.connexions, public\.connexions_etats\s+from anon, authenticated/);
  });
});
