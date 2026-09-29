import test from "node:test";
import assert from "node:assert/strict";
import { fixture, now } from "./chat-fixture.mjs";
import {
  planActions,
  decideProposal,
  sameReviewBase,
} from "../server/actions.mjs";
import { routineContext, suggestions } from "../shared/domain.mjs";
import { interpret } from "../server/ai.mjs";

test("SOP edits need confirmation, preserve other fields and never affect ranking", () => {
  const s = fixture(),
    a = s.activities[0];
  const draft = planActions(
    s,
    [{ type: "update_activity", data: { id: a.id, sop: "Pace yourself along the wall." } }],
    { ai: true, now },
  );
  assert.equal(a.sop, "");
  s.proposals = draft.writes.ot_proposals;
  const confirmed = decideProposal(s, s.proposals[0].id, true, { now });
  const updated = confirmed.writes.ot_activities[0];
  assert.equal(updated.sop, "Pace yourself along the wall.");
  assert.deepEqual({ ...updated, sop: a.sop }, a);
  const pick = (state) =>
    suggestions(state, "2026-09-12").map(({ id, rank, reason }) => ({
      id,
      rank,
      reason,
    }));
  assert.deepEqual(pick(confirmed.working), pick(s));
  assert.ok(
    !JSON.stringify(routineContext(confirmed.working, now)).includes(
      updated.sop,
    ),
  );
  assert.equal(
    routineContext(confirmed.working, now).activities[0].description,
    a.description,
  );
  assert.ok(sameReviewBase({ ...a, sop: undefined }, { ...a, sop: "" }));
  assert.ok(!sameReviewBase(a, updated));
});

test("SOP reminders recur every seven personal days per activity, after confirmation only", () => {
  let s = fixture();
  s.activities[0].sop = "Check the wall gates on the way.";
  s.activities[1].sop = "Bring the supply list.";
  const action = {
    type: "log_activity",
    data: { activity_id: s.activities[0].id, day: "2026-09-12" },
  };
  const proposal = planActions(s, [action], { ai: true, now });
  assert.ok(!proposal.writes.ot_logs);
  s.proposals = proposal.writes.ot_proposals;
  const first = decideProposal(s, s.proposals[0].id, true, { now });
  assert.equal(first.sopReminders.length, 1);
  s = first.working;
  assert.equal(planActions(s, [action], { now }).sopReminders.length, 0);
  assert.equal(
    planActions(s, [action], { now: new Date("2026-09-18T15:00:00Z") })
      .sopReminders.length,
    0,
  );
  const sevenDays = new Date("2026-09-19T15:00:00Z");
  assert.equal(
    planActions(s, [action], { now: sevenDays }).sopReminders.length,
    1,
  );
  assert.equal(
    planActions(
      s,
      [{ type: "log_activity", data: { activity_id: s.activities[1].id } }],
      { now },
    ).sopReminders.length,
    1,
  );
  s.logs[0].done = false;
  assert.equal(planActions(s, [action], { now }).sopReminders.length, 0);
  assert.equal(
    planActions(
      s,
      [{ type: "set_log_status", data: { id: s.logs[0].id, done: true } }],
      { now },
    ).sopReminders.length,
    0,
  );
  s.activities[0].sop = "";
  assert.equal(
    planActions(s, [action], { now: sevenDays }).sopReminders.length,
    0,
  );
});

test("chat retrieves only the requested SOP after a separate routing pass", async (t) => {
  const s = fixture(),
    a = s.activities[0];
  a.sop = "SOP_PRIVATE_MARKER";
  s.activities[1].sop = "UNRELATED_PRIVATE_MARKER";
  s.journal = [{ text: "JOURNAL_PRIVATE_MARKER" }];
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fictional";
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).input);
    assert.ok(!JSON.stringify(input).includes("JOURNAL_PRIVATE_MARKER"));
    assert.ok(!JSON.stringify(input).includes("UNRELATED_PRIVATE_MARKER"));
    calls++;
    if (calls === 1)
      assert.ok(!JSON.stringify(input).includes("SOP_PRIVATE_MARKER"));
    else assert.equal(input.requestedSops[0].sop, "SOP_PRIVATE_MARKER");
    const result = {
      reply: calls === 1 ? "" : "Your SOP is ready to review.",
      journal_intent: "none",
      pending: null,
      sop_activity_ids: calls === 1 ? [a.id] : [],
      actions:
        calls === 1
          ? []
          : [
              {
                type: "update_activity",
                data: JSON.stringify({
                  id: a.id,
                  sop: "SOP_PRIVATE_MARKER. Refill the waterskin at the east well.",
                }),
              },
            ],
    };
    return Response.json({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(result) }] },
      ],
    });
  });
  const answer = await interpret(
    "Append refilling my waterskin at the east well to my Patrol Run SOP",
    s,
    now,
  );
  assert.equal(calls, 2);
  assert.ok(
    planActions(s, answer.actions, { ai: true, now }).writes.ot_proposals,
  );
  assert.equal(s.activities[0].sop, "SOP_PRIVATE_MARKER");
});

test("a HOW-only edit preserves pending completion review but changed XP still needs review", () => {
  const s = fixture(),
    a = s.activities[0];
  s.proposals = planActions(
    s,
    [{ type: "log_activity", data: { activity_id: a.id } }],
    { ai: true, now },
  ).writes.ot_proposals;
  s.proposals = structuredClone(s.proposals);
  a.sop = "New trail route.";
  a.updated_at = "2026-09-13T15:00:00Z";
  assert.equal(
    decideProposal(s, s.proposals[0].id, true, { now }).sopReminders.length,
    1,
  );
  a.xp.physical = 200;
  assert.throws(
    () => decideProposal(s, s.proposals[0].id, true, { now }),
    /changed since/,
  );
});
