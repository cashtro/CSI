#!/usr/bin/env node
// Imports the 38 starting agents of the Centre de commande
// (db/seed_agents.json) into public.agents, through the same validation as
// POST /api/admin/agents/import.
//
//   node scripts/seed-agents.js            # adds the missing agents only
//   node scripts/seed-agents.js --force    # also rewrites the existing ones
//   node scripts/seed-agents.js --file autre.json
//
// Idempotent by id: running it twice adds nothing the second time. Needs
// SUPABASE_URL and SUPABASE_SERVICE_KEY (root-level .env). See MOTEUR-AGENTS.md.

const path = require('path');
const logger = require('../routes(api)/utils/logger');
const catalog = require('../agents/catalog');

async function run({ db, args = [] }) {
  const force = args.includes('--force');
  const i = args.indexOf('--file');
  const file = i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : catalog.SEED_FILE;
  const result = await catalog.seedAgents(db, catalog.loadSeed(file), { force });
  logger.info(`[agents] seed : ${result.inserted} ajouté(s), ${result.updated} mis à jour, ${result.skipped} déjà présent(s) sur ${result.total}.`);
  return result;
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logger.error('[agents] SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.');
    process.exit(1);
  }
  const { createSupabaseAdmin } = require('../routes(api)/utils/supabaseUtil');
  run({ db: createSupabaseAdmin(), args: process.argv.slice(2) })
    .then(() => process.exit(0))
    .catch((err) => { logger.error('[agents] seed échoué :', err.message); process.exit(1); });
}

module.exports = { run };
