import assert from "node:assert/strict";
import { fixture, now, apply, report, answer } from "./chat-fixture.mjs";
import { planChat } from "../server/chat.mjs";
import { decideProposal } from "../server/actions.mjs";
import { interpret } from "../server/ai.mjs";
const originalFetch = globalThis.fetch;
let timings = [];
globalThis.fetch = async (...args) => {
  const start = Date.now();
  const response = await originalFetch(...args);
  const body = await response.clone().json();
  timings.push({
    ms: Date.now() - start,
    inputTokens: body.usage?.input_tokens,
    outputTokens: body.usage?.output_tokens,
    reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens,
  });
  return response;
};
let s = fixture();
s.activities[1].name = "Corner Stall";
s = apply(s, planChat(s, answer(report(s, "Corner Stall")), { now }), "Add corner stall");
s = apply(s, decideProposal(s, s.proposals[0].id, true, { now }));
// Compatibility with conversations saved before the recorded-entry blocker was removed.
s = apply(
  s,
  {
    writes: {},
    reply:
      "That entry is already recorded. Would you like to add another session?",
    loggingContext: {
      entries: [
        {
          activity_id: s.activities[1].id,
          quantity: 1,
          day: s.logs[0].day,
          log_id: s.logs[0].id,
        },
      ],
      follow_up: "offer_additional",
    },
  },
  "Add corner stall",
);
const exchange = s.messages.slice(-2);
s.messages = [];
for (let i = 0; i < 10; i++) {
  const pair = structuredClone(exchange);
  pair[0].id = "u" + i;
  pair[1].id = "a" + i;
  pair[0].created_at = new Date(now.getTime() + i * 2000).toISOString();
  pair[1].created_at = new Date(now.getTime() + i * 2000 + 1).toISOString();
  pair[1].discussion_context = {
    summary:
      "The user wants to log Corner Stall. An entry is recorded; offered another session.",
    user_message_id: pair[0].id,
  };
  s.messages.push(...pair);
}
for (const [message, history, expected] of [
  ["Yep", true, 1],
  ["Yep", false, 1],
  ["No thanks", true, 0],
  ["Obviously. Even a goblin would have got that", true, 1],
]) {
  const sample = structuredClone(s);
  if (!history) for (const m of sample.messages) delete m.discussion_context;
  timings = [];
  const p = await interpret(message, sample, now);
  const result = planChat(sample, p, { now });
  assert.equal(
    result.pendingActivityIds.length,
    expected,
    JSON.stringify({ message, reply: p.reply, actions: p.actions }),
  );
  assert.equal(result.writes.ot_logs, undefined);
  if (expected) assert.equal(p.actions[0].data.additional, true);
  console.log(
    JSON.stringify({
      message,
      history,
      ...{ calls: timings.length, timings },
      passed: true,
    }),
  );
}
console.log("PASS: contextual agreement and refusal; no database writes.");
