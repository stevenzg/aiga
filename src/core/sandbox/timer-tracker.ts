/**
 * Timer tracking for sandbox cleanup (JS-10).
 *
 * Wraps setTimeout, setInterval, and requestAnimationFrame to track
 * active IDs, enabling cleanup when the sandbox is revoked.
 */

export interface TimerTracker {
  setTimeout: (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
  setInterval: (...args: Parameters<typeof globalThis.setInterval>) => ReturnType<typeof globalThis.setInterval>;
  clearInterval: (id: ReturnType<typeof globalThis.setInterval>) => void;
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  /** Clear all tracked timers. */
  clearAll: () => void;
}

export function createTimerTracker(): TimerTracker {
  const timeouts = new Set<ReturnType<typeof globalThis.setTimeout>>();
  const intervals = new Set<ReturnType<typeof globalThis.setInterval>>();
  const rafs = new Set<number>();

  return {
    setTimeout(...args) {
      const id = setTimeout(...args);
      timeouts.add(id);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
      clearTimeout(id);
    },
    setInterval(...args) {
      const id = setInterval(...args);
      intervals.add(id);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
      clearInterval(id);
    },
    requestAnimationFrame(cb) {
      const id = requestAnimationFrame(cb);
      rafs.add(id);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
      cancelAnimationFrame(id);
    },
    clearAll() {
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const id of intervals) clearInterval(id);
      intervals.clear();
      for (const id of rafs) cancelAnimationFrame(id);
      rafs.clear();
    },
  };
}
