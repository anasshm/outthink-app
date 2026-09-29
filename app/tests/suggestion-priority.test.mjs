import test from "node:test";
import assert from "node:assert/strict";
import {
  AREAS,
  DEFAULT_SETTINGS,
  frequencyStatus,
  suggestions,
  routineContext,
  totalsFor,
  shiftDay,
} from "../shared/domain.mjs";
const day = "2026-09-16";
const now = new Date(day + "T12:00:00Z");
function fixture() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    activities: [],
    logs: [],
    goals: [],
    proposals: [],
    messages: [],
  };
}
function activity(s, id, area, days = 3, lastAgo = 10) {
  const a = {
    id,
    name: id,
    xp: { [area]: 10 },
    unit: "completion",
    unit_size: 1,
    default_quantity: 1,
    preferred_frequency: days ? { kind: "interval", days } : null,
    note: "",
    description: "Matches " + id,
    sop: "PRIVATE HOW " + id,
    archived: false,
  };
  s.activities.push(a);
  if (lastAgo !== null)
    s.logs.push({
      id: id + "-last",
      activity_id: id,
      day: shiftDay(day, -lastAgo),
      done: true,
      xp: { [area]: 10 },
    });
  return a;
}
function weeklyTotals(s) {
  // Different targets intentionally make raw XP ordering incorrect.
  const percentages = { mental: 0.1, social: 0.2, physical: 0.5, work: 0.8 };
  for (const area of AREAS) {
    s.settings.targets[area].seven = area === "mental" ? 2000 : 100;
    s.logs.push({
      id: area + "-total",
      activity_id: "other-" + area,
      day,
      done: true,
      xp: { [area]: s.settings.targets[area].seven * percentages[area] },
    });
  }
}
test("weakest weekly percentage first, then days past due, maximum two per pillar", () => {
  const s = fixture();
  weeklyTotals(s);
  for (const area of AREAS) {
    activity(s, area + "-third", area, 3, 11);
    activity(s, area + "-second", area, 3, 13);
    activity(s, area + "-first", area, 3, 20);
  }
  const result = suggestions(s, day);
  assert.deepEqual(
    result.map((a) => a.id),
    [
      "mental-first",
      "mental-second",
      "social-first",
      "social-second",
      "physical-first",
      "physical-second",
      "work-first",
      "work-second",
    ],
  );
  assert.equal(result.length, 8);
  assert.equal(result[0].overdueDays, 17);
});
test("due-date lateness beats frequency ratios and older last-completion dates", () => {
  const s = fixture();
  activity(s, "Study Spellbooks", "mental", 3, 10); // 7 days overdue, 3.33 intervals.
  activity(s, "Repair the Hideout", "mental", 15, 30); // 15 days overdue, 2 intervals.
  activity(s, "Consult the Oracle", "mental", 60, 61); // Oldest completion, only 1 late.
  assert.deepEqual(
    suggestions(s, day).map((a) => a.id),
    ["Repair the Hideout", "Study Spellbooks"],
  );
  assert.equal(suggestions(s, day)[0].nextDue, shiftDay(day, -15));
});
test("weekly completions never bank credit or hide an activity past its next due date", () => {
  const s = fixture();
  const a = activity(s, "weekly", "mental", null, null);
  a.preferred_frequency = { kind: "weekly", days: 7, count: 3 };
  for (let i = 0; i < 10; i++)
    s.logs.push({
      id: "past" + i,
      activity_id: a.id,
      day: shiftDay(day, -(i < 8 ? 3 : i === 8 ? 4 : 5)),
      done: true,
      xp: { mental: 1 },
    });
  const f = frequencyStatus(a, s.logs, day);
  assert.equal(f.count, 3);
  assert.equal(f.next, shiftDay(day, -1));
  assert.equal(f.overdueDays, 1);
  assert.equal(f.due, true);
  assert.equal(suggestions(s, day)[0].id, a.id);
  a.preferred_frequency.count = 2;
  assert.equal(frequencyStatus(a, s.logs, day).due, false); // Next due tomorrow.
  s.logs = s.logs.map((l) => ({ ...l, day: shiftDay(day, -7) }));
  assert.equal(frequencyStatus(a, s.logs, day).overdueDays, 3); // Next due 4 days after last.
});
test("unknown history, unscheduled fallback, cross-pillar deduplication and exclusions", () => {
  const s = fixture();
  weeklyTotals(s);
  const multi = activity(s, "multi", "social", 3, 20);
  multi.xp.mental = 5;
  activity(s, "unknown", "mental", 3, null);
  activity(s, "later", "mental", 15, 10);
  const archived = activity(s, "archived", "mental", 1, 50);
  archived.archived = true;
  activity(s, "today", "mental", 1, 0);
  const undone = activity(s, "undone", "physical", 1, 40);
  s.logs.push({
    id: "undone-today",
    activity_id: undone.id,
    day,
    done: false,
    xp: { physical: 1000 },
  });
  const result = suggestions(s, day);
  assert.equal(result.filter((a) => a.id === "multi").length, 1);
  assert.equal(result.find((a) => a.id === "multi").priorityArea, "mental");
  assert.equal(result.find((a) => a.id === "unknown").overdueDays, 0);
  assert.equal(result.find((a) => a.id === "unknown").daysSinceLast, null);
  assert.ok(!result.some((a) => ["later", "archived", "today"].includes(a.id)));
  assert.equal(result.find((a) => a.id === "undone").overdueDays, 39);
  assert.equal(totalsFor(s.logs, s.settings, day).physical.seven, 50);
  const u = fixture();
  activity(u, "recent", "social", null, 8);
  activity(u, "old", "social", null, 20);
  assert.deepEqual(
    suggestions(u, day).map((a) => a.id),
    ["old", "recent"],
  );
});
test("AI and dashboard share priority, and approved note stays the entire explanation", () => {
  const s = fixture();
  weeklyTotals(s);
  const a = activity(s, "Study Spellbooks", "mental", 3, 10);
  a.note = "Goal: learn the Warding spell before the Blade Trial.";
  activity(s, "Patrol Run", "physical", 3, 50);
  const before = structuredClone(s);
  const output = suggestions(s, day);
  const input = routineContext(s, now);
  assert.deepEqual(
    input.suggestedActivities.map((a) => a.id),
    output.map((a) => a.id),
  );
  assert.deepEqual(
    input.suggestionPriority.pillars.map((p) => p.area),
    ["mental", "social", "physical", "work"],
  );
  assert.equal(output[0].reason, a.note);
  assert.equal(input.activities[0].description, a.description);
  assert.ok(!JSON.stringify(input).includes("PRIVATE HOW"));
  assert.deepEqual(s, before);
});
