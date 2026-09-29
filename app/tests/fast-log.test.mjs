import test from "node:test";
import assert from "node:assert/strict";
import { fastLog } from "../server/fast-log.mjs";
import { planActions, decideProposal } from "../server/actions.mjs";
import { planChat, loggingContext } from "../server/chat.mjs";
import { recentMessages } from "../server/discussion.mjs";
import { fixture, now, apply } from "./chat-fixture.mjs";
function setup() {
  let s = fixture();
  for (const data of [
    {
      name: "Guild Contracts",
      unit: "hour",
      default_quantity: 1,
      xp: { work: 20 },
      daily_bonus: { minutes: 60, perHour: { work: 20 } },
      tracks_work: true,
    },
    {
      name: "Sweep the Hideout",
      unit: "minute",
      unit_size: 10,
      default_quantity: 10,
      xp: { mental: 10 },
    },
    {
      name: "Repair the Hideout",
      unit: "completion",
      default_quantity: 1,
      xp: { mental: 100 },
    },
    {
      name: "Barracks Sparring",
      unit: "completion",
      default_quantity: 1,
      xp: { physical: 100, mental: 25, social: 50 },
    },
    {
      name: "Rune Meditation",
      unit: "minute",
      unit_size: 10,
      default_quantity: 10,
      xp: { mental: 20 },
    },
    {
      name: "Study Spellbooks",
      unit: "minute",
      unit_size: 10,
      default_quantity: 10,
      xp: { mental: 10 },
    },
  ])
    s = planActions(s, [{ type: "create_activity", data }], { now }).working;
  return s;
}
test("complete standalone logging phrases preserve activity, quantity, units and personal day", () => {
  const s = setup();
  for (const [text, name, quantity, day] of [
    [
      "I worked on guild contracts 2 hours today",
      "Guild Contracts",
      2,
      "2026-09-12",
    ],
    ["I worked on contracts for 2h", "Guild Contracts", 2, "2026-09-12"],
    ["add guild contracts", "Guild Contracts", 1, "2026-09-12"],
    [
      "Worked on contracts for 90 minutes",
      "Guild Contracts",
      1.5,
      "2026-09-12",
    ],
    ["Please add Guild Contracts", "Guild Contracts", 1, "2026-09-12"],
    ["log 2h of Guild Contracts yesterday", "Guild Contracts", 2, "2026-09-11"],
    [
      "I worked in the workshop for 2 hours",
      "Enchanting Workshop",
      2,
      "2026-09-12",
    ],
    ["enchanted 1h", "Enchanting Workshop", 1, "2026-09-12"],
    ["Add Enchanting Workshop 30min", "Enchanting Workshop", 0.5, "2026-09-12"],
    ["patrolled yesterday", "Patrol Run", 1, "2026-09-11"],
    ["I went on patrol", "Patrol Run", 1, "2026-09-12"],
    ["10 min Sweep the Hideout", "Sweep the Hideout", 10, "2026-09-12"],
    ["I swept the hideout for .5 hours", "Sweep the Hideout", 30, "2026-09-12"],
    ["Add Repair the Hideout", "Repair the Hideout", 1, "2026-09-12"],
    ["I browsed the bazaar today!", "Browse the Bazaar", 1, "2026-09-12"],
    ["went to the bazaar yesterday", "Browse the Bazaar", 1, "2026-09-11"],
    ["I finished Patrol Run today!", "Patrol Run", 1, "2026-09-12"],
    ["sparred", "Barracks Sparring", 1, "2026-09-12"],
    ["went sparring today", "Barracks Sparring", 1, "2026-09-12"],
    ["I meditated for 20 minutes", "Rune Meditation", 20, "2026-09-12"],
    ["studied spellbooks 30 min", "Study Spellbooks", 30, "2026-09-12"],
  ]) {
    const p = fastLog(text, s, now);
    assert.ok(p, text);
    assert.deepEqual(
      p.actions[0].data,
      {
        activity_id: s.activities.find((a) => a.name === name).id,
        quantity,
        day,
        additional: false,
      },
      text,
    );
  }
  const cutoff = { ...s, settings: { ...s.settings, cutoff: 6 } };
  assert.equal(
    fastLog("worked on contracts 2h", cutoff, new Date("2026-09-12T05:59:00Z"))
      .actions[0].data.day,
    "2026-09-11",
  );
  assert.equal(
    fastLog("worked on contracts 2h", cutoff, new Date("2026-09-12T06:00:00Z"))
      .actions[0].data.day,
    "2026-09-12",
  );
});
test("questions, plans, negations, mixed edits, follow-ups and unsupported quantities defer to AI", () => {
  const s = setup();
  for (const phrase of [
    "Yep",
    "another one",
    "do it",
    "Blast it, you know which one",
    "I will work on contracts 2h",
    "I didn't work on contracts 2h",
    "I almost worked on contracts 2h",
    "Should I work on contracts 2h?",
    "Can you add Guild Contracts?",
    "I worked on contracts 2h and patrolled",
    "Add guild contracts and change its XP to 30",
    "I worked on contracts 2h, mood 8/10",
    "Add Guild Contracts tomorrow",
    "I worked on contracts 2h last Monday",
    "I worked on contracts two hours",
    "I worked on contracts 1h 30m",
    "I worked on contracts -2h",
    "I worked on contracts 0h",
    "I worked on contracts 10001h",
    "I patrolled for 20 minutes",
    "Add Browse the Bazaar 1h",
    "Add Ridge Hunt",
    "Sweep the Hideout",
    "Guild Contracts",
    "Add Guild Contracts then add to my journal",
    "I worked on contracts 2h except yesterday",
    "I have not worked on contracts",
    "I worked with the enchanter for 2 hours",
  ])
    assert.equal(fastLog(phrase, s, now), null, phrase);
});
test("open questions, catalogue reviews, and ambiguous aliases cannot bypass context", () => {
  const s = setup();
  assert.equal(
    fastLog(
      "Add Guild Contracts",
      { ...s, clarification: { intent: "journal" } },
      now,
    ),
    null,
  );
  assert.equal(
    fastLog(
      "Add Guild Contracts",
      {
        ...s,
        messages: [
          {
            role: "assistant",
            text: "Create a new activity?",
            created_at: now.toISOString(),
          },
        ],
      },
      now,
    ),
    null,
  );
  const proposal = planActions(
    s,
    [
      {
        type: "update_activity",
        data: { id: s.activities[3].id, note: "Escort jobs pay best." },
      },
    ],
    { ai: true, now },
  );
  assert.equal(fastLog("Add Guild Contracts", apply(s, proposal), now), null);
  const duplicate = structuredClone(s);
  duplicate.activities.push({
    ...s.activities[0],
    id: "another",
    name: "Patrol Run",
  });
  assert.equal(fastLog("patrolled", duplicate, now), null);
  s.activities.find((a) => a.name === "Guild Contracts").archived = true;
  assert.equal(fastLog("worked on contracts 2h", s, now), null);
});
test("fast logs retain conversation context, require checkoff, deduplicate and preserve XP rules", () => {
  let s = setup();
  s.messages = [
    {
      role: "assistant",
      mode: "routine",
      text: "An idea.",
      created_at: now.toISOString(),
      discussion_context: {
        summary: "Discussing a possible Study Spellbooks note; not saved.",
      },
    },
  ];
  const prepared = fastLog("worked on contracts 2h", s, now);
  assert.match(prepared.discussionContext.summary, /Study Spellbooks note/);
  const result = planChat(s, prepared, { now });
  assert.equal(result.writes.ot_logs, undefined);
  s = apply(s, result, "worked on contracts 2h");
  s.messages.at(-1).discussion_context = {
    ...prepared.discussionContext,
    user_message_id: s.messages.at(-2).id,
  };
  assert.equal(recentMessages(s).at(-2).content, "worked on contracts 2h");
  assert.equal(loggingContext(s).entries[0].quantity, 2);
  const again = planChat(s, fastLog("worked on contracts 2h", s, now), { now });
  assert.deepEqual(again.pendingActivityIds, result.pendingActivityIds);
  s = apply(s, decideProposal(s, result.pendingActivityIds[0], true, { now }));
  assert.equal(s.logs[0].xp.work, 60);
  const next = planChat(s, fastLog("worked on contracts 2h", s, now), { now });
  assert.equal(next.handoff, true);
  assert.equal(next.pendingActivityIds.length, 1);
  assert.notEqual(next.pendingActivityIds[0], result.pendingActivityIds[0]);
  assert.doesNotMatch(next.reply, /already recorded/i);
  s = apply(s, next, "worked on contracts 2h");
  assert.equal(s.logs.length, 1);
  assert.equal(loggingContext(s).follow_up, undefined);
  s = apply(s, decideProposal(s, next.pendingActivityIds[0], true, { now }));
  assert.equal(s.logs.length, 2);
  assert.equal(
    s.logs.reduce((sum, log) => sum + log.xp.work, 0),
    100,
  );
  assert.equal(fastLog("Yep", s, now), null);
});
