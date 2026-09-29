import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  personalDay,
  totalsFor,
  streakForDays,
  suggestions,
  routineContext,
  frequencyStatus,
  xpFor,
  pendingActivities,
  isPendingLog,
} from "../shared/domain.mjs";
import { planActions, decideProposal } from "../server/actions.mjs";
import { checkRange, reflectionRange } from "../server/ai.mjs";
import { settings, activity } from "../server/validation.mjs";
const now = new Date("2026-09-11T14:00:00Z");
const empty = () => ({
  revision: 0,
  settings: structuredClone(DEFAULT_SETTINGS),
  activities: [],
  logs: [],
  journal: [],
  messages: [],
  proposals: [],
  goals: [],
});
const make = (s, data) =>
  planActions(
    s,
    [
      {
        type: "create_activity",
        data: {
          name: "Patrol Run",
          xp: { physical: 20, mental: 10 },
          unit: "completion",
          default_quantity: 1,
          ...data,
        },
      },
    ],
    { now },
  ).working;
const log = (s, quantity, day = "2026-09-11") =>
  planActions(
    s,
    [
      {
        type: "log_activity",
        data: { activity_id: s.activities[0].id, quantity, day },
      },
    ],
    { now },
  ).working;
test("8am boundary uses configured timezone, including month/year and DST changes", () => {
  assert.equal(personalDay(new Date("2026-09-11T07:59:59Z")), "2026-09-10");
  assert.equal(personalDay(new Date("2026-09-11T08:00:00Z")), "2026-09-11");
  assert.equal(personalDay(new Date("2027-01-01T03:00:00Z")), "2026-12-31");
  const s = { ...DEFAULT_SETTINGS, timezone: "America/New_York" };
  assert.equal(personalDay(new Date("2026-03-08T11:59:00Z"), s), "2026-03-07");
  assert.equal(personalDay(new Date("2026-03-08T12:00:00Z"), s), "2026-03-08");
});
test("multi-area default units, explicit duration and historical XP snapshots", () => {
  let s = make(empty(), {
    unit: "minute",
    default_quantity: 10,
    xp: { mental: 1, physical: 0.5 },
  });
  s = log(s, 30);
  assert.equal(s.logs[0].xp.mental, 30);
  assert.equal(s.logs[0].xp.physical, 15);
  const edited = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: s.activities[0].id, xp: { mental: 5 } },
      },
    ],
    { now },
  ).working;
  assert.equal(edited.logs[0].xp.mental, 30);
  assert.equal(xpFor(edited.activities[0]).mental, 50);
});
test("split work sessions incur only excess hours, undo recalculates all pillars", () => {
  let s = make(empty(), {
    name: "Guild Contracts",
    unit: "hour",
    default_quantity: 1,
    xp: { work: 10 },
    tracks_work: true,
  });
  s = log(s, 3);
  s = log(s, 2.5);
  let t = totalsFor(s.logs, s.settings, "2026-09-11");
  assert.equal(t.work.today, 55);
  assert.equal(t.mental.today, -15);
  assert.equal(t.social.today, -15);
  s = planActions(
    s,
    [{ type: "set_log_status", data: { id: s.logs[1].id, done: false } }],
    { now },
  ).working;
  t = totalsFor(s.logs, s.settings, "2026-09-11");
  assert.equal(t.work.today, 30);
  assert.equal(t.mental.today, 0);
});
test("rolling windows include today and exclude tomorrow and older boundary", () => {
  let s = make(empty());
  for (const d of ["2026-09-04", "2026-09-05", "2026-09-11"]) s = log(s, 1, d);
  const t = totalsFor(s.logs, s.settings, "2026-09-11");
  assert.equal(t.physical.today, 20);
  assert.equal(t.physical.seven, 40);
  assert.equal(t.physical.thirty, 60);
});
test("every AI write waits for confirmation, including log, journal and catalogue add", () => {
  const s = make(empty());
  for (const action of [
    { type: "log_activity", data: { activity_id: s.activities[0].id } },
    { type: "journal", data: { text: "Good day on the wall", scores: { day: 7 } } },
    {
      type: "create_activity",
      data: {
        name: "Study Spellbooks",
        xp: { mental: 2 },
        unit: "minute",
        default_quantity: 10,
      },
    },
    {
      type: "update_activity",
      data: { id: s.activities[0].id, note: "Take the long way past the watchtower" },
    },
    { type: "archive_activity", data: { id: s.activities[0].id } },
  ]) {
    const proposed = planActions(s, [action], { ai: true, now });
    assert.deepEqual(Object.keys(proposed.writes), ["ot_proposals"]);
    assert.equal(proposed.saved.length, 0);
    const waiting = { ...s, proposals: proposed.writes.ot_proposals };
    const cancelled = decideProposal(waiting, waiting.proposals[0].id, false);
    assert.deepEqual(Object.keys(cancelled.writes), ["ot_proposals"]);
    const confirmed = decideProposal(waiting, waiting.proposals[0].id, true, {
      now,
    });
    assert.ok(Object.keys(confirmed.writes).length > 1);
  }
});
test("one proposal can create an activity and then log it by name", () => {
  const s = empty();
  const p = planActions(
    s,
    [
      {
        type: "create_activity",
        data: {
          name: "Rune Meditation",
          unit: "minute",
          xp: { mental: 1 },
          default_quantity: 10,
        },
      },
      {
        type: "log_activity",
        data: { activity_name: "Rune Meditation", quantity: 30 },
      },
    ],
    { ai: true, now },
  );
  s.proposals = p.writes.ot_proposals;
  const confirmed = decideProposal(s, s.proposals[0].id, true, { now });
  assert.equal(confirmed.writes.ot_logs[0].xp.mental, 30);
  assert.equal(
    confirmed.writes.ot_logs[0].activity_id,
    confirmed.writes.ot_activities[0].id,
  );
});
function commitPlan(s, plan) {
  const next = structuredClone(plan.working || s);
  for (const [table, records] of Object.entries(plan.writes)) {
    const key = {
      ot_proposals: "proposals",
      ot_logs: "logs",
      ot_journal: "journal",
    }[table];
    if (!key) continue;
    for (const record of records) {
      const i = next[key].findIndex((r) => r.id === record.id);
      if (i < 0) next[key].push(record);
      else next[key][i] = record;
    }
  }
  return next;
}
test("pending cards independently confirm repeat sessions, persist, undo and dismiss without double XP", () => {
  let s = make(empty());
  s = make(s, { name: "Study Spellbooks", xp: { mental: 10 } });
  const actions = [0, 1, 0].map((index) => ({
    type: "log_activity",
    data: { activity_id: s.activities[index].id },
  }));
  s = commitPlan(s, planActions(s, actions, { ai: true, now }));
  const ids = s.proposals.map((p) => p.id);
  assert.equal(ids.length, 3);
  assert.ok(s.proposals.every(isPendingLog));
  assert.equal(s.logs.length, 0);
  assert.equal(pendingActivities(s, "2026-09-11").length, 3);
  for (const id of [ids[2], ids[0]]) {
    s = commitPlan(s, decideProposal(s, id, true, { now }));
    s = JSON.parse(JSON.stringify(s)); // Reload persisted state between checks.
    assert.throws(
      () => decideProposal(s, id, true, { now }),
      /already handled/,
    );
  }
  assert.equal(s.logs.length, 2);
  assert.equal(totalsFor(s.logs, s.settings, "2026-09-11").physical.today, 40);
  const card = pendingActivities(s, "2026-09-11").find((p) => p.id === ids[2]);
  assert.equal(card.complete, true);
  s = planActions(
    s,
    [{ type: "set_log_status", data: { id: card.log_id, done: false } }],
    { now },
  ).working;
  assert.equal(
    pendingActivities(s, "2026-09-11").find((p) => p.id === ids[2]).complete,
    false,
  );
  s = planActions(
    s,
    [{ type: "set_log_status", data: { id: card.log_id, done: true } }],
    { now },
  ).working;
  assert.equal(s.logs.length, 2);
  s = commitPlan(s, decideProposal(s, ids[1], false, { now }));
  assert.equal(pendingActivities(s, "2026-09-11").length, 2);
  assert.equal(s.logs.length, 2);
});
test("pending logs keep dates and XP review intact across cutoff and catalogue changes", () => {
  let s = make(empty());
  const beforeCutoff = new Date("2026-09-12T07:50:00Z");
  const afterCutoff = new Date("2026-09-12T08:10:00Z");
  s = commitPlan(
    s,
    planActions(
      s,
      [{ type: "log_activity", data: { activity_id: s.activities[0].id } }],
      { ai: true, now: beforeCutoff },
    ),
  );
  assert.equal(pendingActivities(s, "2026-09-12")[0].day, "2026-09-11");
  const result = decideProposal(s, s.proposals[0].id, true, {
    now: afterCutoff,
  });
  assert.equal(result.writes.ot_logs[0].day, "2026-09-11");
  const checked = commitPlan(s, result);
  assert.equal(pendingActivities(checked, "2026-09-12")[0].complete, true);
  assert.equal(pendingActivities(checked, "2026-09-13").length, 0);
  s = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: s.activities[0].id, xp: { physical: 500 } },
      },
    ],
    { now },
  ).working;
  assert.equal(pendingActivities(s, "2026-09-12")[0].xp.physical, 20);
  assert.throws(
    () => decideProposal(s, s.proposals[0].id, true, { now: afterCutoff }),
    /changed since/,
  );
});
test("journal confirmation stays separate and pending AI context contains only completion drafts", () => {
  let s = make(empty());
  s = commitPlan(
    s,
    planActions(
      s,
      [
        { type: "log_activity", data: { activity_id: s.activities[0].id } },
        {
          type: "journal",
          data: { text: "PRIVATE_DIARY", scores: { mood: 7 } },
        },
      ],
      { ai: true, now },
    ),
  );
  const logProposal = s.proposals.find(isPendingLog);
  s = commitPlan(s, decideProposal(s, logProposal.id, true, { now }));
  assert.equal(s.journal.length, 0);
  assert.equal(s.proposals.filter((p) => p.status === "pending").length, 1);
  assert.ok(!JSON.stringify(routineContext(s, now)).includes("PRIVATE_DIARY"));
  const waiting = make(empty());
  waiting.proposals = planActions(
    waiting,
    [{ type: "log_activity", data: { activity_id: waiting.activities[0].id } }],
    { ai: true, now },
  ).writes.ot_proposals;
  assert.equal(
    routineContext(waiting, now).pendingCompletions[0].activity_id,
    waiting.activities[0].id,
  );
  assert.equal(routineContext(waiting, now).recentCompletions.length, 0);
});
test("legacy combined proposals still require fresh review after newly logged sessions", () => {
  let s = make(empty());
  const p = planActions(
    s,
    [{ type: "log_activity", data: { activity_id: s.activities[0].id } }],
    { ai: true, now, splitLogs: false },
  );
  s = log(s, 1);
  s.proposals = p.writes.ot_proposals;
  assert.throws(
    () => decideProposal(s, s.proposals[0].id, true, { now }),
    /changed since/,
  );
});
test("a full Mental ring cannot replace an overdue must-do", () => {
  let s = make(empty(), {
    name: "Guild Dues",
    must_do: true,
    preferred_frequency: { kind: "interval", days: 15 },
  });
  s = make(s, { name: "Study Spellbooks", xp: { mental: 1000 } });
  s.logs = [
    {
      id: "study-spellbooks",
      activity_id: s.activities[1].id,
      day: "2026-09-11",
      xp: { mental: 1000 },
      done: true,
      work_minutes: 0,
      penalty_rule: s.settings.workPenalty,
    },
  ];
  assert.equal(suggestions(s, "2026-09-11")[0].name, "Guild Dues");
});
test("monthly activities are not repeatedly suggested to fill social gaps", () => {
  let s = make(empty(), {
    preferred_frequency: { kind: "interval", days: 30 },
    xp: { social: 10 },
  });
  s = log(s, 1, "2026-09-10");
  assert.equal(suggestions(s, "2026-09-11").length, 0);
  assert.equal(
    frequencyStatus(s.activities[0], s.logs, "2026-10-10").due,
    true,
  );
});
test("weekly frequency counts distinct days, not repeated sessions", () => {
  let s = make(empty(), {
    preferred_frequency: { kind: "weekly", days: 7, count: 3 },
  });
  s = log(s, 1, "2026-09-10");
  s = log(s, 1, "2026-09-10");
  assert.equal(frequencyStatus(s.activities[0], s.logs, "2026-09-11").count, 1);
});
test("chat counts once; yesterday keeps a streak alive until today ends", () => {
  assert.deepEqual(
    streakForDays(["2026-09-09", "2026-09-10", "2026-09-10"], "2026-09-11"),
    { count: 2, todayLogged: false },
  );
  assert.deepEqual(
    streakForDays(["2026-09-09", "2026-09-10", "2026-09-11"], "2026-09-11"),
    { count: 3, todayLogged: true },
  );
});
test("routine AI context excludes scores, journal text, old raw chats and reflections", () => {
  const s = make(empty());
  s.journal = [{ text: "JOURNAL_SECRET", scores: { mood: 3 } }];
  s.messages = [
    { text: "CHAT_SECRET", role: "user", day: "2026-09-10" },
    { text: "REFLECTION_SECRET", role: "assistant", mode: "reflection" },
  ];
  s.proposals = [
    { actions: [{ type: "journal", data: { text: "PROPOSAL_SECRET" } }] },
  ];
  const context = JSON.stringify(routineContext(s, now));
  for (const secret of [
    "JOURNAL_SECRET",
    "CHAT_SECRET",
    "REFLECTION_SECRET",
    "PROPOSAL_SECRET",
    "scores",
  ])
    assert.ok(!context.includes(secret));
});
test("reflection date gate only accepts explicit bounded requests", () => {
  assert.deepEqual(reflectionRange("Analyze the last 30 days", "2026-09-11"), {
    from: "2026-08-13",
    to: "2026-09-11",
  });
  assert.equal(
    reflectionRange("I might analyze the last 30 days later", "2026-09-11"),
    null,
  );
  assert.throws(() =>
    checkRange({ from: "2025-01-01", to: "2026-09-11" }, "2026-09-11"),
  );
});
test("input validation rejects bad dates, impossible frequency, non-finite XP and work completions", () => {
  assert.throws(() =>
    activity(
      {
        name: "x",
        xp: { mental: Infinity },
        unit: "hour",
        default_quantity: 1,
      },
      null,
      now.toISOString(),
    ),
  );
  assert.throws(() => settings({ ...DEFAULT_SETTINGS, timezone: "invalid" }));
  assert.throws(() =>
    make(empty(), {
      preferred_frequency: { kind: "weekly", days: 7, count: 8 },
    }),
  );
  assert.throws(() => make(empty(), { tracks_work: true }));
  assert.throws(() => log(make(empty()), 1, "2026-02-30"));
});
