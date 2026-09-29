import type {
  Activity,
  Log,
  PendingActivity,
  State,
  Suggestion,
  XP,
} from "../src/lib/types";

export function xpFor(
  activity: Activity,
  quantity?: number,
  minutesBefore?: number,
): XP;
export function rewardRule(activity: Activity): NonNullable<Log["reward_rule"]>;
export function repriceLogs(logs: Log[]): Log[];
export function nextReward(
  activity: Activity,
  quantity: number,
  logs: Log[],
  day: string,
): XP;
export function minutesFor(activity: Activity, quantity: number): number;
export function quantityLabel(activity: Activity, quantity: number): string;
export function summary(
  state: Pick<State, "settings" | "logs" | "messages">,
  now?: Date,
): Pick<State, "day" | "totals" | "streak" | "penalties">;
export function suggestions(
  state: Pick<State, "settings" | "logs" | "activities" | "goals"> &
    Partial<Pick<State, "proposals">>,
  day: string,
): Suggestion[];
export function pendingActivities(
  state: Pick<State, "settings" | "logs" | "proposals">,
  day?: string,
): PendingActivity[];
