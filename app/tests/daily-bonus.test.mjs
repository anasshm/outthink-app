import test from "node:test";
import assert from "node:assert/strict";
import { planActions, decideProposal } from "../server/actions.mjs";
import { planChat } from "../server/chat.mjs";
import {
  totalsFor,
  nextReward,
  pendingActivities,
  suggestions,
  routineContext,
} from "../shared/domain.mjs";
import { fixture, apply, now } from "./chat-fixture.mjs";

function setup() {
  return planActions(
    fixture(),
    [
      {
        type: "create_activity",
        data: {
          name: "Guild Contracts",
          unit: "hour",
          unit_size: 1,
          default_quantity: 1,
          xp: { work: 20 },
          tracks_work: true,
          daily_bonus: { minutes: 60, perHour: { work: 20 } },
        },
      },
    ],
    { now },
  ).working;
}
const work = (s) => s.activities.find((a) => a.name === "Guild Contracts");
const stamp = (s) => new Date(now.getTime() + s.logs.length * 1000);
const total = (s, day = "2026-09-12") =>
  totalsFor(s.logs, s.settings, day).work.today;
const action = (s, quantity, day = "2026-09-12") => ({
  type: "log_activity",
  data: { activity_id: work(s).id, quantity, day },
});
const log = (s, quantity, day) =>
  planActions(s, [action(s, quantity, day)], { now: stamp(s) }).working;
const toggle = (s, id, done) =>
  planActions(s, [{ type: "set_log_status", data: { id, done } }], {
    now: stamp(s),
  });

test("Guild Contracts pays 40 for the first hour and 20 afterward, including split and partial hours", () => {
  for (const [hours, expected] of [
    [0.5, 20],
    [1, 40],
    [2, 60],
    [3, 80],
    [4, 100],
  ]) {
    const s = log(setup(), hours);
    assert.equal(total(s), expected);
    assert.equal(s.logs.length, 1);
    assert.equal(s.logs[0].xp.work, expected);
  }
  let s = setup();
  for (const duration of [0.5, 0.5, 1]) s = log(s, duration);
  assert.deepEqual(
    s.logs.map((l) => l.xp.work),
    [20, 20, 20],
  );
  assert.equal(total(s), 60);
});

test("minute-based splits share the allowance without rounding drift", () => {
  let s = setup();
  s = planActions(
    s,
    [
      {
        type: "update_activity",
        data: {
          id: work(s).id,
          unit: "minute",
          unit_size: 60,
          default_quantity: 20,
        },
      },
    ],
    { now },
  ).working;
  for (let i = 0; i < 12; i++) {
    const preview = nextReward(work(s), 20, s.logs, "2026-09-12");
    const before = total(s);
    s = log(s, 20);
    assert.equal(
      Math.round((total(s) - before) * 100),
      Math.round(preview.work * 100),
    );
    if (i === 2) assert.equal(total(s), 40);
  }
  assert.equal(total(s), 100);
});

test("undo and restore reallocate the bonus and persist all changed log amounts", () => {
  let s = log(log(setup(), 1), 1);
  const [first, second] = s.logs;
  assert.deepEqual(
    s.logs.map((l) => l.xp.work),
    [40, 20],
  );
  const removed = toggle(s, first.id, false);
  assert.equal(removed.writes.ot_logs.length, 2);
  s = apply(s, removed);
  assert.equal(total(s), 40);
  assert.equal(s.logs.find((l) => l.id === second.id).xp.work, 40);
  s = apply(s, toggle(s, first.id, true));
  assert.equal(total(s), 60);
  assert.deepEqual(
    s.logs.map((l) => l.xp.work),
    [40, 20],
  );
});

test("each personal day has its own allowance and Enchanting Workshop remains a separate flat rate", () => {
  let s = log(setup(), 2, "2026-09-11");
  s = log(s, 2);
  s = planActions(
    s,
    [
      {
        type: "log_activity",
        data: {
          activity_id: s.activities.find((a) => a.name === "Enchanting Workshop").id,
          quantity: 2,
        },
      },
    ],
    { now: stamp(s) },
  ).working;
  assert.equal(total(s, "2026-09-11"), 60);
  assert.equal(total(s), 90);
  assert.equal(s.logs.at(-1).xp.work, 30);
  assert.equal(totalsFor(s.logs, s.settings, "2026-09-12").work.seven, 150);
});

test("pending cards use the remaining daily allowance and either confirmation order stays correct", () => {
  for (const reverse of [false, true]) {
    let s = setup();
    const planned = planActions(s, [action(s, 2), action(s, 1)], {
      ai: true,
      now,
    });
    s = apply(s, planned);
    assert.deepEqual(
      pendingActivities(s, "2026-09-12").map((p) => p.xp.work),
      [60, 40],
    );
    const ids = s.proposals.map((p) => p.id);
    if (reverse) ids.reverse();
    s = apply(s, decideProposal(s, ids[0], true, { now: stamp(s) }));
    const remaining = pendingActivities(s, "2026-09-12").find((p) => p.waiting);
    assert.equal(remaining.xp.work, reverse ? 40 : 20);
    s = apply(s, decideProposal(s, ids[1], true, { now: stamp(s) }));
    assert.equal(total(s), 80);
  }
});

test("historical snapshots survive catalogue edits and old proposals tolerate nullable migration fields", () => {
  let s = log(setup(), 2, "2026-09-11");
  const before = structuredClone(s.logs);
  s = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: work(s).id, xp: { work: 100 }, daily_bonus: null },
      },
    ],
    { now },
  ).working;
  assert.deepEqual(s.logs, before);
  assert.equal(total(s, "2026-09-11"), 60);
  const created = planChat(
    s,
    { reply: "Ready", pending: null, actions: [action(s, 1)] },
    { now },
  );
  s = apply(s, created);
  delete s.proposals[0].actions[0].base.activity.daily_bonus;
  s.proposals[0].actions[0].base.activity.updated_at = work(
    s,
  ).updated_at.replace("Z", "+00:00");
  const again = planChat(
    s,
    { reply: "Ready", pending: null, actions: [action(s, 1)] },
    { now },
  );
  assert.equal(again.writes.ot_proposals, undefined);
  assert.doesNotThrow(() =>
    decideProposal(s, s.proposals[0].id, true, { now }),
  );
  work(s).daily_bonus = { minutes: 60, perHour: { work: 20 } };
  assert.throws(
    () => decideProposal(s, s.proposals[0].id, true, { now }),
    /changed/,
  );
});

test("suggestions and AI context expose the rule without changing notes, and invalid bonuses are rejected", () => {
  const s = setup();
  assert.equal(
    suggestions(s, "2026-09-12").find((a) => a.name === "Guild Contracts").reward.work,
    40,
  );
  assert.equal(
    routineContext(s, now).activities.find((a) => a.name === "Guild Contracts").daily_bonus
      .perHour.work,
    20,
  );
  for (const data of [
    { unit: "completion" },
    { daily_bonus: { minutes: 0, perHour: { work: 20 } } },
    { daily_bonus: { minutes: 60, perHour: { work: -20 } } },
  ]) {
    assert.throws(() =>
      planActions(
        s,
        [{ type: "update_activity", data: { id: work(s).id, ...data } }],
        { now },
      ),
    );
  }
});
