/**
 * Pure routing decisions for dsh-model-router.
 *
 * Everything here is a function of its arguments: the mutable cursor lives in
 * `state.ts` and is updated by returning new objects, so the decision logic
 * can be exercised without a Cordis context.
 *
 * The attempt budget has two layers with different owners, and this file only
 * owns the Router's layer:
 *
 * - Same-route retries (with backoff and `llm/retry` durable records) belong to
 *   DSH's `llm-retry`, which registers OUTSIDE this plugin on
 *   `agent/request-error` and retries before delegating. The Router cannot
 *   preempt it, so a retryable code burns llm-retry's per-provider budget
 *   first; `planFire` then redirects each further `agent/request` fire to the
 *   next candidate once the per-candidate cap is reached.
 * - Cross-candidate failover and the total-attempt cap belong here.
 */

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Candidate, DefaultProfile, Profile, SwitchOn } from './config.ts'
import { switchOnKeyOf } from './config.ts'
import type { StepState } from './state.ts'

/** The effective chain for one step: a snapshot, so mid-step config edits do not split it. */
export interface StepChain {
  readonly candidates: readonly Candidate[]
  readonly switchOn: SwitchOn
  readonly maxTotalAttempts: number
}

/**
 * Match the user's resolved route. A matched profile's chain starts at its
 * pinned `candidates[0]` (the `when` model). The default pool is pure
 * fallback: the user's own route is the implicit first hop with one attempt.
 * Returns undefined when this request is not the plugin's to route.
 */
export function resolveChain(
  resolved: LlmCallConfig,
  profiles: readonly Profile[],
  fallback: DefaultProfile,
): StepChain | undefined {
  for (const profile of profiles) {
    if (profile.when.provider === resolved.provider && profile.when.model === resolved.model) {
      return {
        candidates: profile.candidates,
        switchOn: profile.switchOn,
        maxTotalAttempts: profile.maxTotalAttempts,
      }
    }
  }
  if (!fallback.enabled || fallback.candidates.length === 0) return undefined
  const implicit: Candidate = { provider: resolved.provider, model: resolved.model, maxAttempts: 1 }
  return {
    candidates: [implicit, ...fallback.candidates],
    switchOn: fallback.switchOn,
    maxTotalAttempts: fallback.maxTotalAttempts,
  }
}

/** Open a step's cursor at the first candidate. */
export function startStep(turn: number, step: number, chain: StepChain): StepState {
  return { turn, step, chain, index: 0, attemptsOnCandidate: 0, totalAttempts: 0, exhausted: false }
}

export interface FirePlan {
  readonly state: StepState
  /** True when this fire moved to the next candidate (the notice trigger). */
  readonly advanced: boolean
  /** Index the fire moved away from, for the notice's "from" label. */
  readonly fromIndex: number
}

/**
 * Count one `agent/request` fire. Every attempt — including the retries
 * `llm-retry` schedules — passes through here, which is what makes the
 * per-candidate cap enforceable despite llm-retry owning same-route retries.
 *
 * `mayAdvance` gates the move: it is true only when the failure behind this
 * retry is `switchOn`-eligible. A capped-out candidate whose last failure is
 * not eligible stays put, so `llm-retry` burns its own budget and the recovery
 * listener terminates the chain — the user's "don't switch on this error"
 * choice holds even for codes llm-retry retries first.
 */
export function planFire(state: StepState, mayAdvance: boolean): FirePlan {
  const candidates = state.chain.candidates
  const current = candidates[state.index]!
  let index = state.index
  let exhausted = state.exhausted
  let advanced = false
  if (mayAdvance && state.attemptsOnCandidate >= current.maxAttempts) {
    if (index < candidates.length - 1) {
      index += 1
      advanced = true
    } else {
      exhausted = true
    }
  }
  return {
    state: {
      ...state,
      index,
      exhausted,
      attemptsOnCandidate: advanced ? 1 : state.attemptsOnCandidate + 1,
      totalAttempts: state.totalAttempts + 1,
    },
    advanced,
    fromIndex: state.index,
  }
}

/** Point the cursor at a candidate the pre-validation skipped. */
export function skipTo(state: StepState, index: number): StepState {
  return { ...state, index, attemptsOnCandidate: 1 }
}

/**
 * Whether a failure code may move the chain forward. One definition, two call
 * sites: the request handler gates its cap-driven advance on it (because
 * `llm-retry` preempts the recovery listener for retryable codes, an advance
 * must not bypass the user's `switchOn`), and `decideRecovery` gates its retry.
 */
export function isSwitchOnEligible(chain: StepChain, code: string): boolean {
  const key = switchOnKeyOf(code)
  return key !== undefined && chain.switchOn[key]
}

export type RecoveryDecision = 'retry' | 'terminal'

/**
 * Decide what a delegated failure means for the chain. `llm-retry` consults
 * this plugin only after it gives up, so reaching here at all means the
 * same-route layer is finished with this failure.
 */
export function decideRecovery(state: StepState, code: string, aborted: boolean): RecoveryDecision {
  if (aborted) return 'terminal'
  if (state.exhausted) return 'terminal'
  if (!isSwitchOnEligible(state.chain, code)) return 'terminal'
  if (state.totalAttempts >= state.chain.maxTotalAttempts) return 'terminal'
  return 'retry'
}
