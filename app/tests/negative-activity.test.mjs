import test from "node:test";
import assert from "node:assert/strict";
import { fixture, apply, now } from "./chat-fixture.mjs";
import { planActions, decideProposal } from "../server/actions.mjs";
import { planChat } from "../server/chat.mjs";
import { fastLog } from "../server/fast-log.mjs";
import {
  AREAS,
  xpFor,
  xpBreakdown,
  totalsFor,
  summary,
  suggestions,
  routineContext,
  quantityLabel,
  shiftDay,
} from "../shared/domain.mjs";
// A generic tracking cost: only negative XP, counted in completions.
const DOOMSCROLL = {
  name: "Crystal Ball Doomscroll",
  description:
    "Time lost staring into the crystal ball at gossip and false omens. One completion = one session.",
  note: "Each session costs 10 XP in every pillar.",
  xp: { mental: -10, physical: -10, work: -10, social: -10 },
  unit: "completion",
  unit_size: 1,
  default_quantity: 1,
  preferred_frequency: null,
  daily_bonus: null,
  must_do: false,
  tracks_work: false,
};
// Mirrors a conversational AI reply that counted the occurrences.
const counted = (activity, quantity) => ({
  reply: "Ready to check off.",
  actions: [
    {
      type: "log_activity",
      data: { activity_id: activity.id, quantity, additional: false },
    },
  ],
  pending: null,
  proposalEdits: [],
  discussionContext: null,
});
function setup() {
  const s = planActions(
    fixture(),
    [{ type: "create_activity", data: DOOMSCROLL }],
    { now },
  ).working;
  s.settings.workPenalty.enabled = false;
  return s;
}
test("a negative activity costs ten per pillar, requires checkoff, keeps gross effort, and undo/restore across periods", () => {
  let s = setup();
  const a = s.activities.find((a) => a.name === "Crystal Ball Doomscroll");
  assert.deepEqual(
    xpFor(a, 10),
    Object.fromEntries(AREAS.map((a) => [a, -100])),
  );
  s.logs.push({
    id: "earned",
    day: "2026-09-12",
    done: true,
    xp: Object.fromEntries(AREAS.map((a) => [a, 600])),
  });
  const p = planChat(s, counted(a, 10), { now });
  s = apply(s, p);
  assert.equal(summary(s, now).totals.mental.seven, 600);
  s = apply(s, decideProposal(s, p.pendingActivityIds[0], true, { now }));
  const cost = s.logs.find((l) => l.activity_id === a.id);
  assert.equal(cost.label, "Crystal Ball Doomscroll · 10 times");
  for (const area of AREAS)
    for (const period of ["today", "seven", "thirty"]) {
      assert.deepEqual(summary(s, now).xpBreakdown[area][period], {
        earned: 600,
        deducted: 100,
        net: 500,
      });
      assert.equal(summary(s, now).totals[area][period], 500);
    }
  for (const done of [false, true]) {
    s = planActions(
      s,
      [{ type: "set_log_status", data: { id: cost.id, done } }],
      { now },
    ).working;
    assert.equal(
      summary(s, now).xpBreakdown.mental.seven.deducted,
      done ? 100 : 0,
    );
  }
  // A later catalogue change must not rewrite the already confirmed cost.
  s = planActions(
    s,
    [{ type: "update_activity", data: { id: a.id, xp: { mental: -20 } } }],
    { now },
  ).working;
  assert.equal(summary(s, now).totals.mental.seven, 500);
  assert.equal(quantityLabel(a, 1), "Crystal Ball Doomscroll");
  assert.equal(quantityLabel(a, 6), "Crystal Ball Doomscroll · 6 times");
  assert.ok(!suggestions(s, "2026-09-13").some((x) => x.id === a.id));
  assert.equal(
    routineContext(s, now).activities.find((x) => x.id === a.id).description,
    a.description,
  );
});
test("costs exceed earnings without clamping net; periods, undone logs, and work costs reconcile", () => {
  const s = setup(),
    day = "2026-09-12";
  const logs = [
    { day, done: true, xp: { mental: 20 } },
    { day, done: true, xp: { mental: -100 } },
    { day, done: false, xp: { mental: -200 } },
    { day: shiftDay(day, -6), done: true, xp: { mental: -10 } },
    { day: shiftDay(day, -7), done: true, xp: { mental: -30 } },
    { day: shiftDay(day, 1), done: true, xp: { mental: -500 } },
  ];
  const b = xpBreakdown(logs, s.settings, day);
  assert.deepEqual(b.mental.today, { earned: 20, deducted: 100, net: -80 });
  assert.deepEqual(b.mental.seven, { earned: 20, deducted: 110, net: -90 });
  assert.deepEqual(b.mental.thirty, { earned: 20, deducted: 140, net: -120 });
  s.settings.workPenalty = {
    enabled: true,
    afterMinutes: 60,
    perHour: { mental: -10 },
  };
  logs[0].work_minutes = 120;
  for (const area of AREAS)
    for (const period of ["today", "seven", "thirty"])
      assert.equal(
        xpBreakdown(logs, s.settings, day)[area][period].net,
        totalsFor(logs, s.settings, day)[area][period],
      );
});
test("a named tracking cost uses the fast path; counts, plans and durations use conversational AI", () => {
  const s = setup();
  const a = s.activities.find((a) => a.name === "Crystal Ball Doomscroll");
  for (const text of [
    "Log crystal ball doomscroll",
    "Add Crystal Ball Doomscroll today",
    "I did crystal ball doomscroll",
  ]) {
    const data = fastLog(text, s, now).actions[0].data;
    assert.equal(data.activity_id, a.id, text);
    assert.equal(data.quantity, 1, text);
  }
  assert.equal(
    fastLog("Log crystal ball doomscroll yesterday", s, now).actions[0].data.day,
    "2026-09-11",
  );
  for (const text of [
    "Crystal ball doomscroll",
    "I will do a crystal ball doomscroll",
    "I avoided crystal ball doomscroll",
    "Log 6 crystal ball doomscroll",
    "Log crystal ball doomscroll for 10 minutes",
    "Did I log crystal ball doomscroll?",
  ])
    assert.equal(fastLog(text, s, now), null, text);
});
