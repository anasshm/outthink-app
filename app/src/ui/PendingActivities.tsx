import type { PendingActivity } from "../lib/types";
import type { Point } from "./progress-utils";
import { Icon, TaskRow } from "./Progress";
import { useCompletionList } from "./useCompletionList";

const handled = (item: PendingActivity) => !item.waiting;

export default function PendingActivities({
  items,
  today,
  busy,
  arriving,
  savingId,
  optimisticIds,
  onToggle,
  onDismiss,
}: {
  items: PendingActivity[];
  today: string;
  busy: boolean;
  arriving: string[];
  savingId: string | null;
  optimisticIds: string[];
  onToggle: (item: PendingActivity, point: Point) => void;
  onDismiss: (item: PendingActivity) => void;
}) {
  const visible = useCompletionList(items, handled, today);
  const groups = [
    { title: "Pending today", items: visible.filter((i) => i.day === today) },
    { title: "Pending earlier", items: visible.filter((i) => i.day !== today) },
  ];
  if (!visible.length) return null;
  return (
    <div className="ot-pending-sections">
      {groups
        .filter((g) => g.items.length)
        .map((group) => {
          const complete = group.items.filter((i) => i.complete).length;
          return (
            <section
              key={group.title}
              className="ot-pending-section"
              aria-label={group.title}
            >
              <div className="pp-section-title">
                <h3 tabIndex={-1} data-pending-heading>
                  {group.title}
                </h3>
                <span className="ot-pending-count" aria-live="polite">
                  {complete === group.items.length ? (
                    <>
                      <Icon kind="check" size={13} /> All checked in
                    </>
                  ) : (
                    `${group.items.filter((i) => i.waiting).length} left`
                  )}
                </span>
              </div>
              <div className="ot-pending-list">
                {group.items.map((item, index) => (
                  <div
                    key={item.id}
                    data-pending-id={item.id}
                    aria-busy={
                      savingId === item.id || optimisticIds.includes(item.id)
                    }
                    className={`ot-completion-row ot-pending-row${arriving.includes(item.id) ? " is-arriving" : ""}${!item.waiting ? " is-leaving" : ""}`}
                    style={{
                      animationDelay: item.waiting
                        ? `${Math.min(index, 5) * 55}ms`
                        : "0ms",
                    }}
                  >
                    <TaskRow
                      task={{
                        id: item.id,
                        title: item.title,
                        xp: item.xp,
                        detail:
                          item.day !== today
                            ? new Date(
                                `${item.day}T12:00:00Z`,
                              ).toLocaleDateString("en", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                timeZone: "UTC",
                              })
                            : undefined,
                      }}
                      complete={item.complete}
                      saving={
                        savingId === item.id || optimisticIds.includes(item.id)
                      }
                      optimistic={
                        optimisticIds.includes(item.id) && item.complete
                      }
                      disabled={
                        (busy && !optimisticIds.length) || !item.waiting
                      }
                      onToggle={(point) => onToggle(item, point)}
                    />
                    <button
                      className="ot-pending-dismiss"
                      disabled={busy || !item.waiting}
                      style={{
                        visibility: item.waiting ? "visible" : "hidden",
                      }}
                      aria-label={`Dismiss ${item.title}`}
                      onClick={() => onDismiss(item)}
                    >
                      <Icon kind="close" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
