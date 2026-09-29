// One-time setup helper: writes app/.env.local for the OutThink server.
//
// Usage (from the repository root):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=... OPENAI_API_KEY=... \
//     node scripts/configure-server.mjs
//
// Values are taken from the environment first, then from an existing
// app/.env.local, then from defaults (AI_PROVIDER=openai, AI_MODEL=gpt-6-astra,
// AI_REASONING_EFFORT=low, APP_ORIGIN=http://localhost:5173).
// The app password is read from stdin (typed without echo in a terminal, or
// piped). Only a salted scrypt hash is written, never the password itself.
// The script checks that the Supabase migrations are applied and that the
// OpenAI key can see the configured model. It never prints credentials.
//
// Flags:
//   --skip-checks   write the file without contacting Supabase or OpenAI
//   --keep-password keep the existing APP_PASSWORD_HASH instead of asking
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, 'app/.env.local');
const args = new Set(process.argv.slice(2));
const order = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_REASONING_EFFORT', 'APP_PASSWORD_HASH', 'APP_ORIGIN'];
const defaults = { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-6-astra', AI_REASONING_EFFORT: 'low', APP_ORIGIN: 'http://localhost:5173' };

function parseEnv(text) {
  return Object.fromEntries(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
  }));
}

const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const env = { ...existing };
for (const name of order) {
  if (process.env[name]) env[name] = process.env[name];
  else if (!env[name] && defaults[name]) env[name] = defaults[name];
}
if (!args.has('--keep-password')) delete env.APP_PASSWORD_HASH;

const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY'].filter(n => !env[n]);
if (missing.length) throw Error(`Missing ${missing.join(', ')}. Set them in the environment or in app/.env.local. See SETUP.md.`);
if (!/^https:\/\/[^/]+$/.test(env.SUPABASE_URL.replace(/\/$/, ''))) throw Error('SUPABASE_URL should look like https://<project-ref>.supabase.co');
env.SUPABASE_URL = env.SUPABASE_URL.replace(/\/$/, '');

if (!args.has('--skip-checks')) {
  const storage = await fetch(`${env.SUPABASE_URL}/rest/v1/ot_meta?select=id`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!storage.ok) throw Error(`Supabase check failed (${storage.status}). Check the URL and secret/service_role key, and apply supabase/migrations first.`);
  if (env.AI_PROVIDER === 'openai') {
    const models = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!models.ok) throw Error(`OpenAI key check failed (${models.status}).`);
    const names = (await models.json()).data.map(m => m.id);
    if (!names.includes(env.AI_MODEL)) throw Error(`The model ${env.AI_MODEL} is not available to this OpenAI key. Set AI_MODEL to one it can use.`);
  }
}

async function readPassword() {
  if (!process.stdin.isTTY) return readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  process.stdout.write('Choose the OutThink password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((done, fail) => {
    let value = '';
    process.stdin.on('data', chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
          return done(value);
        }
        if (ch === '\u0003') { process.stdin.setRawMode(false); process.stdout.write('\n'); return fail(Error('Cancelled.')); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1); else value += ch;
      }
    });
  });
}

if (!env.APP_PASSWORD_HASH) {
  const password = await readPassword();
  if (!password.trim()) throw Error('Supply the chosen password on stdin.');
  if (password.length >= 1024) throw Error('Use a password shorter than 1024 characters.');
  const salt = randomBytes(32).toString('hex');
  env.APP_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const keys = [...order, ...Object.keys(env).filter(k => !order.includes(k))];
writeFileSync(envPath, keys.filter(k => env[k] !== undefined).map(k => `${k}=${env[k]}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(`Saved app/.env.local with the server connection, AI settings and password hash.${args.has('--skip-checks') ? ' Checks were skipped.' : ' Supabase and model access verified.'} No credentials printed.`);
