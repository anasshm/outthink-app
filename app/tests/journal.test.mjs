import test from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../server/ai.mjs";
import { planChat } from "../server/chat.mjs";
import { journalFlow } from "../server/journaling.mjs";
import { decideProposal } from "../server/actions.mjs";
import { fixture, now, apply, answer, report } from "./chat-fixture.mjs";

const entry = {
  text: "I like to check the guild board first thing each day.",
  scores: {},
  period: "day",
  day: "2026-09-12",
};
const journalAction = (data = entry) => ({ type: "journal", data });
const draft = (s, data = entry) =>
  journalFlow(answer(journalAction(data)), "draft", s, now);

test("journal drafts require conversational agreement and then a separate Confirm", () => {
  let s = fixture();
  const prepared = draft(s);
  assert.ok(prepared.reply.includes(entry.text));
  assert.match(prepared.reply, /Would you like me to add/);
  const first = planChat(s, prepared, { now });
  assert.equal(first.writes.ot_proposals, undefined);
  assert.equal(first.writes.ot_journal, undefined);
  assert.equal(first.handoff, false);
  s = apply(s, first, "Can you rephrase this for my ranger's journal?");
  // Persisted state works across refreshes, without any old chat text.
  s.messages = [];
  const approved = journalFlow(
    answer(journalAction({ ...entry, text: "Add it" })),
    "approve",
    s,
    now,
  );
  assert.deepEqual(approved.actions, [journalAction()]);
  const second = planChat(s, approved, { now });
  assert.equal(second.writes.ot_journal, undefined);
  assert.equal(second.writes.clarification, null);
  assert.equal(second.writes.ot_proposals.length, 1);
  s = apply(s, second, "Add it");
  const saved = decideProposal(s, s.proposals[0].id, true, { now });
  const { id, created_at, ...actual } = saved.writes.ot_journal[0];
  assert.ok(id && created_at);
  assert.deepEqual(actual, entry);
});

test("ordinary feelings, activity ratings and cancellation cannot queue an unsolicited journal action", () => {
  let s = fixture();
  s = apply(s, planChat(s, draft(s), { now }));
  for (const intent of ["none", "cancel", undefined]) {
    const result = planChat(
      s,
      journalFlow(answer(journalAction()), intent, s, now),
      { now },
    );
    assert.equal(result.writes.ot_journal, undefined);
    assert.equal(result.writes.ot_proposals, undefined);
    assert.equal(result.writes.clarification, null);
    const cleared = apply(s, result);
    const lateApproval = journalFlow(answer(), "approve", cleared, now);
    assert.deepEqual(lateApproval.actions, []);
    assert.match(lateApproval.reply, /draft first/);
  }
});

test("revised ratings need agreement again, preserve missing scores and the original date across cutoff", () => {
  let s = fixture();
  s = apply(s, planChat(s, draft(s), { now }));
  const revised = {
    ...entry,
    text: "The rain finally stopped.",
    scores: { mood: 8 },
    period: "evening",
  };
  const result = planChat(s, draft(s, revised), { now });
  assert.equal(result.writes.ot_proposals, undefined);
  assert.match(result.reply, /Mood: 8\/10/);
  s = apply(s, result);
  const approved = journalFlow(
    answer(),
    "approve",
    s,
    new Date("2026-09-13T12:00:00Z"),
  );
  assert.deepEqual(approved.actions[0].data, revised);
});

test("mixed activity logging still makes Pending cards while the journal stays a conversational draft", () => {
  const s = fixture();
  const prepared = journalFlow(
    answer(report(s, "Patrol Run"), journalAction()),
    "draft",
    s,
    now,
  );
  const result = planChat(s, prepared, { now });
  assert.equal(result.handoff, false);
  assert.equal(result.writes.ot_proposals.length, 1);
  assert.equal(result.writes.ot_proposals[0].actions[0].type, "log_activity");
  assert.equal(result.writes.ot_journal, undefined);
});

test("draft and confirmation share validation for scores, period and date", () => {
  for (const changes of [
    { scores: { mood: 11 } },
    { scores: { invented: 8 } },
    { scores: [] },
    { day: "2026-09-14" },
    { period: "week" },
    { text: "" },
  ])
    assert.throws(() => draft(fixture(), { ...entry, ...changes }));
  assert.match(
    draft(fixture(), { ...entry, scores: { focus: 7 } }).reply,
    /Focus: 7\/10/,
  );
});

test("reviewing a journal does not discard a simultaneous activity clarification", () => {
  const pending = {
    intent: "create_activity",
    activity_name: "Archery Practice",
    question: "What XP should Archery Practice earn?",
    draft: { name: "Archery Practice" },
  };
  let s = fixture();
  const prepared = journalFlow(
    { ...answer(journalAction()), pending },
    "draft",
    s,
    now,
  );
  s = apply(s, planChat(s, prepared, { now }));
  for (const intent of ["approve", "cancel"]) {
    const next = journalFlow(answer(), intent, s, now);
    assert.deepEqual(next.pending, pending);
    assert.ok(next.reply.includes(pending.question));
  }
});

test("interpreter keeps rephrased content and only supplies the active journal draft for its follow-up", async (t) => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  });
  let s = fixture();
  s.journal.push({ text: "HISTORICAL_SECRET", scores: { mood: 2 } });
  let turn = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.ok(!request.input.includes("HISTORICAL_SECRET"));
    const input = JSON.parse(request.input);
    if (turn === 1) assert.deepEqual(input.pending.draft, entry);
    const result =
      turn++ === 0
        ? {
            reply: "",
            journal_intent: "draft",
            actions: [{ type: "journal", data: JSON.stringify(entry) }],
            pending: null,
          }
        : {
            reply: "Ready",
            journal_intent: "approve",
            actions: [],
            pending: null,
          };
    return Response.json({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(result) }] },
      ],
    });
  });
  s = apply(
    s,
    planChat(
      s,
      await interpret(
        "Please rephrase my preference and add it to the journal",
        s,
        now,
      ),
      { now },
    ),
  );
  assert.equal(s.clarification.draft.text, entry.text);
  const result = planChat(s, await interpret("Add it", s, now), { now });
  assert.equal(result.writes.ot_proposals[0].actions[0].data.text, entry.text);
});
