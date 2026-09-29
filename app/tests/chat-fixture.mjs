import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../shared/domain.mjs";
import { planActions } from "../server/actions.mjs";

export const now = new Date("2026-09-12T15:00:00Z");
export function fixture() {
  let s = {
    revision: 0,
    settings: structuredClone(DEFAULT_SETTINGS),
    activities: [],
    logs: [],
    proposals: [],
    messages: [],
    goals: [],
    journal: [],
    clarification: null,
  };
  for (const data of [
    { name: "Patrol Run", xp: { physical: 100, mental: 50, social: 25 } },
    {
      name: "Browse the Bazaar",
      description: "Buying gear, arrows and trinkets at the Ashvale bazaar.",
      xp: { social: 50 },
    },
    {
      name: "Enchanting Workshop",
      unit: "hour",
      xp: { work: 15 },
      tracks_work: true,
    },
  ])
    s = planActions(
      s,
      [
        {
          type: "create_activity",
          data: {
            unit: "completion",
            unit_size: 1,
            default_quantity: 1,
            ...data,
          },
        },
      ],
      { now },
    ).working;
  return s;
}
export function apply(s, result, message = null) {
  s = structuredClone(s);
  const keys = {
    ot_proposals: "proposals",
    ot_logs: "logs",
    ot_journal: "journal",
    ot_activities: "activities",
  };
  for (const [table, values] of Object.entries(result.writes)) {
    if (table === "clarification") {
      s.clarification = values;
      continue;
    }
    const key = keys[table];
    if (!key) continue;
    for (const value of values) {
      const i = s[key].findIndex((item) => item.id === value.id);
      if (i === -1) s[key].push(value);
      else s[key][i] = value;
    }
  }
  if (message !== null) {
    const time = now.getTime() + s.messages.length * 1000;
    s.messages.push({
      id: randomUUID(),
      role: "user",
      text: message,
      mode: "routine",
      created_at: new Date(time).toISOString(),
    });
    s.messages.push({
      id: randomUUID(),
      role: "assistant",
      text: result.reply,
      mode: "routine",
      created_at: new Date(time + 1).toISOString(),
      logging_context: result.loggingContext,
    });
  }
  return s;
}
export function report(s, name, quantity = 1, extra = {}) {
  return {
    type: "log_activity",
    data: {
      activity_id: s.activities.find((a) => a.name === name).id,
      quantity,
      ...extra,
    },
  };
}
export const answer = (...actions) => ({
  reply: "Ready.",
  pending: null,
  actions,
});
