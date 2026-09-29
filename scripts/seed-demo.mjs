// Seed the fictional "Wren of Ashvale" demo into an OutThink Supabase project.
//
//   node scripts/seed-demo.mjs [--dry-run] [--replace]
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from the environment, falling
// back to app/.env.local. All demo dates are shifted by whole days so the
// latest logged day becomes "today" (a personal day in the demo timezone and
// cutoff). --dry-run makes no network calls at all.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, personalDay, shiftDay, totalsFor, round } from '../app/shared/domain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const DAY_MS = 86400000;
const BATCH = 100;

const args = process.argv.slice(2);
const unknown = args.filter(a => !['--dry-run', '--replace', '--help', '-h'].includes(a));
if (args.includes('--help') || args.includes('-h') || unknown.length) {
  if (unknown.length) console.error(`Unknown option: ${unknown.join(' ')}`);
  console.log('Usage: node scripts/seed-demo.mjs [--dry-run] [--replace]\n  --dry-run  show what would be written, without touching the network\n  --replace  wipe existing OutThink data (not sessions/rate limits) before seeding');
  process.exit(unknown.length ? 2 : 0);
}
const dryRun = args.includes('--dry-run');
const replace = args.includes('--replace');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- demo data
const data = JSON.parse(readFileSync(resolve(root, 'demo/demo-data.json'), 'utf8'));
const { settings } = data;
for (const key of ['activities', 'logs', 'journal']) if (!Array.isArray(data[key])) fail(`demo-data.json is missing "${key}".`);
if (!settings?.timezone || typeof settings.cutoff !== 'number') fail('demo-data.json settings need a timezone and cutoff.');
const activityIds = new Set(data.activities.map(a => a.id));
const orphans = data.logs.filter(l => !activityIds.has(l.activity_id));
if (orphans.length) fail(`${orphans.length} demo logs point at unknown activities.`);

// ---------------------------------------------------------------- date shift
const today = personalDay(new Date(), settings);
const latest = data.logs.map(l => l.day).sort().at(-1);
const offset = Math.round((Date.parse(today) - Date.parse(latest)) / DAY_MS);
const shiftTime = t => (t == null ? t : new Date(Date.parse(t) + offset * DAY_MS).toISOString());

const activities = data.activities.map(a => ({ ...a, created_at: shiftTime(a.created_at), updated_at: shiftTime(a.updated_at) }));
const logs = data.logs.map(l => ({ ...l, day: shiftDay(l.day, offset), created_at: shiftTime(l.created_at), sop_reminded_at: shiftTime(l.sop_reminded_at) }));
const journal = data.journal.map(j => ({ ...j, day: shiftDay(j.day, offset), created_at: shiftTime(j.created_at) }));

const allDays = [...logs, ...journal].map(r => r.day).sort();
const [firstDay, lastDay] = [allDays[0], allDays.at(-1)];
const totals = totalsFor(logs, settings, today);
const future = [...activities, ...logs, ...journal].filter(r => Date.parse(r.created_at) > Date.now()).length;

console.log('OutThink demo seeder: Wren, ranger-for-hire of Ashvale\n');
console.log(`  Personal day now : ${today} (${settings.timezone}, day starts ${settings.cutoff}:00)`);
console.log(`  Shift            : ${offset >= 0 ? '+' : ''}${offset} day${Math.abs(offset) === 1 ? '' : 's'} (latest demo day ${latest} -> ${today})`);
console.log(`  New date range   : ${firstDay} .. ${lastDay}`);
console.log(`  Rows             : ${activities.length} activities, ${logs.length} logs (${logs.filter(l => l.done).length} done), ${journal.length} journal entries`);
console.log(`  Last 7 days XP   : (${shiftDay(today, -6)} .. ${today}, net of penalties)`);
for (const area of AREAS) {
  const got = totals[area].seven, target = settings.targets?.[area]?.seven;
  const pct = target ? ` / ${target}  (${Math.round((got / target) * 100)}%)` : '';
  console.log(`    ${area.padEnd(9)} ${String(round(got)).padStart(6)}${pct}   today ${totals[area].today}`);
}
if (future) console.log(`  Note: ${future} timestamp(s) land later today than "now"; harmless, they only order entries.`);

if (dryRun) {
  console.log('\nDry run: no network calls were made and nothing was written.');
  console.log(replace
    ? 'A real run with --replace would clear ot_logs, ot_journal, ot_messages, ot_goals, ot_proposals, ot_activities and ot_receipts first.'
    : 'A real run refuses to write if activities, logs or journal entries already exist (use --replace to clear them).');
  process.exit(0);
}

// ---------------------------------------------------------------- connection
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) loadEnvFile(resolve(root, 'app/.env.local'));
const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!base || !key) fail('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (in the environment or app/.env.local).');
if (!/^https?:\/\/[^/]+$/.test(base)) fail(`SUPABASE_URL should look like https://your-project.supabase.co (got "${base}").`);

async function rest(method, path, { body, prefer = 'return=minimal' } = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) fail(`Supabase ${method} /rest/v1/${path} returned ${response.status}:\n${text}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- write
try {
  const occupied = [];
  for (const table of ['ot_activities', 'ot_logs', 'ot_journal'])
    if ((await rest('GET', `${table}?select=id&limit=1`)).length) occupied.push(table);
  if (occupied.length && !replace)
    fail(`This project already has data in ${occupied.join(', ')}.\n  Nothing was changed. Re-run with --replace to wipe it and load the demo instead.`);

  if (replace) {
    // Logs reference activities, so they go first. Sessions and rate limits stay.
    for (const table of ['ot_logs', 'ot_journal', 'ot_messages', 'ot_goals', 'ot_proposals', 'ot_activities', 'ot_receipts']) {
      await rest('DELETE', `${table}?id=not.is.null`);
      console.log(`  cleared ${table}`);
    }
  }

  for (const [table, rows] of [['ot_activities', activities], ['ot_logs', logs], ['ot_journal', journal]]) {
    for (let i = 0; i < rows.length; i += BATCH) await rest('POST', table, { body: rows.slice(i, i + BATCH) });
    console.log(`  inserted ${rows.length} ${table}`);
  }

  // Settings and the revision bump go last so open clients reload onto the
  // complete demo rather than a half-written one. The revision filter makes
  // the bump safe against a concurrent app write.
  let revision;
  for (let attempt = 0; attempt < 5 && revision === undefined; attempt++) {
    const [meta] = await rest('GET', 'ot_meta?id=eq.1&select=revision,settings');
    if (!meta) {
      await rest('POST', 'ot_meta', { body: { id: 1, revision: 1, settings } });
      revision = 1;
      break;
    }
    const merged = { ...(meta.settings || {}), ...settings };
    const updated = await rest('PATCH', `ot_meta?id=eq.1&revision=eq.${meta.revision}`, {
      body: { settings: merged, revision: Number(meta.revision) + 1 },
      prefer: 'return=representation',
    });
    if (updated.length) revision = updated[0].revision;
  }
  if (revision === undefined) fail('Could not update ot_meta: the app kept writing at the same time. Try again.');
  console.log(`  saved demo settings to ot_meta (revision ${revision})`);
} catch (error) {
  fail(`Seeding stopped: ${error.message}`);
}

console.log(`\n✔ Wren's last ${allDays.length ? Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / DAY_MS) + 1 : 0} days in Ashvale are loaded (${firstDay} .. ${lastDay}).`);
console.log('  Open OutThink and refresh: rings, streak and suggestions should all be populated.');
console.log('  To remove the demo later, delete the rows as described in demo/README.md.');
