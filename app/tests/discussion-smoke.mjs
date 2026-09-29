// Real-model multi-turn check with fictional activities; no database writes.
import assert from "node:assert/strict";
import { fixture, now, apply } from "./chat-fixture.mjs";
import { interpret } from "../server/ai.mjs";
import { planChat } from "../server/chat.mjs";
import { decideProposal } from "../server/actions.mjs";
let s = fixture();
s.activities[1].description =
  "Buying gear, arrows and trinkets at the Ashvale bazaar, including the fletcher's stall where arrows get restocked.";
async function turn(message) {
  const prepared = await interpret(message, s, now);
  const planned = planChat(s, prepared, { now });
  s = apply(s, planned, message);
  s.messages.at(-1).discussion_context = prepared.discussionContext;
  console.log(
    JSON.stringify({
      message,
      reply: prepared.reply,
      actions: prepared.actions.map((a) => a.type),
      edits: prepared.proposalEdits?.length || 0,
      pending: prepared.pending?.intent || null,
    }),
  );
  return { prepared, planned };
}
let r = await turn(
  "I like browsing the bazaar before a ridge hunt because the fletcher there restocks my arrows. Just discussing: how could this fit into my activities?",
);
assert.equal(r.prepared.actions.length, 0);
assert.ok(/bazaar/i.test(r.prepared.discussionContext?.summary || ""));
r = await turn(
  "What wording would you suggest for its note? Don't save it yet.",
);
assert.equal(r.prepared.actions.length, 0);
assert.ok(r.prepared.discussionContext?.summary);
r = await turn("Okay add that note to Browse the Bazaar and change its Social XP to 25 per visit.");
if (r.prepared.pending) r = await turn("Once a week maybe.");
const pending = s.proposals.filter((p) => p.status === "pending").at(-1);
assert.ok(pending);
const changes = pending.actions.find((a) => a.type === "update_activity").data;
assert.equal(changes.xp.social, 25);
assert.ok(changes.note);
assert.ok(/hunt/i.test(changes.note));
assert.ok(!s.activities[1].note);
r = await turn(
  "Actually make that 35 Social XP and add to the same note that the fletcher gives guild rangers a discount. Keep everything else we discussed.",
);
assert.ok(r.prepared.proposalEdits.length);
const fresh = s.proposals.filter((p) => p.status === "pending").at(-1);
const confirmed = decideProposal(s, fresh.id, true, { now });
const updated = confirmed.working.activities[1];
assert.equal(updated.xp.social, 35);
assert.ok(/hunt/i.test(updated.note));
assert.ok(/discount/i.test(updated.note));
assert.deepEqual(updated.preferred_frequency, {
  kind: "weekly",
  days: 7,
  count: 1,
});
r = await turn("I'm grumpy because it rained on my patrol.");
assert.equal(r.prepared.actions.length, 0);
assert.equal(r.prepared.discussionContext, null);
console.log(
  "PASS: discussion, note follow-up, combined edits, weekly clarification, revised review, and private-feeling boundary. No records written.",
);
