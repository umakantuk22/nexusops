/**
 * Project Nexus - Explicit Database Seed CLI Script
 * Run with: node scripts/seed.js [--force]
 */
import { seedDemoDatabase } from '../src/server/seed.js';

const force = process.argv.includes('--force');
console.log(`[Seed CLI] Executing database seed (force=${force})...`);

seedDemoDatabase({ force })
  .then((res) => {
    if (res) {
      console.log('[Seed CLI] Seed finished successfully.');
    } else {
      console.log('[Seed CLI] Skipped: Database already populated. Pass --force to overwrite.');
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Seed CLI] Seed failed:', err);
    process.exit(1);
  });
