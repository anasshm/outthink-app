// Optional real-model checks with fictional fixtures; nothing is saved to the DB.
import assert from "node:assert/strict";
import { interpret, reflect } from "../server/ai.mjs";
import { DEFAULT_SETTINGS, xpFor } from "../shared/domain.mjs";
const s = {
  settings: DEFAULT_SETTINGS,
  activities: [],
  goals: [],
  logs: [],
  messages: [],
  clarification: null,
};
const add = await interpret(
  "Add Rune Meditation: 10 Mental XP per 10 minutes, default 10 minutes, every day. No other XP. This is catalogue setup, not a completion.",
  s,
);
const activity = add.actions.find((a) => a.type === "create_activity")?.data;
assert.ok(activity, "AI should propose an activity");
assert.equal(xpFor(activity, 30).mental, 30, "AI must preserve 10XP/10minutes");
assert.equal(
  add.actions.some((a) => a.type === "log_activity"),
  false,
);
const a = {
  ...activity,
  name: "Rune Meditation",
  id: "00000000-0000-4000-8000-000000000001",
  archived: false,
};
s.activities = [a];
const log = await interpret(
  "I meditated over the rune stones for half an hour.",
  s,
);
assert.equal(
  log.actions.find((a) => a.type === "log_activity")?.data.quantity,
  30,
);
const unknown = await interpret("I went dragon-egg hunting in the caves.", s);
assert.ok(unknown.pending || unknown.reply.includes("?"));
assert.equal(
  unknown.actions.some((a) => a.type === "create_activity"),
  false,
);
const reflection = await reflect("Analyze these fictional test days.", {
  range: { from: "2026-08-01", to: "2026-08-02" },
  journal: [
    {
      day: "2026-08-01",
      period: "day",
      scores: { day: 7 },
      text: "Test note: enjoyed a patrol along the town wall.",
    },
  ],
  completions: [],
  activities: [a],
});
assert.ok(reflection.reply);
console.log(
  "PASS: actual OpenAI connection, XP rate interpretation, casual duration, unknown activity clarification, and explicit reflection. No records saved.",
);
