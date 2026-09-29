# OutThink app

React + TypeScript + Vite frontend, a Vercel Node API (`api/outthink.mjs`), Supabase Postgres, and a replaceable OpenAI model adapter. Only this directory is deployed. For first-time setup see the root [SETUP.md](../SETUP.md); for configuration see [CUSTOMIZING.md](../CUSTOMIZING.md).

## Local development

```sh
npm install
npm run dev:api
```

In another terminal:

```sh
npm run dev
```

`dev:api` runs `server/dev.mjs` with `node --env-file=.env.local` on `127.0.0.1:3001`. Vite serves the frontend on port 5173 and proxies `/api` to it.

Create `.env.local` with `node scripts/configure-server.mjs` from the repository root (it asks for your password and stores only its scrypt hash), or copy `.env.example` and fill it in by hand. Never prefix a secret with `VITE_`: the frontend needs no keys at all. `.env.local` is ignored by Git and Vercel and should have permissions `0600`. Production values live in Vercel environment variables.

The database schema is in `../supabase/migrations/`; apply the files in filename order (SETUP.md, step 2). Supabase must never expose any `ot_*` table or function to `anon` or `authenticated`; only this server uses the service key.

## Checks

```sh
npm run build
npm run lint
npm test
npm run test:ui
```

Optional real-model checks (fictional data, small API usage, no database writes):

```sh
node --env-file=.env.local tests/ai-smoke.mjs
node --env-file=.env.local tests/chat-smoke.mjs
```

The real Supabase test is `node --env-file=.env.local tests/integration.mjs`. Supply your app password on stdin; the test does not contain it. It creates uniquely labeled records, verifies real commits and confirmation boundaries, then removes only its own UUIDs. Make sure `.env.local` points at the project you intend to test.

`npm run format` formats code with Prettier. UI tests use a DOM simulator, not a physical browser, so they do not establish visual layout or real iPhone haptics.

## Deploy

See [SETUP.md, step 8](../SETUP.md#8-deploy-to-vercel). In short: a Vercel project whose root directory is `app`, the eight server environment variables, and `APP_ORIGIN` set to your production origin.

`vercel.json` pins the API function to London (`lhr1`). Change `regions` to the Vercel region closest to your Supabase project; every request makes several database round trips. `.vercelignore` excludes environment files and tests.

`scripts/deploy-app-env.mjs` (repository root) copies the values from `.env.local` into the linked Vercel project's Production environment through stdin, without printing them, using the `--origin` you pass for `APP_ORIGIN`. Then deploy:

```sh
npx vercel deploy --prod
```

Password sessions last 90 days; **Lock OutThink** deletes the current session. To revoke all devices after a password change, run `delete from ot_sessions;` in the Supabase SQL editor.

## How the pieces fit

**Chat.** The floating + button opens a full-page chat on phone and desktop, with a centered reading column on larger screens. The native dialog keeps keyboard focus in chat and pauses dashboard scrolling. Sending immediately shows your message, clears the input, and displays a thinking indicator. Failed requests keep the message with a retry using the same request ID; replies never erase a new draft. Messages scroll independently and the input follows the visible viewport above the phone keyboard. Back to dashboard or Escape closes chat and preserves the draft; logging still hands off automatically to Pending.

**Pending cards.** Known completed activities become Pending today cards using the same `TaskRow` component as suggestions. A successful logging-only response hands off from chat to the cards with reduced-motion support and focus transfer. A clarification, catalogue/journal review, or new draft keeps chat open. Each checkbox confirms one completion and runs the normal rewards, then the card fades out. An empty Pending section disappears. Completed cards stay hidden after refresh; undo and restore remain available from pillar activity history. Older reported dates appear under Pending earlier, and all waiting cards survive refreshes.

These cards use the `ot_proposals` table. The server splits independent logs into individual proposals; a `pending_log` object inside each action holds its batch ID and, after confirmation, the saved log ID and confirmation time. Atomic writes (`ot_apply`) and request receipts prevent duplicate saves. Separate completion cards do not invalidate each other when checked; changes to the reviewed activity still require fresh review. Catalogue changes and dependent logs keep the combined confirmation flow. `pendingActivities()` supplies the reusable view model, and only completion drafts enter routine AI context.

**All activities.** The last dashboard card lists the full active catalogue alphabetically, without the suggestion limit or frequency filter. It shares the same optimistic check, rewards, exit animation, and rollback. Completed activities stay hidden for the current day. When a current-day Pending entry exists, its quantity and XP appear here and either card confirms that same entry. Archived activities are excluded.

**Logging continuity.** Routine chat remembers the last logging exchange through `ot_messages.logging_context`. The server saves only catalogue IDs, quantities, dates, and proposal/log references, and rebuilds their current status when sending context to the model; raw past messages, journals, scores, and reflection replies are never replayed. An unanswered clarification takes precedence; another topic clears the implicit logging reference. This is app-managed conversation state, independent of the model provider.

`server/chat.mjs` resolves repeat logging reports: an unchanged matching pending card is reopened with the normal chat-to-dashboard handoff. A completed entry never blocks a fresh logging request; it creates a new unchecked card. An explicit request for another entry also bypasses reuse of an unchecked card. The model always returns the intended completion and leaves duplicate matching to the server. Each card awards XP only after it is checked; retries with the same request ID cannot save twice.

**Daily bonus and reward snapshots.** `ot_activities.daily_bonus` is `{minutes, perHour: {pillar: extraXP}}`, added to the activity's base rate for its first minutes per personal day. Each log snapshots its base rates, unit and bonus in `ot_logs.reward_rule`. `repriceLogs()` allocates XP in recording order after logging or undo/restore, and all changed rows are committed in one transaction. Entries without snapshots keep their stored XP. `nextReward()` computes the next card's reward from completed entries; unconfirmed cards do not reserve the bonus.

**Optimistic checkboxes.** Completion checkboxes preview their checkmark, XP, rolling totals, streak, and rewards immediately. `src/lib/completions.ts` keeps confirmed server state separate from temporary previews and reuses `shared/domain.mjs` for calculations. Rapid taps are saved in order using the latest confirmed revision; each request keeps its ID for safe retry. Save responses reconcile without replaying rewards, and failures restore the affected card and totals. A recovery read preserves changes made on other devices. This is an in-memory save queue, not offline storage.

The product rules and module map are in the root [README](../README.md). A fresh install has no activities; the optional fictional demo is loaded with `node scripts/seed-demo.mjs`.
