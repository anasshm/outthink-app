# OutThink

Set your goals, earn XP for the activities that move you toward them, and watch your progress fill up like a game character levelling up.

OutThink is a private, single-owner, gamified goal tracker. You define activities and how much XP each one earns in up to four pillars. The app ships with four pillar slots, currently labelled **Mental, Physical, Work and Social**; you can rename them to whatever areas you want to track (see [CUSTOMIZING.md](CUSTOMIZING.md#renaming-pillars)). You log what you did by ticking a checkbox or by telling the AI chat in plain words ("30 minutes of language practice, then two hours on my side project"). Four sets of progress rings show today and the last seven days, and the dashboard suggests what to do next, based on which pillar is furthest from its target.

It is a React + Vite web app with a small Node API, deployed on Vercel, storing everything in your own Supabase Postgres database, with OpenAI as a replaceable model provider.

- **New here?** Follow [SETUP.md](SETUP.md) to deploy your own copy (Supabase + OpenAI + Vercel, about 20 minutes).
- **Making it yours:** [CUSTOMIZING.md](CUSTOMIZING.md) explains activities, XP rules, frequencies, targets, goals, renaming pillars, and tuning the AI.
- **Want to see it full of data first?** The repo ships a fictional demo: Wren, a ranger-for-hire in the town of Ashvale, with 26 activities, 18 days of history and a couple of journal entries. Load it with `node scripts/seed-demo.mjs` (see [SETUP.md](SETUP.md#7-optional-load-the-wren-demo-data)).
- **Working on the code with an AI agent?** Read [AGENTS.md](AGENTS.md).

## Quick start

```sh
# 1. Create a Supabase project and apply supabase/migrations in filename order (SETUP.md, steps 1-3)
# 2. Write app/.env.local (asks for your app password and stores only its hash)
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=<secret key> OPENAI_API_KEY=<key> \
  node scripts/configure-server.mjs
# 3. Run it
cd app && npm install
npm run dev:api     # terminal 1: API on 127.0.0.1:3001
npm run dev         # terminal 2: http://localhost:5173
# 4. Optional: fill it with the Wren demo
node scripts/seed-demo.mjs --dry-run && node scripts/seed-demo.mjs
```

## Features

- **Password-only access** with a server-side scrypt password hash and a remembered, revocable 90-day session. No email signup. Supabase tables and write functions are inaccessible to browser keys; only the app server uses the service key.
- **Four dual progress rings:** the outer ring is the last **7 personal days** including today; the inner ring is today. Tap a pillar for today, last 7, or last 30 days, and undo/restore recorded activities across every affected pillar.
- **Activities** with descriptions, notes, XP across multiple pillars, an explicit XP unit size, default amount, preferred frequency, must-do status, and archiving that keeps history.
- **Tracking costs (negative XP):** any activity whose XP is only zero or negative (for example a habit you want to cut back on, set to cost 10 XP in every pillar per occurrence) deducts XP when logged. Earned XP, deductions and net progress are kept separate for today, seven days and thirty days. Rings show the cost in red; when the combined segments exceed one lap both scale proportionally while the numbers stay exact. Net XP can go negative. Undo removes the deduction. Negative-only activities are never suggested.
- **Optional activity SOPs** hold HOW-to instructions. They are excluded from routine selection and reflection context; chat retrieves an activity's SOP only when you ask to read or edit it. After you confirm a completion of an activity with an SOP, a friendly **View SOP** reminder appears at most once every seven personal days per activity. SOP text never creates penalties or schedules.
- **AI chat logging with confirmation.** Reported completions appear as **Pending today** cards; ticking a card confirms and saves that one activity with the same checkbox and XP feedback as suggestions. Chat closes with a short transition when a logging request is ready, and stays open for clarifications, other edits, or new drafts. Journal entries, catalogue edits, settings, goals and removals get an explicit Confirm/Cancel review. The AI can never approve its own proposals.
- **Fast path for simple logs:** clear single-activity requests such as "add workout" or "did workout yesterday" (for an activity named *Workout*), or "I worked for 2h" (for one named *Work*), can prepare Pending cards without a model call. Omitted quantities use the activity's default. It needs a unique active activity name and valid units; anything ambiguous, follow-ups, open clarifications/reviews and mixed requests go to the full conversational AI. Both paths share validation, deduplication, personal-day rules, confirmation, and conversation context.
- **Pending cards persist** across refreshes and devices, keeping their quantity and personal day (older dates are shown separately). Waiting cards award no XP; dismissing drops the proposal. Saved cards briefly show their checkmark and disappear; undo is available from pillar history. Pending activities are left out of duplicate daily suggestions.
- **Conversation memory for activity discussions:** a compact summary (including proposed note wording and unresolved edits) that expires after 24 hours of inactivity, plus the last ten eligible activity exchanges verbatim. Journal, reflection and SOP exchanges are excluded. The model also sees current unconfirmed catalogue drafts so follow-ups revise the right card.
- **Combined edits:** changes such as XP plus note plus frequency stay in one review. Partial XP edits preserve other pillars. Invalid AI action payloads get one bounded repair attempt before an error reaches you.
- **Follow-ups:** repeating a logging request returns to its existing pending cards; "do it" reuses the last activity, amount and day; "add another" creates a separate entry. Only structured logging references are carried between turns, never old journal text or scores.
- **Journal:** optional notes and separate 0-10 scores for **day, mood, energy, focus and sleep**. Casual feelings stay conversational; an explicit rating ("my mood is 8/10") or journal request starts a written draft, and agreeing to it produces a Confirm/Cancel card with that exact wording. Entries can describe the whole day, morning, evening, or a moment. Missing scores stay missing.
- **Suggestions** visit pillars from lowest to highest percentage of the last-7-day target. Each activity is assigned once to its weakest credited pillar; up to two due suggestions per pillar are ordered by days overdue, with must-dos and goals breaking ties. A nonempty activity note is shown as the **Why this today** explanation.
- **Reflection** over an explicit date range, e.g. "Analyze the last 30 days". Only this mode reads historical journal entries and scores. Proposed learnings can be saved as activity notes after review.
- **Streaks** from a sent message or a completed activity, once per personal day. Merely opening the app does not count.
- **Light and dark** appearance, reduced-motion support, confetti when a ring closes.

A fresh install starts with an empty catalogue. Nothing is imported unless you run the demo seeder.

## Defaults and calculation rules

- **Time zone** `UTC`; a personal day starts at **08:00** (both editable, see [CUSTOMIZING.md](CUSTOMIZING.md#time-zone-and-day-cutoff)). Explicit activity dates override the default. Changing the time zone or cutoff affects new entries, not stored activity days.
- **Targets:** 100 XP per pillar today, 700 over the last 7 days, 3,000 over the last 30. Each target is independently editable.
- **Reward:** `quantity / unit_size × pillar XP`. With 20 Mental XP per 10 minutes, 30 minutes earns 60 XP. A missing quantity uses the activity's default amount.
- **Daily bonus:** timed activities can add a bonus rate for their first N minutes per personal day. Example: an hourly activity earning 20 Work XP/hour plus another 20 XP/hour for its first 60 minutes each day earns 1h = 40, 2h = 60, 3h = 80, 4h = 100. Separate entries share the allowance; partial hours are prorated and rounding is balanced across the day's entries. Chat keeps each reported session as one entry.
- **Reward snapshots:** each completion stores its reward rule. Undo/restore recalculates the affected entries together (including the remaining bonus). Pending cards and optimistic checkbox feedback use the same calculation. Catalogue edits never rewrite historical rewards.
- **Work limit:** activities marked "Count toward my daily work limit" accumulate minutes across the personal day. Beyond the limit (default 4 hours) each extra hour costs the configured XP per pillar, prorated. Work-limit rules are snapshotted per day, so editing the rule changes today and future days only. Undoing work recomputes the cost.
- **Frequency:** "every N days" is measured from the last recorded completion; "X days per period" sets a repeat gap from the last completion. Past counts never bank credit. An overdue must-do stays relevant even when its pillar is full.
- The dashboard shows recorded data. Missing entries do not prove an activity did not happen, and journal correlations are not proof of causation.

## Modules

- [`app/shared/domain.mjs`](app/shared/domain.mjs): pure, UI-independent dates, XP, penalties, streaks, frequency, suggestions, default settings, and routine AI context. Reusable in React Native.
- [`app/server/actions.mjs`](app/server/actions.mjs): validation, proposals, confirmation, XP snapshots, and archive/undo behavior.
- [`app/server/validation.mjs`](app/server/validation.mjs): allowed fields, ranges, units, frequencies, journal scores and settings.
- [`app/server/prompts.mjs`](app/server/prompts.mjs): the editable everyday AI prompt. Tune behavior here; confirmation and database restrictions are enforced separately in code.
- [`app/server/ai.mjs`](app/server/ai.mjs): routine versus reflection context, clarification drafts, and response schemas.
- [`app/server/fast-log.mjs`](app/server/fast-log.mjs): the no-model shortcut for simple logging messages.
- [`app/server/journaling.mjs`](app/server/journaling.mjs): journal drafts, conversational agreement, and preserving the reviewed entry through final confirmation.
- [`app/server/chat.mjs`](app/server/chat.mjs): structured logging continuity, duplicate report handling, and returning new or existing cards to the dashboard.
- [`app/server/provider.mjs`](app/server/provider.mjs): replaceable model adapter. `AI_PROVIDER` and `AI_MODEL` select the provider/model; currently OpenAI Responses with `gpt-6-astra`, `AI_REASONING_EFFORT=low`, and `store: false`. Clear the reasoning setting when switching to a model that does not support it.
- [`app/api/outthink.mjs`](app/api/outthink.mjs): authenticated API, explicit reflection gate, idempotent writes, and conflict handling.
- [`app/server/auth.mjs`](app/server/auth.mjs): scrypt password verification, HttpOnly session cookies, and persistent login rate limits.
- [`app/src/ui/`](app/src/ui/): reusable visual components, forms, dialogs, rings, confetti, and feedback. Browser-specific haptics live in `progress-utils.ts` and can be replaced by native haptics later.
- [`supabase/migrations/`](supabase/migrations/): versioned database schema, private permissions, and transactional writes.
- [`scripts/`](scripts/): setup helpers (`configure-server.mjs`, `deploy-app-env.mjs`, `outthink-supabase.mjs`) and the demo seeder (`seed-demo.mjs`, reading [`demo/demo-data.json`](demo/demo-data.json)).

A React Native version can reuse the domain rules, API contract, provider, and database. DOM/SVG presentation, browser sessions, and haptics need native adapters; it is not an automatic conversion. Keep new business rules out of UI components and AI prompts.

The web app needs a connection to save. A failed request can be retried with the same request ID without duplicate completions. Conflicting edits from another device are rejected for review. Offline sync and push notifications are not implemented.

## Development and verification

See [`app/README.md`](app/README.md) for local commands, checks, and architecture notes.

Checks cover domain calculations, AI confirmation boundaries, journal context isolation, React interaction flow, and real Supabase persistence/security. `tests/ai-smoke.mjs` checks the real model with fictional data and never writes records. `tests/integration.mjs` creates uniquely labeled temporary records and removes only those IDs afterward.

The UI has been checked in Chromium at phone and desktop widths, in light and dark modes. DOM tests cover clarification, drafts, and failed saves. They do not establish real iPhone keyboard or haptic behavior; test on a device.

## Your data

Vercel deployments and Supabase data are separate from the source code. Your activities, logs and journal live only in your Supabase database, so back it up (Supabase dashboard backups or `pg_dump`) if you rely on it. Keep `app/.env.local` and any Vercel environment values private; they are ignored by Git.
