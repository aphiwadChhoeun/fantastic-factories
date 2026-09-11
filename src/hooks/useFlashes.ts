"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ids that are briefly lit, and a way to light one.
 *
 * Something that just happened is worth pointing at for a moment and then
 * forgetting. Holding that in state rather than firing an animation directly
 * keeps the board declarative: a card does not need to be told it flashed, it
 * only needs to know whether it is lit right now.
 */
export function useFlashes(ms: number): readonly [ReadonlySet<string>, (id: string) => void] {
  const [lit, setLit] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // A game abandoned mid-flash must not come back to set state on nothing.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const flash = useCallback(
    (id: string) => {
      const running = timers.current.get(id);
      if (running) clearTimeout(running);

      setLit((current) => (current.has(id) ? current : new Set(current).add(id)));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setLit((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }, ms),
      );
    },
    [ms],
  );

  return [lit, flash];
}
