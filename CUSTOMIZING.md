# Making OutThink your own

You decide which goals you are working toward, which activities exist, what each is worth, how often it should come back, and what costs XP. This guide explains every knob with generic examples; for a complete worked catalogue, see the fictional demo in [demo/README.md](demo/README.md).

Contents: [where to change things](#where-to-change-things) · [goals](#goals) · [activities](#activities) · [text fields](#description-note-and-sop) · [XP and units](#xp-units-and-amounts) · [daily bonus](#daily-bonus-first-n-minutes) · [frequency](#preferred-frequency) · [must-dos](#must-do) · [tracking costs](#tracking-costs-negative-xp) · [work limit](#daily-work-limit) · [targets](#targets) · [time zone and cutoff](#time-zone-and-day-cutoff) · [journal](#journal-scores) · [the AI](#tuning-the-ai) · [pillars](#renaming-pillars)

## Where to change things

There are three ways to change your setup:

1. **Chat** (the floating **+** button). Describe the change in plain words. The AI turns it into a review card showing exactly what will change; nothing is saved until you press **Confirm**. Chat can create and edit activities (including fields the form does not show, such as the daily bonus), archive them, save goals, write journal entries, and change settings (targets, time zone, day start, work limit).
2. **The activity editor** (**New activity** / tapping an activity in *Your activities*). Saving the form is itself your confirmation.
3. **SQL** in the Supabase dashboard, for bulk edits or anything the app does not expose. If you edit rows directly, also run `update ot_meta set revision = revision + 1 where id = 1;` so open tabs reload instead of overwriting your change.

> **Current UI gap:** `app/src/App.tsx` contains full screens for *Your activities*, *Goals*, *Preferences*, *Your journal* and *Reflect on your days*, but the dashboard currently only links to *Your activities* from its empty state ("Add an activity" / "Choose an activity"). Until you add a menu, use chat for settings, goals, journal entries and reflection ("Analyze the last 30 days"). Adding buttons that call `setPanel("activities" | "goals" | "settings" | "journal" | "reflection")` is a small change in `App.tsx`.

## Goals

Start here: a goal is what you are working toward, and activities are the steps that move you there. A goal has a title, an optional reason (`note`), linked pillars and/or activities, an optional end date, and an active flag. Active goals appear in suggestion explanations ("Your goal: …") and break ties in ranking. They never change XP, targets or frequencies by themselves. In the *Goals* screen the fields are **Goal**, **Reason** and **Keep in focus until (optional)**. Example in chat: *"Add a goal: Ship version 1.0 of my side project by 30 November, because a client is waiting for it. Link Side Project and Deep Work."*

## Activities

An activity is a reusable definition; a *completion* (log) is one occurrence of it. Each completion stores a snapshot of the reward rule that applied, so later edits never rewrite history.

| Field | Editor label | What it does |
| --- | --- | --- |
| `name` | Name | Unique among active activities. Also what the no-AI fast logger matches. |
| `description` | Description | What counts as this activity: aliases, distinctions, exclusions. Sent to the AI for matching. |
| `xp` | one field per pillar label (Mental / Physical / Work / Social by default) | XP per `unit_size` for each pillar (-10000 to 10000). Missing pillars are 0. |
| `unit` | Measure in | `completion`, `minute` or `hour`. |
| `unit_size` | the number next to "XP per …" | How many units earn the listed XP (0.01 to 10000). |
| `default_quantity` | Default amount when you don't specify | Used when you tick a suggestion or say "did X" without an amount. |
| `preferred_frequency` | Preferred frequency | `null`, `{kind:"interval",days}` or `{kind:"weekly",days,count}`. |
| `must_do` | This is a must-do | Keeps its own schedule even when its pillar is full. |
| `tracks_work` | Count toward my daily work limit | Only for minute/hour activities. Feeds the work limit. |
| `daily_bonus` | (chat only; shown in the editor when set) | Extra XP per hour for the first N minutes each day. |
| `note` | Notes for suggestions | Shown as **Why this today** when suggested. |
| `sop` | SOP · How to do it | Step-by-step instructions, shown on request and as an occasional reminder. |
| `archived` | Archive | Hides it from suggestions and new logging; history is kept and it can be restored. |

## Description, note and SOP

These three text fields have separate jobs. Mixing them up produces odd dashboard text, so keep them apart:

- **`description`** is for *matching*: what counts, aliases, and how it differs from similar activities. The AI reads it; you also see it in the editor.
  *Strength Training:* "Weights or bodyweight strength work. Not the same as Stretching."
- **`note`** is for *you*: the goal it serves or a useful reminder. A nonempty note is the **entire** "Why this today" explanation under the top suggestion, so write it as something you want to read. Never put parsing rules or instructions to the AI here.
  *Language Practice:* "Goal: pass the B2 exam in June."
  *Side Project:* "Goal: ship version 1.0 by the end of the quarter."
- **`sop`** is *how to do it*, never why or when. It is kept out of routine AI context and only loaded when you ask to read or edit it. After you confirm a completion, a **View SOP** reminder appears at most once every seven personal days per activity.
  *Deep Work:* "1. Close chat and email. 2. Pick one task from the project list. 3. Write down where you stopped."

When the note is empty, the explanation is assembled from structured data instead: must-do status, the frequency ("Last recorded … ; you chose once every 5 days."), a linked goal, or which pillar is below its 7-day target. See [AGENTS.md](AGENTS.md) for the full field-responsibility rules.

## XP, units and amounts

The server computes, per pillar:

```text
XP = quantity / unit_size × xp[pillar]
```

Worked examples:

- **Team Sport** (a completion that credits several pillars): `unit: completion`, `unit_size: 1`, `xp: {physical: 100, mental: 50, social: 25}`. One match is one completion that credits three pillars at once: +100 / +50 / +25.
- **Language Practice** (minute-based): `unit: minute`, `unit_size: 10`, `default_quantity: 10`, `xp: {mental: 20}`. "Did language practice" logs 10 minutes = 20 XP; "language practice 30 minutes" = 60 XP. In the editor this reads *Measure in: Minutes*, *XP per minute: 10*, *Mental: 20*.
- **Side Project** (hourly): `unit: hour`, `unit_size: 1`, `xp: {work: 15}`. "90 minutes on the side project" is converted to 1.5 hours = 22.5 XP.

Tips:

- Pick a `unit_size` that matches how you think ("20 XP per 10 minutes" rather than "2 XP per minute"). The AI is told to keep the stated rate exactly.
- `default_quantity` is in the activity's unit. For a minute-based activity, a default of 10 means ten minutes.
- XP is your incentive system, not an objective score. The AI is instructed never to second-guess the XP numbers you choose.

Via chat: *"Create Strength Training: 50 Physical XP per completion."* or *"Language Practice should give 30 Mental XP per 10 minutes."* (Partial XP edits keep the other pillars; say "0" explicitly to remove one.)

## Daily bonus (first N minutes)

A timed activity can pay an extra rate for its first N minutes of each personal day, to reward getting started. It is stored as:

```json
"daily_bonus": { "minutes": 60, "perHour": { "work": 20 } }
```

An hourly activity such as **Deep Work** with `xp.work = 20` per hour plus that bonus pays 40 for the first hour and 20 for later hours: 1h = 40, 2h = 60, 3h = 80, 4h = 100. Separate entries on the same day share one allowance (two 30-minute sessions together get the 60 bonus minutes). Undo and restore recompute every affected entry, and partial hours are prorated.

The bonus needs a `minute` or `hour` unit, 1 to 1440 minutes, and non-negative rates. The editor form shows but cannot edit it (saving the form keeps it). Set, change or remove it through chat, for example:

> *Change Deep Work to 25 Work XP per hour, with the first hour each day paying 50.*

which becomes `xp.work = 25` and `daily_bonus = {minutes: 60, perHour: {work: 25}}`; or *"Remove the first-hour bonus from Deep Work."*

## Preferred frequency

Frequency drives when an activity comes back as a suggestion. It never changes XP.

- **No schedule** (`null`): no due date. It can still be suggested when its pillar is below target, ordered by time since you last did it.
- **Once every few days** (`{"kind": "interval", "days": 5}`): due 5 personal days after the last recorded completion. For example, *Water the Plants* every 5 days or *Budget Review* every 30.
- **Several days per period** (`{"kind": "weekly", "days": 7, "count": 3}`): three distinct days in a rolling 7-day window. Internally this becomes a repeat gap (7 / 3, rounded to whole days) from the last completion. Several sessions on one day count as one day, and past sessions never "bank" credit for the future.

In chat: "once a week" = `{kind: "weekly", days: 7, count: 1}`, "three times a week" = `{kind: "weekly", days: 7, count: 3}`, "every 15 days" = `{kind: "interval", days: 15}`.

**How suggestions are ranked:** pillars are visited from the lowest to the highest share of their 7-day target. Each activity is assigned once, to its weakest pillar that it credits, and each pillar gets at most two suggestions, ordered by days overdue, then must-dos, then goal links. Activities already done or pending today are skipped. The logic lives in `suggestions()` in `app/shared/domain.mjs` if you want to change it.

## Must-do

Tick **This is a must-do** for something that should keep its own schedule regardless of how its pillar is doing. An overdue must-do stays eligible even when its pillar is full, and wins ties. Example: if *Budget Review* is a must-do, a strong week of Work XP from other activities will not hide it once it is overdue.

## Tracking costs (negative XP)

Any activity whose XP values are all zero or negative is a **tracking cost**: something you want to see, not something you want to do more of. A typical example is a habit you want to cut back on, such as **Doomscrolling**:

```json
{ "name": "Doomscrolling", "unit": "completion", "unit_size": 1, "default_quantity": 1,
  "xp": { "mental": -10, "physical": -10, "work": -10, "social": -10 } }
```

Logging "three Doomscrolling sessions" deducts 30 XP from every pillar. Tracking costs:

- use the same Pending card and checkbox confirmation as everything else;
- show as a red segment on the rings, and are kept separate from earned XP in the breakdown (earned, deducted and net for today, 7 and 30 days). If earned plus deducted exceeds one lap, both segments are scaled proportionally while the numbers stay exact;
- can push net XP below zero;
- can be undone from the pillar history, which removes the deduction;
- are **never suggested**, and the AI never proposes earning XP to offset them.

Create one in the editor by entering negative numbers, or in chat: *"Add an activity called Snooze Button, minus 5 Mental XP per completion."* Mixed activities (some positive, some negative pillars) are allowed and behave like normal activities that also cost something.

## Daily work limit

Activities with **Count toward my daily work limit** (`tracks_work`) add their minutes to a per-day total. Past the limit, each extra hour costs XP in the pillars you choose. The rule lives in `settings.workPenalty`:

```json
"workPenalty": { "enabled": true, "afterMinutes": 240, "perHour": { "mental": -10, "social": -10 } }
```

That is the fresh-install default: after 4 hours, each extra hour costs 10 Mental and 10 Social XP, prorated. (The demo sets every rate to 0, so it never deducts.) Example: you log 3 hours of Deep Work and 2 hours on a Side Project. Both track work, so the day totals 5 hours, 1 hour over: -10 Mental and -10 Social, shown in pillar history as a calculated "Work beyond 4 hours" entry. Undoing an hour recomputes it.

- Rates must be zero or negative; `afterMinutes` is 0 to 1440; `enabled: false` turns it off.
- The rule is snapshotted with the first log of each day, so changing it affects today and future days, never earlier ones.
- Change it in chat (*"Set my work limit to 6 hours and make each extra hour cost 5 Physical XP"*), or set all rates to 0 to disable costs.

## Targets

Each pillar has three independent targets: **today**, **last 7 days** and **last 30 days** (defaults 100 / 700 / 3,000). The inner ring is today versus the daily target, the outer ring the last 7 personal days versus the 7-day target, and suggestions prioritize the pillar that is furthest behind its 7-day target. Changing targets never changes recorded XP.

Example in chat: *"Set my Work targets to 150 a day, 900 a week and 3,600 a month."* The validator accepts 1 to 1,000,000.

## Time zone and day cutoff

A *personal day* starts at the cutoff hour in your IANA time zone. Fresh installs use `UTC` with the day starting at `08:00` (defaults in `DEFAULT_SETTINGS` in `app/shared/domain.mjs` and the settings row inserted by the first migration); the demo uses `UTC` and `06:00`. With an 08:00 cutoff, something logged at 02:00 on Tuesday belongs to Monday.

Set yours first thing, e.g. in chat: *"Set my time zone to America/Chicago and start my day at 5."* The cutoff must be a whole hour from 0 to 23, and the time zone a valid IANA name (`Europe/Berlin`, `Asia/Tokyo`, ...). Changing either affects new entries only; stored activity days are never reassigned.

To change the defaults for new installations, edit both `DEFAULT_SETTINGS` and the `insert into public.ot_meta` line in `supabase/migrations/202609110001_outthink.sql`.

## Journal scores

Journal entries are free text plus optional 0 to 10 scores for **day, mood, energy, focus and sleep**, scoped to the day, morning, evening or a moment. Saying "my focus is 7/10" or "write in my journal that ..." starts a draft; you agree, then confirm a card. Everyday chat never sees past journal entries; only an explicit reflection ("Analyze the last 30 days", or "review my last 14 days") reads them.

To rename or add a score, change the list in `journal()` in `app/server/validation.mjs`, the score names in the journal form in `app/src/ui/Editors.tsx`, and the "Scores 0–10" sentence in `app/server/prompts.mjs`. Stored entries keep their old keys.

## Logging through chat vs. the no-AI shortcut

Short messages like "add workout", "log workout yesterday" or "language practice 20 minutes" are handled by `app/server/fast-log.mjs` without calling the model, if they name exactly one active activity. It also knows a few built-in grammar variants (`forms` in that file, e.g. "worked" for an activity named "Work" and "cleaned" for "Cleaning", plus variants for the demo's activity names). Add your own variants there if you log something often. Anything else goes to the AI, which reads your descriptions to match aliases, so put nicknames in `description` ("Also called: Spanish, language lesson").

## Tuning the AI

- **Behavior:** `app/server/prompts.mjs` holds the everyday system prompt as one string. Edit tone, examples and rules there. Confirmation, validation and database limits are enforced in code, so a prompt change cannot make the AI save anything without your approval. The prompt contains a few generic worked examples (such as an hourly activity with a first-hour bonus); rewrite them to match your own catalogue if you like.
- **Context:** what the model sees is built by `routineContext()` in `app/shared/domain.mjs` and `app/server/ai.mjs` (reflection has its own path). Keep journal history out of routine context.
- **Model:** `AI_MODEL` (default `gpt-6-astra`) and `AI_REASONING_EFFORT` (default `low` for that model) in `app/.env.local` and your Vercel environment. Leave `AI_REASONING_EFFORT` empty for models that do not accept a reasoning setting. The model must support OpenAI Structured Outputs through the Responses API.
- **Provider:** `AI_PROVIDER` selects an adapter in `app/server/provider.mjs`; only `openai` exists. To add another, add a function to the `providers` object that takes `{instructions, input, schema, timeoutMs}` and returns the parsed JSON object matching `schema`, then set `AI_PROVIDER` to its key.
- **Checks:** `node --env-file=.env.local tests/ai-smoke.mjs` and `tests/chat-smoke.mjs` (from `app/`) exercise the real model with fictional data.

## Renaming pillars

OutThink ships with four pillar slots, currently labelled **Mental**, **Physical**, **Work** and **Social**. The labels are only a starting point: rename them to whatever areas you want to track. Be aware that the internal IDs behind the four slots (`mental`, `physical`, `work`, `social`) are hardcoded and stored inside every activity's XP and every log, so renaming what you **see** is easy, while changing the **number** of pillars or their internal IDs is a real refactor.

**Change the display names or colors** (safe, no data migration):

- `app/src/ui/progress-utils.ts`: the `AREAS` list sets each pillar's display `name` and `color` (`orange`, `green`, `blue`, `purple`, defined for light and dark mode in `app/src/ui/theme.ts`). For example `{ id: "mental", name: "Learning", ... }` shows the first slot as *Learning* everywhere in the UI, including the activity editor, while the stored ID stays `mental`.
- `app/src/ui/Progress.tsx`: the SVG icon for each pillar ID.
- `app/server/prompts.mjs`: the prompt names the pillars "Mental, Physical, Work, Social"; mention your labels ("Mental (shown as Learning)") so the AI understands you.

**Adding, removing or changing the internal ID of a pillar** means changing `AREAS` in `app/shared/domain.mjs`, the `Area` type in `app/src/lib/types.ts`, the UI list above, the hardcoded pillar list for goals in `app/server/actions.mjs`, the prompt's action formats in `app/server/prompts.mjs`, the default settings in the first migration, and migrating the JSON in `ot_activities.xp`, `ot_activities.daily_bonus`, `ot_logs.xp`, `ot_logs.reward_rule`, `ot_logs.penalty_rule`, `ot_goals.areas` and `ot_meta.settings`. Search the code for `"mental"` to find everything, and run `npm test` afterwards.
