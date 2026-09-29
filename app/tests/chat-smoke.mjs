// Optional real-model regression of a scripted conversation. Fictional state
// only: no Supabase calls, real activity changes, or journal access.
import assert from "node:assert/strict";
import { interpret } from "../server/ai.mjs";
import { planChat } from "../server/chat.mjs";
import { decideProposal } from "../server/actions.mjs";
import { fixture, apply, now } from "./chat-fixture.mjs";

let s = fixture();
async function turn(message, expectedNames, newCards, handoff = true) {
  const prepared = await interpret(message, s, now);
  assert.deepEqual(
    prepared.actions.map((a) => a.type),
    expectedNames.map(() => "log_activity"),
    message,
  );
  const names = prepared.actions.map(
    (a) => s.activities.find((i) => i.id === a.data.activity_id)?.name,
  );
  assert.deepEqual(names, expectedNames, message);
  const result = planChat(s, prepared, { now });
  assert.equal((result.writes.ot_proposals || []).length, newCards, message);
  assert.equal(result.handoff, handoff, message);
  s = apply(s, result, message);
  assert.equal(s.logs.length, 0, "chat must never confirm its own proposals");
  console.log(
    JSON.stringify({
      message,
      reply: result.reply,
      newCards,
      handoff: result.handoff,
    }),
  );
  return { prepared, result };
}
await turn(
  "Add that i patrolled today and went to the bazzar",
  ["Patrol Run", "Browse the Bazaar"],
  2,
);
const multi = structuredClone(s);
await turn(
  "Add that I patrolled today and went to the bazaar",
  ["Patrol Run", "Browse the Bazaar"],
  0,
);
await turn(
  "Add that I patrolled today and went to the bazaar",
  ["Patrol Run", "Browse the Bazaar"],
  0,
);
await turn("I worked in the enchanting workshop for 2 hours today", ["Enchanting Workshop"], 1);
await turn("Worked in the workshop for 2 hours today", ["Enchanting Workshop"], 0);
const repeatedWorkshop = structuredClone(s);
await turn("Do it", ["Enchanting Workshop"], 0);
assert.equal(s.messages.at(-1).logging_context.entries[0].quantity, 2);
await turn("I went to the bazaar", ["Browse the Bazaar"], 0);
await turn("No, I went to the bazaar twice, just add a new one", ["Browse the Bazaar"], 1);
assert.equal(s.proposals.length, 4);
assert.equal(s.activities.length, 3);
const bazaar = s.proposals.filter(
  (p) => p.actions[0].data.activity_id === s.activities[1].id,
);
for (const proposal of bazaar.reverse())
  s = apply(s, decideProposal(s, proposal.id, true, { now }));
assert.equal(s.logs.length, 2);

// A follow-up can inherit an amount while overriding the personal day.
s = repeatedWorkshop;
const earlier = await turn("Another one yesterday", ["Enchanting Workshop"], 1);
assert.equal(earlier.prepared.actions[0].data.quantity, 2);
assert.equal(earlier.prepared.actions[0].data.day, "2026-09-11");

// Real ambiguity asks a relevant question and remembers the answer.
const ambiguous = await interpret("Add another one", multi, now);
assert.equal(ambiguous.actions.length, 0);
assert.ok(
  ambiguous.pending,
  "two different activities require a focused clarification",
);
s = apply(multi, planChat(multi, ambiguous, { now }), "Add another one");
await turn("The bazaar", ["Browse the Bazaar"], 1);

// Explicit catalogue creation stays distinct from another completion.
const catalogue = await interpret(
  "Create a new activity named Archery Practice: 80 Physical XP per session, default 1 session, no recurrence. I haven't done it yet.",
  s,
  now,
);
assert.deepEqual(
  catalogue.actions.map((a) => a.type),
  ["create_activity"],
);
console.log(
  "PASS: real-model continuity, typo/repeat handling, another entry, dates, genuine ambiguity, catalogue creation, and checkbox-only XP. No records saved.",
);
