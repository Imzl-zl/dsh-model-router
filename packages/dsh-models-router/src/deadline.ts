/**
 * One hard deadline, fusing the caller's cancellation with our own timeout.
 *
 * Two callers need the same three facts — a signal the adapter can watch, a way
 * to tell "our deadline fired" apart from "the caller hung up", and a promise
 * that guarantees *our* side settles even if the adapter never answers. They
 * also need them in the same order, because that order is the classification:
 * a timeout is a fact about the channel, a caller abort is not.
 *
 * Written by hand rather than with DSH's disposable `deadline()` primitive:
 * `using` is syntax the source-mode loader cannot parse, and both modules must
 * load from source in the headless composition (see ./probe.ts).
 *
 * Note: 为何必须有 deadline、为何要 race 而不只 abort —— 见
 * .agents/notes/implemented/2026-10-21-connectivity-deadline-and-honest-history.md
 */

/** Raised as the abort reason when our own deadline fires. */
export class DeadlineExceeded extends Error {
  // Explicit fields, not a parameter property: the source-mode loader strips
  // types without transforming, and rejects parameter properties outright.
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`the deadline of ${timeoutMs}ms expired`)
    this.name = 'DeadlineExceeded'
    this.timeoutMs = timeoutMs
  }
}

export interface FusedDeadline {
  /** The signal to hand the adapter: aborts on either the caller or the deadline. */
  readonly signal: AbortSignal
  /** True only when our own timer is what aborted the signal. */
  expired(): boolean
  /**
   * Rejects when our own deadline fires, and never settles otherwise.
   *
   * Racing this against the adapter call is what makes "our side always
   * settles" an invariant rather than a hope: an adapter that ignores its
   * signal would otherwise hang the caller for as long as it likes — which,
   * for the connectivity check, means the UI's busy flag never clears and every
   * later run becomes a no-op.
   */
  readonly whenExpired: Promise<never>
  /** Clears the timer and detaches from the caller's signal. Always call it. */
  dispose(): void
}

/**
 * @param signal - the caller's cancellation, or undefined when nobody cancels.
 * @param timeoutSeconds - the hard cap; a non-positive value disables it.
 */
export function fuseDeadline(signal: AbortSignal | undefined, timeoutSeconds: number): FusedDeadline {
  const controller = new AbortController()
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onUpstreamAbort = (): void => { abort(signal?.reason) }
  if (signal !== undefined) {
    if (signal.aborted) abort(signal.reason)
    else signal.addEventListener('abort', onUpstreamAbort, { once: true })
  }
  let timedOut = false
  let rejectExpired: (reason: unknown) => void = () => {}
  const whenExpired = new Promise<never>((_resolve, reject) => { rejectExpired = reject })
  // A caller that does not race this promise (the probe reads `expired()` and the
  // aborted signal instead) must not crash the process when the deadline fires:
  // an unobserved rejection is a fatal error in Node. Attaching this handler only
  // marks the rejection as observed — every racer still receives it.
  void whenExpired.catch(() => {})
  const timer = timeoutSeconds > 0
    ? setTimeout(() => {
        // The caller's abort wins if it already happened: a deadline that fires
        // after it must not reclassify "we stopped asking" as the channel's fault.
        if (controller.signal.aborted) return
        timedOut = true
        const reason = new DeadlineExceeded(timeoutSeconds * 1000)
        controller.abort(reason)
        rejectExpired(reason)
      }, timeoutSeconds * 1000)
    : undefined
  return {
    signal: controller.signal,
    expired: () => timedOut,
    whenExpired,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onUpstreamAbort)
    },
  }
}
