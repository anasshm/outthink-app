import type { Area, XP, State } from "../lib/types";
export type Point = { x: number; y: number };
export type Totals = Record<Area, { today: number; seven: number }>;
export type PillarDefinition = {
  id: Area;
  name: string;
  color: "orange" | "green" | "blue" | "purple";
  daily: number;
  seven: number;
};
export const AREAS: PillarDefinition[] = [
  { id: "mental", name: "Mental", color: "orange", daily: 100, seven: 700 },
  { id: "physical", name: "Physical", color: "green", daily: 100, seven: 700 },
  { id: "work", name: "Work", color: "blue", daily: 100, seven: 700 },
  { id: "social", name: "Social", color: "purple", daily: 100, seven: 700 },
];
export type Variant = "rings";
export type Reward = {
  id: number;
  gains: XP;
  before: Totals;
  after: Totals;
  beforeBreakdown?: State["xpBreakdown"];
  afterBreakdown?: State["xpBreakdown"];
  point: Point;
  variant: Variant;
  showMiniRings: boolean;
  milestones: { area: Area; period: "today" | "seven" }[];
};
export type Streak = { count: number; todayLogged: boolean };
export type StreakMoment = {
  id: number;
  from: number;
  to: number;
  milestone: boolean;
  offscreen: boolean;
};
export type Activity = { id: string; title: string; detail?: string; xp: XP };
export const pct = (v: number, target: number) =>
  Math.round((v / target) * 100);
export const clamp = (v: number) => Math.max(0, Math.min(100, v));
export function returnToRings(variant: Variant) {
  document.querySelector(`[data-progress="${variant}"]`)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });
}

export function haptic(milestone = false) {
  // Android supports custom vibration patterns. iPhone taps use the native
  // switch control below; delayed/programmatic rewards cannot use that path.
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    )
      navigator.vibrate(milestone ? [18, 45, 30] : 12);
  } catch {
    /* Feedback must never block logging. */
  }
}

export function enableNativeTapHaptic(input: HTMLInputElement | null) {
  // WebKit on iOS 18+ provides a native tap when a switch is toggled.
  // Attach it to the real task input so one user tap still means one change.
  // The custom checkmark and explicit checkbox role preserve its task UI.
  if (input && "switch" in input && typeof navigator.vibrate !== "function")
    input.setAttribute("switch", "");
}

// Costs share the track with net progress. Above one lap, scale both together
// so the cost remains visible; exact XP is always shown in the breakdown.
export function ringSegments(net: number, deducted: number) {
  const positive = Math.max(0, net),
    cost = Math.max(0, deducted);
  const scale = Math.max(100, positive + cost);
  return { net: (positive / scale) * 100, deducted: (cost / scale) * 100 };
}
