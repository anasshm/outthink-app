import { useState } from "react";
import type {
  Activity,
  Action,
  Goal,
  Settings,
  State,
  XP,
  Area,
} from "../lib/types";
import { Icon } from "./Progress";
import { AREAS } from "./progress-utils";
import { useHostTheme } from "./theme";
import Modal from "./Modal";
import { xpFor, nextReward } from "../../shared/domain.mjs";
export type Save = (actions: Action[]) => Promise<boolean>;
export function XPLine({ xp }: { xp: XP }) {
  const theme = useHostTheme();
  return (
    <span className="ot-xp-line">
      {AREAS.filter((a) => xp[a.id]).map((a) => (
        <span
          style={{
            color:
              (xp[a.id] || 0) < 0
                ? "var(--ot-negative)"
                : theme.category[a.color],
          }}
          key={a.id}
        >
          <span>
            {(xp[a.id] || 0) > 0 ? "+" : ""}
            {Math.round((xp[a.id] || 0) * 100) / 100}
          </span>
          <Icon kind={a.id} size={15} />
        </span>
      ))}
    </span>
  );
}
export function ActivityEditor({
  activity,
  onClose,
  onSave,
  busy,
}: {
  activity?: Activity;
  onClose: () => void;
  onSave: Save;
  busy: boolean;
}) {
  const [name, setName] = useState(activity?.name || ""),
    [description, setDescription] = useState(activity?.description || ""),
    [note, setNote] = useState(activity?.note || ""),
    [sop, setSop] = useState(activity?.sop || "");
  const [unit, setUnit] = useState<Activity["unit"]>(
    activity?.unit || "completion",
  );
  const [unitSize, setUnitSize] = useState(activity?.unit_size || 1);
  const [xp, setXp] = useState<XP>(
    Object.fromEntries(AREAS.map((a) => [a.id, activity?.xp[a.id] || 0])),
  );
  const [quantity, setQuantity] = useState(activity?.default_quantity ?? 1);
  const [kind, setKind] = useState(
    activity?.preferred_frequency?.kind || "none",
  );
  const [days, setDays] = useState(activity?.preferred_frequency?.days || 7),
    [count, setCount] = useState(
      activity?.preferred_frequency?.kind === "weekly"
        ? activity.preferred_frequency.count
        : 3,
    );
  const [must, setMust] = useState(activity?.must_do || false),
    [work, setWork] = useState(activity?.tracks_work || false);
  return (
    <Modal
      title={activity ? "Edit activity" : "New activity"}
      onClose={onClose}
    >
      <form
        className="ot-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = {
            ...(activity ? { id: activity.id } : {}),
            name,
            description,
            note,
            sop,
            unit,
            default_quantity: quantity,
            unit_size: unitSize,
            xp,
            preferred_frequency:
              kind === "none"
                ? null
                : { kind, days, ...(kind === "weekly" ? { count } : {}) },
            must_do: must,
            tracks_work: work,
          };
          if (
            await onSave([
              { type: activity ? "update_activity" : "create_activity", data },
            ])
          )
            onClose();
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Activity name"
          />
        </label>
        <label>
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What counts as this activity?"
          />
        </label>
        <div className="ot-fields">
          <label>
            Measure in
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value as Activity["unit"]);
                setUnitSize(1);
                setQuantity(1);
                if (e.target.value === "completion") setWork(false);
              }}
            >
              <option value="completion">Completions</option>
              <option value="minute">Minutes</option>
              <option value="hour">Hours</option>
            </select>
          </label>
          <label>
            XP per {unit}
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={unitSize}
              onChange={(e) => setUnitSize(+e.target.value)}
            />
          </label>
        </div>
        <div className="ot-xp-inputs">
          {AREAS.map((a) => (
            <label key={a.id}>
              {a.name}
              <input
                type="number"
                step="any"
                min="-10000"
                max="10000"
                value={xp[a.id] ?? 0}
                onChange={(e) => setXp({ ...xp, [a.id]: +e.target.value })}
              />
            </label>
          ))}
        </div>
        {activity?.daily_bonus && unit !== "completion" && (
          <p>
            First {activity.daily_bonus.minutes} minutes each day:{" "}
            <XPLine
              xp={xpFor(
                { ...activity, xp, unit, unit_size: unitSize },
                activity.daily_bonus.minutes / (unit === "hour" ? 60 : 1),
              )}
            />
            . The rates above apply afterward. Separate entries share the same
            daily allowance.
          </p>
        )}
        <label>
          Default amount when you don’t specify
          <input
            type="number"
            min="0.01"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(+e.target.value)}
          />
        </label>
        <label>
          Preferred frequency
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="none">No schedule</option>
            <option value="interval">Once every few days</option>
            <option value="weekly">Several days per period</option>
          </select>
        </label>
        {kind !== "none" && (
          <div className="ot-fields">
            {kind === "weekly" && (
              <label>
                Active days
                <input
                  type="number"
                  min="1"
                  max={days}
                  required
                  value={count}
                  onChange={(e) => setCount(+e.target.value)}
                />
              </label>
            )}
            <label>
              {kind === "weekly" ? "In the last" : "Every"}
              <span className="ot-input-unit">
                <input
                  type="number"
                  min="1"
                  max="3660"
                  required
                  value={days}
                  onChange={(e) => setDays(+e.target.value)}
                />
                <span>days</span>
              </span>
            </label>
          </div>
        )}
        <label className="ot-check-label">
          <input
            type="checkbox"
            checked={must}
            onChange={(e) => setMust(e.target.checked)}
          />
          This is a must-do
        </label>
        {unit !== "completion" && (
          <label className="ot-check-label">
            <input
              type="checkbox"
              checked={work}
              onChange={(e) => setWork(e.target.checked)}
            />
            Count toward my daily work limit
          </label>
        )}
        <label>
          Notes for suggestions
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this activity helps with your goals."
          />
        </label>
        <label>
          SOP · How to do it
          <textarea
            rows={4}
            maxLength={10000}
            value={sop}
            onChange={(e) => setSop(e.target.value)}
            placeholder="Your steps, technique, or reminders while doing it."
          />
        </label>
        <button className="ot-primary" disabled={busy}>
          {busy ? "Saving…" : "Save activity"}
        </button>
      </form>
    </Modal>
  );
}
export function LogEditor({
  activity,
  today,
  busy,
  onSave,
  onClose,
}: {
  activity: Activity;
  today: string;
  busy: boolean;
  onSave: Save;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(activity.default_quantity),
    [day, setDay] = useState(today);
  const xp = Object.fromEntries(
    AREAS.map((a) => [
      a.id,
      Math.round(
        (((activity.xp[a.id] || 0) * quantity) / (activity.unit_size || 1)) *
          100,
      ) / 100,
    ]),
  );
  return (
    <Modal title={`Log ${activity.name}`} onClose={onClose}>
      <form
        className="ot-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave([
              {
                type: "log_activity",
                data: { activity_id: activity.id, quantity, day },
              },
            ])
          )
            onClose();
        }}
      >
        <div className="ot-fields">
          <label>
            {activity.unit === "completion"
              ? "Times"
              : activity.unit === "hour"
                ? "Hours"
                : "Minutes"}
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(+e.target.value)}
            />
          </label>
          <label>
            Activity day
            <input
              type="date"
              required
              max={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
        </div>
        <XPLine xp={xp} />
        <button className="ot-primary" disabled={busy}>
          {busy ? "Saving…" : "Log activity"}
        </button>
      </form>
    </Modal>
  );
}
export function GoalEditor({
  goal,
  state,
  busy,
  onSave,
  onClose,
}: {
  goal?: Goal;
  state: State;
  busy: boolean;
  onSave: Save;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(goal?.title || ""),
    [note, setNote] = useState(goal?.note || ""),
    [areas, setAreas] = useState<Area[]>(goal?.areas || []),
    [ids, setIds] = useState<string[]>(goal?.activity_ids || []),
    [until, setUntil] = useState(goal?.until_day || "");
  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <form
        className="ot-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave([
              {
                type: "save_goal",
                data: {
                  ...(goal ? { id: goal.id } : {}),
                  title,
                  note,
                  areas,
                  activity_ids: ids,
                  until_day: until || null,
                  active: true,
                },
              },
            ])
          )
            onClose();
        }}
      >
        <label>
          Goal
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Define your goal"
          />
        </label>
        <label>
          Reason
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="ot-choice-row">
          {AREAS.map((a) => (
            <label className="ot-check-label" key={a.id}>
              <input
                type="checkbox"
                checked={areas.includes(a.id)}
                onChange={(e) =>
                  setAreas(
                    e.target.checked
                      ? [...areas, a.id]
                      : areas.filter((p) => p !== a.id),
                  )
                }
              />
              {a.name}
            </label>
          ))}
        </div>
        <label>
          Related activities
          <select
            multiple
            value={ids}
            onChange={(e) =>
              setIds(Array.from(e.target.selectedOptions, (o) => o.value))
            }
          >
            {state.activities
              .filter((a) => !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Keep in focus until (optional)
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <button className="ot-primary" disabled={busy}>
          Save goal
        </button>
      </form>
    </Modal>
  );
}
export function SettingsEditor({
  settings,
  busy,
  onSave,
  onClose,
  onLogout,
}: {
  settings: Settings;
  busy: boolean;
  onSave: Save;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [value, setValue] = useState(structuredClone(settings));
  return (
    <Modal title="Preferences" onClose={onClose}>
      <form
        className="ot-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSave([{ type: "save_settings", data: value }])) onClose();
        }}
      >
        <h4>XP targets</h4>
        <div className="ot-targets">
          <span />
          <small>Today</small>
          <small>Last 7</small>
          <small>Last 30</small>
          {AREAS.map((a) => (
            <div className="ot-target-row" key={a.id}>
              <label>{a.name}</label>
              {(["today", "seven", "thirty"] as const).map((p) => (
                <input
                  key={p}
                  aria-label={`${a.name} ${p} target`}
                  type="number"
                  min="1"
                  required
                  value={value.targets[a.id][p]}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      targets: {
                        ...value.targets,
                        [a.id]: {
                          ...value.targets[a.id],
                          [p]: +e.target.value,
                        },
                      },
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <h4>Work limit</h4>
        <label className="ot-check-label">
          <input
            type="checkbox"
            checked={value.workPenalty.enabled}
            onChange={(e) =>
              setValue({
                ...value,
                workPenalty: {
                  ...value.workPenalty,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Apply XP costs after my limit
        </label>
        <label>
          Hours before XP costs start
          <input
            type="number"
            min="0"
            max="24"
            step="any"
            value={value.workPenalty.afterMinutes / 60}
            onChange={(e) =>
              setValue({
                ...value,
                workPenalty: {
                  ...value.workPenalty,
                  afterMinutes: +e.target.value * 60,
                },
              })
            }
          />
        </label>
        <div className="ot-xp-inputs">
          {AREAS.map((a) => (
            <label key={a.id}>
              {a.name} / extra hour
              <input
                type="number"
                min="-10000"
                max="0"
                step="any"
                value={value.workPenalty.perHour[a.id] || 0}
                onChange={(e) =>
                  setValue({
                    ...value,
                    workPenalty: {
                      ...value.workPenalty,
                      perHour: {
                        ...value.workPenalty.perHour,
                        [a.id]: +e.target.value,
                      },
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="ot-muted">
          Work costs update today. Earlier days keep their saved rule.
        </p>
        <h4>Your day</h4>
        <label>
          Time zone
          <input
            required
            value={value.timezone}
            onChange={(e) => setValue({ ...value, timezone: e.target.value })}
          />
        </label>
        <label>
          New day starts at
          <input
            type="number"
            min="0"
            max="23"
            step="1"
            required
            value={value.cutoff}
            onChange={(e) => setValue({ ...value, cutoff: +e.target.value })}
          />
        </label>
        <p className="ot-muted">
          Changing your day boundary affects new entries. Existing activity
          dates stay as logged.
        </p>
        <button className="ot-primary" disabled={busy}>
          Save preferences
        </button>
        <button
          type="button"
          className="ot-secondary"
          onClick={onLogout}
          disabled={busy}
        >
          Lock OutThink
        </button>
      </form>
    </Modal>
  );
}
export function JournalEditor({
  today,
  busy,
  onSave,
  onClose,
}: {
  today: string;
  busy: boolean;
  onSave: Save;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(""),
    [day, setDay] = useState(today),
    [scores, setScores] = useState<Record<string, string>>({}),
    [period, setPeriod] = useState("day");
  return (
    <Modal title="A note about your day" onClose={onClose}>
      <form
        className="ot-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave([
              {
                type: "journal",
                data: {
                  text: entry,
                  day,
                  period,
                  scores: Object.fromEntries(
                    Object.entries(scores)
                      .filter(([, v]) => v !== "")
                      .map(([k, v]) => [k, +v]),
                  ),
                },
              },
            ])
          )
            onClose();
        }}
      >
        <textarea
          aria-label="Journal entry"
          rows={6}
          required
          placeholder="What happened today?"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
        />
        <div className="ot-fields">
          <label>
            Day
            <input
              type="date"
              required
              max={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            Applies to
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="day">Whole day</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="moment">This moment</option>
            </select>
          </label>
        </div>
        <details>
          <summary>Optional scores</summary>
          <div className="ot-xp-inputs">
            {["day", "mood", "energy", "focus", "sleep"].map((k) => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  placeholder="/ 10"
                  value={scores[k] ?? ""}
                  onChange={(e) =>
                    setScores({ ...scores, [k]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <p className="ot-muted">
          These notes and scores are only read by the AI when you ask for a
          reflection.
        </p>
        <button className="ot-primary" disabled={busy}>
          Save journal entry
        </button>
      </form>
    </Modal>
  );
}
export function ProposalCard({
  proposal,
  state,
  busy,
  decide,
}: {
  proposal: State["proposals"][number];
  state: State;
  busy: boolean;
  decide: (id: string, accept: boolean) => void;
}) {
  return (
    <div className="ot-proposal">
      <strong>Ready to save?</strong>
      {proposal.actions.map((action, index) => {
        const d = action.data,
          activity =
            state.activities.find((a) => a.id === (d.activity_id || d.id)) ||
            proposal.actions.find(
              (a) =>
                a.type === "create_activity" && a.data.name === d.activity_name,
            )?.data;
        return (
          <div className="ot-proposal-change" key={index}>
            {action.type === "log_activity" ? (
              <>
                <b>Log {activity?.name || d.activity_name}</b>
                <p>
                  {d.quantity ?? activity?.default_quantity} {activity?.unit}
                  {(d.quantity ?? activity?.default_quantity) !== 1
                    ? "s"
                    : ""}{" "}
                  · {d.day}
                </p>
                <XPLine
                  xp={
                    activity
                      ? nextReward(
                          activity as Activity,
                          d.quantity ?? activity.default_quantity,
                          state.logs,
                          d.day ?? state.day,
                        )
                      : {}
                  }
                />
                {activity?.tracks_work && (
                  <small>Includes any work-limit XP costs for that day.</small>
                )}
              </>
            ) : action.type === "journal" ? (
              <>
                <b>
                  Journal · {d.day} · {d.period || "day"}
                </b>
                <p>{d.text}</p>
                <small>
                  {Object.entries(d.scores || {})
                    .map(([k, v]) => `${k}: ${v}/10`)
                    .join(" · ")}
                </small>
              </>
            ) : action.type === "create_activity" ||
              action.type === "update_activity" ? (
              <>
                <b>
                  {action.type === "create_activity" ? "Add" : "Update"}{" "}
                  {d.name || activity?.name}
                </b>
                {d.description && <p>{d.description}</p>}
                {d.xp && (
                  <p>
                    <XPLine xp={d.xp} /> XP per{" "}
                    {d.unit_size || activity?.unit_size || 1}{" "}
                    {d.unit || activity?.unit}
                  </p>
                )}
                {d.default_quantity != null && (
                  <p>
                    Default: {d.default_quantity} {d.unit || activity?.unit}
                  </p>
                )}
                {"daily_bonus" in d && (
                  <p>
                    {d.daily_bonus ? (
                      <>
                        First {d.daily_bonus.minutes} minutes each day: an extra{" "}
                        <XPLine xp={d.daily_bonus.perHour} /> per hour, shared
                        across entries.
                      </>
                    ) : (
                      "Remove the daily bonus."
                    )}
                  </p>
                )}
                {"preferred_frequency" in d && (
                  <p>
                    {d.preferred_frequency
                      ? d.preferred_frequency.kind === "interval"
                        ? `Every ${d.preferred_frequency.days} days`
                        : `${d.preferred_frequency.count} days in every ${d.preferred_frequency.days}`
                      : "No fixed frequency"}
                  </p>
                )}
                {"must_do" in d && (
                  <p>{d.must_do ? "Must-do" : "Flexible activity"}</p>
                )}
                {"tracks_work" in d && (
                  <p>
                    {d.tracks_work
                      ? "Counts toward your work limit"
                      : "Does not count toward work time"}
                  </p>
                )}
                {"note" in d && <p>Note: {d.note || "(remove note)"}</p>}
                {"sop" in d && (
                  <p className="ot-sop-text">
                    SOP · How: {d.sop || "(remove SOP)"}
                  </p>
                )}
              </>
            ) : action.type === "archive_activity" ? (
              <>
                <b>
                  {d.archived === false ? "Restore" : "Archive"}{" "}
                  {activity?.name}
                </b>
                <p>Past completions will be kept.</p>
              </>
            ) : action.type === "set_log_status" ? (
              <>
                <b>
                  {d.done ? "Restore" : "Undo"}{" "}
                  {state.logs.find((l) => l.id === d.id)?.label}
                </b>
                <p>All affected XP totals will update.</p>
              </>
            ) : action.type === "save_goal" ? (
              <>
                <b>Goal: {d.title}</b>
                <p>{d.note}</p>
                <p>
                  {d.areas?.join(", ")}
                  {d.until_day ? ` · until ${d.until_day}` : ""}
                  {d.active === false ? " · mark inactive" : ""}
                </p>
                <p>
                  {d.activity_ids
                    ?.map(
                      (id: string) =>
                        state.activities.find((a) => a.id === id)?.name,
                    )
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </>
            ) : (
              <>
                <b>Update preferences</b>
                {AREAS.map((a) => (
                  <p key={a.id}>
                    {a.name}: {d.targets?.[a.id]?.today} today ·{" "}
                    {d.targets?.[a.id]?.seven} last 7 ·{" "}
                    {d.targets?.[a.id]?.thirty} last 30
                  </p>
                ))}
                <p>
                  {d.timezone} · day starts at {d.cutoff}:00
                </p>
                <p>
                  Work limit:{" "}
                  {d.workPenalty?.enabled
                    ? `${d.workPenalty.afterMinutes / 60} hours`
                    : "off"}
                </p>
                <XPLine xp={d.workPenalty?.perHour || {}} /> per extra hour
              </>
            )}
          </div>
        );
      })}
      {Array.isArray(proposal.preview) &&
        proposal.preview.map((p) => (
          <div className="ot-proposal-total" key={p.day}>
            <strong>Total change · {p.day}</strong>
            <XPLine xp={p.delta} />
          </div>
        ))}
      <div className="ot-actions">
        <button
          className="ot-primary"
          disabled={busy}
          onClick={() => decide(proposal.id, true)}
        >
          Confirm
        </button>
        <button
          className="ot-secondary"
          disabled={busy}
          onClick={() => decide(proposal.id, false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
