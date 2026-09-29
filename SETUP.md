# Setting up your own OutThink

This guide takes you from a fresh clone to a running, password-protected OutThink on your own Supabase database and Vercel deployment. Nothing here is shared with anyone else's installation: you create every resource, key and password yourself.

Budget about 20 minutes. Commands are run from the repository root unless a step says `cd app`.

## 0. Prerequisites

- **Node.js 22 LTS or newer** and npm. (The API dev server uses `node --env-file`, and Vite 8 needs a current Node.)
- A **Supabase** account ([supabase.com](https://supabase.com)). The Supabase CLI is optional; `npx supabase` works without installing it.
- An **OpenAI API key** with access to the configured model (`gpt-6-astra` by default) and some API credit. OutThink still works without AI (checkboxes and forms), but chat logging, journaling through chat, and reflection need it.
- A **Vercel** account ([vercel.com](https://vercel.com)) for hosting. The CLI is optional (`npx vercel`).

```sh
git clone <your-repo-url> outthink && cd outthink
cd app && npm install && cd ..
```

## 1. Create a Supabase project

1. In the Supabase dashboard choose **New project**.
2. Pick a name, a strong database password (save it in your password manager; the CLI asks for it), and a **region close to you**. Note the region; you will match your Vercel function region to it in step 8.
3. Wait until the project is ready. Your **project ref** is the random ID in the dashboard URL and in the project URL `https://<ref>.supabase.co`.

OutThink does not use Supabase Auth, Storage or Realtime. It only needs Postgres and the REST API, accessed by the server with the secret key.

## 2. Apply the database migrations

The schema lives in `supabase/migrations/`. Apply **every file, in filename order** (the names start with a timestamp):

```
202609110001_outthink.sql
202609110002_activity_units.sql
202609110003_review_context.sql
202609120001_logging_context.sql
202609130001_daily_xp_bonus.sql
202609140001_activity_sop.sql
202609140002_activity_discussion.sql
```

(Use `ls supabase/migrations` to see the current list; later versions may add files.)

Choose one method:

**A. Supabase CLI (recommended)**

```sh
npx supabase login
npx supabase link --project-ref <ref>      # asks for the database password from step 1
npx supabase db push                       # applies supabase/migrations in order
```

If the CLI complains that `supabase/config.toml` is missing, run `npx supabase init` once first (it only adds local config files, which are fine to keep or ignore). `supabase db push` remembers what it applied, so re-running it later applies only new migrations.

**B. SQL editor**

In the dashboard open **SQL Editor**, paste the full contents of the first migration file, run it, and repeat for each file in order. Keep track of which files you have run: the migrations are not idempotent, so running one twice fails with "already exists" errors (harmless, but confusing).

**C. Helper script (Management API)**

```sh
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> node scripts/outthink-supabase.mjs apply-all
```

`apply-all` is for an empty project only. For a single new file use `apply-migration <filename.sql>`; `inspect` lists the public tables and whether row-level security is on. A personal access token comes from **Account → Access Tokens**, or the script reuses the token saved by `supabase login`.

**Check:** in **Table Editor** you should see ten `ot_*` tables (`ot_meta`, `ot_activities`, `ot_logs`, `ot_journal`, `ot_messages`, `ot_goals`, `ot_proposals`, `ot_receipts`, `ot_sessions`, `ot_limits`), and `ot_meta` should contain one row with the default settings. All of them have RLS enabled and no grants to `anon` or `authenticated`, so the public browser keys cannot read or write anything. Keep it that way.

## 3. Get the Supabase URL and server key

In **Project Settings → API Keys** (older dashboards: **Project Settings → API**):

- **Project URL:** `https://<ref>.supabase.co` → `SUPABASE_URL`
- **Secret key** (`sb_secret_...`), or the legacy **service_role** key → `SUPABASE_SERVICE_KEY`

This key bypasses row-level security. It must only ever live in `app/.env.local` and in Vercel's server-side environment variables. Never put it in frontend code or in a variable starting with `VITE_`. You do not need the publishable/anon key at all.

## 4. Get an OpenAI API key

Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → `OPENAI_API_KEY`. Make sure the project has billing/credit and access to the model in `AI_MODEL` (default `gpt-6-astra`). To use a different model, see [CUSTOMIZING.md](CUSTOMIZING.md#tuning-the-ai).

## 5. Choose your password and write `app/.env.local`

OutThink has one password and no user accounts. The server never stores the password itself, only a salted scrypt hash in `APP_PASSWORD_HASH` (format `<64-hex salt>:<128-hex hash>`). At login, `app/server/auth.mjs` hashes what you type with the same salt and compares in constant time; eight failed attempts per IP lock logins for 15 minutes.

`scripts/configure-server.mjs` writes the whole server configuration for you:

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_KEY=<secret key> \
OPENAI_API_KEY=<openai key> \
node scripts/configure-server.mjs
```

What it does:

1. Collects values from the environment, then from an existing `app/.env.local`, then defaults: `AI_PROVIDER=openai`, `AI_MODEL=gpt-6-astra`, `AI_REASONING_EFFORT=low`, `APP_ORIGIN=http://localhost:5173`. Any extra variables already in `.env.local` are kept.
2. Checks Supabase by reading `ot_meta` with your key (this fails if the key is wrong **or the migrations are not applied yet**), and checks that your OpenAI key can see `AI_MODEL`.
3. Asks for the app password without echoing it (or reads it from stdin when piped), generates a random 32-byte salt, and stores only the hash.
4. Writes `app/.env.local` with permissions `0600`. No secret is printed.

Options: `--skip-checks` writes the file without contacting Supabase or OpenAI; `--keep-password` keeps the existing hash and does not ask. Once `.env.local` exists you can re-run the script without the environment variables, e.g. to change the password.

<details>
<summary>Doing it by hand instead</summary>

```sh
cp app/.env.example app/.env.local && chmod 600 app/.env.local
# generate a hash (note: this puts the password in your shell history)
node -e 'const c=require("crypto"),s=c.randomBytes(32).toString("hex");console.log(s+":"+c.scryptSync(process.argv[1],s,64).toString("hex"))' 'your password'
```

Paste the output into `APP_PASSWORD_HASH=` and fill in the other values.
</details>

| Variable | Required | Meaning |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | yes | Supabase secret / service_role key (server only) |
| `OPENAI_API_KEY` | for AI | Without it, chat reports that AI is not configured; manual logging still works |
| `AI_PROVIDER` | no | `openai` (the only built-in adapter) |
| `AI_MODEL` | no | Default `gpt-6-astra` |
| `AI_REASONING_EFFORT` | no | Default `low` for `gpt-6-astra`; leave empty for models without reasoning settings |
| `APP_PASSWORD_HASH` | yes | `salt:hash` from step 5 |
| `APP_ORIGIN` | yes | The origin browsers use to open the app (`http://localhost:5173` locally; your https URL in production) |

## 6. Run locally

```sh
cd app
npm run dev:api     # terminal 1: API on 127.0.0.1:3001, loads .env.local
npm run dev         # terminal 2: Vite on http://localhost:5173, proxies /api to 3001
```

Open http://localhost:5173 and unlock with your password. A fresh install has an empty catalogue: add your first activity with **Add an activity**, or open chat (the floating **+**) and say something like "Create an activity called Workout: 30 Physical XP per completion". A good first step is to write down a goal the same way ("Add a goal: finish my certification by March, linked to the Work pillar") so suggestions can point toward it.

## 7. Optional: load the Wren demo data

The repository includes a fictional dataset in `demo/demo-data.json`: **Wren, a ranger-for-hire in the town of Ashvale**. It has 26 activities across all four pillars (Patrol Run, Barracks Sparring, Rune Meditation, Guild Contracts with a first-hour bonus and an SOP, Enchanting Workshop, Study Spellbooks, Send a Raven to the Lodge, the negative-XP Crystal Ball Doomscroll, and more), 106 logs over 18 days, and 2 journal entries. It is the quickest way to see full rings, streaks, suggestions and history.

```sh
node scripts/seed-demo.mjs --dry-run    # shows the date shift and XP totals; no network calls
node scripts/seed-demo.mjs              # writes the demo
```

- It reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from the environment or `app/.env.local`.
- Dates are shifted by whole days so the demo's last day is **today**.
- It also saves the demo's settings (time zone `UTC`, day starting at 06:00, work-limit costs set to zero, default targets) into `ot_meta`.
- It refuses to run if the project already has activities, logs or journal entries. `--replace` first **deletes all existing OutThink data** (activities, logs, journal, messages, goals, proposals, receipts; sessions and rate limits are kept) and then loads the demo. Use it on a demo project, not on your real history.

Refresh the app after seeding. [demo/README.md](demo/README.md) lists every demo activity and what it demonstrates. See [section 11](#11-reset-or-remove-the-demo-data) to remove it again.

## 8. Deploy to Vercel

Only the `app/` directory is deployed. It contains the Vite frontend and a single serverless function, `api/outthink.mjs`. `app/vercel.json` sets the framework, build command, output directory, a 60-second function timeout, and security headers (including `noindex`).

**Function region.** `app/vercel.json` pins the API to `"regions": ["lhr1"]` (London). Change it to the Vercel region nearest your Supabase region, since every request makes several database round trips. Examples: Supabase `us-east-1` → `iad1`, `us-west-1` → `sfo1`, `eu-west-2` → `lhr1`, `eu-central-1` → `fra1`, `ap-southeast-1` → `sin1`, `ap-northeast-1` → `hnd1`. See Vercel's region list for others.

### Option A: import from GitHub (dashboard)

1. Push your repository to GitHub, then **Add New → Project** in Vercel and import it.
2. Set **Root Directory** to `app`. The Vite preset, build command and output are read from `vercel.json`.
3. Add the eight environment variables from the table in step 5 (Production, and Preview if you want preview deployments to work). Copy the values from `app/.env.local`, but set `APP_ORIGIN` to your production URL, for example `https://outthink-yourname.vercel.app`. If you do not know the URL yet, deploy once, then set it and redeploy.
4. Deploy. Every push to your main branch redeploys.

### Option B: Vercel CLI

```sh
cd app
npx vercel link                 # create a new project; answer that the code is in the current directory
npx vercel deploy --prod        # first deploy, to learn the production URL
cd ..
node scripts/deploy-app-env.mjs --origin https://<your-project>.vercel.app
cd app && npx vercel deploy --prod   # redeploy so the variables take effect
```

`scripts/deploy-app-env.mjs` reads `app/.env.local`, replaces `APP_ORIGIN` with the `--origin` you pass (or `PRODUCTION_ORIGIN`), and pipes each of the eight variables into `vercel env add <NAME> production --force` in the linked `app/` project, without printing values. It only sets the **Production** environment.

`.vercelignore` keeps `.env*` files and tests out of the upload.

## 9. `APP_ORIGIN`

Every POST request (login and all writes) must carry an `Origin` header equal to either the URL the request arrived on or `APP_ORIGIN`; anything else is rejected with "Open OutThink directly to make changes." On Vercel the request URL already matches the domain you opened, so a wrong `APP_ORIGIN` is rarely fatal, but set it to your real production origin (scheme + host, no trailing slash). Update it if you add a custom domain, and set it to `http://localhost:5173` locally.

Session cookies are `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS, and last 90 days. **Lock OutThink** deletes the current session.

## 10. Changing the password or signing out every device

1. Run `node scripts/configure-server.mjs` again and type the new password (it keeps your other values).
2. Update `APP_PASSWORD_HASH` in Vercel (`node scripts/deploy-app-env.mjs --origin ...`, or the dashboard) and redeploy.
3. Existing sessions stay valid until they expire. To sign out every device, run in the Supabase SQL editor:

   ```sql
   delete from ot_sessions;
   ```

## 11. Reset or remove the demo data

To reload a fresh copy of the demo (dates shifted to today again):

```sh
node scripts/seed-demo.mjs --replace
```

To remove the demo and start with an empty OutThink, run this in the Supabase SQL editor (it deletes **all** OutThink records, not only demo rows; the editor may ask you to confirm deletes without a `where` clause):

```sql
delete from ot_logs;
delete from ot_journal;
delete from ot_messages;
delete from ot_goals;
delete from ot_proposals;
delete from ot_activities;
delete from ot_receipts;
update ot_meta set clarification = null, revision = revision + 1 where id = 1;
```

The seeder replaced your settings with the demo's, so set your own time zone and day start afterwards, either by asking chat ("Set my time zone to Europe/Lisbon and start my day at 8") and confirming the card, or directly:

```sql
update ot_meta
set settings = settings || '{"timezone": "Europe/Lisbon", "cutoff": 8}'::jsonb,
    revision = revision + 1
where id = 1;
```

Bumping `revision` makes any open app tab reload instead of writing over the change.

## Troubleshooting

- **"Server storage is not configured."** `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` is missing in the API's environment (`app/.env.local` locally, Vercel env vars in production). Redeploy after changing Vercel variables.
- **"Password access is not configured."** `APP_PASSWORD_HASH` is missing or not in `salt:hash` form.
- **`configure-server.mjs`: "Supabase check failed (404)"** usually means the migrations are not applied; 401 means a wrong key.
- **Relation "ot_…" does not exist.** A migration was skipped. Apply the missing files in order.
- **Chat says the AI connection is not configured / quota exhausted / at its usage limit.** Check `OPENAI_API_KEY`, billing, and that `AI_MODEL` is available to your key. Manual logging keeps working.
- **"Open OutThink directly to make changes."** The browser's origin did not match; check `APP_ORIGIN` and that you are not calling the API from another site.
- **Rings and dates look a day off.** Check the time zone and day cutoff ([CUSTOMIZING.md](CUSTOMIZING.md#time-zone-and-day-cutoff)).

Next: [CUSTOMIZING.md](CUSTOMIZING.md) to make OutThink your own.
