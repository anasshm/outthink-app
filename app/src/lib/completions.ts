import {
  summary,
  suggestions,
  pendingActivities,
  xpFor,
  rewardRule,
  repriceLogs,
  minutesFor,
  quantityLabel,
} from "../../shared/domain.mjs";
import type { Action, Activity, State } from "./types";
import type { Point } from "../ui/progress-utils";

type Request = Record<string, any>;
type Completion = {
  key: string;
  request: Request;
  point?: Point;
  preview: boolean;
  at: Date;
};
type Callbacks = {
  request: (body?: Request) => Promise<any>;
  changed: (
    view: State,
    keys: string[],
    retries: number,
    server: State,
    activityIds: string[],
  ) => void;
  busy: (active: boolean) => void;
  reward: (before: State, after: State, point?: Point) => void;
  rollback: () => void;
  error: (error: any) => void;
  saved: (
    reply: string,
    remainingFailures: number,
    reminders?: { activity_id: string; name: string }[],
  ) => void;
};

// Only explicit completion checkboxes use this projection. AI proposals and
// catalogue edits still require their existing review and server validation.
function project(server: State, entries: Completion[]): State {
  const next = structuredClone(server);
  for (const entry of entries) {
    if (!entry.preview) continue;
    const { request } = entry;
    const proposal =
      request.type === "proposal"
        ? next.proposals.find(
            (p) => p.id === request.id && p.status === "pending",
          )
        : undefined;
    const actions: Action[] = proposal?.actions || request.actions || [];
    if (
      request.type === "proposal" &&
      (!proposal || actions.length !== 1 || !actions[0].pending_log)
    )
      continue;
    for (const action of actions) {
      if (action.type === "set_log_status") {
        const log = next.logs.find((l) => l.id === action.data.id);
        if (log) log.done = action.data.done;
      } else if (action.type === "log_activity") {
        const a = proposal
          ? (action.base as { activity: Activity } | undefined)?.activity
          : next.activities.find((a) => a.id === action.data.activity_id);
        if (!a || a.archived) continue;
        const quantity = action.data.quantity ?? a.default_quantity;
        const day = action.data.day ?? server.day;
        const id = `optimistic-${request.requestId}`;
        next.logs.push({
          id,
          activity_id: a.id,
          day,
          quantity,
          xp: xpFor(a, quantity),
          reward_rule: rewardRule(a),
          work_minutes: a.tracks_work ? minutesFor(a, quantity) : 0,
          penalty_rule:
            next.logs.find((l) => l.day === day)?.penalty_rule ??
            next.settings.workPenalty,
          label: quantityLabel(a, quantity),
          done: true,
          created_at: entry.at.toISOString(),
        });
        if (proposal) {
          proposal.status = "accepted";
          action.pending_log = {
            ...action.pending_log!,
            log_id: id,
            confirmed_at: entry.at.toISOString(),
          };
        }
      }
    }
  }
  // Calculate every affected pillar, rolling period, penalty and streak using
  // the same domain functions as the server. Never just add a displayed XP chip.
  next.logs = repriceLogs(next.logs);
  const result = { ...next, ...summary(next) };
  return {
    ...result,
    suggestions: suggestions(result, result.day),
    pendingActivities: pendingActivities(result, result.day),
  };
}

export class CompletionQueue {
  server: State | null = null;
  view: State | null = null;
  active = false;
  private queue: Completion[] = [];
  private failures = new Map<string, Completion>();
  private errors = new Set<string>();
  private callbacks: Callbacks;
  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
  }

  replace(server: State, fromSave = false) {
    // A concurrent GET may already contain an in-flight write. Only its save
    // response can remove that preview without accidentally counting it twice.
    if (this.active && !fromSave) return;
    // A background refresh started before a save must not rewind its result.
    if (this.server && server.revision < this.server.revision) return;
    this.server = server;
    this.publish();
  }

  private publish() {
    if (!this.server) return;
    this.view = this.queue.length
      ? project(this.server, this.queue)
      : this.server;
    this.callbacks.changed(
      this.view,
      this.queue.map((e) => e.key),
      this.failures.size,
      this.server,
      this.server.activities
        .filter((a) => this.isSavingActivity(a.id))
        .map((a) => a.id),
    );
  }

  enqueue(key: string, request: Request, point?: Point) {
    if (!this.server || this.queue.some((e) => e.key === key)) return;
    const before = this.view!;
    // A tap on a restored row reuses the failed request ID too. The server may
    // have committed even if its response was lost; a new ID could double XP.
    const failed = this.failures.get(key);
    this.failures.delete(key);
    this.errors.delete(key);
    const entry = failed ?? {
      key,
      request: { ...request, requestId: crypto.randomUUID() },
      point,
      at: new Date(),
      preview: true,
    };
    this.queue.push(entry);
    this.publish();
    if (entry.preview) this.callbacks.reward(before, this.view!, point);
    void this.drain();
  }

  retry() {
    for (const [key, entry] of this.failures) {
      this.failures.delete(key);
      this.errors.delete(key);
      this.queue.push(entry);
    }
    this.publish();
    void this.drain();
  }

  isSavingActivity(id: string) {
    return this.queue.some((entry) => {
      const actions =
        entry.request.actions ??
        this.server?.proposals.find((p) => p.id === entry.request.id)
          ?.actions ??
        [];
      return actions.some(
        (a: Action) =>
          a.data.activity_id === id ||
          (a.type === "set_log_status" &&
            this.server?.logs.find((l) => l.id === a.data.id)?.activity_id ===
              id),
      );
    });
  }

  private async drain() {
    if (this.active || !this.queue.length) return;
    this.active = true;
    this.callbacks.busy(true);
    try {
      while (this.queue.length) {
        const entry = this.queue[0];
        // Assign the latest confirmed revision at send time, including retry.
        // Keep the original ID and actions: the server checks its receipt before
        // the revision, so a lost response still cannot create a second log.
        if (entry.request.type === "command")
          entry.request.revision = this.server!.revision;
        try {
          const result = await this.callbacks.request(entry.request);
          if (!result.state)
            throw Error("OutThink couldn’t verify this save. Please retry.");
          this.queue.shift();
          this.replace(result.state, true);
          // The tap already triggered its reward; acknowledging it adds no XP
          // and plays no second celebration. Other queued previews stay visible.
          this.callbacks.saved(
            this.queue.length ? "Saving…" : result.reply || "Saved.",
            this.errors.size,
            result.sopReminders || [],
          );
        } catch (error: any) {
          this.queue.shift();
          this.errors.add(entry.key);
          // Unknown outcomes and 5xx errors must retry the identical request.
          // Don't preview retries: a recovery GET may already contain the log.
          if (!error.status || error.status >= 500 || error.status === 429) {
            this.failures.set(entry.key, { ...entry, preview: false });
          }
          this.callbacks.rollback();
          this.publish();
          this.callbacks.error(error);
          try {
            this.replace(await this.callbacks.request(), true);
          } catch {
            // Can't safely rebase the rest while disconnected. Restore these
            // unsent rows too and let Retry save resume the same queue.
            for (const queued of this.queue)
              this.failures.set(queued.key, { ...queued, preview: false });
            this.queue = [];
            this.publish();
          }
          if (error.locked) break;
        }
      }
    } finally {
      this.active = false;
      this.callbacks.busy(false);
    }
  }
}

export function completionRequest(activity: Activity, state: State): Request {
  const done = state.logs
    .filter(
      (l) => l.done && l.day === state.day && l.activity_id === activity.id,
    )
    .at(-1);
  return {
    type: "command",
    actions: done
      ? [{ type: "set_log_status", data: { id: done.id, done: false } }]
      : [
          {
            type: "log_activity",
            data: { activity_id: activity.id, day: state.day },
          },
        ],
  };
}
