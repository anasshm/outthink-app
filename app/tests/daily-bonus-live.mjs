// Real database verification using one temporary activity and exact-ID cleanup.
// Run only against your own configured OutThink project after the migration.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as store from "../server/db.mjs";
import { planActions } from "../server/actions.mjs";
import { totalsFor } from "../shared/domain.mjs";

assert.ok(
  process.env.SUPABASE_URL?.startsWith("https://"),
  "Set SUPABASE_URL to your own OutThink project before running this test.",
);
const prefix = `TEST daily XP ${randomUUID()}`;
const touched = {
  ot_logs: new Set(),
  ot_activities: new Set(),
  ot_receipts: new Set(),
};
async function change(actions) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await store.state();
    const result = planActions(s, actions);
    for (const [table, rows] of Object.entries(result.writes)) {
      assert.ok(table in touched);
      for (const row of rows) {
        if (table === "ot_logs") assert.equal(row.activity_id, activity?.id);
        if (table === "ot_activities") assert.equal(row.name, prefix);
        touched[table].add(row.id);
      }
    }
    const id = randomUUID();
    touched.ot_receipts.add(id);
    try {
      await store.apply(s, id, result.writes, { test: true });
      return await store.state();
    } catch (error) {
      if (error.code !== "40001" || attempt === 2) throw error;
    }
  }
}
let activity;
const day = "2000-01-02"; // Keep fixture XP out of the current rings.
try {
  let s = await change([
    {
      type: "create_activity",
      data: {
        name: prefix,
        unit: "hour",
        unit_size: 1,
        default_quantity: 1,
        xp: { work: 20 },
        tracks_work: true,
        daily_bonus: { minutes: 60, perHour: { work: 20 } },
      },
    },
  ]);
  activity = s.activities.find((a) => a.name === prefix);
  assert.equal(activity.daily_bonus.perHour.work, 20);
  const own = () =>
    s.logs
      .filter((l) => l.activity_id === activity.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const total = () => totalsFor(own(), s.settings, day).work.today;
  for (const expected of [40, 60]) {
    s = await change([
      {
        type: "log_activity",
        data: { activity_id: activity.id, quantity: 1, day },
      },
    ]);
    assert.equal(total(), expected);
  }
  const first = own()[0].id;
  s = await change([
    { type: "set_log_status", data: { id: first, done: false } },
  ]);
  assert.equal(total(), 40);
  assert.equal(own().find((l) => l.done).xp.work, 40);
  s = await change([
    { type: "set_log_status", data: { id: first, done: true } },
  ]);
  assert.equal(total(), 60);
  assert.ok(own().every((l) => l.reward_rule.daily_bonus.perHour.work === 20));
  console.log(
    "PASS: database persists the rule, split-session XP, and bonus reallocation on undo/restore.",
  );
} finally {
  for (const table of ["ot_logs", "ot_activities", "ot_receipts"]) {
    const ids = [...touched[table]];
    if (ids.length)
      store.checked(await store.db().from(table).delete().in("id", ids));
  }
  console.log("Temporary fixture rows removed by exact ID.");
}
