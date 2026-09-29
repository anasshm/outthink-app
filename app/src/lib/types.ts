export type Area = "mental" | "physical" | "work" | "social";
export type XP = Partial<Record<Area, number>>;
export type DailyBonus = { minutes: number; perHour: XP };
export type Frequency =
  | { kind: "interval"; days: number }
  | { kind: "weekly"; days: number; count: number }
  | null;
export type Activity = {
  id: string;
  name: string;
  description: string;
  xp: XP;
  daily_bonus?: DailyBonus | null;
  unit: "minute" | "hour" | "completion";
  unit_size: number;
  default_quantity: number;
  preferred_frequency: Frequency;
  note: string;
  sop?: string;
  must_do: boolean;
  tracks_work: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
export type Penalty = { enabled: boolean; afterMinutes: number; perHour: XP };
export type Settings = {
  timezone: string;
  cutoff: number;
  targets: Record<Area, { today: number; seven: number; thirty: number }>;
  workPenalty: Penalty;
};
export type Log = {
  id: string;
  activity_id?: string;
  day: string;
  label: string;
  quantity?: number;
  xp: XP;
  work_minutes?: number;
  done: boolean;
  penalty_rule?: Penalty;
  reward_rule?: {
    unit: Activity["unit"];
    unit_size: number;
    xp: XP;
    daily_bonus: DailyBonus | null;
  } | null;
  created_at?: string;
  derived?: boolean;
  sop_reminded_at?: string | null;
};
export type Goal = {
  id: string;
  title: string;
  note: string;
  areas: Area[];
  activity_ids: string[];
  until_day: string | null;
  active: boolean;
};
export type Message = {
  id: string;
  day: string;
  role: "user" | "assistant";
  text: string;
  mode: string;
  created_at: string;
  suggestions?: { activity_id: string; note: string }[];
};
export type Action = {
  type: string;
  data: Record<string, any>;
  base?: unknown;
  pending_log?: { batch_id: string; log_id?: string; confirmed_at?: string };
};
export type PendingActivity = {
  id: string;
  activity_id: string;
  day: string;
  title: string;
  xp: XP;
  complete: boolean;
  waiting: boolean;
  log_id?: string;
};
export type Proposal = {
  id: string;
  title: string;
  actions: Action[];
  status: string;
  created_at: string;
  preview?: { day: string; delta: XP }[];
};
export type Suggestion = Activity & {
  priorityArea?: Area;
  overdueDays?: number;
  nextDue?: string | null;
  daysSinceLast?: number | null;
  title: string;
  reward: XP;
  reason: string;
  complete: boolean;
};
export type Journal = {
  id: string;
  day: string;
  text: string;
  scores: Record<string, number>;
  period: string;
  created_at: string;
};
export type Totals = Record<
  Area,
  { today: number; seven: number; thirty: number }
>;
export type State = {
  revision: number;
  settings: Settings;
  activities: Activity[];
  logs: Log[];
  goals: Goal[];
  messages: Message[];
  proposals: Proposal[];
  pendingActivities: PendingActivity[];
  day: string;
  totals: Totals;
  xpBreakdown?: Record<
    Area,
    Record<
      "today" | "seven" | "thirty",
      { earned: number; deducted: number; net: number }
    >
  >;
  penalties: Log[];
  streak: { count: number; todayLogged: boolean };
  suggestions: Suggestion[];
  aiConfigured: boolean;
};
