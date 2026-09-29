import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  personalDay,
  shiftDay,
  xpFor,
  rewardRule,
  repriceLogs,
  minutesFor,
  quantityLabel,
  totalsFor,
  AREAS,
} from "../shared/domain.mjs";
import * as v from "./validation.mjs";

// Nullable schema additions are equivalent to absent fields in older reviews.
export function sameReviewBase(left, right) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const fields = { ...value };
    if ("sop" in fields && !fields.sop) delete fields.sop;
    return Object.fromEntries(
      Object.entries(fields)
        .filter(
          ([key, value]) =>
            !(
              value == null &&
              ["daily_bonus", "reward_rule", "sop_reminded_at"].includes(key)
            ),
        )
        .map(([key, value]) => [
          key,
          ["created_at", "updated_at"].includes(key) &&
          typeof value === "string" &&
          Number.isFinite(Date.parse(value))
            ? new Date(value).toISOString()
            : normalize(value),
        ]),
    );
  };
  return isDeepStrictEqual(normalize(left), normalize(right));
}

function logReviewActivity(activity) {
  if (!activity) return activity;
  // HOW-only edits do not change the activity completion being confirmed.
  const { sop: _sop, updated_at: _updatedAt, ...review } = activity;
  return review;
}

export function planActions(
  s,
  actions,
  { ai = false, now = new Date(), splitLogs = true } = {},
) {
  v.assert(
    Array.isArray(actions) && actions.length <= 30,
    "Too many changes at once.",
  );
  // Existing completions can be checked independently. Keep catalogue changes
  // and their dependent logs together in the existing explicit review flow.
  if (
    ai &&
    splitLogs &&
    actions.some((a) => a.type === "log_activity") &&
    actions.every((a) => ["log_activity", "journal"].includes(a.type))
  ) {
    const batchId = randomUUID();
    const proposals = actions.flatMap((action) => {
      const prepared =
        action.type === "log_activity"
          ? { ...action, pending_log: { batch_id: batchId } }
          : action;
      return planActions(s, [prepared], { ai, now, splitLogs: false }).writes
        .ot_proposals;
    });
    return { writes: { ot_proposals: proposals }, saved: [], working: s };
  }
  const working = structuredClone(s),
    writes = {},
    saved = [],
    sopReminders = [];
  const timestamp = now.toISOString(),
    today = personalDay(now, s.settings);
  function write(table, row, key) {
    const arr = (writes[table] ??= []);
    const index = arr.findIndex((r) => r.id === row.id);
    if (index < 0) arr.push(row);
    else arr[index] = row;
    if (key) {
      const i = working[key].findIndex((r) => r.id === row.id);
      if (i < 0) working[key].push(row);
      else working[key][i] = row;
    }
  }
  for (const action of actions) {
    const { type, data } = action;
    v.assert(
      data && typeof data === "object" && !Array.isArray(data),
      "Invalid change.",
    );
    if (type === "create_activity" || type === "update_activity") {
      const existing =
        type === "update_activity"
          ? working.activities.find((a) => a.id === data.id)
          : null;
      if (type === "update_activity")
        v.assert(existing, "That activity no longer exists.");
      const item = v.activity(
        { ...data, id: type === "create_activity" ? randomUUID() : data.id },
        existing,
        timestamp,
      );
      v.assert(
        !working.activities.some(
          (a) =>
            a.id !== item.id &&
            !a.archived &&
            a.name.toLocaleLowerCase() === item.name.toLocaleLowerCase(),
        ),
        "An activity with that name already exists.",
      );
      v.assert(
        !item.tracks_work || item.unit !== "completion",
        "Work tracking needs minutes or hours.",
      );
      write("ot_activities", item, "activities");
      saved.push(`${existing ? "Updated" : "Added"} ${item.name}.`);
    } else if (type === "archive_activity") {
      const a = working.activities.find((a) => a.id === data.id);
      v.assert(a, "Activity not found.");
      write(
        "ot_activities",
        { ...a, archived: v.bool(data.archived, true), updated_at: timestamp },
        "activities",
      );
      saved.push(
        `${data.archived === false ? "Restored" : "Archived"} ${a.name}. Its history is kept.`,
      );
    } else if (type === "log_activity") {
      const a = working.activities.find(
        (a) =>
          a.id === data.activity_id ||
          (!data.activity_id &&
            a.name.toLocaleLowerCase() ===
              data.activity_name?.toLocaleLowerCase()),
      );
      v.assert(
        a && !a.archived,
        "Add this activity and its XP before logging it.",
      );
      const quantity = v.number(
        data.quantity ?? a.default_quantity,
        0.01,
        10000,
        "Amount",
      );
      const logDay = v.day(data.day ?? today, today);
      const penalty =
        working.logs.find((l) => l.day === logDay)?.penalty_rule ??
        working.settings.workPenalty;
      write(
        "ot_logs",
        {
          id: randomUUID(),
          activity_id: a.id,
          day: logDay,
          quantity,
          xp: xpFor(a, quantity),
          reward_rule: rewardRule(a),
          work_minutes: a.tracks_work ? minutesFor(a, quantity) : 0,
          penalty_rule: penalty,
          label: quantityLabel(a, quantity),
          done: true,
          created_at: timestamp,
        },
        "logs",
      );
      saved.push(
        `Logged ${quantityLabel(a, quantity)}${logDay !== today ? ` for ${logDay}` : ""}.`,
      );
    } else if (type === "set_log_status") {
      const log = working.logs.find((l) => l.id === data.id);
      v.assert(log, "Activity record not found.");
      v.assert(typeof data.done === "boolean", "Choose undo or restore.");
      write("ot_logs", { ...log, done: data.done }, "logs");
      saved.push(`${data.done ? "Restored" : "Undid"} ${log.label}.`);
    } else if (type === "journal") {
      const entry = v.journal(data, today);
      write("ot_journal", {
        id: randomUUID(),
        ...entry,
        created_at: timestamp,
      });
      saved.push(
        `Saved your ${entry.period === "day" ? "" : `${entry.period} `}journal entry.`,
      );
    } else if (type === "save_goal") {
      const old = data.id ? working.goals.find((g) => g.id === data.id) : null;
      if (data.id) v.assert(old, "Goal not found.");
      const g = { ...old, ...data };
      v.assert(
        Array.isArray(g.areas) &&
          g.areas.every((p) =>
            ["mental", "physical", "work", "social"].includes(p),
          ),
        "Choose goal pillars.",
      );
      v.assert(
        Array.isArray(g.activity_ids) &&
          g.activity_ids.every((id) =>
            working.activities.some((a) => a.id === id),
          ),
        "Choose existing activities.",
      );
      const goal = {
        id: old?.id ?? randomUUID(),
        title: v.text(g.title, "a goal", 300, false),
        note: v.text(g.note ?? "", "a goal note"),
        areas: g.areas,
        activity_ids: g.activity_ids,
        until_day: g.until_day ? v.day(g.until_day, today, true) : null,
        active: v.bool(g.active, true),
        created_at: old?.created_at ?? timestamp,
      };
      write("ot_goals", goal, "goals");
      saved.push(`Saved goal: ${goal.title}.`);
    } else if (type === "save_settings") {
      const next = v.settings(data);
      writes.settings = next;
      working.settings = next;
      // Changes are prospective, except that today's work penalty is refreshed.
      if (
        JSON.stringify(s.settings.workPenalty) !==
        JSON.stringify(next.workPenalty)
      ) {
        for (const l of working.logs.filter((l) => l.day === today))
          write("ot_logs", { ...l, penalty_rule: next.workPenalty }, "logs");
      }
      saved.push("Saved targets and preferences.");
    } else {
      throw new v.UserError("This change is not supported.");
    }
  }
  if (!ai) {
    for (const log of [...(writes.ot_logs || [])]) {
      if (s.logs.some((old) => old.id === log.id)) continue;
      const activity = working.activities.find((a) => a.id === log.activity_id);
      if (!activity?.sop?.trim()) continue;
      const recent = working.logs.some(
        (l) =>
          l.activity_id === activity.id &&
          l.sop_reminded_at &&
          personalDay(new Date(l.sop_reminded_at), working.settings) >=
            shiftDay(today, -6),
      );
      if (recent) continue;
      write("ot_logs", { ...log, sop_reminded_at: timestamp }, "logs");
      sopReminders.push({ activity_id: activity.id, name: activity.name });
    }
  }
  for (const log of repriceLogs(working.logs)) {
    const existing = working.logs.find((l) => l.id === log.id);
    if (!isDeepStrictEqual(log.xp, existing.xp)) write("ot_logs", log, "logs");
  }
  if (ai && actions.length) {
    const normalized = actions.map((a) => ({
      ...a,
      data: ["log_activity", "journal"].includes(a.type)
        ? { ...a.data, day: a.data.day ?? today }
        : a.data,
    }));
    const days = [...new Set([...working.logs, ...s.logs].map((l) => l.day))];
    const preview = days.flatMap((day) => {
      const before = totalsFor(s.logs, s.settings, day),
        after = totalsFor(working.logs, working.settings, day);
      const delta = Object.fromEntries(
        AREAS.map((a) => [
          a,
          Math.round((after[a].today - before[a].today) * 100) / 100,
        ]),
      );
      return Object.values(delta).some((n) => n !== 0) ? [{ day, delta }] : [];
    });
    const p = {
      id: randomUUID(),
      preview,
      title: saved
        .join(" ")
        .replaceAll("Logged ", "Log ")
        .replaceAll("Added ", "Add ")
        .replaceAll("Saved ", "Save "),
      actions: normalized.map((a) => ({ ...a, base: actionBase(s, a) })),
      status: "pending",
      created_at: timestamp,
    };
    return { writes: { ot_proposals: [p] }, saved: [], working: s };
  }
  return { writes, saved, working, sopReminders };
}
export function decideProposal(s, id, accept, { now = new Date() } = {}) {
  const p = s.proposals.find((p) => p.id === id);
  v.assert(p && p.status === "pending", "This proposal was already handled.");
  if (!accept)
    return {
      writes: { ot_proposals: [{ ...p, status: "dismissed" }] },
      saved: ["Dismissed."],
    };
  for (const a of p.actions) {
    // Each pending completion is an additive entry. Checking another session
    // must not invalidate this card; changed catalogue terms still need review.
    if (a.pending_log) {
      v.assert(
        sameReviewBase(
          logReviewActivity(actionBase(s, a).activity),
          logReviewActivity(a.base?.activity),
        ),
        "This item changed since the proposal. Ask for an updated proposal.",
      );
      continue;
    }
    const current = actionBase(s, a);
    v.assert(
      sameReviewBase(current, a.base),
      "This item changed since the proposal. Ask for an updated proposal.",
    );
  }
  const result = planActions(s, p.actions, { now });
  result.writes.ot_proposals = [
    {
      ...p,
      status: "accepted",
      actions: p.actions.map((a) =>
        a.pending_log
          ? {
              ...a,
              pending_log: {
                ...a.pending_log,
                log_id: result.writes.ot_logs[0].id,
                confirmed_at: now.toISOString(),
              },
            }
          : a,
      ),
    },
  ];
  return result;
}

export function actionBase(s, a) {
  if (a.type === "save_settings") return s.settings;
  if (a.type === "save_goal")
    return s.goals.find((g) => g.id === a.data.id) ?? null;
  if (a.type === "set_log_status")
    return s.logs.find((l) => l.id === a.data.id) ?? null;
  if (a.type === "log_activity")
    return {
      activity:
        s.activities.find(
          (i) =>
            i.id === a.data.activity_id ||
            (!a.data.activity_id &&
              i.name.toLowerCase() === a.data.activity_name?.toLowerCase()),
        ) ?? null,
      logs: s.logs
        .filter(
          (l) =>
            l.day === a.data.day &&
            (!a.pending_log ||
              l.activity_id ===
                (a.data.activity_id ||
                  s.activities.find(
                    (i) =>
                      i.name.toLowerCase() ===
                      a.data.activity_name?.toLowerCase(),
                  )?.id)),
        )
        .map((l) => ({ id: l.id, done: l.done }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  if (a.type === "create_activity" || a.type === "journal") return null;
  return s.activities.find((i) => i.id === a.data.id) ?? null;
}
