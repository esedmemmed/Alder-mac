/*
 * A controllable clock for tests: timers fire only when the test advances time, in order, with the promise
 * microtasks they cause settled in between. Used by the AVPlay mock (player tests, Phase 3) and by any code that takes
 * injected `timers`.
 *
 *   const clock = createFakeClock();
 *   const avplay = createAvplayMock({ clock });
 *   await clock.advance(1500);
 */
const nextMacrotask = () => new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));

export function createFakeClock(start = 0) {
  let current = start;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn, every, order }

  function add(fn, ms, every) {
    const id = ++seq;
    timers.set(id, { at: current + Math.max(0, Number(ms) || 0), fn, every, order: id });
    return id;
  }

  function nextDue(limit) {
    let best = null;
    for (const [id, t] of timers) {
      if (t.at > limit) continue;
      if (!best || t.at < best.t.at || (t.at === best.t.at && t.order < best.t.order)) best = { id, t };
    }
    return best;
  }

  const clock = {
    now: () => current,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, Number(ms) || 1)),
    clearInterval: (id) => { timers.delete(id); },
    /** Moves time forward by [ms], running every timer that falls due on the way. Await it. */
    async advance(ms) {
      const target = current + ms;
      await nextMacrotask(); // anything already queued as a promise goes first
      for (;;) {
        const due = nextDue(target);
        if (!due) break;
        const { id, t } = due;
        current = Math.max(current, t.at);
        if (t.every) { t.at += t.every; t.order = ++seq; } else timers.delete(id);
        t.fn();
        await nextMacrotask();
      }
      current = target;
      await nextMacrotask();
    },
    /** Runs timers due right now and settles promises (advance(0)). */
    flush: () => clock.advance(0),
    pending: () => timers.size,
  };
  return clock;
}

export const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};
