import { useCallback, useEffect, useRef, useState } from "react";

const latest = <T>(item: T) => item;

// Keep a just-checked row in its original position for the shared exit animation.
// Previously completed rows stay hidden; a rolled-back check returns immediately.
export function useCompletionList<T extends { id: string }>(
  items: T[],
  completed: (item: T) => boolean,
  scope: string,
  retainCompleted: (incoming: T, previous: T) => T = latest,
) {
  const reconcile = useCallback(
    (incoming: T[], previous: T[]) => {
      const retained = new Map(previous.map((item) => [item.id, item]));
      const visible = incoming
        .filter((item) => !completed(item) || retained.has(item.id))
        .map((item) =>
          completed(item) && retained.has(item.id)
            ? retainCompleted(item, retained.get(item.id)!)
            : item,
        );
      if (!visible.some(completed)) return visible;
      const byId = new Map(visible.map((item) => [item.id, item]));
      return [
        ...previous.flatMap((item) =>
          byId.has(item.id) ? [byId.get(item.id)!] : [],
        ),
        ...visible.filter((item) => !retained.has(item.id)),
      ];
    },
    [completed, retainCompleted],
  );
  const [list, setList] = useState(() => ({
    source: items,
    scope,
    rows: items.filter((item) => !completed(item)),
  }));
  if (list.source !== items || list.scope !== scope) {
    setList({
      source: items,
      scope,
      rows: reconcile(items, list.scope === scope ? list.rows : []),
    });
  }
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const leaving = new Set(list.rows.filter(completed).map((item) => item.id));
    for (const [id, timer] of timers.current) {
      if (!leaving.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 380;
    for (const id of leaving) {
      if (timers.current.has(id)) continue;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setList((current) => {
            const row = current.rows.find((item) => item.id === id);
            if (!row || !completed(row)) return current;
            return {
              ...current,
              rows: reconcile(
                current.source,
                current.rows.filter((item) => item.id !== id),
              ),
            };
          });
        }, delay),
      );
    }
  }, [list.rows, completed, reconcile]);
  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach(clearTimeout);
      active.clear();
    };
  }, []);
  return list.rows;
}
