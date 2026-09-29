import test from "node:test";
import assert from "node:assert/strict";
import { loggingContext, planChat } from "../server/chat.mjs";
import { interpret } from "../server/ai.mjs";
import { decideProposal, planActions } from "../server/actions.mjs";
import { totalsFor } from "../shared/domain.mjs";
import { fixture, apply, report, answer, now } from "./chat-fixture.mjs";

test("repeat reports reopen the same cards, and the latest subject replaces the old one", () => {
  let s = fixture();
  const first = planChat(
    s,
    answer(report(s, "Patrol Run"), report(s, "Browse the Bazaar")),
    { now },
  );
  s = apply(s, first, "I went on patrol and browsed the bazaar.");
  for (let i = 0; i < 2; i++) {
    const retry = planChat(
      s,
      answer(report(s, "Patrol Run"), report(s, "Browse the Bazaar")),
      { now },
    );
    assert.deepEqual(retry.pendingActivityIds, first.pendingActivityIds);
    assert.equal(retry.handoff, true);
    assert.equal(retry.writes.ot_proposals, undefined);
    s = apply(s, retry, "Add that I patrolled and went to the bazaar.");
  }
  const work = planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now });
  s = apply(s, work, "I worked in the enchanting workshop for two hours.");
  const again = planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now });
  s = apply(s, again, "Do it.");
  assert.deepEqual(again.pendingActivityIds, work.pendingActivityIds);
  assert.equal(s.logs.length, 0);
  assert.equal(s.proposals.length, 3);
  assert.equal(loggingContext(s).entries[0].quantity, 2);
  s = apply(
    s,
    planChat(s, answer(report(s, "Browse the Bazaar")), { now }),
    "I went to the bazaar.",
  );
  assert.equal(loggingContext(s).entries[0].name, "Browse the Bazaar");
  assert.equal(loggingContext(s).entries.length, 1);
});

test("explicit additional sessions make new cards and both can be checked in either order", () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    let s = fixture();
    s = apply(
      s,
      planChat(s, answer(report(s, "Browse the Bazaar")), { now }),
      "I went to the bazaar.",
    );
    s = apply(
      s,
      planChat(s, answer(report(s, "Browse the Bazaar", 1, { additional: true })), {
        now,
      }),
      "No, I went to the bazaar twice. Add a second one.",
    );
    assert.equal(s.activities.length, 3, "no catalogue activity created");
    assert.equal(s.logs.length, 0, "chat has not approved anything");
    const ids = s.proposals.map((p) => p.id);
    assert.equal(ids.length, 2);
    for (const i of order)
      s = apply(s, decideProposal(s, ids[i], true, { now }));
    assert.equal(s.logs.length, 2);
    assert.equal(totalsFor(s.logs, s.settings, "2026-09-12").social.today, 100);
    assert.equal(loggingContext(s).entries[0].status, "recorded");
    assert.throws(
      () => decideProposal(s, ids[0], true, { now }),
      /already handled/,
    );
  }
});

test("recorded entries never block fresh reports, including mixed batches", () => {
  let s = fixture();
  const first = planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now });
  s = apply(s, first, "Worked in the enchanting workshop for 2h.");
  s = apply(s, decideProposal(s, first.pendingActivityIds[0], true, { now }));
  const next = planChat(
    s,
    answer(report(s, "Enchanting Workshop", 2), report(s, "Browse the Bazaar")),
    { now },
  );
  assert.equal(next.handoff, true);
  assert.equal(next.pendingActivityIds.length, 2);
  assert.ok(!next.pendingActivityIds.includes(first.pendingActivityIds[0]));
  assert.doesNotMatch(next.reply, /already recorded|another session/i);
  assert.equal(next.writes.ot_logs, undefined);
  s = apply(s, next, "Worked in the enchanting workshop for 2h and browsed the bazaar.");
  assert.equal(s.logs.length, 1, "new reports still require checkoff");
  assert.equal(loggingContext(s).follow_up, undefined);
  assert.ok(loggingContext(s).entries.every((e) => e.status === "pending"));
  const repeated = planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now });
  assert.deepEqual(repeated.pendingActivityIds, [next.pendingActivityIds[0]]);
  for (const id of next.pendingActivityIds)
    s = apply(s, decideProposal(s, id, true, { now }));
  assert.equal(s.logs.length, 3);
  assert.equal(totalsFor(s.logs, s.settings, "2026-09-12").work.today, 60);
});

test("reuse respects quantity, dates, changed catalogue terms, dismissals, and cutoff", () => {
  let s = fixture();
  s = apply(
    s,
    planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now }),
    "Enchanted for 2h.",
  );
  const three = planChat(s, answer(report(s, "Enchanting Workshop", 3)), { now });
  assert.equal(three.writes.ot_proposals.length, 1);
  const yesterday = planChat(
    s,
    answer(report(s, "Enchanting Workshop", 2, { day: "2026-09-11" })),
    { now },
  );
  assert.equal(
    yesterday.writes.ot_proposals[0].actions[0].data.day,
    "2026-09-11",
  );
  const beforeCutoff = new Date("2026-09-13T07:59:00Z");
  assert.equal(
    planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now: beforeCutoff }).writes
      .ot_proposals,
    undefined,
  );
  const afterCutoff = new Date("2026-09-13T08:01:00Z");
  assert.equal(
    planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now: afterCutoff }).writes
      .ot_proposals.length,
    1,
  );
  const dismissed = apply(
    s,
    decideProposal(s, s.proposals[0].id, false, { now }),
  );
  assert.equal(
    planChat(dismissed, answer(report(s, "Enchanting Workshop", 2)), { now }).writes
      .ot_proposals.length,
    1,
  );
  s = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: s.activities[2].id, xp: { work: 25 } },
      },
    ],
    { now },
  ).working;
  const updated = planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now });
  assert.equal(updated.writes.ot_proposals.length, 1);
  assert.throws(
    () => decideProposal(s, s.proposals[0].id, true, { now }),
    /changed since/,
  );
});

test("clarifications and other edits keep chat open, including reused completion cards", () => {
  let s = fixture();
  const prepared = answer(report(s, "Browse the Bazaar"));
  s = apply(s, planChat(s, prepared, { now }), "I went to the bazaar.");
  const pending = {
    intent: "log_activity",
    activity_name: "Ridge Hunt",
    question: "Which XP?",
    draft: {},
  };
  const clarification = planChat(s, { ...prepared, pending }, { now });
  assert.equal(clarification.handoff, false);
  assert.equal(clarification.writes.clarification, pending);
  assert.equal(clarification.pendingActivityIds.length, 1);
  const journal = planChat(
    s,
    answer(...prepared.actions, {
      type: "journal",
      data: { text: "PRIVATE", scores: { mood: 7 } },
    }),
    { now },
  );
  assert.equal(journal.handoff, false);
  assert.equal(journal.writes.ot_journal, undefined);
  assert.ok(!JSON.stringify(journal.loggingContext).includes("PRIVATE"));
});

test("everyday model input remembers structured focus, never previous chat, scores or reflections", async (t) => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  });
  let s = fixture();
  s = apply(
    s,
    planChat(s, answer(report(s, "Enchanting Workshop", 2)), { now }),
    "CHAT_SECRET and mood 7/10",
  );
  s.messages.at(-1).text = "ASSISTANT_SECRET";
  s.messages.at(-1).logging_context.entries[0].text = "FORGED_SECRET";
  s.journal.push({ text: "JOURNAL_SECRET", scores: { mood: 7 } });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    for (const secret of [
      "CHAT_SECRET",
      "ASSISTANT_SECRET",
      "FORGED_SECRET",
      "JOURNAL_SECRET",
    ])
      assert.ok(!request.input.includes(secret));
    const input = JSON.parse(request.input);
    assert.equal(input.lastLoggingExchange.entries[0].name, "Enchanting Workshop");
    assert.equal(input.lastLoggingExchange.entries[0].quantity, 2);
    assert.equal(input.lastLoggingExchange.entries[0].status, "pending");
    assert.equal(input.message, "Do it");
    return Response.json({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                reply: "Ready",
                actions: [],
                pending: null,
              }),
            },
          ],
        },
      ],
    });
  });
  await interpret("Do it", s, now);
  const reflection = structuredClone(s);
  reflection.messages.at(-1).mode = "reflection";
  assert.equal(loggingContext(reflection), null);
  s = apply(s, planChat(s, answer(), { now }), "Different topic: Pip chewed my map again.");
  assert.equal(loggingContext(s), null);
});
