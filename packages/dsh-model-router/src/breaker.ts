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
 *
 * Blocks are keyed at two granularities, and a rule picks one per failure:
 * route (`provider/model`) for faults that belong to one model, channel
 * (`provider`) for faults that belong to the key or the gateway. The split is
 * measured: inside one gateway channel the models fail independently (a route
 * block keeps the healthy siblings in rotation), while a dead key or a down
 * gateway fails every model identically — a route-only block there makes the
 * chain spend one real attempt per sibling before it crosses channels, which is
 * exactly the attempt budget the user configured.
 *
 * Note: scope 字段的取舍与实测依据 —— 见
 * .agents/notes/implemented/2026-10-15-breaker-channel-scope.md
 */

import type { BreakRule, BreakerScope } from './config.ts'
import { routeKeyOf } from './health.ts'

/** One matched rule: how long to cool down, and at which granularity. */
export interface BreakVerdict {
  readonly seconds: number
  readonly scope: BreakerScope
}

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
): BreakVerdict | undefined {
  for (const rule of rules) {
    if (rule.code.length > 0 && rule.code !== code) continue
    if (rule.message.length > 0 && !message.includes(rule.message)) continue
    return { seconds: rule.cooldownSeconds, scope: rule.scope }
  }
  return undefined
}

/** One route's standing block: when it lifts, and which rule granularity binds it. */
export interface RouteBlock {
  readonly until: number
  readonly scope: BreakerScope
}

export class CircuitBreaker {
  /** Route → the epoch ms at which its block lifts. Expired entries are swept. */
  private readonly routeBlocks = new Map<string, number>()
  /** Provider → the epoch ms at which every route under it lifts. */
  private readonly channelBlocks = new Map<string, number>()

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
  ): RouteBlock | undefined {
    const verdict = matchBreakRule(code, message, rules)
    if (verdict === undefined) return undefined
    const until = now + verdict.seconds * 1000
    if (verdict.scope === 'channel') this.channelBlocks.set(provider, until)
    else this.routeBlocks.set(routeKeyOf(provider, model), until)
    return { until, scope: verdict.scope }
  }

  /**
   * The route's block, when it is still in force. A route is servable only once
   * BOTH its own block and its channel's block have lifted, so the answer is the
   * later of the two; `scope` names the one that binds, so the notice can say
   * which kind of cooldown the user is looking at.
   */
  blockedUntil(provider: string, model: string, now: number): RouteBlock | undefined {
    const route = this.routeBlocks.get(routeKeyOf(provider, model)) ?? 0
    const channel = this.channelBlocks.get(provider) ?? 0
    if (channel >= route) return channel > now ? { until: channel, scope: 'channel' } : undefined
    return route > now ? { until: route, scope: 'route' } : undefined
  }

  /** Drop expired entries so a long-lived process does not grow without bound. */
  sweep(now: number): void {
    for (const [route, until] of this.routeBlocks) {
      if (until <= now) this.routeBlocks.delete(route)
    }
    for (const [provider, until] of this.channelBlocks) {
      if (until <= now) this.channelBlocks.delete(provider)
    }
  }
}
