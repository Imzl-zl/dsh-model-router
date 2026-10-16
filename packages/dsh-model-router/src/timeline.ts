/**
 * The channel-health timeline window: one rule, two consumers.
 *
 * The host fold (`health.ts`) appends to it while events flow; the browser half
 * (`client/controller.ts`) merges per-session records into one global record.
 * Both must agree on the window, or the sparkline the user sees and the
 * availability rate computed beside it would be measuring different sets.
 */

/** How many observations a route's timeline keeps: the newest ones. */
export const MAX_TIMELINE_POINTS = 24

/** Keep the newest {@link MAX_TIMELINE_POINTS} entries of an ordered timeline. */
export function capTimeline<T>(points: readonly T[]): T[] {
  return points.length > MAX_TIMELINE_POINTS ? points.slice(-MAX_TIMELINE_POINTS) : [...points]
}
