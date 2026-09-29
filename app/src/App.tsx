import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useHostTheme, useAppearance } from "./ui/theme";
import {
  Pillar,
  StreakBadge,
  TaskRow,
  RewardFeedback,
  Icon,
} from "./ui/Progress";
import {
  AREAS,
  ringSegments,
  haptic,
  enableNativeTapHaptic,
  type Reward,
  type StreakMoment,
  type Point,
} from "./ui/progress-utils";
import {
  ActivityEditor,
  LogEditor,
  GoalEditor,
  SettingsEditor,
  JournalEditor,
  ProposalCard,
  XPLine,
} from "./ui/Editors";
import Modal from "./ui/Modal";
import ChatPanel from "./ui/ChatPanel";
import PendingActivities from "./ui/PendingActivities";
import { useCompletionList } from "./ui/useCompletionList";
import { nextReward, quantityLabel } from "../shared/domain.mjs";
import { FeedbackContext } from "./ui/FeedbackContext";
import { CompletionQueue, completionRequest } from "./lib/completions";
import { createPortal } from "react-dom";
import type {
  State,
  Activity,
  Area,
  Goal,
  Journal,
  Action,
  Log,
  Message,
  PendingActivity,
} from "./lib/types";
import "./ui/progress.css";
import "./ui/app.css";
const suggestionDone = (item: State["suggestions"][number]) => item.complete;
// Keep the card's title, XP and explanation stable while it fades away.
const retainSuggestion = (
  incoming: State["suggestions"][number],
  previous: State["suggestions"][number],
) => ({ ...previous, complete: incoming.complete });

type DashboardTask = State["suggestions"][number] & {
  pending?: PendingActivity;
};

type OutgoingMessage = {
  message: Message;
  request: Record<string, unknown>;
  status: "sending" | "failed";
};
const dayBefore = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
async function api(body?: Record<string, unknown>, timeout?: number) {
  const response = await fetch("/api/outthink", {
    credentials: "same-origin",
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("OutThink couldn’t connect. Please try again.");
  }
  if (!response.ok)
    throw Object.assign(Error(data.error || "Please try again."), {
      status: response.status,
      locked: data.locked,
    });
  return data;
}
export default function App() {
  const theme = useHostTheme();
  const { mode, setMode } = useAppearance();
  const [state, setState] = useState<State | null>(null),
    [locked, setLocked] = useState(false),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [chatSaved, setChatSaved] = useState(false);
  const [sopReminders, setSopReminders] = useState<
    { activity_id: string; name: string }[]
  >([]);
  const [sopActivityId, setSopActivityId] = useState<string | null>(null);
  const addSopReminders = (
    items: { activity_id: string; name: string }[] = [],
  ) => {
    if (items.length)
      setSopReminders((previous) => [
        ...previous,
        ...items.filter(
          (item) => !previous.some((p) => p.activity_id === item.activity_id),
        ),
      ]);
  };
  const [handoffIds, setHandoffIds] = useState<string[]>([]);
  const [arrivingIds, setArrivingIds] = useState<string[]>([]);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [completionKeys, setCompletionKeys] = useState<string[]>([]);
  const [savingActivityIds, setSavingActivityIds] = useState<string[]>([]);
  const [completionRetries, setCompletionRetries] = useState(0);
  const [completionError, setCompletionError] = useState("");
  const pendingRegion = useRef<HTMLDivElement>(null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [panel, setPanel] = useState<
      | "activities"
      | "goals"
      | "settings"
      | "journal"
      | "reflection"
      | "chat"
      | null
    >(null),
    [selected, setSelected] = useState<Area | null>(null),
    [period, setPeriod] = useState<"today" | "seven" | "thirty">("today");
  const [editActivity, setEditActivity] = useState<Activity | "new" | null>(
      null,
    ),
    [logActivity, setLogActivity] = useState<Activity | null>(null),
    [editGoal, setEditGoal] = useState<Goal | "new" | null>(null),
    [journalEditor, setJournalEditor] = useState(false),
    [archive, setArchive] = useState<Activity | null>(null);
  const [search, setSearch] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [draft, setDraft] = useState(""),
    [journal, setJournal] = useState<Journal[]>([]),
    [journalLoaded, setJournalLoaded] = useState(false);
  const [range, setRange] = useState({ from: "", to: "" }),
    [reward, setReward] = useState<Reward | null>(null),
    [streakMoment, setStreakMoment] = useState<StreakMoment | null>(null);
  const [retry, setRetry] = useState<{
    body: Record<string, unknown>;
    point?: Point;
    taskId?: string;
  } | null>(null);
  const current = useRef<State | null>(null),
    saving = useRef(false),
    interactionOpen = useRef(false),
    chatEnd = useRef<HTMLDivElement>(null),
    chatInput = useRef<HTMLTextAreaElement>(null);
  const [completions] = useState(
    () =>
      new CompletionQueue({
        request: (body) => api(body, 20000),
        changed: (view, keys, retries, server, activityIds) => {
          current.current = server;
          setSavingActivityIds(activityIds);
          setState(view);
          setCompletionKeys(keys);
          setCompletionRetries(retries);
        },
        busy: (active) => {
          saving.current = active;
          setBusy(active);
          if (active) setNotice("Saving…");
        },
        reward: celebrate,
        rollback: () => {
          setReward(null);
          setStreakMoment(null);
        },
        error: (e) => {
          setNotice("");
          setCompletionError(
            e.locked
              ? e.message
              : `${e.message} The unsaved change was rolled back.`,
          );
          if (e.locked) setLocked(true);
        },
        saved: (reply, failures, reminders) => {
          addSopReminders(reminders);
          setNotice(reply);
          if (!failures) setCompletionError("");
        },
      }),
  );
  useEffect(() => {
    interactionOpen.current = !!(
      panel ||
      selected ||
      editActivity ||
      logActivity ||
      editGoal ||
      journalEditor ||
      sopActivityId ||
      archive
    );
  }, [
    panel,
    selected,
    editActivity,
    logActivity,
    editGoal,
    journalEditor,
    sopActivityId,
    archive,
  ]);
  const update = useCallback(
    (s: State) => {
      completions.replace(s);
      setLocked(false);
    },
    [completions],
  );
  const refresh = useCallback(async () => {
    try {
      update(await api());
      setError("");
    } catch (e) {
      if ((e as any).locked) {
        setLocked(true);
        current.current = null;
        completions.server = null;
        setState(null);
      } else setError((e as Error).message);
    }
  }, [update, completions]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const focus = () => {
      if (
        !saving.current &&
        !interactionOpen.current &&
        document.visibilityState === "visible"
      )
        void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = setInterval(focus, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!reward) return;
    const timer = setTimeout(() => setReward(null), 4500);
    return () => clearTimeout(timer);
  }, [reward]);
  useEffect(() => {
    if (!streakMoment) return;
    const timer = setTimeout(() => setStreakMoment(null), 2600);
    return () => clearTimeout(timer);
  }, [streakMoment]);
  useEffect(() => {
    const log = chatEnd.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [state?.messages.length, panel, outgoing]);
  useEffect(() => {
    const input = chatInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(44, Math.min(96, input.scrollHeight))}px`;
  }, [draft, panel]);
  useEffect(() => {
    if (!chatSaved) return;
    const timer = setTimeout(() => setChatSaved(false), 3500);
    return () => clearTimeout(timer);
  }, [chatSaved]);
  useEffect(() => {
    if (!handoffIds.length) return;
    // A new draft, an unanswered question, or navigation should never be stolen.
    if (panel !== "chat" || draft.trim()) {
      const cancel = setTimeout(() => setHandoffIds([]), 0);
      return () => clearTimeout(cancel);
    }
    chatInput.current?.blur();
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(
      () => {
        setPanel(null);
        setArrivingIds(handoffIds);
        setHandoffIds([]);
      },
      reduced ? 0 : 460,
    );
    return () => clearTimeout(timer);
  }, [handoffIds, panel, draft]);
  useEffect(() => {
    if (!arrivingIds.length) return;
    const region = pendingRegion.current;
    const row = region?.querySelector(`[data-pending-id="${arrivingIds[0]}"]`);
    const heading = row
      ?.closest("section")
      ?.querySelector<HTMLElement>("[data-pending-heading]");
    heading?.focus({ preventScroll: true });
    const section = row?.closest("section");
    const bounds = section?.getBoundingClientRect();
    if (bounds && (bounds.top < 12 || bounds.bottom > window.innerHeight - 90))
      section?.scrollIntoView({
        block: bounds.height < window.innerHeight - 160 ? "center" : "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    const timer = setTimeout(() => setArrivingIds([]), 900);
    return () => clearTimeout(timer);
  }, [arrivingIds]);
  function celebrate(before: State, next: State, point?: Point) {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (next.streak.count > before.streak.count && !reduced)
      setStreakMoment({
        // oxlint-disable-next-line react/purity -- Runs only on a user action.
        id: Date.now(),
        from: before.streak.count,
        to: next.streak.count,
        milestone: [7, 30, 60, 100, 365].includes(next.streak.count),
        offscreen: false,
      });
    const gains = Object.fromEntries(
      AREAS.map((a) => [
        a.id,
        Math.round(
          (next.totals[a.id].today - before.totals[a.id].today) * 100,
        ) / 100,
      ]),
    );
    if (!Object.values(gains).some((n) => n > 0)) {
      setReward(null);
      return;
    }
    haptic();
    if (reduced) return;
    const milestones: Reward["milestones"] = [];
    for (const a of AREAS)
      if (a.id !== "work")
        for (const p of ["today", "seven"] as const)
          if (
            before.totals[a.id][p] < next.settings.targets[a.id][p] &&
            next.totals[a.id][p] >= next.settings.targets[a.id][p]
          )
            milestones.push({ area: a.id, period: p });
    const r = document
      .querySelector('[data-progress="rings"]')
      ?.getBoundingClientRect();
    const chatTop = document
      .querySelector(".ot-chat-panel")
      ?.getBoundingClientRect().top;
    setReward({
      // oxlint-disable-next-line react/purity -- Runs only on a user action.
      id: Date.now(),
      gains,
      before: before.totals,
      after: next.totals,
      beforeBreakdown: before.xpBreakdown,
      afterBreakdown: next.xpBreakdown,
      point: point || {
        x: window.innerWidth / 2,
        y: Math.min(
          window.innerHeight - 140,
          chatTop ? Math.max(80, chatTop - 125) : 380,
        ),
      },
      variant: "rings",
      showMiniRings:
        !!document.querySelector("dialog[open]") ||
        !r ||
        r.bottom < 70 ||
        r.top > window.innerHeight ||
        (chatTop !== undefined && r.bottom > chatTop),
      milestones,
    });
  }
  async function send(
    body: Record<string, unknown>,
    point?: Point,
    taskId?: string,
  ): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setSavingTaskId(taskId ?? null);
    setChatSaved(false);
    setError("");
    const prepared = {
        ...body,
        requestId: body.requestId || crypto.randomUUID(),
      },
      before = current.current;
    const isChat = body.type === "chat" || body.type === "reflect";
    if (isChat && before) {
      setOutgoing((messages) => {
        const existing = messages.find(
          (m) => m.message.id === prepared.requestId,
        );
        const message: Message = existing?.message || {
          id: String(prepared.requestId),
          text: String(body.text),
          role: "user",
          day: before.day,
          mode: body.type === "reflect" ? "reflection" : "routine",
          created_at: new Date().toISOString(),
        };
        return [
          ...messages.filter((m) => m.message.id !== message.id),
          {
            message,
            request: prepared,
            status: "sending",
          },
        ];
      });
    }
    try {
      const result = await api(prepared);
      addSopReminders(result.sopReminders);
      if (result.state) {
        update(result.state);
        if (before) celebrate(before, result.state, point);
      }
      setNotice(result.reply || "Saved.");
      if (body.type === "proposal" && body.accept) setChatSaved(true);
      const readyIds = (result.pendingActivityIds || []).filter((id: string) =>
        result.state?.pendingActivities?.some(
          (item: PendingActivity) => item.id === id && item.waiting,
        ),
      );
      if (
        body.type === "chat" &&
        result.handoff &&
        !result.aiError &&
        readyIds.length
      )
        setHandoffIds(readyIds);
      if (isChat)
        setOutgoing((messages) =>
          messages.filter((m) => m.message.id !== prepared.requestId),
        );
      setRetry(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (isChat)
        setOutgoing((messages) =>
          messages.map((m) =>
            m.message.id === prepared.requestId
              ? { ...m, status: "failed" }
              : m,
          ),
        );
      if ((e as any).locked) setLocked(true);
      if (!(e as any).status && !isChat)
        setRetry({ body: prepared, point, taskId });
      else {
        setRetry(null);
        if (
          (e as any).status === 409 ||
          String((e as Error).message).includes("another device")
        ) {
          try {
            update(await api());
          } catch {
            /* retain error */
          }
        }
      }
      return false;
    } finally {
      setBusy(false);
      setSavingTaskId(null);
      saving.current = false;
    }
  }
  const save = (actions: Action[]) =>
    send({ type: "command", revision: current.current?.revision, actions });
  async function submitChat() {
    if (!draft.trim() || saving.current) return;
    const text = draft;
    setDraft("");
    await send({ type: "chat", text });
  }
  function toggleTask(activity: Activity, point: Point) {
    if (
      !current.current ||
      (saving.current && !completions.active) ||
      completions.isSavingActivity(activity.id)
    )
      return;
    setError("");
    completions.enqueue(
      activity.id,
      completionRequest(activity, current.current),
      point,
    );
  }
  const toggleLog = (log: Log) => {
    if (
      (saving.current && !completions.active) ||
      log.id.startsWith("optimistic-") ||
      completions.isSavingActivity(log.activity_id || "")
    )
      return;
    completions.enqueue(log.id, {
      type: "command",
      actions: [
        { type: "set_log_status", data: { id: log.id, done: !log.done } },
      ],
    });
  };
  function togglePending(item: PendingActivity, point: Point) {
    if (saving.current && !completions.active) return;
    setError("");
    completions.enqueue(
      item.id,
      item.log_id
        ? {
            type: "command",
            actions: [
              {
                type: "set_log_status",
                data: { id: item.log_id, done: !item.complete },
              },
            ],
          }
        : { type: "proposal", id: item.id, accept: true },
      point,
    );
  }
  const variables = {
    "--pp-bg": theme.bg.editor,
    "--pp-chrome": theme.bg.chrome,
    "--pp-text": theme.text.primary,
    "--pp-secondary": theme.text.secondary,
    "--pp-muted": theme.text.tertiary,
    "--pp-fill": theme.fill.tertiary,
    "--pp-fill-strong": theme.fill.primary,
    "--pp-stroke": theme.stroke.secondary,
    "--pp-focus": theme.stroke.focused,
    "--pp-accent": theme.accent.primary,
    "--pp-on-accent": theme.text.onAccent,
    "--pp-flame": "#ed8b23",
  } as CSSProperties;
  const areas = AREAS.map((a) => ({
    ...a,
    daily: state?.settings.targets[a.id].today || 100,
    seven: state?.settings.targets[a.id].seven || 700,
  }));
  const pending =
      state?.proposals.filter(
        (p) => p.status === "pending" && !p.actions[0]?.pending_log,
      ) || [],
    selectedDef = areas.find((a) => a.id === selected);
  const historySegments =
    state && selectedDef
      ? ringSegments(
          (state.totals[selectedDef.id][period] /
            state.settings.targets[selectedDef.id][period]) *
            100,
          ((state.xpBreakdown?.[selectedDef.id][period].deducted || 0) /
            state.settings.targets[selectedDef.id][period]) *
            100,
        )
      : { net: 0, deducted: 0 };
  const pendingActivities = state?.pendingActivities || [];
  const waitingActivities = pendingActivities.filter((p) => p.waiting);
  const chatMessages = [
    ...(state?.messages || []),
    ...outgoing
      .filter(
        (m) => !state?.messages.some((saved) => saved.id === m.message.id),
      )
      .map((m) => m.message),
  ].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const thinking = outgoing.some((m) => m.status === "sending");
  const historyRows = state
    ? [...state.logs, ...state.penalties]
        .filter(
          (l) =>
            selected &&
            l.done &&
            l.xp[selected] &&
            l.day <= state.day &&
            l.day >=
              dayBefore(
                state.day,
                period === "today" ? 0 : period === "seven" ? 6 : 29,
              ),
        )
        .sort(
          (a, b) =>
            b.day.localeCompare(a.day) ||
            (b.created_at || "").localeCompare(a.created_at || ""),
        )
    : [];
  const task = (a: DashboardTask, explain = false) => {
    const saveKey = a.pending?.id ?? a.id;
    return (
      <div
        key={a.id}
        className={`ot-completion-row ot-suggestion-row${a.complete ? " is-leaving" : ""}`}
      >
        <TaskRow
          task={{ id: a.id, title: a.title, xp: a.reward }}
          complete={a.complete}
          saving={savingTaskId === saveKey || completionKeys.includes(saveKey)}
          optimistic={completionKeys.includes(saveKey) && a.complete}
          disabled={
            a.complete ||
            (busy && !completionKeys.length) ||
            savingActivityIds.includes(a.id)
          }
          onToggle={(p) =>
            a.pending ? togglePending(a.pending, p) : toggleTask(a, p)
          }
        />
        {explain && a.reason && (
          <div className="pp-why">
            <span className="pp-why-title">
              <Icon kind="spark" size={14} />
              Why this today
            </span>
            <p>{a.reason}</p>
          </div>
        )}
      </div>
    );
  };
  const visibleSuggestions = useMemo(() => {
    if (!state) return [];
    const suggestedIds = new Set(state.suggestions.map((a) => a.id));
    const doneIds = new Set(
      state.logs
        .filter((l) => l.done && l.day === state.day)
        .map((l) => l.activity_id),
    );
    // The server's ranked suggestions may drop a just-completed item immediately.
    // Keep its completion available to the exit animation; the shared list hides
    // any already-completed rows that weren't on screen when checked.
    const completedRows = state.activities
      .filter(
        (a) => !a.archived && !suggestedIds.has(a.id) && doneIds.has(a.id),
      )
      .map((a) => ({
        ...a,
        complete: true,
        title: quantityLabel(a, a.default_quantity),
        reward: nextReward(a, a.default_quantity, state.logs, state.day),
        reason: a.note,
      }));
    return [...state.suggestions, ...completedRows].filter(
      (a) =>
        !state.pendingActivities.some(
          (p) => p.day === state.day && p.activity_id === a.id,
        ),
    );
  }, [state]);
  const displayedSuggestions = useCompletionList(
    visibleSuggestions,
    suggestionDone,
    state?.day || "",
    retainSuggestion,
  );
  const allActivityRows = useMemo<DashboardTask[]>(() => {
    if (!state) return [];
    const done = new Set(
      state.logs
        .filter((l) => l.done && l.day === state.day)
        .map((l) => l.activity_id),
    );
    return state.activities
      .filter((a) => !a.archived)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => {
        const pending = state.pendingActivities.find(
          (p) => p.activity_id === a.id && p.day === state.day && p.waiting,
        );
        return {
          ...a,
          pending,
          title: pending?.title ?? quantityLabel(a, a.default_quantity),
          reward:
            pending?.xp ??
            nextReward(a, a.default_quantity, state.logs, state.day),
          reason: a.note,
          complete: done.has(a.id),
        };
      });
  }, [state]);
  const displayedActivities = useCompletionList(
    allActivityRows,
    suggestionDone,
    state?.day || "",
    retainSuggestion,
  );
  const shownError = error || completionError;
  const retrySave = completionRetries
    ? () => completions.retry()
    : retry
      ? () => void send(retry.body, retry.point, retry.taskId)
      : null;
  return (
    <FeedbackContext.Provider
      value={{
        error: shownError,
        clear: () => {
          setError("");
          setCompletionError("");
        },
        retry: retrySave,
        busy,
      }}
    >
      <main
        className={`pp-root${panel === "chat" ? " ot-chat-is-open" : ""}`}
        style={variables}
      >
        {shownError && (
          <div className="ot-error" role="alert">
            <span>{shownError}</span>
            {retrySave ? (
              <button onClick={retrySave} disabled={busy}>
                Retry save
              </button>
            ) : (
              !locked && (
                <button onClick={() => void refresh()} disabled={busy}>
                  Refresh
                </button>
              )
            )}
            <button
              aria-label="Dismiss error"
              onClick={() => {
                setError("");
                setCompletionError("");
              }}
            >
              <Icon kind="close" size={16} />
            </button>
          </div>
        )}
        {locked ? (
          <div className="ot-unlock">
            <span className="pp-eyebrow">OUTTHINK</span>
            <h1>Track progress toward your goals.</h1>
            <p>Sign in to continue.</p>
            <form
              className="ot-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api({ type: "login", password });
                  setPassword("");
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="ot-primary" disabled={busy}>
                {busy ? "Opening…" : "Unlock OutThink"}
              </button>
            </form>
          </div>
        ) : !state ? (
          <div className="ot-unlock">
            <span className="pp-eyebrow">OUTTHINK</span>
            <p>Loading your progress…</p>
          </div>
        ) : (
          <div className="pp-comparison single">
            <div className="pp-preview">
              <div className="pp-dashboard-body">
                <div className="pp-greeting">
                  <div className="pp-greeting-copy">
                    <span className="pp-eyebrow">
                      OUTTHINK ·{" "}
                      {new Date(`${state.day}T12:00:00Z`).toLocaleDateString(
                        "en",
                        {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        },
                      )}
                    </span>
                    <h2>Your progress today.</h2>
                  </div>
                  <StreakBadge
                    streak={state.streak}
                    moment={streakMoment}
                    dayStartsAt={state.settings.cutoff}
                  />
                </div>
                <div className="pp-pillars" data-progress="rings">
                  {areas.map((a) => (
                    <Pillar
                      key={a.id}
                      area={a}
                      dayXP={state.totals[a.id].today}
                      sevenXP={state.totals[a.id].seven}
                      dayDeducted={state.xpBreakdown?.[a.id].today.deducted}
                      sevenDeducted={state.xpBreakdown?.[a.id].seven.deducted}
                      onSelect={() => {
                        setPeriod("today");
                        setSelected(a.id);
                      }}
                      closing={
                        !!reward?.milestones.some((m) => m.area === a.id)
                      }
                    />
                  ))}
                </div>
                {pending.length > 0 && (
                  <button
                    className="ot-pending-banner"
                    onClick={() => setPanel("chat")}
                  >
                    {pending.length === 1
                      ? "A change is"
                      : `${pending.length} changes are`}{" "}
                    waiting for your confirmation <span>Review →</span>
                  </button>
                )}
                <div className="pp-main-content">
                  {pendingActivities.length > 0 && (
                    <div className="ot-pending-region" ref={pendingRegion}>
                      <PendingActivities
                        items={pendingActivities}
                        today={state.day}
                        busy={busy}
                        optimisticIds={completionKeys}
                        arriving={arrivingIds}
                        savingId={savingTaskId}
                        onToggle={(item, point) =>
                          void togglePending(item, point)
                        }
                        onDismiss={(item) =>
                          void send({
                            type: "proposal",
                            id: item.id,
                            accept: false,
                          })
                        }
                      />
                    </div>
                  )}
                  <section className="pp-priorities">
                    <div className="pp-section-title">
                      <h3>
                        {displayedSuggestions.length
                          ? "Suggested for today"
                          : state.activities.some((a) => !a.archived)
                            ? "No suggestions right now"
                            : "Get started"}
                      </h3>
                    </div>
                    {displayedSuggestions[0] ? (
                      task(displayedSuggestions[0], true)
                    ) : (
                      <div className="ot-empty">
                        <p>
                          {state.activities.some((a) => !a.archived)
                            ? "Your current suggestions are done. You can log more from Activities at any time."
                            : "Add your first activities and their XP. Your progress will start from what you actually log."}
                        </p>
                        <button
                          className="ot-secondary"
                          onClick={() =>
                            state.activities.length
                              ? setPanel("activities")
                              : setEditActivity("new")
                          }
                        >
                          {state.activities.length
                            ? "Choose an activity"
                            : "Add an activity"}
                        </button>
                      </div>
                    )}
                  </section>
                  {displayedSuggestions.length > 1 && (
                    <section className="pp-other">
                      <div className="pp-section-title">
                        <h3>More suggestions</h3>
                      </div>
                      {displayedSuggestions.slice(1).map((a) => task(a))}
                    </section>
                  )}
                  <section
                    className="ot-all-activities"
                    aria-labelledby="all-activities-title"
                  >
                    <div className="pp-section-title">
                      <h3 id="all-activities-title">All activities</h3>
                    </div>
                    {displayedActivities.length ? (
                      displayedActivities.map((a) => task(a))
                    ) : (
                      <p className="ot-empty">
                        {allActivityRows.length
                          ? "Everything is checked off for today."
                          : "Your activities will appear here once you add them."}
                      </p>
                    )}
                  </section>
                </div>
                <div className="pp-notice" role="status" aria-live="polite">
                  <span>{notice && !panel ? notice.slice(0, 180) : ""}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {state && !locked && (
          <button
            className="ot-chat-fab"
            aria-label="Open chat"
            aria-controls="outthink-chat"
            aria-expanded={panel === "chat"}
            hidden={panel === "chat"}
            onClick={() => setPanel("chat")}
          >
            <Icon kind="plus" size={28} />
          </button>
        )}
        {state && !locked && !panel && !sopActivityId && sopReminders[0] && (
          <aside className="ot-sop-reminder" role="status">
            <p>Reminder: review your {sopReminders[0].name} SOP.</p>
            <div className="ot-actions">
              <button
                className="ot-text-button"
                onClick={() => {
                  setSopActivityId(sopReminders[0].activity_id);
                  setSopReminders((items) => items.slice(1));
                }}
              >
                View SOP
              </button>
              <button
                className="ot-text-button"
                aria-label="Dismiss SOP reminder"
                onClick={() => setSopReminders((items) => items.slice(1))}
              >
                Dismiss
              </button>
            </div>
          </aside>
        )}
        {state && sopActivityId && (
          <Modal
            title={`${state.activities.find((a) => a.id === sopActivityId)?.name || "Activity"} · SOP`}
            onClose={() => setSopActivityId(null)}
          >
            <p className="ot-sop-text">
              {state.activities.find((a) => a.id === sopActivityId)?.sop ||
                "No SOP added yet."}
            </p>
          </Modal>
        )}
        {state && selectedDef && (
          <Modal
            title={`${selectedDef.name} activity`}
            onClose={() => setSelected(null)}
          >
            <div className="pp-history-tabs">
              {(["today", "seven", "thirty"] as const).map((p) => (
                <button
                  key={p}
                  aria-pressed={period === p}
                  onClick={() => setPeriod(p)}
                >
                  {p === "today"
                    ? "Today"
                    : p === "seven"
                      ? "Last 7 days"
                      : "Last 30 days"}
                </button>
              ))}
            </div>
            {!!state.xpBreakdown?.[selectedDef.id][period].deducted && (
              <div className="ot-xp-breakdown" aria-label="XP breakdown">
                <span>
                  <b>{state.xpBreakdown[selectedDef.id][period].earned}</b>{" "}
                  earned
                </span>
                <span className="ot-negative">
                  <b>−{state.xpBreakdown[selectedDef.id][period].deducted}</b>{" "}
                  deducted
                </span>
                <span>
                  <b>{state.xpBreakdown[selectedDef.id][period].net}</b> net
                </span>
              </div>
            )}
            <div className="pp-history-summary">
              <strong>
                {state.totals[selectedDef.id][period]} /{" "}
                {state.settings.targets[selectedDef.id][period]} XP
              </strong>
              <span>
                {Math.round(
                  (state.totals[selectedDef.id][period] /
                    state.settings.targets[selectedDef.id][period]) *
                    100,
                )}
                %
              </span>
            </div>
            <div className="pp-bar-track ot-cost-bar">
              <div
                className="pp-bar-fill"
                style={{
                  width: `${historySegments.net}%`,
                  background: theme.category[selectedDef.color],
                }}
              />
              {historySegments.deducted > 0 && (
                <div
                  className="pp-bar-fill"
                  style={{
                    width: `${historySegments.deducted}%`,
                    background: "var(--ot-negative)",
                  }}
                />
              )}
            </div>
            <div className="pp-history-rows">
              {historyRows.length ? (
                historyRows.map((l) =>
                  l.derived ? (
                    <div key={l.id} className="ot-derived">
                      <small>{l.day}</small>
                      <p>{l.label}</p>
                      <XPLine xp={{ [selectedDef.id]: l.xp[selectedDef.id] }} />
                      <small>Updates when work sessions are changed.</small>
                    </div>
                  ) : (
                    <label className="pp-history-entry" key={l.id}>
                      <input
                        type="checkbox"
                        role="checkbox"
                        ref={enableNativeTapHaptic}
                        checked={l.done}
                        disabled={
                          (busy && !completionKeys.length) ||
                          l.id.startsWith("optimistic-") ||
                          savingActivityIds.includes(l.activity_id || "")
                        }
                        onChange={() => void toggleLog(l)}
                        aria-label={`Undo ${l.label}`}
                      />
                      <span className="pp-history-check" aria-hidden="true">
                        <Icon kind="check" size={14} />
                      </span>
                      <span className="pp-history-entry-text">
                        <small>{l.day === state.day ? "Today" : l.day}</small>
                        <span>{l.label}</span>
                      </span>
                      <b
                        className={
                          (l.xp[selectedDef.id] || 0) < 0
                            ? "ot-negative"
                            : undefined
                        }
                      >
                        {`${(l.xp[selectedDef.id] || 0) > 0 ? "+" : ""}${l.xp[selectedDef.id]}`}
                      </b>
                    </label>
                  ),
                )
              ) : (
                <p className="ot-empty">Nothing recorded here yet.</p>
              )}
            </div>
            <p className="ot-muted">
              Uncheck a completion to undo its XP across all pillars.
            </p>
          </Modal>
        )}
        {state && panel === "activities" && (
          <Modal title="Your activities" onClose={() => setPanel(null)}>
            <div className="ot-actions">
              <button
                className="ot-primary"
                onClick={() => setEditActivity("new")}
              >
                New activity
              </button>
              <button className="ot-secondary" onClick={() => setPanel("chat")}>
                Add through chat
              </button>
            </div>
            <input
              className="ot-search"
              aria-label="Search activities"
              placeholder="Find an activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="ot-catalogue">
              {state.activities
                .filter(
                  (a) =>
                    a.archived === showArchived &&
                    a.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((a) => (
                  <div className="ot-catalogue-row" key={a.id}>
                    <button
                      className="ot-row-main"
                      onClick={() => setEditActivity(a)}
                    >
                      <strong>
                        {a.name}
                        {a.must_do ? " · Must-do" : ""}
                      </strong>
                      <XPLine
                        xp={Object.fromEntries(
                          AREAS.map((p) => [
                            p.id,
                            ((a.xp[p.id] || 0) * a.default_quantity) /
                              (a.unit_size || 1),
                          ]),
                        )}
                      />
                      <small>
                        {a.default_quantity} {a.unit}
                        {a.default_quantity !== 1 ? "s" : ""}
                        {a.preferred_frequency
                          ? ` · ${a.preferred_frequency.kind === "interval" ? `every ${a.preferred_frequency.days} days` : `${a.preferred_frequency.count}/${a.preferred_frequency.days} days`}`
                          : ""}
                      </small>
                    </button>
                    {!a.archived && (
                      <button
                        className="ot-secondary"
                        onClick={() => setLogActivity(a)}
                      >
                        Log
                      </button>
                    )}
                    <button
                      className="ot-text-button"
                      onClick={() => setArchive(a)}
                    >
                      {a.archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                ))}
            </div>
            <button
              className="ot-text-button"
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived
                ? "Back to active activities"
                : "Archived activities"}
            </button>
          </Modal>
        )}
        {state && panel === "goals" && (
          <Modal title="Goals" onClose={() => setPanel(null)}>
            <button className="ot-primary" onClick={() => setEditGoal("new")}>
              Add a goal
            </button>
            <div className="ot-catalogue">
              {state.goals
                .filter((g) => g.active)
                .map((g) => (
                  <div className="ot-goal" key={g.id}>
                    <button
                      className="ot-row-main"
                      onClick={() => setEditGoal(g)}
                    >
                      <strong>{g.title}</strong>
                      <p>{g.note}</p>
                      {g.until_day && <small>Until {g.until_day}</small>}
                    </button>
                    <button
                      className="ot-text-button"
                      disabled={busy}
                      onClick={() =>
                        void save([
                          { type: "save_goal", data: { ...g, active: false } },
                        ])
                      }
                    >
                      Finish goal
                    </button>
                  </div>
                ))}
              {!state.goals.some((g) => g.active) && (
                <p className="ot-empty">
                  Add a goal to point your suggestions toward the pillars and
                  activities it covers.
                </p>
              )}
            </div>
          </Modal>
        )}
        {state && panel === "settings" && (
          <SettingsEditor
            settings={state.settings}
            busy={busy}
            onSave={save}
            onClose={() => setPanel(null)}
            onLogout={async () => {
              try {
                await api({ type: "logout" });
                setPanel(null);
                setState(null);
                current.current = null;
                setLocked(true);
                setJournal([]);
                setDraft("");
                setOutgoing([]);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        )}
        {state && (panel === "reflection" || panel === "journal") && (
          <Modal
            title={
              panel === "reflection" ? "Reflect on your days" : "Your journal"
            }
            onClose={() => setPanel(null)}
          >
            <p className="ot-muted">
              {panel === "reflection"
                ? "Only this request gives the AI access to entries, scores, and completed activities for the dates you choose."
                : "Your words and scores stay here. Daily suggestions use the activity notes you approve."}
            </p>
            {panel === "journal" && (
              <button
                className="ot-primary"
                onClick={() => setJournalEditor(true)}
              >
                Write a note
              </button>
            )}
            <form
              className="ot-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (panel === "reflection") {
                  if (
                    await send({
                      type: "reflect",
                      range,
                      text: `Analyze my days from ${range.from} through ${range.to}. What can we learn?`,
                    })
                  )
                    setPanel("chat");
                } else {
                  setBusy(true);
                  try {
                    const r = await api({ type: "journal_history", range });
                    setJournal(r.entries);
                    setJournalLoaded(true);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              <div className="ot-fields">
                <label>
                  From
                  <input
                    type="date"
                    required
                    max={range.to}
                    value={range.from}
                    onChange={(e) =>
                      setRange({ ...range, from: e.target.value })
                    }
                  />
                </label>
                <label>
                  Through
                  <input
                    type="date"
                    required
                    min={range.from}
                    max={state.day}
                    value={range.to}
                    onChange={(e) => setRange({ ...range, to: e.target.value })}
                  />
                </label>
              </div>
              <button className="ot-secondary" disabled={busy}>
                {busy
                  ? "Working…"
                  : panel === "reflection"
                    ? "Analyze these days"
                    : "Show entries"}
              </button>
            </form>
            {panel === "journal" &&
              journalLoaded &&
              (journal.length ? (
                journal
                  .slice()
                  .sort(
                    (a, b) =>
                      b.day.localeCompare(a.day) ||
                      b.created_at.localeCompare(a.created_at),
                  )
                  .map((j) => (
                    <article className="ot-journal-entry" key={j.id}>
                      <small>
                        {j.day} · {j.period}
                      </small>
                      <p>{j.text}</p>
                      <b>
                        {Object.entries(j.scores)
                          .map(([k, v]) => `${k}: ${v}/10`)
                          .join(" · ")}
                      </b>
                    </article>
                  ))
              ) : (
                <p className="ot-empty">No entries recorded for these dates.</p>
              ))}
          </Modal>
        )}
        {state && panel === "chat" && (
          <ChatPanel
            onClose={() => setPanel(null)}
            saved={chatSaved}
            handingOff={handoffIds.length > 0 && !draft.trim()}
            restoreFocus={!handoffIds.length}
          >
            <div className="ot-chat-log" role="log" aria-label="Conversation">
              {chatMessages.length ? (
                chatMessages.slice(-60).map((m) => (
                  <article key={m.id} className={`ot-message ${m.role}`}>
                    <small>
                      {m.role === "user"
                        ? "You"
                        : m.mode === "reflection"
                          ? "OutThink · Reflection"
                          : "OutThink"}
                    </small>
                    <p>{m.text}</p>
                    {outgoing
                      .filter(
                        (o) => o.message.id === m.id && o.status === "failed",
                      )
                      .map((o) => (
                        <div className="ot-message-failed" key={o.message.id}>
                          <span>Couldn’t send.</span>
                          <button
                            className="ot-text-button"
                            disabled={busy}
                            onClick={() => void send(o.request)}
                          >
                            Retry message
                          </button>
                        </div>
                      ))}
                    {m.suggestions?.map((n, i) => (
                      <div className="ot-note-suggestion" key={i}>
                        <p>{n.note}</p>
                        <button
                          className="ot-secondary"
                          onClick={() =>
                            setDraft(
                              `Add this note to ${state.activities.find((a) => a.id === n.activity_id)?.name}: ${n.note}`,
                            )
                          }
                        >
                          Use as activity note
                        </button>
                      </div>
                    ))}
                  </article>
                ))
              ) : (
                <p className="ot-chat-empty">What did you do today?</p>
              )}
              {pending.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  state={state}
                  busy={busy}
                  decide={(id, accept) =>
                    void send({ type: "proposal", id, accept })
                  }
                />
              ))}
              {waitingActivities.length > 0 && !handoffIds.length && (
                <button
                  className="ot-chat-pending-link"
                  disabled={busy}
                  onClick={() => {
                    setPanel(null);
                    setArrivingIds(waitingActivities.map((p) => p.id));
                  }}
                >
                  <Icon kind="check" size={16} />
                  {waitingActivities.length}{" "}
                  {waitingActivities.length === 1 ? "activity" : "activities"}{" "}
                  ready to check off
                  <span aria-hidden="true">→</span>
                </button>
              )}
              {thinking && (
                <div
                  className="ot-chat-thinking"
                  role="status"
                  aria-label="OutThink is thinking"
                >
                  <Icon kind="spark" size={14} />
                  <span>Thinking…</span>
                  <span className="ot-thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="ot-chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                e.currentTarget.querySelector("textarea")?.blur();
                void submitChat();
              }}
            >
              <textarea
                ref={chatInput}
                aria-label="Message"
                placeholder="Describe what you did, e.g. 2 hours of focused work, then a workout"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                maxLength={20000}
              />
              <div className="ot-actions">
                <small>Tell me what you did. Check it off next.</small>
                <button
                  className="ot-primary"
                  disabled={busy || !draft.trim()}
                  aria-label="Send message"
                >
                  <Icon kind="arrow" size={18} />
                </button>
              </div>
            </form>
          </ChatPanel>
        )}
        {editActivity && (
          <ActivityEditor
            key={editActivity === "new" ? "new" : editActivity.id}
            activity={editActivity === "new" ? undefined : editActivity}
            busy={busy}
            onClose={() => setEditActivity(null)}
            onSave={save}
          />
        )}
        {state && logActivity && (
          <LogEditor
            activity={logActivity}
            today={state.day}
            busy={busy}
            onSave={save}
            onClose={() => setLogActivity(null)}
          />
        )}
        {state && editGoal && (
          <GoalEditor
            goal={editGoal === "new" ? undefined : editGoal}
            state={state}
            busy={busy}
            onSave={save}
            onClose={() => setEditGoal(null)}
          />
        )}
        {state && journalEditor && (
          <JournalEditor
            today={state.day}
            busy={busy}
            onSave={save}
            onClose={() => {
              setJournalEditor(false);
              setJournalLoaded(false);
            }}
          />
        )}
        {archive && (
          <Modal
            title={`${archive.archived ? "Restore" : "Archive"} ${archive.name}?`}
            onClose={() => setArchive(null)}
          >
            <p>Its completed activities and XP history will be kept.</p>
            <div className="ot-actions">
              <button
                className="ot-primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await save([
                      {
                        type: "archive_activity",
                        data: { id: archive.id, archived: !archive.archived },
                      },
                    ])
                  )
                    setArchive(null);
                }}
              >
                Confirm
              </button>
              <button className="ot-secondary" onClick={() => setArchive(null)}>
                Cancel
              </button>
            </div>
          </Modal>
        )}
        {reward &&
          createPortal(
            <RewardFeedback
              key={reward.id}
              reward={reward}
              onClose={() => setReward(null)}
              areas={areas}
            />,
            Array.from(document.querySelectorAll("dialog[open]")).at(-1) ||
              document.querySelector(".pp-root") ||
              document.body,
          )}
        <footer className="ot-appearance">
          <div
            className="ot-appearance-toggle"
            role="group"
            aria-label="Appearance"
          >
            <button
              type="button"
              aria-pressed={mode === "light"}
              onClick={() => setMode("light")}
            >
              <Icon kind="sun" />
              Light
            </button>
            <button
              type="button"
              aria-pressed={mode === "dark"}
              onClick={() => setMode("dark")}
            >
              <Icon kind="moon" />
              Dark
            </button>
          </div>
        </footer>
      </main>
    </FeedbackContext.Provider>
  );
}
