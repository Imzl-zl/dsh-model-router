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
import type { Candidate, DefaultProfile, Profile, Strategy, SwitchOn } from './config.ts'
import { switchOnKeyOf } from './defaults.ts'
import type { StepChain, StepConditions, StepState } from './state.ts'

/**
 * 本步从哪条候选开始。
 *
 * 三种策略只决定起点，失败之后都继续试完其余渠道——`planFire` 的前进逻辑因此
 * 完全不用知道策略存在。`weight` 为 0 的候选永远不会被抽中，但仍可能在别的候选
 * 失败后被试到；一个正权重都没有时退回第一条，让错误在加载时就被 `assertStructural`
 * 抓到，而不是在这里静默发生。
 */
export function resolveStartIndex(
  candidates: readonly { weight?: number }[],
  strategy: Strategy,
  cursor: number,
): number {
  if (candidates.length <= 1) return 0
  if (strategy === 'round-robin') return ((cursor % candidates.length) + candidates.length) % candidates.length
  if (strategy !== 'weight') return 0
  const weights = candidates.map(candidate => Math.max(0, candidate.weight ?? 0))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return 0
  let draw = Math.random() * total
  for (let index = 0; index < weights.length; index += 1) {
    draw -= weights[index]!
    if (draw < 0) return index
  }
  return weights.length - 1
}

/** Rotate a list so `start` becomes the head, wrapping to cover the rest. */
export function rotate<T>(list: readonly T[], start: number): T[] {
  if (list.length === 0) return []
  const at = ((start % list.length) + list.length) % list.length
  return [...list.slice(at), ...list.slice(0, at)]
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
        order: profile.candidates.map((_, index) => index),
        switchOn: profile.switchOn,
        maxTotalAttempts: profile.maxTotalAttempts,
        stickyTurns: profile.stickyTurns,
        strategy: profile.strategy,
      }
    }
  }
  if (!fallback.enabled || fallback.candidates.length === 0) return undefined
  const implicit: Candidate = { provider: resolved.provider, model: resolved.model, maxAttempts: 1, weight: 0 }
  return {
    candidates: [implicit, ...fallback.candidates],
    order: [0, ...fallback.candidates.map((_, index) => index + 1)],
    switchOn: fallback.switchOn,
    maxTotalAttempts: fallback.maxTotalAttempts,
    stickyTurns: fallback.stickyTurns,
    strategy: fallback.strategy,
  }
}

/** Open a step's cursor at the strategy's start, with the step's frozen conditions. */
export function startStep(turn: number, step: number, chain: StepChain, conditions: StepConditions, start: number): StepState {
  // 策略只改起点，所以把链旋转到从 start 开始即可——`planFire` 的前进逻辑看
  // 不到策略的存在。`order` 一起旋转，界面和通知因此仍说用户自己排的编号。
  return {
    turn,
    step,
    chain: { ...chain, candidates: rotate(chain.candidates, start), order: rotate(chain.order, start) },
    conditions,
    index: 0,
    attemptsOnCandidate: 0,
    totalAttempts: 0,
    exhausted: false,
  }
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

/**
 * The canonical has-image check over admitted user messages: any content block
 * of type `image`, mirroring the llm layer's own text-model projection rule
 * (`llm/src/index.ts` projects images to handle text when the route declares no
 * image modality).
 */
export function hasImageContent(messages: readonly { content: readonly { type: string }[] }[]): boolean {
  return messages.some(message => message.content.some(block => block.type === 'image'))
}

/**
 * Whether one durable `tool/result` event carries an image into the
 * conversation. `read_image`'s outcome arrives as an image block nested inside
 * a tool-result block, not at the message's top level — the request that
 * follows the tool call is the first one an image gate can see it in.
 */
export function toolResultHasImage(data: unknown): boolean {
  const message = (data as { message?: { content?: unknown } } | undefined)?.message
  const blocks = message?.content
  if (!Array.isArray(blocks)) return false
  return blocks.some(block => {
    const typed = block as { type?: unknown; content?: unknown }
    if (typed.type === 'image') return true
    if (!Array.isArray(typed.content)) return false
    return typed.content.some(inner => (inner as { type?: unknown }).type === 'image')
  })
}

/**
 * Whether a candidate is eligible for this request's shape: the negation of
 * {@link unmetCondition}.
 */
export function conditionsMet(candidate: Candidate, conditions: StepConditions): boolean {
  return unmetCondition(candidate, conditions) === undefined
}

/**
 * The unmet `needs` condition of one candidate, or undefined when it is
 * eligible for this request. An unmeasured projection is not a measured-large
 * one, so a `minContextTokens` gate treats absence as unmet.
 *
 * `images` is tri-state: `true` requires an image in the request, `false`
 * requires its absence — the pair that splits one chain into an image route
 * and a text route — and an absent value constrains nothing. Both directions
 * apply to every candidate including a matched profile's pinned `candidates[0]`:
 * an explicit condition is the user's stated intent, and skipping a primary
 * that fails it is honoring the configuration, not a silent reroute.
 *
 * Note: 为什么文本模型能在 DSH 里勾识图、靠路由兜底 —— 见
 * .agents/notes/implemented/2026-10-14-image-route-conditions-and-admission-gate-boundary.md
 */
export function unmetCondition(candidate: Candidate, conditions: StepConditions): string | undefined {
  if (candidate.needs?.images === true && !conditions.hasImages) return '需图片输入'
  if (candidate.needs?.images === false && conditions.hasImages) return '本请求包含图片'
  const min = candidate.needs?.minContextTokens
  if (min !== undefined && min > 0) {
    const projected = conditions.projectedTokens
    if (projected === undefined || projected < min) return `需预估上下文 ≥ ${min} tokens`
  }
  return undefined
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
