// Optional Supabase Management API helper for your own OutThink project.
// The Supabase CLI (`supabase db push`) or the dashboard SQL editor are the
// simpler ways to apply migrations; see SETUP.md.
//
// Project: SUPABASE_PROJECT_REF, or derived from SUPABASE_URL
//          (https://<ref>.supabase.co) in the environment or app/.env.local.
// Token:   SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...), or the
//          token saved by `supabase login` (macOS keychain or ~/.supabase/access-token).
//
// Usage (from the repository root):
//   node scripts/outthink-supabase.mjs inspect
//   node scripts/outthink-supabase.mjs apply-migration 202609110001_outthink.sql
//   node scripts/outthink-supabase.mjs apply-all
//   node scripts/outthink-supabase.mjs read-query path/to/query.sql
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, 'app/.env.local');
const localEnv = existsSync(envPath)
  ? Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const url = process.env.SUPABASE_URL || localEnv.SUPABASE_URL || '';
const project = process.env.SUPABASE_PROJECT_REF || url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)?.[1];
if (!project) throw Error('Set SUPABASE_PROJECT_REF, or SUPABASE_URL=https://<project-ref>.supabase.co in the environment or app/.env.local.');

let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && platform() === 'darwin') {
  try { token = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'access-token', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* fall through */ }
}
if (!token) {
  try { token = readFileSync(resolve(homedir(), '.supabase/access-token'), 'utf8').trim(); } catch { /* fall through */ }
}
if (token?.startsWith('go-keyring-base64:')) token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString();
if (!token || !/^sbp_(oauth_)?[a-f0-9]{40}$/.test(token)) throw Error('Set SUPABASE_ACCESS_TOKEN or run `supabase login`. No credential contents were printed.');

async function request(path, method = 'GET', body) {
  const allowed = ['/database/query', '/database/migrations'];
  if (!allowed.includes(path)) throw Error('Unsupported management operation');
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`Supabase ${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

async function applyMigration(file) {
  if (!file || basename(file) !== file || !file.endsWith('.sql')) throw Error('Pass a migration filename only');
  const query = readFileSync(resolve(root, 'supabase/migrations', file), 'utf8');
  const result = await request('/database/migrations', 'POST', { name: file.replace(/\.sql$/, ''), query });
  console.log(JSON.stringify({ migration: file, result }));
}

const [mode, file] = process.argv.slice(2);
if (mode === 'inspect') {
  const tables = await request('/database/query', 'POST', { query: "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename", read_only: true });
  console.log(JSON.stringify({ project, tables }, null, 2));
} else if (mode === 'apply-migration') {
  await applyMigration(file);
} else if (mode === 'apply-all') {
  // For a brand-new, empty project only: the migrations are not idempotent.
  for (const name of readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await applyMigration(name);
} else if (mode === 'read-query') {
  if (!file) throw Error('Pass a SQL file');
  const query = readFileSync(resolve(file), 'utf8');
  console.log(JSON.stringify(await request('/database/query', 'POST', { query, read_only: true }), null, 2));
} else {
  throw Error('Choose inspect, apply-migration <file.sql>, apply-all, or read-query <file.sql>');
}
