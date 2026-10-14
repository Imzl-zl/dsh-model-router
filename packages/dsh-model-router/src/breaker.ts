/**
 * Circuit breaker: take a channel out of rotation for a while after it fails
 * in a way the user said should disqualify it.
 *
 * DSH core has nothing to reuse here — `llm-retry` counts retries per
 * (provider, policyKey) but clears them at `step/start` and `turn/end`, which is
 * explicitly per-request state, not cross-request health. So the router owns this.
 *
 * Two deliberate choices:
 *
 * - A block always expires. A permanent blacklist would turn one transient fault
 *   into a channel the user has to remember to re-enable, and the cooldown is the
 *   only thing standing between "this gateway is down" and "this gateway is dead
 *   forever". After it expires the next request really tries the channel again,
 *   and a fresh failure re-arms the block.
 * - State is in memory, so a config save (which restarts the whole plugin fiber)
 *   clears every block. That is accepted rather than hidden: the alternative is a
 *   disk write per failure, and the reset costs one re-probe.
 */

import type { BreakRule } from './config.ts'
import { routeKeyOf } from './health.ts'

/**
 * The cooldown one failure earns, or `undefined` when no rule matches it.
 *
 * The first matching rule wins, so a user who lists a broad rule before a narrow
 * one gets the broad one — the rules are ordered, like every other list here.
 */
export function matchBreakRule(
  code: string,
  message: string,
  rules: readonly BreakRule[],
): number | undefined {
  for (const rule of rules) {
    if (rule.code.length > 0 && rule.code !== code) continue
    if (rule.message.length > 0 && !message.includes(rule.message)) continue
    return rule.cooldownSeconds
  }
  return undefined
}

export class CircuitBreaker {
  /** Route → the epoch ms at which its block lifts. Expired entries are swept. */
  private readonly blocks = new Map<string, number>()

  /**
   * Record one failure. Returns the block it earned, or `undefined` when no rule
   * matched — a failure that does not disqualify the channel changes nothing.
   */
  note(
    provider: string,
    model: string,
    code: string,
    message: string,
    rules: readonly BreakRule[],
    now: number,
  ): { until: number } | undefined {
    const seconds = matchBreakRule(code, message, rules)
    if (seconds === undefined) return undefined
    const until = now + seconds * 1000
    this.blocks.set(routeKeyOf(provider, model), until)
    return { until }
  }

  /** The route's block, when it is still in force. */
  blockedUntil(provider: string, model: string, now: number): number | undefined {
    const until = this.blocks.get(routeKeyOf(provider, model))
    return until !== undefined && until > now ? until : undefined
  }

  /** Drop expired entries so a long-lived process does not grow without bound. */
  sweep(now: number): void {
    for (const [route, until] of this.blocks) {
      if (until <= now) this.blocks.delete(route)
    }
  }
}
