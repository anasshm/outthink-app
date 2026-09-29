import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useHostTheme } from "./theme";
import type { Area } from "../lib/types";
import {
  AREAS,
  ringSegments,
  pct,
  clamp,
  haptic,
  returnToRings,
  enableNativeTapHaptic,
  type Point,
  type Reward,
  type Streak,
  type StreakMoment,
  type Activity,
  type PillarDefinition,
} from "./progress-utils";
export function Icon({
  kind,
  size = 18,
}: {
  kind:
    | Area
    | "check"
    | "arrow"
    | "spark"
    | "close"
    | "flame"
    | "plus"
    | "sun"
    | "moon"
    | "chevron-down";
  size?: number;
}) {
  const paths: Record<string, any> = {
    mental: (
      <>
        <path d="M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 3 3 0 0 0 4 5 3 3 0 0 0 5-2V7a3 3 0 0 0-3-3Z" />
        <path d="M15 4a3 3 0 0 1 5 3 4 4 0 0 1 1 7 3 3 0 0 1-4 5 3 3 0 0 1-5-2M8 9l4 2m4-2-4 2M7 15l5-1m5 1-5-1" />
      </>
    ),
    physical: (
      <>
        <path d="M2 12h5l3-8 4 16 3-8h5" />
      </>
    ),
    work: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="3" />
        <path d="M8 7V4h8v3M3 12c6 4 12 4 18 0M10 13v3h4v-3" />
      </>
    ),
    social: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    moon: <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    arrow: <path d="M12 20V4m-6 6 6-6 6 6" />,
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    flame: (
      <>
        <path
          d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 3-6 0 3 1 4 2 4 2-3 2-6 1-9Z"
          fill="currentColor"
          fillOpacity=".14"
        />
        <path d="M10 17c0-1 1-2 2-3 1 1 2 2 2 3a2 2 0 0 1-4 0Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

const hourLabel = (hour: number) =>
  hour === 0
    ? "midnight"
    : hour === 12
      ? "noon"
      : `${hour % 12} ${hour < 12 ? "a.m." : "p.m."}`;

export function StreakBadge({
  streak,
  moment,
  dayStartsAt,
}: {
  streak: Streak;
  moment: StreakMoment | null;
  dayStartsAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = dialog.current,
      button = trigger.current;
    node?.showModal();
    return () => {
      node?.close();
      document.body.style.overflow = previousOverflow;
      button?.focus({ preventScroll: true });
    };
  }, [open]);
  const milestoneText =
    moment?.to === 7
      ? "Seven days logged in a row."
      : "Thirty days logged in a row.";
  return (
    <div className="pp-streak-wrap">
      <button
        ref={trigger}
        className={`pp-streak-badge${streak.todayLogged ? " is-lit" : ""}${moment ? " is-celebrating" : ""}${moment?.milestone ? " is-milestone" : ""}`}
        onClick={() => setOpen(true)}
        data-count={streak.count}
        data-logged={streak.todayLogged}
        aria-label={`${streak.count} day logging streak. ${streak.todayLogged ? "Today is recorded." : "Send a message or log an activity to continue today."} View streak.`}
      >
        <span
          key={`flame-${moment?.id || 0}`}
          className="pp-streak-flame"
          aria-hidden="true"
        >
          <Icon kind="flame" size={23} />
        </span>
        <span
          className="pp-streak-number"
          aria-hidden="true"
          style={{
            width: `${Math.max(String(streak.count).length, String(moment?.from || 0).length)}ch`,
          }}
        >
          {moment ? (
            <span key={moment.id} className="pp-streak-roll">
              <span>{moment.from}</span>
              <span>{moment.to}</span>
            </span>
          ) : (
            <span>{streak.count}</span>
          )}
        </span>
        {moment && (
          <span
            key={`sparks-${moment.id}`}
            className="pp-streak-sparks"
            aria-hidden="true"
          >
            {Array.from({ length: moment.milestone ? 12 : 6 }, (_, i) => (
              <i
                key={i}
                style={
                  {
                    "--spark-angle": `${(i * 360) / (moment.milestone ? 12 : 6)}deg`,
                    "--spark-distance": moment.milestone ? "36px" : "25px",
                    animationDelay: `${120 + (i % 3) * 25}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        )}
      </button>
      {moment && (moment.milestone || moment.offscreen) && (
        <div
          className={`pp-streak-message${moment.offscreen ? " is-floating" : ""}`}
          role="status"
          aria-live="polite"
        >
          <Icon kind="flame" size={20} />
          <span>
            <strong>{moment.to} day streak</strong>
            <small>
              {moment.milestone ? milestoneText : "Logged again today."}
            </small>
          </span>
        </div>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="pp-streak-dialog"
          aria-labelledby="pp-streak-title"
          onCancel={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              const r = e.currentTarget.getBoundingClientRect();
              if (
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
              )
                setOpen(false);
            }
          }}
        >
          <div className="pp-section-title">
            <h3 id="pp-streak-title">Your logging streak</h3>
            <button
              className="pp-icon-button"
              autoFocus
              onClick={() => setOpen(false)}
              aria-label="Close logging streak"
            >
              <Icon kind="close" size={18} />
            </button>
          </div>
          <div
            className={`pp-streak-total${streak.todayLogged ? " is-lit" : ""}`}
          >
            <Icon kind="flame" size={42} />
            <strong>
              {streak.count} {streak.count === 1 ? "day" : "days"}
            </strong>
          </div>
          <p className="pp-streak-today">
            {streak.todayLogged
              ? "Today is logged."
              : "Send a message or log an activity to keep it going."}
          </p>
          <p>
            Send a message or check off an activity. Either counts once for the
            day. Your rings show your progress in each pillar.
          </p>
          <p className="pp-streak-footnote">
            {dayStartsAt !== undefined &&
              `Days start at ${hourLabel(dayStartsAt)}. `}
            Past activities count toward the day they happened.
          </p>
        </dialog>
      )}
    </div>
  );
}

export function Arc({
  radius,
  progress,
  color,
  light = false,
  width = 12,
  allowOverflow = true,
  deducted = 0,
}: {
  radius: number;
  progress: number;
  color: string;
  light?: boolean;
  width?: number;
  allowOverflow?: boolean;
  deducted?: number;
}) {
  const theme = useHostTheme();
  const length = 2 * Math.PI * radius;
  const [shown, setShown] = useState({ progress, deducted });
  const current = useRef({ progress, deducted });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = { progress, deducted };
      // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the external reduced-motion preference.
      setShown({ progress, deducted });
      return;
    }
    const from = current.current,
      start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / 620);
      const ease = 1 - Math.pow(1 - t, 3);
      const next = {
        progress: from.progress + (progress - from.progress) * ease,
        deducted: from.deducted + (deducted - from.deducted) * ease,
      };
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    }
    if (from.progress !== progress || from.deducted !== deducted)
      frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress, deducted]);
  const parts = ringSegments(shown.progress, shown.deducted);
  const netProgress = shown.deducted > 0 ? parts.net : shown.progress;
  const muted = light && netProgress < 100;
  const over = allowOverflow && !shown.deducted && netProgress > 100.01;
  const extra = over ? (netProgress - 100) % 100 || 100 : 0;
  const angle = (((netProgress / 100) * 360 - 90) * Math.PI) / 180;
  return (
    <>
      <circle
        cx="72"
        cy="72"
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.09}
        strokeWidth={width}
      />
      <circle
        className="pp-arc"
        data-light={muted ? "true" : "false"}
        cx="72"
        cy="72"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        transform="rotate(-90 72 72)"
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={length * (1 - clamp(netProgress) / 100)}
        opacity={netProgress <= 0 ? 0 : muted ? 0.56 : over ? 0.65 : 1}
      />
      {parts.deducted > 0 && (
        <circle
          className="pp-cost-arc"
          data-deducted={deducted}
          cx="72"
          cy="72"
          r={radius}
          fill="none"
          stroke="var(--ot-negative, #c53939)"
          strokeWidth={width}
          strokeLinecap="butt"
          transform={`rotate(${parts.net * 3.6 - 90} 72 72)`}
          strokeDasharray={`${(length * parts.deducted) / 100} ${length}`}
        />
      )}
      {over && (
        <g className="pp-overflow" data-progress={Math.round(netProgress)}>
          <circle
            cx="72"
            cy="72"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            transform="rotate(-90 72 72)"
            strokeDasharray={`${length} ${length}`}
            strokeDashoffset={length * (1 - extra / 100)}
          />
          <circle
            className="pp-ring-end"
            cx={72 + radius * Math.cos(angle)}
            cy={72 + radius * Math.sin(angle)}
            r={width / 2}
            fill={color}
            stroke={theme.bg.editor}
            strokeWidth={1.5}
          />
        </g>
      )}
    </>
  );
}

export function Pillar({
  area,
  dayXP,
  sevenXP,
  dayDeducted = 0,
  sevenDeducted = 0,
  onSelect,
  closing = false,
}: {
  area: (typeof AREAS)[number];
  dayXP: number;
  sevenXP: number;
  dayDeducted?: number;
  sevenDeducted?: number;
  onSelect: () => void;
  closing?: boolean;
}) {
  const theme = useHostTheme();
  const color = theme.category[area.color];
  const today = pct(dayXP, area.daily),
    seven = pct(sevenXP, area.seven);
  const full = dayXP >= area.daily;
  return (
    <button
      className="pp-pillar"
      data-area={area.id}
      onClick={onSelect}
      aria-label={`${area.name}: today ${today} percent, last 7 days ${seven} percent.${sevenDeducted > 0 ? ` ${Math.round((sevenXP + sevenDeducted) * 100) / 100} earned, ${sevenDeducted} deducted, ${sevenXP} net XP this week.` : ""} View activity history.`}
    >
      <span className="pp-pillar-name">{area.name}</span>
      <div className={`pp-ring-wrap${closing ? " is-closing" : ""}`}>
        <svg
          viewBox="0 0 144 144"
          role="img"
          aria-label={`Outer: ${seven}% of last 7 days goal. Inner: ${today}% of today's goal.`}
        >
          <Arc
            radius={62}
            progress={seven}
            deducted={pct(sevenDeducted, area.seven)}
            color={color}
            width={12}
            allowOverflow={area.id !== "work"}
          />
          <Arc
            radius={46}
            progress={today}
            deducted={pct(dayDeducted, area.daily)}
            color={color}
            light
            width={10}
            allowOverflow={area.id !== "work"}
          />
        </svg>
        <span className="pp-ring-center" style={{ color }} aria-hidden="true">
          <Icon kind={area.id} size={32} />
        </span>
      </div>
      <div
        className="pp-daily-value"
        style={{ color: full ? color : theme.text.secondary }}
      >
        {full && <Icon kind="check" size={13} />}
        <span>
          Today <b>{today}%</b>
        </span>
      </div>
    </button>
  );
}

export function TaskRow({
  task,
  complete,
  onToggle,
  disabled = false,
  saving = false,
  optimistic = false,
}: {
  task: Activity;
  complete: boolean;
  onToggle: (point: Point) => void;
  disabled?: boolean;
  saving?: boolean;
  optimistic?: boolean;
}) {
  const theme = useHostTheme();
  return (
    <label
      className={`pp-task${complete ? " is-complete" : ""}${saving ? " is-saving" : ""}${optimistic ? " is-optimistic" : ""}`}
      aria-busy={saving}
    >
      <input
        ref={enableNativeTapHaptic}
        type="checkbox"
        role="checkbox"
        checked={complete}
        disabled={disabled || saving}
        aria-busy={saving}
        onChange={(e) => {
          const rect = e.currentTarget
            .closest("label")!
            .getBoundingClientRect();
          onToggle({
            x: window.innerWidth / 2,
            y: Math.max(90, Math.min(window.innerHeight - 150, rect.top)),
          });
        }}
        aria-label={task.title}
      />
      <span className="pp-check" aria-hidden="true">
        {complete && <Icon kind="check" size={15} />}
      </span>
      <span className="pp-task-text">
        <span className="pp-task-title">{task.title}</span>
        {task.detail && <small>{task.detail}</small>}
      </span>
      <span className="pp-xp-chips">
        {AREAS.filter((a) => task.xp[a.id]).map((a) => (
          <span
            key={a.id}
            title={`${task.xp[a.id]} ${a.name} XP`}
            style={{
              color:
                (task.xp[a.id] || 0) < 0
                  ? "var(--ot-negative)"
                  : theme.category[a.color],
            }}
          >
            <Icon kind={a.id} size={12} />
            {(task.xp[a.id] || 0) > 0 ? "+" : ""}
            {task.xp[a.id]}
          </span>
        ))}
      </span>
    </label>
  );
}

export function ConfettiBurst({ top }: { top: number }) {
  const theme = useHostTheme();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !container.current) return;
    const animations: Animation[] = [];
    // Sample a continuous drag/gravity trajectory; there is no end-position pull.
    const fraction = (seed: number) => {
      const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    Array.from(container.current.children).forEach((child, i) => {
      const angle = ((-155 + fraction(i + 1) * 130) * Math.PI) / 180;
      const speed =
        (360 + fraction(i + 71) * 250) * Math.min(1, window.innerWidth / 390);
      const vx = Math.cos(angle) * speed,
        vy = Math.sin(angle) * speed;
      const drag = 1.65 + fraction(i + 131) * 0.45;
      const gravity = 190 + fraction(i + 191) * 70;
      const terminal = gravity / drag;
      const drift = (fraction(i + 251) - 0.5) * 20;
      const spin = (fraction(i + 311) - 0.5) * 500;
      const phase = fraction(i + 371) * Math.PI * 2;
      const duration = 1550 + fraction(i + 431) * 420;
      const frames = Array.from({ length: 61 }, (_, step) => {
        const progress = step / 60,
          t = (progress * duration) / 1000;
        const travel = (1 - Math.exp(-drag * t)) / drag;
        const flutter =
          (1 - Math.exp(-4 * t)) *
          (Math.sin(phase + t * 8) - Math.sin(phase)) *
          4;
        const x = vx * travel + drift * t + flutter;
        const y = (vy - terminal) * travel + terminal * t;
        const fade = Math.max(0, (progress - 0.62) / 0.38);
        const opacity =
          Math.min(1, progress / 0.06) * (1 - fade * fade * (3 - 2 * fade));
        return {
          offset: progress,
          opacity,
          transform: `translate3d(${x}px,${y}px,0) rotate(${(phase * 180) / Math.PI + spin * t}deg) scaleX(${0.3 + Math.abs(Math.cos(phase + t * 7)) * 0.7})`,
        };
      });
      animations.push(
        child.animate(frames, {
          duration,
          delay: 640 + Math.floor(i / 30) * 180 + fraction(i + 491) * 100,
          easing: "linear",
          fill: "both",
        }),
      );
    });
    const stopForReducedMotion = () => {
      if (motion.matches) animations.forEach((animation) => animation.cancel());
    };
    motion.addEventListener("change", stopForReducedMotion);
    return () => {
      animations.forEach((animation) => animation.cancel());
      motion.removeEventListener("change", stopForReducedMotion);
    };
  }, [top]);
  return (
    <div ref={container} className="pp-confetti" aria-hidden="true">
      {Array.from({ length: 60 }, (_, i) => (
        <i
          key={i}
          style={{
            background: theme.category[AREAS[i % AREAS.length].color],
            left: `${46 + (i % 5) * 2}%`,
            top,
            width: i % 3 === 0 ? 5 : 7,
            height: i % 3 === 0 ? 5 : i % 2 === 0 ? 11 : 14,
            borderRadius: i % 3 === 0 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

export function RewardFeedback({
  reward,
  onClose,
  areas = AREAS,
}: {
  reward: Reward;
  onClose: () => void;
  areas?: PillarDefinition[];
}) {
  const theme = useHostTheme();
  const [animated, setAnimated] = useState(false);
  const earned = areas.filter((a) => reward.gains[a.id]);
  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 40);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!reward.milestones.length) return;
    const timer = setTimeout(() => haptic(true), 660);
    return () => clearTimeout(timer);
  }, [reward.id, reward.milestones.length]);
  const milestone = reward.milestones[0];
  const milestoneArea = areas.find((a) => a.id === milestone?.area);
  const title = milestoneArea
    ? `${milestoneArea.name} ${milestone.period === "today" ? "ring" : "week"} closed`
    : Object.values(reward.gains).some((n) => (n || 0) < 0)
      ? "XP updated"
      : "Progress logged";
  const floatingTop = Math.max(
    80,
    Math.min(
      reward.point.y,
      window.innerHeight -
        (reward.showMiniRings ? 140 : 70) -
        earned.length * 35,
    ),
  );
  const burstTop = Math.max(
    window.innerHeight * 0.42,
    Math.min(window.innerHeight * 0.65, floatingTop),
  );
  return (
    <>
      <div
        className="pp-floating-xp"
        aria-hidden="true"
        style={{ top: floatingTop }}
      >
        {earned.map((a) => (
          <span
            key={a.id}
            style={{
              color:
                (reward.gains[a.id] || 0) < 0
                  ? "var(--ot-negative)"
                  : theme.category[a.color],
            }}
          >
            <span>
              {(reward.gains[a.id] || 0) > 0 ? "+" : ""}
              {reward.gains[a.id]} XP
            </span>
            <Icon kind={a.id} size={22} />
          </span>
        ))}
      </div>
      {milestone && <ConfettiBurst top={burstTop} />}
      {reward.showMiniRings && (
        <aside
          className={`pp-reward-tray pp-compact-reward ${milestone ? "pp-milestone" : ""}`}
          data-areas={earned.length}
          aria-label="Activity reward"
        >
          <button
            className="pp-reward-summary"
            onClick={() => {
              returnToRings(reward.variant);
              onClose();
            }}
            aria-label={`${title}. View your rings.`}
          >
            <span className="pp-reward-rings">
              {earned.map((a) => {
                const before = reward.before[a.id],
                  after = reward.after[a.id],
                  current = animated ? after : before;
                return (
                  <span
                    className={`pp-mini-pillar${reward.milestones.some((m) => m.area === a.id) ? " is-closing" : ""}`}
                    key={a.id}
                    style={{ color: theme.category[a.color] }}
                    aria-label={`${a.name}: today ${pct(after.today, a.daily)} percent, last 7 days ${pct(after.seven, a.seven)} percent`}
                  >
                    <svg
                      viewBox="0 0 144 144"
                      width="50"
                      height="50"
                      aria-hidden="true"
                    >
                      <Arc
                        radius={61}
                        progress={pct(current.seven, a.seven)}
                        deducted={pct(
                          (animated
                            ? reward.afterBreakdown
                            : reward.beforeBreakdown)?.[a.id].seven.deducted ||
                            0,
                          a.seven,
                        )}
                        color={theme.category[a.color]}
                        width={13}
                        allowOverflow={a.id !== "work"}
                      />
                      <Arc
                        radius={43}
                        progress={pct(current.today, a.daily)}
                        deducted={pct(
                          (animated
                            ? reward.afterBreakdown
                            : reward.beforeBreakdown)?.[a.id].today.deducted ||
                            0,
                          a.daily,
                        )}
                        color={theme.category[a.color]}
                        light
                        width={11}
                        allowOverflow={a.id !== "work"}
                      />
                    </svg>
                    <span className="pp-mini-icon">
                      <Icon kind={a.id} size={12} />
                    </span>
                  </span>
                );
              })}
            </span>
            <span className="pp-reward-copy">
              <strong>{title}</strong>
              <small>
                View your rings <span aria-hidden="true">↑</span>
              </small>
            </span>
          </button>
          <button
            className="pp-icon-button"
            aria-label="Dismiss reward"
            onClick={onClose}
          >
            <Icon kind="close" size={17} />
          </button>
        </aside>
      )}
    </>
  );
}
