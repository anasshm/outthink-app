# Demo: Wren of Ashvale

Meet **Wren**, a ranger-for-hire in the frontier town of Ashvale. Wren takes
guild contracts to earn Silver rank, patrols the town wall, spars at the
barracks for the Blade Trial, studies the Warding spell, reports to the
Rangers' lodge by raven, and now and then loses time to the crystal ball.
Pip the owl familiar scouts ahead.

This folder holds about three weeks of Wren's quests as OutThink data:
26 activities, 106 completed log entries and 2
journal entries. It is all fictional. Use it to try the app, take
screenshots, or show someone the rings, streak and suggestions without
sharing your own data.

## Load it

From the repo root, with the server settings in the environment or in
`app/.env.local`:

```sh
node scripts/seed-demo.mjs --dry-run   # preview only, no network calls
node scripts/seed-demo.mjs             # load into an empty project
node scripts/seed-demo.mjs --replace   # wipe existing OutThink data first, then load
```

The seeder moves every date forward or back by the same number of whole days,
so Wren's latest day becomes *today*. The rings, the streak and the
suggestions are then filled in, whenever you run it. It also writes the demo
settings (UTC, day starts at 06:00, 700 XP weekly targets, work penalty set
to 0) into `ot_meta`, keeping any other settings keys, and bumps the revision
so open tabs reload.

Without `--replace` it refuses to touch a project that already has
activities, logs or journal entries. With `--replace` it first deletes
everything in `ot_logs`, `ot_journal`, `ot_messages`, `ot_goals`,
`ot_proposals`, `ot_activities` and `ot_receipts`. **That includes your own
data.** Sign-in sessions and rate limits are left alone.

## Remove it

- **Start over with the demo:** run `node scripts/seed-demo.mjs --replace`.
- **Go back to an empty app:** in the Supabase SQL editor, run:

  ```sql
  delete from ot_logs; delete from ot_journal; delete from ot_messages;
  delete from ot_goals; delete from ot_proposals; delete from ot_activities;
  delete from ot_receipts;
  update ot_meta set revision = revision + 1 where id = 1;
  ```

  Delete logs before activities, because logs reference them. You may also
  want to change the timezone and day start: ask the chat (e.g. "set my
  timezone to Europe/Paris") or edit `ot_meta.settings` directly.

## The activities

This table is generated from `demo-data.json`. XP is per unit. "Done logs"
counts completed entries in the demo history.

| Activity | XP | Unit | Done logs | What it shows |
|---|---|---|---|---|
| Patrol Run | +100 physical, +50 mental, +25 social | per completion | 5 | Multi-pillar completion; its note becomes the suggestion reason |
| Barracks Sparring | +100 physical, +25 mental, +50 social | per completion | 4 | Description that disambiguates it from a similar activity |
| Rune Meditation | +20 mental | per 10 minutes | 4 | Minute-based activity |
| Feast at the Tavern | +50 social | per completion | 0 | Catalogue entry with no history yet |
| Consult the Oracle | +200 mental, +50 social | per completion | 2 | Big reward for a rare quest step |
| Visit the Village Sage | +200 mental, +50 social | per completion | 0 | Large reward on an activity that is never logged |
| Browse the Bazaar | +50 social | per completion | 2 | Plain social completion |
| Long Tavern Stay (2h+) | +100 social | per completion | 0 | Bigger social reward for a longer version of Tavern Visit |
| Repair the Hideout | +100 mental | per completion | 1 | Every-15-days interval |
| Crystal Ball Doomscroll | -10 physical, -10 mental, -10 social, -10 work | per completion | 2 | Negative "unwanted" activity: costs XP in every pillar and is never suggested |
| Send a Raven to the Lodge | +25 mental, +25 social | per completion | 3 | Every-5-days interval |
| Tavern Visit | +50 social | per completion | 7 | Frequent social entry |
| Ridge Hunt | +200 physical, +50 social | per completion | 1 | Big physical reward for a rare outing |
| Forest Walk | +10 social | per 10 minutes | 1 | Minute-based activity |
| Market Run | +25 social | per completion | 5 | Small social errand |
| Corner Stall | +10 social | per completion | 13 | Small, frequent entry (most-logged after Guild Contracts) |
| Guild Contracts | +20 work | per 1 hour | 24 | Hourly work that tracks work time; First-hour daily bonus (another +20 work per hour, so the first hour pays double); Step-by-step SOP |
| Quick Stop at the Inn | +10 social | per completion | 0 | Tiny social entry, never logged |
| Armour Tune-up | +50 mental, +50 social | per completion | 1 | Step-by-step SOP |
| Train the Familiar | +10 mental | per 10 minutes | 6 | Short minute-based mental activity |
| Enchanting Workshop | +15 work | per 1 hour | 7 | Hourly work without a bonus; its minutes count toward the work-hours limit |
| Stretching Kata | +50 physical | per completion | 0 | Physical-only completion with no history |
| Sweep the Hideout | +20 physical, +10 mental | per 10 minutes | 6 | Minute-based activity |
| Study Spellbooks | +10 mental | per 10 minutes | 6 | Step-by-step SOP; Minute-based activity |
| Raven to a Friend | +25 social | per completion | 5 | Unscheduled social entry (compare Send a Raven to the Lodge) |
| Visit a Party Member | +50 social | per completion | 1 | Added late in the timeline |

A few things to look for once it's loaded:

- **Guild Contracts** pays 40 work XP for the first hour each day and 20 for
  each hour after that. It has an SOP, a step-by-step checklist. When you
  log it, the app shows the checklist as a reminder, at most once a week.
- **Crystal Ball Doomscroll** subtracts 10 XP from every pillar per session. It shows up in
  the XP breakdown as a deduction and never appears as a suggestion.
- **Repair the Hideout** (every 15 days) and **Send a Raven to the Lodge**
  (every 5 days) use the interval scheduler. They come back as suggestions only when
  they are due.
- Work is Wren's weakest pillar this week, so suggestions lean toward
  contracts and the enchanting workshop.
