#!/usr/bin/env node
// Agent engine worker: a separate process from the web server.
//
//   pm2 start scripts/agents-worker.js --name pandora-agents
//
// Reads the same root-level .env as server.js. It needs SUPABASE_URL and
// SUPABASE_SERVICE_KEY; without ANTHROPIC_API_KEY (or with AGENTS_ENABLED
// not "true") it logs why and stays idle. See MOTEUR-AGENTS.md.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const logger = require('../routes(api)/utils/logger');
const { createSupabaseAdmin } = require('../routes(api)/utils/supabaseUtil');
const { createWorker } = require('../agents/worker');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  logger.error('[agents] SUPABASE_URL and SUPABASE_SERVICE_KEY are required. Worker not started.');
  process.exit(1);
}

const pollMs = parseInt(process.env.AGENTS_POLL_MS, 10) || 5000;
const worker = createWorker({ db: createSupabaseAdmin(), pollMs });

let exiting = false;
async function shutdown(signal) {
  if (exiting) return;
  exiting = true;
  logger.info(`[agents] ${signal} reçu.`);
  try { await worker.stop(); } catch (err) { logger.error('[agents] stop failed:', err.message); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('[agents] unhandledRejection', reason));

worker.start();
