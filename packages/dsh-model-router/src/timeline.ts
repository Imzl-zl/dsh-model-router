/**
 * The channel-health timeline window: one rule, two consumers, and the bucketing
 * the UI draws.
 *
 * The host fold (`health.ts`) appends to it while events flow; the browser half
 * (`client/controller.ts`) merges per-session records into one global record;
 * the dashboard (`client/health-ui.ts`) buckets what survived into bars. All
 * three must agree on the window, or the bars the user sees and the rate
 * computed beside them would be measuring different sets.
 *
 * Why buckets and not "the newest N observations": one observation is one real
 * call, and calls are not evenly spaced in time. A chain that fires twice a day
 * and one that fires twice a minute produced the same picture — 24 bars of
 * unknown span, with no way to tell "was down for ten minutes" from "was down
 * for a week". A fixed bar count over a configurable bucket length makes the
 * window a fact the user can read off the screen, and makes the bar height mean
 * one thing: the success rate inside that bucket.
 *
 * Observations are kept with their timestamps, so changing the bucket length
 * re-buckets history that is already there instead of starting over.
 */

/** How many bars the timeline draws. The window is this times the bucket length. */
export const TIMELINE_BAR_COUNT = 24

/**
 * One bar's width, in seconds. The only configurable part of the window: a
 * channel that flaps every few minutes and one that degrades over an hour need
 * different resolutions, and the honest default is the middle of that range.
 */
export const DEFAULT_TIMELINE_BUCKET_SECONDS = 600

/** The bucket lengths offered, in seconds: 1 / 5 / 10 / 30 / 60 minutes. */
export const TIMELINE_BUCKET_SECONDS: readonly number[] = [60, 300, 600, 1800, 3600]

/**
 * How long an observation stays foldable, in seconds.
 *
 * The window a user can look at is `TIMELINE_BAR_COUNT` times the longest
 * bucket (24 × 60 min = 24 h); anything older can never be drawn again, so
 * keeping it would only grow the persisted projection forever.
 */
export const TIMELINE_RETENTION_SECONDS = 24 * 60 * 60

/**
 * The hard cap on stored observations per route, whatever the retention window
 * allows. A route that is called thousands of times inside the window would
 * otherwise keep every point; the newest ones are the ones the bars show.
 */
export const TIMELINE_MAX_POINTS = 600

/** What the bucketing needs from an observation: when it happened, and how it went. */
export interface TimelineObservation {
  time: number
  status: string
}

/** One drawn bar: the bucket it covers, what happened inside it, and its score. */
export interface TimelineBucket {
  /** Bucket start, epoch ms, inclusive. */
  start: number
  /** Bucket end, epoch ms, exclusive. */
  end: number
  /** Observations inside the bucket. */
  count: number
  healthy: number
  degraded: number
  unhealthy: number
  /**
   * `(healthy + degraded / 2) / count`, or `undefined` when the bucket holds no
   * observation. A throttle is not a success and not a failure — scoring it
   * half is what keeps one 429 from painting a working channel red while still
   * being visible in the height.
   */
  successRate?: number
}

/**
 * The tone one bucket's bar is drawn in: `unknown` for a bucket with no
 * observation, so the UI renders it as "no data" rather than as a fault.
 */
export function bucketTone(bucket: TimelineBucket): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
  if (bucket.successRate === undefined) return 'unknown'
  if (bucket.successRate >= 0.99) return 'healthy'
  if (bucket.successRate >= 0.9) return 'degraded'
  return 'unhealthy'
}

/**
 * Bucket an ordered timeline into {@link TIMELINE_BAR_COUNT} bars ending at the
 * bucket that contains `now`.
 *
 * Bars are aligned to the bucket grid rather than to `now`, so the same
 * observation lands in the same bar on two renders a second apart — a sliding
 * window would make the bars twitch while nothing happened.
 *
 * @param points - observations, any order.
 * @param bucketSeconds - one bar's width.
 * @param now - epoch ms the window ends at.
 */
export function bucketTimeline(
  points: readonly TimelineObservation[],
  bucketSeconds: number,
  now: number,
): TimelineBucket[] {
  const width = Math.max(1, Math.round(bucketSeconds)) * 1000
  const end = Math.floor(now / width) * width + width
  const start = end - TIMELINE_BAR_COUNT * width
  const bars: TimelineBucket[] = []
  for (let index = 0; index < TIMELINE_BAR_COUNT; index += 1) {
    bars.push({
      start: start + index * width,
      end: start + (index + 1) * width,
      count: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
    })
  }
  for (const point of points) {
    if (point.time < start || point.time >= end) continue
    const bar = bars[Math.floor((point.time - start) / width)]!
    bar.count += 1
    if (point.status === 'healthy') bar.healthy += 1
    else if (point.status === 'degraded') bar.degraded += 1
    else bar.unhealthy += 1
  }
  for (const bar of bars) {
    if (bar.count === 0) continue
    bar.successRate = Math.round(((bar.healthy + bar.degraded / 2) / bar.count) * 1000) / 1000
  }
  return bars
}

/**
 * Keep an appended timeline inside both bounds: the retention window, measured
 * from the newest observation, and {@link TIMELINE_MAX_POINTS} entries.
 *
 * The window is measured from the newest point rather than from the wall clock
 * because a session folded hours after its events still holds the newest
 * observation of that route; measuring from `Date.now()` would drop a whole
 * session's history the first time an old session is re-folded.
 *
 * The input is sorted first, so "the newest N" does not depend on the caller's
 * ordering: the host appends chronologically, but the browser merges records
 * from many sessions and an out-of-order array would otherwise silently keep
 * the oldest points instead of the newest.
 */
export function pruneTimeline<T extends TimelineObservation>(points: readonly T[]): T[] {
  if (points.length === 0) return []
  const ordered = points.slice().sort((left, right) => left.time - right.time)
  const newest = ordered[ordered.length - 1]!.time
  const oldest = newest - TIMELINE_RETENTION_SECONDS * 1000
  const kept = ordered.filter(point => point.time >= oldest)
  return kept.length > TIMELINE_MAX_POINTS ? kept.slice(-TIMELINE_MAX_POINTS) : kept
}
