import { AREAS, validDay } from "../shared/domain.mjs";
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function assert(ok, message) {
  if (!ok) throw new UserError(message);
}
export const uuid = (x) =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    x,
  );
export function text(x, label, max = 10000, empty = true) {
  assert(
    typeof x === "string" && x.length <= max && (empty || x.trim()),
    `Please provide ${label}${max < 1000 ? ` (up to ${max} characters)` : ""}.`,
  );
  return x.trim();
}
export function number(x, min, max, label) {
  assert(
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max,
    `${label} must be between ${min} and ${max}.`,
  );
  return x;
}
export function bool(x, fallback = false) {
  assert(
    x === undefined || typeof x === "boolean",
    "Expected a checkbox value.",
  );
  return x ?? fallback;
}
export function xp(value, negative = true) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Provide XP for each affected pillar.",
  );
  assert(
    Object.keys(value).every((k) => AREAS.includes(k)),
    "Unknown XP pillar.",
  );
  return Object.fromEntries(
    AREAS.map((a) => [
      a,
      number(value[a] ?? 0, negative ? -10000 : 0, 10000, `${a} XP`),
    ]),
  );
}
export function frequency(f) {
  if (f == null) return null;
  assert(
    f && ["interval", "weekly"].includes(f.kind),
    "Choose an activity frequency.",
  );
  const days = number(
    f.days ?? (f.kind === "weekly" ? 7 : undefined),
    1,
    3660,
    "Frequency days",
  );
  assert(Number.isInteger(days), "Use whole days.");
  if (f.kind === "interval") return { kind: f.kind, days };
  const count = number(f.count, 1, days, "Days per period");
  assert(Number.isInteger(count), "Use a whole number of days.");
  return { kind: f.kind, days, count };
}
export function dailyBonus(value, unit) {
  if (value == null) return null;
  assert(
    unit !== "completion",
    "A daily first-hour bonus needs hours or minutes.",
  );
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "Provide a daily XP bonus.",
  );
  return {
    minutes: number(value.minutes, 1, 1440, "Daily bonus minutes"),
    perHour: xp(value.perHour, false),
  };
}
export function activity(a, existing, now) {
  assert(a && typeof a === "object", "Provide an activity.");
  const unit = a.unit ?? existing?.unit;
  assert(
    ["minute", "hour", "completion"].includes(unit),
    "Choose minutes, hours, or completions.",
  );
  const merged = { ...existing, ...a };
  return {
    id: existing?.id ?? a.id,
    name: text(merged.name, "an activity name", 120, false),
    description: text(merged.description ?? "", "a description", 2000),
    xp: xp(existing && a.xp ? { ...existing.xp, ...a.xp } : merged.xp),
    daily_bonus: dailyBonus(merged.daily_bonus, unit),
    unit,
    unit_size: number(merged.unit_size ?? 1, 0.01, 10000, "XP unit size"),
    default_quantity: number(
      merged.default_quantity,
      0.01,
      10000,
      "Default amount",
    ),
    preferred_frequency: frequency(merged.preferred_frequency),
    note: text(merged.note ?? "", "a note", 10000),
    sop: text(merged.sop ?? "", "an SOP", 10000),
    must_do: bool(merged.must_do),
    tracks_work: bool(merged.tracks_work),
    archived: existing?.archived ?? false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}
export function day(value, today, future = false) {
  assert(
    validDay(value) && value >= "2000-01-01" && (future || value <= today),
    "Choose a valid activity day, today or earlier.",
  );
  return value;
}
export function journal(value, today) {
  assert(value && typeof value === "object", "Provide a journal entry.");
  const supplied = value.scores ?? {};
  assert(
    typeof supplied === "object" && !Array.isArray(supplied),
    "Provide journal scores as named ratings.",
  );
  const scores = {};
  for (const [key, rating] of Object.entries(supplied)) {
    assert(
      ["day", "mood", "energy", "focus", "sleep"].includes(key),
      "Unknown score.",
    );
    if (rating !== null) scores[key] = number(rating, 0, 10, `${key} score`);
  }
  const period = value.period ?? "day";
  assert(
    ["day", "morning", "evening", "moment"].includes(period),
    "Choose when this score applies.",
  );
  return {
    text: text(value.text, "a journal entry", 20000, false),
    scores,
    period,
    day: day(value.day ?? today, today),
  };
}
export function settings(value) {
  assert(value && typeof value === "object", "Provide settings.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
  } catch {
    throw new UserError("Choose a valid time zone, such as Europe/London.");
  }
  assert(typeof value.timezone === "string", "Choose a time zone.");
  const cutoff = number(value.cutoff, 0, 23, "Day start hour");
  assert(Number.isInteger(cutoff), "Choose a whole hour.");
  const targets = Object.fromEntries(
    AREAS.map((a) => [
      a,
      Object.fromEntries(
        ["today", "seven", "thirty"].map((p) => [
          p,
          number(value.targets?.[a]?.[p], 1, 1000000, `${a} ${p} target`),
        ]),
      ),
    ]),
  );
  const r = value.workPenalty;
  assert(r && typeof r === "object", "Provide a work limit.");
  const perHour = xp(r.perHour);
  assert(
    AREAS.every((a) => perHour[a] <= 0),
    "Work penalties should be zero or negative.",
  );
  return {
    timezone: value.timezone,
    cutoff,
    targets,
    workPenalty: {
      enabled: bool(r.enabled),
      afterMinutes: number(r.afterMinutes, 0, 1440, "Work limit in minutes"),
      perHour,
    },
  };
}
