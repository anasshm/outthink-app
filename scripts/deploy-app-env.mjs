// Copies the server settings from app/.env.local into the linked Vercel
// project's Production environment, without printing any values.
//
// Usage (from the repository root, after `cd app && npx vercel link`):
//   node scripts/deploy-app-env.mjs --origin https://your-app.vercel.app
//
// APP_ORIGIN in .env.local is normally http://localhost:5173, so the production
// origin is passed separately (or through the PRODUCTION_ORIGIN variable).
// Existing Production values with the same names are replaced (--force).
// Redeploy afterwards so the new values take effect.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flag = args.indexOf('--origin');
const origin = (flag >= 0 ? args[flag + 1] : process.env.PRODUCTION_ORIGIN)?.replace(/\/$/, '');
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) throw Error('Pass the deployed app origin, e.g. --origin https://your-app.vercel.app');

const env = Object.fromEntries(readFileSync(resolve(root, 'app/.env.local'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('=')).map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const allowed = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_REASONING_EFFORT', 'APP_PASSWORD_HASH', 'APP_ORIGIN'];
env.APP_ORIGIN = origin;
for (const name of allowed) {
  if (!env[name]) throw Error(`Missing ${name} in app/.env.local. Run scripts/configure-server.mjs first.`);
  const p = spawnSync('npm', ['exec', '--yes', '--fetch-timeout=10000', '--fetch-retries=0', '--package=vercel', '--', 'vercel', 'env', 'add', name, 'production', '--force'], { cwd: resolve(root, 'app'), input: env[name], encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (p.status !== 0) { console.log(`Could not configure ${name}. Is app/ linked to a Vercel project (npx vercel link)? No secret output was printed.`); process.exit(1); }
  console.log(`Configured ${name}.`);
}
console.log('Done. Redeploy (npx vercel deploy --prod from app/) so the new values take effect.');
