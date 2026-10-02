// The local demo fakes Supabase and signs in an admin without a password: it
// must never start in production.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { demoAllowed } = require('../scripts/demo/guard');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'demo-admin.js');
function run(env) {
  const clean = { PATH: process.env.PATH, ...env };
  return spawnSync(process.execPath, [SCRIPT], { env: clean, encoding: 'utf8', timeout: 10000 });
}

describe('demo mode guard', () => {
  it('needs DEMO_MODE=true and a non-production NODE_ENV', () => {
    expect(demoAllowed({ DEMO_MODE: 'true', NODE_ENV: 'development' }).ok).toBe(true);
    expect(demoAllowed({ DEMO_MODE: 'true' }).ok).toBe(true);
    expect(demoAllowed({ DEMO_MODE: 'true', NODE_ENV: 'production' }).ok).toBe(false);
    expect(demoAllowed({ DEMO_MODE: 'true', NODE_ENV: ' Production ' }).ok).toBe(false);
    expect(demoAllowed({ NODE_ENV: 'development' }).ok).toBe(false);
    expect(demoAllowed({ DEMO_MODE: '1' }).ok).toBe(false);
    expect(demoAllowed({ DEMO_MODE: 'TRUE' }).ok).toBe(false);
  });

  it('refuses under PM2, how the site runs in production', () => {
    expect(demoAllowed({ DEMO_MODE: 'true', NODE_ENV: 'development', pm_id: '0' }).ok).toBe(false);
  });

  it('the script exits with an error in production, before starting anything', () => {
    const res = run({ DEMO_MODE: 'true', NODE_ENV: 'production', DEMO_PORT: '0' });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/Mode démo refusé : NODE_ENV=production/);
    expect(res.stdout + res.stderr).not.toMatch(/Démo prête/);
  });

  it('the script exits without DEMO_MODE=true', () => {
    const res = run({ NODE_ENV: 'development' });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/DEMO_MODE=true/);
  });

  it('the site never loads the demo', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(server).not.toMatch(/demo-admin|DEMO_MODE|scripts\/demo/);
    const pages = fs.readFileSync(path.join(__dirname, '..', 'routes(api)', 'espacePages.js'), 'utf8');
    expect(pages).not.toMatch(/demo-admin|DEMO_MODE|scripts\/demo/);
  });
});
