// Uses the configured model with fictional in-memory data. No database writes.
import assert from "node:assert/strict";
import { interpret } from "../server/ai.mjs";
import { planChat } from "../server/chat.mjs";
import { fixture, now, apply } from "./chat-fixture.mjs";

async function turn(s, message) {
  const prepared = await interpret(message, s, now);
  const result = planChat(s, prepared, { now });
  assert.equal(result.writes.ot_journal, undefined);
  return { result, state: apply(s, result, message) };
}

for (const message of [
  "I'm grumpy about the rain",
  "Today was good",
  "Patrol Run was an 8/10 activity",
  "Do you have access to my journal?",
]) {
  const { result, state } = await turn(fixture(), message);
  assert.ok(
    !(result.writes.ot_proposals ?? []).some((p) =>
      p.actions.some((a) => a.type === "journal"),
    ),
    message,
  );
  if (!message.startsWith("Patrol Run"))
    assert.equal(result.writes.ot_proposals, undefined, message);
  assert.notEqual(state.clarification?.intent, "journal", message);
  assert.ok(
    !/would you like.*(?:save|journal)|add this to your journal/i.test(
      result.reply,
    ),
    message,
  );
  console.log(`PASS: conversation stays conversational: ${message}`);
}

let { result, state } = await turn(
  fixture(),
  "Can you add in my journal that I like to check the guild board first thing, so if someday before 9am I ask what to do you can suggest Guild Contracts? You can rephrase that a bit.",
);
assert.equal(state.clarification?.intent, "journal");
assert.equal(result.writes.ot_proposals, undefined);
assert.match(state.clarification.draft.text, /guild|contract/i);
assert.ok(
  !/can you add|you can rephrase/i.test(state.clarification.draft.text),
);
assert.deepEqual(state.clarification.draft.scores, {});
console.log(
  "PASS: journal request produces rephrased draft, no confirmation card",
);

({ result, state } = await turn(
  state,
  "Yes but make it shorter and say before 8am instead of 9am",
));
assert.equal(result.writes.ot_proposals, undefined);
assert.equal(state.clarification?.intent, "journal");
assert.match(state.clarification.draft.text, /8/);
const approvedDraft = structuredClone(state.clarification.draft);
console.log("PASS: revised draft is shown for agreement again");

({ result, state } = await turn(state, "Add it"));
assert.equal(state.clarification, null);
assert.equal(result.writes.ot_proposals.length, 1);
assert.deepEqual(result.writes.ot_proposals[0].actions[0].data, approvedDraft);
console.log("PASS: add it creates confirmation with exact reviewed content");

({ result, state } = await turn(fixture(), "My mood right now is 8/10"));
assert.equal(result.writes.ot_proposals, undefined);
assert.deepEqual(state.clarification?.draft.scores, { mood: 8 });
assert.equal(state.clarification?.draft.period, "moment");
console.log("PASS: explicit mood rating creates draft with correct period");
({ result, state } = await turn(state, "Never mind, don't save that"));
assert.equal(state.clarification, null);
assert.equal(result.writes.ot_proposals, undefined);
console.log("PASS: cancellation clears the draft");

({ result, state } = await turn(
  fixture(),
  "I patrolled today and did 2 hours of Enchanting Workshop",
));
assert.equal(result.writes.ot_proposals.length, 2);
assert.ok(
  result.writes.ot_proposals.every((p) => p.actions[0].type === "log_activity"),
);
assert.equal(result.handoff, true);
console.log(
  "PASS: activity logging still goes straight to Pending; no records saved",
);
