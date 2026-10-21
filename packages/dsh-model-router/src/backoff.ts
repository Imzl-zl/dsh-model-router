/**
 * How long to wait before one same-route retry, and how to wait for it.
 *
 * The router executes its own retries (see docs/design/retry-budget-ownership.md),
 * so it also owes the wait that `llm-retry` used to provide. The curve is copied from
 * `packages/llm/llm/src/retry-policy.ts` on purpose: a provider must not behave
 * differently depending on whether the Router or DSH drove the retry.
 *
 * Note: 谁是重试执行者、为何插件独占 —— 见
 * docs/design/retry-budget-ownership.md
 */

import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'

/** DSH's own defaults (`packages/llm/llm/src/retry-policy.ts:14-17`), used only when no policy is reachable. */
const FALLBACK_INITIAL_DELAY_MS = 500
const FALLBACK_MAX_DELAY_MS = 10_000
const FALLBACK_JITTER_RATIO = 0.1

/** What the next attempt on this route should do, or why it must not happen. */
export type BackoffPlan =
  | { readonly kind: 'wait'; readonly delayMs: number }
  /**
   * The server asked for a longer wait than the policy's ceiling. DSH's normal
   * policy gives up here instead of shortening the server's instruction
   * (`llm-retry/src/index.ts:226-233`), and the Router does the same: an
   * explicit `Retry-After` is a fact about the channel, not a suggestion to
   * compress.
   */
  | { readonly kind: 'give-up' }

/**
 * @param policy - the provider's resolved policy, or undefined when the route has no registration.
 * @param retry - 1-based count of the retry about to happen (first retry = 1).
 * @param retryAfterMs - the server's explicit wait, when the failure carried one.
 * @param random - jitter sample in [0, 1), injectable for deterministic tests.
 */
export function planBackoff(
  policy: ResolvedRetryPolicy | undefined,
  retry: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): BackoffPlan {
  const initialDelayMs = policy?.initialDelayMs ?? FALLBACK_INITIAL_DELAY_MS
  const maxDelayMs = policy?.maxDelayMs ?? FALLBACK_MAX_DELAY_MS
  const jitterRatio = policy?.jitterRatio ?? FALLBACK_JITTER_RATIO
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    if (retryAfterMs > maxDelayMs) return { kind: 'give-up' }
    return { kind: 'wait', delayMs: retryAfterMs }
  }
  const exponent = Math.min(Math.max(0, retry - 1), 1024)
  const exponential = Math.min(initialDelayMs * 2 ** exponent, maxDelayMs)
  const jitter = 1 - jitterRatio + 2 * jitterRatio * random()
  return { kind: 'wait', delayMs: Math.min(exponential * jitter, maxDelayMs) }
}

/**
 * Wait for one backoff, giving up when the caller cancels.
 *
 * @param delayMs - how long to wait.
 * @param signal - the attempt's cancellation; aborting resolves the wait early.
 * @returns true when the wait completed, false when it was cancelled — the
 *   caller must not retry in the false case, and must not report the channel as
 *   the reason either.
 */
export function waitBeforeRetry(delayMs: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(false)
  if (!(delayMs > 0)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
