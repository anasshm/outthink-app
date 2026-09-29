import test from "node:test";
import assert from "node:assert/strict";
import { fixture, now, apply } from "./chat-fixture.mjs";
import { planActions, decideProposal } from "../server/actions.mjs";
import { planChat } from "../server/chat.mjs";
import { interpret } from "../server/ai.mjs";
import {
  discussionContext,
  discussionMemory,
  catalogueReviews,
} from "../server/discussion.mjs";
import { frequency } from "../server/validation.mjs";

test("weekly shorthand and combined edits preserve unrelated XP and catalogue fields", () => {
  assert.deepEqual(frequency({ kind: "weekly", count: 1 }), {
    kind: "weekly",
    days: 7,
    count: 1,
  });
  assert.throws(() => frequency({ kind: "weekly", days: 0, count: 1 }));
  assert.throws(() => frequency({ kind: "weekly", count: 8 }));
  const s = fixture(),
    a = s.activities[0];
  const r = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: a.id, xp: { social: 30 }, note: "Check the east gate hinges on the loop." },
      },
    ],
    { ai: true, now },
  );
  const pending = apply(s, r);
  const confirmed = decideProposal(pending, pending.proposals[0].id, true, {
    now,
  });
  const updated = confirmed.working.activities[0];
  assert.deepEqual(updated.xp, {
    mental: 50,
    physical: 100,
    work: 0,
    social: 30,
  });
  assert.equal(updated.note, "Check the east gate hinges on the loop.");
  assert.equal(updated.description, a.description);
  assert.deepEqual(s.activities[0], a);
});

test("revising a pending creation replaces its card and retains every other requested field", () => {
  let s = fixture();
  s = apply(
    s,
    planActions(
      s,
      [
        {
          type: "create_activity",
          data: {
            name: "Test Stall",
            unit: "completion",
            unit_size: 1,
            default_quantity: 1,
            xp: { social: 25 },
            description: "A throwaway stall at the bazaar for testing.",
          },
        },
      ],
      { ai: true, now },
    ),
  );
  const old = s.proposals[0];
  const result = planChat(
    s,
    {
      reply: "Updated draft.",
      pending: null,
      actions: [],
      proposalEdits: [
        {
          proposal_id: old.id,
          action_index: 0,
          changes: {
            note: "Good for restocking arrows before a hunt.",
            xp: { social: 35 },
            preferred_frequency: { kind: "weekly", count: 1 },
          },
        },
      ],
    },
    { now },
  );
  assert.ok(!result.writes.ot_activities);
  assert.equal(
    result.writes.ot_proposals.find((p) => p.id === old.id).status,
    "dismissed",
  );
  const fresh = result.writes.ot_proposals.find((p) => p.status === "pending");
  assert.notEqual(fresh.id, old.id);
  const reviewed = apply(s, result);
  const saved = decideProposal(reviewed, fresh.id, true, { now });
  const a = saved.working.activities.find((a) => a.name === "Test Stall");
  assert.equal(a.xp.social, 35);
  assert.equal(a.note, "Good for restocking arrows before a hunt.");
  assert.equal(a.description, "A throwaway stall at the bazaar for testing.");
  assert.deepEqual(a.preferred_frequency, {
    kind: "weekly",
    days: 7,
    count: 1,
  });
  assert.throws(() => decideProposal(reviewed, old.id, true, { now }));
  assert.throws(() =>
    planChat(
      reviewed,
      {
        actions: [],
        proposalEdits: [
          { proposal_id: old.id, action_index: 0, changes: { note: "Wrong" } },
        ],
      },
      { now },
    ),
  );
});

test("discussion context never imports old raw chat, private modes, or SOP reviews", () => {
  const s = fixture();
  s.messages = [
    {
      role: "assistant",
      mode: "routine",
      text: "OLD_JOURNAL",
      created_at: now.toISOString(),
    },
  ];
  assert.equal(discussionContext(s, now), null);
  s.messages[0].discussion_context = {
    summary: "Discussing a bazaar visit to restock arrows before a hunt.",
  };
  assert.equal(
    discussionContext(s, now).summary,
    s.messages[0].discussion_context.summary,
  );
  assert.equal(discussionContext(s, new Date("2026-09-14T15:00:00Z")), null);
  s.messages[0].mode = "reflection";
  assert.equal(discussionContext(s, now), null);
  const opts = {
    journalIntent: "none",
    pending: null,
    actions: [],
    requestedSops: [],
  };
  assert.deepEqual(discussionMemory("Activity idea.", opts), {
    summary: "Activity idea.",
  });
  for (const overrides of [
    { journalIntent: "draft" },
    { pending: { intent: "journal" } },
    { requestedSops: ["a"] },
    { actions: [{ type: "update_activity", data: { sop: "PRIVATE_SOP" } }] },
  ])
    assert.equal(discussionMemory("PRIVATE", { ...opts, ...overrides }), null);
  s.proposals = planActions(
    s,
    [
      {
        type: "update_activity",
        data: {
          id: s.activities[0].id,
          note: "Useful reminder",
          sop: "PRIVATE_SOP",
        },
      },
    ],
    { ai: true, now },
  ).writes.ot_proposals;
  assert.ok(!JSON.stringify(catalogueReviews(s)).includes("PRIVATE_SOP"));
  assert.ok(JSON.stringify(catalogueReviews(s)).includes("Useful reminder"));
});

test("invalid AI frequency is repaired while preserving the note and XP request", async (t) => {
  const s = fixture(),
    a = s.activities[1];
  s.clarification = {
    intent: "update_activity",
    activity_name: a.name,
    question: "How often?",
    draft: { id: a.id, note: "Good for restocking arrows before a hunt.", xp: { social: 25 } },
  };
  s.messages = [
    {
      role: "assistant",
      mode: "routine",
      created_at: now.toISOString(),
      text: "Do not replay raw chat",
      discussion_context: {
        summary:
          "Set Browse the Bazaar to 25 Social XP and add note: Good for restocking arrows before a hunt. Awaiting frequency.",
      },
    },
  ];
  let calls = 0;
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  t.after(() => {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).input);
    assert.ok(input.discussion.summary.includes("Awaiting frequency"));
    assert.ok(!JSON.stringify(input).includes("Do not replay raw chat"));
    calls++;
    if (calls === 2)
      assert.ok(input.validationError.includes("Frequency days"));
    const output = {
      reply: "Ready to review.",
      journal_intent: "none",
      pending: null,
      sop_activity_ids: [],
      proposal_edits: [],
      discussion_summary: "Browse the Bazaar note and XP edit ready for review.",
      actions: [
        {
          type: "update_activity",
          data: JSON.stringify({
            id: a.id,
            note: "Good for restocking arrows before a hunt.",
            xp: { social: 25 },
            preferred_frequency: {
              kind: "weekly",
              days: calls === 1 ? 0 : 7,
              count: 1,
            },
          }),
        },
      ],
    };
    return Response.json({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(output) }] },
      ],
    });
  });
  const prepared = await interpret("Once a week maybe", s, now);
  assert.equal(calls, 2);
  assert.equal(prepared.actions[0].data.xp.social, 25);
  assert.equal(prepared.actions[0].data.note, "Good for restocking arrows before a hunt.");
  assert.equal(s.activities[1].note, "");
  assert.ok(planChat(s, prepared, { now }).writes.ot_proposals);
});

test("revising a saved activity draft keeps the original review base and detects concurrent edits", () => {
  let s = fixture(),
    id = s.activities[1].id;
  s = apply(
    s,
    planActions(
      s,
      [
        {
          type: "update_activity",
          data: { id, note: "Restock arrows here before each hunt.", xp: { social: 25 } },
        },
      ],
      { ai: true, now },
    ),
  );
  const old = s.proposals[0];
  const edit = {
    reply: "Ready.",
    pending: null,
    actions: [],
    proposalEdits: [
      { proposal_id: old.id, action_index: 0, changes: { xp: { social: 35 } } },
    ],
  };
  const result = planChat(s, edit, { now });
  const fresh = result.writes.ot_proposals.find((p) => p.status === "pending");
  assert.equal(fresh.actions[0].data.note, "Restock arrows here before each hunt.");
  assert.equal(fresh.actions[0].data.xp.social, 35);
  s.activities[1].note = "Changed on another device.";
  assert.throws(() => planChat(s, edit, { now }), /changed since/);
});

test("recent context is exactly ten paired activity exchanges, in order, plus existing summary", async () => {
  const { recentMessages } = await import("../server/discussion.mjs");
  const s = fixture();
  for (let i = 0; i < 12; i++) {
    const u = {
      id: "u" + i,
      role: "user",
      mode: "routine",
      text: "Request " + i,
      created_at: new Date(now.getTime() + i * 2000).toISOString(),
    };
    const a = {
      id: "a" + i,
      role: "assistant",
      mode: "routine",
      text: "Reply " + i,
      created_at: new Date(now.getTime() + i * 2000 + 1000).toISOString(),
      discussion_context: { summary: "Summary " + i, user_message_id: u.id },
    };
    s.messages.push(u, a);
  }
  const history = recentMessages(s);
  assert.equal(history.length, 20);
  assert.deepEqual(history[0], { role: "user", content: "Request 2" });
  assert.deepEqual(history.at(-1), { role: "assistant", content: "Reply 11" });
  assert.equal(history.filter((m) => m.role === "user").length, 10);
  assert.equal(history.filter((m) => m.role === "assistant").length, 10);
  assert.equal(discussionContext(s, now).summary, "Summary 11");
  s.messages.push(
    {
      role: "user",
      mode: "routine",
      text: "PRIVATE JOURNAL",
      created_at: "2026-09-13T12:00:00Z",
    },
    {
      role: "assistant",
      mode: "routine",
      text: "PRIVATE JOURNAL DRAFT",
      created_at: "2026-09-13T12:00:01Z",
    },
    {
      role: "assistant",
      mode: "reflection",
      text: "PRIVATE REFLECTION",
      discussion_context: { summary: "Should not be read" },
      created_at: "2026-09-13T13:00:01Z",
    },
  );
  assert.deepEqual(recentMessages(s), history);
  s.messages.push({
    role: "assistant",
    mode: "routine",
    text: "Context reset",
    discussion_context: { reset: true },
    created_at: "2026-09-14T13:00:00Z",
  });
  assert.deepEqual(recentMessages(s), []);
  assert.equal(discussionContext(s, now), null);
});

test("legacy unmarked text and unpaired replies are never imported into recent context", async () => {
  const { recentMessages } = await import("../server/discussion.mjs");
  const s = fixture();
  s.messages = [
    {
      role: "user",
      mode: "routine",
      text: "OLD PRIVATE",
      created_at: now.toISOString(),
    },
    {
      role: "assistant",
      mode: "routine",
      text: "OLD PRIVATE REPLY",
      created_at: new Date(now.getTime() + 1).toISOString(),
    },
    {
      role: "assistant",
      mode: "routine",
      text: "Orphan",
      discussion_context: {
        summary: "Orphan summary",
        user_message_id: "missing",
      },
      created_at: new Date(now.getTime() + 2).toISOString(),
    },
  ];
  assert.deepEqual(recentMessages(s), []);
});
