export const AREAS = ["mental", "physical", "work", "social"];
export const DEFAULT_SETTINGS = {
  timezone: "UTC",
  cutoff: 8,
  targets: Object.fromEntries(
    AREAS.map((a) => [a, { today: 100, seven: 700, thirty: 3000 }]),
  ),
  workPenalty: {
    enabled: true,
    afterMinutes: 240,
    perHour: { mental: -10, social: -10 },
  },
};
export const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function personalDay(now = new Date(), settings = DEFAULT_SETTINGS) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  return +p.hour < settings.cutoff ? shiftDay(day, -1) : day;
}
export function validDay(day) {
  return (
    typeof day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day
  );
}
function rawXP(activity, quantity, minutesBefore) {
  const bonus = activity.daily_bonus;
  const bonusMinutes = bonus
    ? Math.min(
        minutesFor(activity, quantity),
        Math.max(0, bonus.minutes - minutesBefore),
      )
    : 0;
  return Object.fromEntries(
    AREAS.map((a) => [
      a,
      ((activity.xp[a] || 0) * quantity) / (activity.unit_size || 1) +
        (bonusMinutes / 60) * (bonus?.perHour[a] || 0),
    ]),
  );
}
export function xpFor(
  activity,
  quantity = activity.default_quantity,
  minutesBefore = 0,
) {
  return Object.fromEntries(
    Object.entries(rawXP(activity, quantity, minutesBefore)).map(
      ([key, value]) => [key, round(value)],
    ),
  );
}
export function rewardRule(activity) {
  return structuredClone({
    unit: activity.unit,
    unit_size: activity.unit_size || 1,
    xp: activity.xp,
    daily_bonus: activity.daily_bonus ?? null,
  });
}
// Allocate each activity's daily bonus across completed entries, in stable
// recording order. Undo releases its minutes; restore reallocates them again.
// Historical entries without a snapshot keep their stored XP.
export function repriceLogs(logs) {
  const minutes = new Map();
  const accrued = new Map();
  const priced = new Map();
  const ordered = logs
    .filter((l) => l.done)
    .slice()
    .sort(
      (a, b) =>
        (a.created_at || "").localeCompare(b.created_at || "") ||
        a.id.localeCompare(b.id),
    );
  for (const log of ordered) {
    const key = `${log.day}:${log.activity_id}`;
    const before = minutes.get(key) || 0;
    const rule = log.reward_rule;
    const previousXP = accrued.get(key) || {};
    const raw = rule ? rawXP(rule, log.quantity, before) : log.xp;
    const total = Object.fromEntries(
      AREAS.map((area) => [area, (previousXP[area] || 0) + (raw[area] || 0)]),
    );
    if (rule)
      priced.set(log.id, {
        ...log,
        xp: Object.fromEntries(
          AREAS.map((area) => [
            area,
            round(round(total[area]) - round(previousXP[area] || 0)),
          ]),
        ),
      });
    accrued.set(key, total);
    minutes.set(
      key,
      before + (rule ? minutesFor(rule, log.quantity) : log.work_minutes || 0),
    );
  }
  return logs.map((log) => priced.get(log.id) || log);
}
export function nextReward(
  activity,
  quantity = activity.default_quantity,
  logs = [],
  day,
) {
  const rows = logs.filter(
    (l) => l.done && l.day === day && l.activity_id === activity.id,
  );
  return repriceLogs([
    ...rows,
    {
      id: "preview",
      activity_id: activity.id,
      day,
      quantity,
      reward_rule: rewardRule(activity),
      xp: {},
      done: true,
      created_at: "9999-12-31T23:59:59.999Z",
    },
  ]).at(-1).xp;
}
export function minutesFor(activity, quantity) {
  return activity.unit === "hour"
    ? quantity * 60
    : activity.unit === "minute"
      ? quantity
      : 0;
}
export function quantityLabel(activity, quantity) {
  return activity.unit === "completion"
    ? quantity === 1
      ? activity.name
      : `${activity.name} · ${quantity} times`
    : `${activity.name} · ${round(quantity)} ${activity.unit}${quantity === 1 ? "" : "s"}`;
}
export function frequencyStatus(activity, logs, day) {
  const done = logs.filter(
    (l) => l.activity_id === activity.id && l.done && l.day <= day,
  );
  const last =
    done
      .map((l) => l.day)
      .sort()
      .at(-1) || null;
  const f = activity.preferred_frequency;
  const daysSinceLast = last
    ? (Date.parse(day) - Date.parse(last)) / 86400000
    : null;
  // Frequency is used only to find the next due date from the LAST completion.
  // Past weekly totals never bank credit or postpone that date.
  const gap = f
    ? Math.max(1, Math.round(f.days / (f.kind === "weekly" ? f.count : 1)))
    : null;
  const next = f ? (last ? shiftDay(last, gap) : day) : null;
  const overdueDays =
    last && next
      ? Math.max(0, (Date.parse(day) - Date.parse(next)) / 86400000)
      : 0;
  const urgency = { daysSinceLast, overdueDays, next };
  if (!f)
    return {
      ...urgency,
      due: !done.some((l) => l.day === day),
      last,
      count: 0,
      reason: "",
    };
  if (f.kind === "interval") {
    return {
      ...urgency,
      due: next <= day,
      last,
      next,
      count: done.length,
      reason: last
        ? `Last recorded ${last}; you chose once every ${f.days} days.`
        : `You chose once every ${f.days} days; none recorded yet.`,
    };
  }
  const count = new Set(
    done.filter((l) => l.day >= shiftDay(day, 1 - f.days)).map((l) => l.day),
  ).size;
  return {
    ...urgency,
    due: next <= day && !done.some((l) => l.day === day),
    last,
    count,
    reason: last
      ? `Last recorded ${last}; next due ${next}.`
      : "None recorded yet.",
  };
}
// Penalty rules are saved alongside the first log of each personal day. Editing
// today's rule explicitly replaces that day's snapshot, without changing old days.
export function penaltyEntries(logs, settings) {
  const byDay = new Map();
  for (const l of logs) {
    const group = byDay.get(l.day) || [];
    group.push(l);
    byDay.set(l.day, group);
  }
  return [...byDay].flatMap(([day, rows]) => {
    const rule = rows[0].penalty_rule ?? settings.workPenalty;
    const minutes = rows
      .filter((l) => l.done)
      .reduce((sum, l) => sum + (l.work_minutes || 0), 0);
    if (!rule.enabled || minutes <= rule.afterMinutes) return [];
    const xp = Object.fromEntries(
      AREAS.map((a) => [
        a,
        round(((minutes - rule.afterMinutes) / 60) * (rule.perHour[a] || 0)),
      ]),
    );
    return [
      {
        id: `penalty-${day}`,
        day,
        xp,
        done: true,
        label: `Work beyond ${rule.afterMinutes / 60} hours · ${round((minutes - rule.afterMinutes) / 60)} extra hours`,
        derived: true,
      },
    ];
  });
}
export function totalsFor(logs, settings, day) {
  const rows = [
    ...logs.filter((l) => l.done),
    ...penaltyEntries(logs, settings),
  ];
  return Object.fromEntries(
    AREAS.map((a) => [
      a,
      Object.fromEntries(
        [
          ["today", 1],
          ["seven", 7],
          ["thirty", 30],
        ].map(([period, days]) => [
          period,
          round(
            rows
              .filter((l) => l.day <= day && l.day >= shiftDay(day, 1 - days))
              .reduce((n, l) => n + (l.xp[a] || 0), 0),
          ),
        ]),
      ),
    ]),
  );
}
// Keep gross effort and costs separate; net totals continue to drive targets.
export function xpBreakdown(logs, settings, day) {
  const rows = [
    ...logs.filter((l) => l.done),
    ...penaltyEntries(logs, settings),
  ];
  return Object.fromEntries(
    AREAS.map((area) => [
      area,
      Object.fromEntries(
        [
          ["today", 1],
          ["seven", 7],
          ["thirty", 30],
        ].map(([period, days]) => {
          const values = rows
            .filter((l) => l.day <= day && l.day >= shiftDay(day, 1 - days))
            .map((l) => l.xp[area] || 0);
          const earned = round(values.reduce((n, v) => n + Math.max(0, v), 0));
          const deducted = round(
            values.reduce((n, v) => n + Math.max(0, -v), 0),
          );
          return [period, { earned, deducted, net: round(earned - deducted) }];
        }),
      ),
    ]),
  );
}
export function streakForDays(days, today) {
  const logged = new Set(days.filter((d) => d <= today));
  const todayLogged = logged.has(today);
  let cursor = todayLogged ? today : shiftDay(today, -1),
    count = 0;
  while (logged.has(cursor)) {
    count++;
    cursor = shiftDay(cursor, -1);
  }
  return { count, todayLogged };
}
export function summary(state, now = new Date()) {
  const day = personalDay(now, state.settings);
  const totals = totalsFor(state.logs, state.settings, day);
  const streak = streakForDays(
    [
      ...state.logs.filter((l) => l.done).map((l) => l.day),
      ...state.messages.filter((m) => m.role === "user").map((m) => m.day),
    ],
    day,
  );
  return {
    day,
    totals,
    xpBreakdown: xpBreakdown(state.logs, state.settings, day),
    streak,
    penalties: penaltyEntries(state.logs, state.settings),
  };
}
export function isPendingLog(proposal) {
  return (
    proposal.actions?.length === 1 &&
    proposal.actions[0].type === "log_activity" &&
    !!proposal.actions[0].pending_log
  );
}

// Pending is a review state, never a completion or a source of earned XP.
// Use the reviewed catalogue snapshot so the checkbox matches what was proposed.
export function pendingActivities(
  state,
  day = personalDay(new Date(), state.settings),
) {
  return (state.proposals || []).filter(isPendingLog).flatMap((p) => {
    const action = p.actions[0];
    const meta = action.pending_log;
    const log = state.logs.find((l) => l.id === meta.log_id);
    if (
      p.status !== "pending" &&
      !(
        p.status === "accepted" &&
        log &&
        (log.day === day ||
          (meta.confirmed_at &&
            personalDay(new Date(meta.confirmed_at), state.settings) === day))
      )
    )
      return [];
    const activity = action.base?.activity;
    if (!activity) return [];
    const quantity = action.data.quantity ?? activity.default_quantity;
    return [
      {
        id: p.id,
        activity_id: activity.id,
        day: action.data.day,
        title: log?.label ?? quantityLabel(activity, quantity),
        xp:
          log?.xp ??
          nextReward(activity, quantity, state.logs, action.data.day),
        complete: log?.done ?? false,
        log_id: log?.id,
        waiting: p.status === "pending",
      },
    ];
  });
}

export function pillarPriority(state, day) {
  const totals = totalsFor(state.logs, state.settings, day);
  return AREAS.map((area) => ({
    area,
    progress: totals[area].seven / state.settings.targets[area].seven,
  })).sort((a, b) => a.progress - b.progress);
}

export function suggestions(state, day) {
  const pillars = pillarPriority(state, day);
  const goals = state.goals.filter(
    (g) => g.active && (!g.until_day || g.until_day >= day),
  );
  // Exclude existing review cards before filling each pillar's two slots.
  const pendingIds = new Set(
    pendingActivities(state, day)
      .filter((p) => p.day === day)
      .map((p) => p.activity_id),
  );
  const candidates = state.activities
    .filter((a) => !a.archived && !pendingIds.has(a.id))
    .map((a) => {
      const f = frequencyStatus(a, state.logs, day);
      const relevant = pillars.filter((p) => a.xp[p.area] > 0);
      const deficit = relevant.some((p) => p.progress < 1);
      const goal = goals.find(
        (g) =>
          g.activity_ids.includes(a.id) ||
          g.areas.some((area) => relevant.some((p) => p.area === area)),
      );
      const eligible =
        relevant.length &&
        f.due &&
        !state.logs.some(
          (l) => l.done && l.day === day && l.activity_id === a.id,
        ) &&
        (a.preferred_frequency || deficit || goal || a.must_do);
      const why =
        a.note?.trim() ||
        [
          a.must_do ? "You marked this as a must-do." : "",
          f.reason,
          goal ? `Your goal: ${goal.title}. ${goal.note}` : "",
          !a.preferred_frequency && deficit
            ? `${relevant
                .filter((p) => p.progress < 1)
                .map((p) => p.area)
                .join(" and ")} is below your last 7 days target.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
      return {
        ...a,
        title: quantityLabel(a, a.default_quantity),
        reward: nextReward(a, a.default_quantity, state.logs, day),
        reason: why,
        complete: false,
        eligible: !!eligible,
        // Assign once to the weakest credited pillar, preventing duplicates
        // and more than two recommendations assigned to any one pillar.
        priorityArea: relevant[0]?.area,
        overdueDays: f.overdueDays,
        nextDue: f.next,
        daysSinceLast: f.daysSinceLast,
        goalPriority: !!goal,
      };
    })
    .filter((a) => a.eligible);
  const result = [];
  for (const { area } of pillars) {
    const selected = candidates
      .filter((a) => a.priorityArea === area)
      .sort(
        (a, b) =>
          b.overdueDays - a.overdueDays ||
          Number(b.must_do) - Number(a.must_do) ||
          Number(b.goalPriority) - Number(a.goalPriority) ||
          // No recurrence means no overdue date; recency is only a tie-break.
          (!b.preferred_frequency ? (b.daysSinceLast ?? 0) : 0) -
            (!a.preferred_frequency ? (a.daysSinceLast ?? 0) : 0),
      )
      .slice(0, 2);
    result.push(...selected);
  }
  return result.map(({ goalPriority: _goalPriority, ...a }, index) => ({
    ...a,
    rank: result.length - index,
  }));
}

export function activityContext(activity) {
  const { sop, ...context } = activity;
  return { ...context, has_sop: !!sop?.trim() };
}

// This is the entire payload allowed in everyday AI context. Never add journal
// rows, scores, raw message history, or previous reflection results here.
export function routineContext(state, now = new Date()) {
  const s = summary(state, now);
  return {
    day: s.day,
    timezone: state.settings.timezone,
    dayStartsAt: state.settings.cutoff,
    targets: state.settings.targets,
    workPenalty: state.settings.workPenalty,
    totals: s.totals,
    activities: state.activities.map((a) => ({
      ...activityContext(a),
      history: frequencyStatus(a, state.logs, s.day),
    })),
    goals: state.goals.filter((g) => g.active),
    recentCompletions: state.logs
      .filter((l) => l.day >= shiftDay(s.day, -6))
      .map(({ id, activity_id, day, quantity, done, xp }) => ({
        id,
        activity_id,
        day,
        quantity,
        done,
        xp,
      })),
    // Only completion drafts; never include journal or catalogue proposals here.
    pendingCompletions: pendingActivities(state, s.day)
      .filter((item) => item.waiting)
      .map(({ activity_id, day, title }) => ({ activity_id, day, title })),
    suggestionPriority: {
      pillars: pillarPriority(state, s.day),
      maxPerPillar: 2,
      overdueRule:
        "Use frequency only to establish nextDue from last completion (weekly spacing rounded to a personal day); rank by days between nextDue and today. Past weekly counts never bank credit or suppress overdue activities. Unknown history has no known overdue age.",
    },
    suggestedActivities: suggestions(state, s.day).map((a) => ({
      id: a.id,
      area: a.priorityArea,
      overdueDays: a.overdueDays,
      nextDue: a.nextDue,
      daysSinceLast: a.daysSinceLast,
      reason: a.reason,
    })),
  };
}
