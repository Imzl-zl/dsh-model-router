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
 *   DSH's `llm-retry`, which registers on the root plugin ctx without prepend.
 *   The Router registers OUTSIDE it (`prepend: true`, root ctx) and normally
 *   lets it act first — `await next()` — then honors, vetoes (budget spent) or
 *   replaces its decision. Since 2026-10-17 the Router decides the "candidate's
 *   budget is spent && this error should switch" case before asking llm-retry
 *   at all, so that same-route retry never happens (see index.ts and the note
 *   below).
 * - Cross-candidate failover and the total-attempt cap belong here.
 *
 * The recovery listener's two decision points ({@link decideBeforeInner} and
 * {@link decideAfterInner}) also live here: the seam in `index.ts` asks this
 * file both questions and applies the side effects the ruling declares, so
 * the branch table is testable without a boot.
 *
 * Note: 为何可服务性必须由 decideRecovery 在授权下一次发火之前判（C2 原文最小修法
 * 实测只是搬代价）—— 见 .agents/notes/implemented/2026-10-17-attempt-budget-two-layers.md
 */

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Candidate, ChainConfig, Strategy, SwitchOn } from './config.ts'
import { IMPLICIT_HOP_MAX_ATTEMPTS, switchOnKeyOf } from './defaults.ts'
import { routeKeyOf } from './routes.ts'
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
 * Build this step's chain: the user's own selection first, the configured
 * fallbacks after it.
 *
 * The first hop is the selected model and gets exactly one shot
 * ({@link IMPLICIT_HOP_MAX_ATTEMPTS}) — the chain exists to move ON, not to
 * retry the route the user already chose. A fallback that names the selected
 * route is dropped: it is already the first hop, and trying it twice would bill
 * the same channel twice for one request.
 *
 * Returns undefined when there is nothing to fall back to — an empty chain, or
 * one that only names the selected route. The plugin then stays out of the
 * request path entirely instead of imposing its one-shot cap on a request it
 * has nothing to add to.
 */
export function resolveChain(resolved: LlmCallConfig, chain: ChainConfig): StepChain | undefined {
  const selected = routeKeyOf(resolved.provider, resolved.model)
  const fallbacks = chain.candidates.filter(candidate => routeKeyOf(candidate.provider, candidate.model) !== selected)
  if (fallbacks.length === 0) return undefined
  const implicit: Candidate = {
    provider: resolved.provider,
    model: resolved.model,
    maxAttempts: IMPLICIT_HOP_MAX_ATTEMPTS,
    weight: 0,
  }
  const candidates = [implicit, ...fallbacks]
  return {
    candidates,
    // 用户可见编号：0 = 第一跳（他自己选的模型），1..N = 降级第几条。
    order: candidates.map((_, index) => index),
    switchOn: chain.switchOn,
    maxTotalAttempts: chain.maxTotalAttempts,
    stickyTurns: chain.stickyTurns,
    strategy: chain.strategy,
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
 *
 * The `exhausted` flag this sets is a FACT about the transition ("the last
 * candidate just hit its cap"), consumed by `decideRecovery` and by the
 * fall-back path; it is not what prevents the extra fire — that is
 * {@link canFireAgain}, checked before the next fire is authorized.
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
 * The unmet `needs` condition of one candidate, or undefined when it is
 * eligible for this request. An unmeasured projection is not a measured-large
 * one, so a `minContextTokens` gate treats absence as unmet.
 *
 * `images` is tri-state: `true` requires an image in the request, `false`
 * requires its absence — the pair that splits one chain into an image route
 * and a text route — and an absent value constrains nothing. Both directions
 * apply to every candidate: an explicit condition is the user's stated intent,
 * and skipping a candidate that fails it honors the configuration rather than
 * silently rerouting around it.
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

/**
 * Whether one more fire may happen at all: the current candidate still has
 * budget of its own, or there is a next candidate to move to.
 *
 * This is the C2 fix in one sentence. `planFire` learns that the last
 * candidate is capped only when it counts that fire — and by then the call
 * has already been dispatched (`index.ts` walks candidates from
 * `plan.state.index` and nothing reads `plan.state.exhausted` before
 * dispatching). The earliest decision point that can PREVENT a fire is
 * `decideRecovery`, which runs after a failure; asking it "may this happen
 * again" before it answers 'retry' is what makes the cap a real invariant.
 * A cap that only stops the fire after it has happened is not a cap.
 *
 * Layering: the `agent/request-error` handler decides the same condition
 * even earlier (before `await next()`, so llm-retry never runs at all — see
 * index.ts and open-questions 第五节第 2 项). This predicate is the pure
 * layer's own contract: `decideRecovery` must never authorize a fire that
 * cannot happen, whoever calls it. The two overlap in today's wiring and
 * that is deliberate — one is the seam's cost-avoidance, the other is the
 * decision layer's invariant.
 */
export function canFireAgain(state: StepState): boolean {
  const current = state.chain.candidates[state.index]!
  return state.attemptsOnCandidate < current.maxAttempts
    || state.index < state.chain.candidates.length - 1
}

export type RecoveryDecision = 'retry' | 'terminal'

/**
 * Decide what a delegated failure means for the chain. `llm-retry` consults
 * this plugin only after it gives up, so reaching here at all means the
 * same-route layer is finished with this failure.
 *
 * `canFireAgain` is checked before 'retry' is granted, not after: the guard
 * has to run before the fire it is meant to prevent, which is what makes the
 * per-candidate cap hold on the last candidate too.
 */
export function decideRecovery(state: StepState, code: string, aborted: boolean): RecoveryDecision {
  if (aborted) return 'terminal'
  // `exhausted` 与 `canFireAgain` 分工不同，不可互相取代：这个标记还服务
  // "整条链都服务不了、落回用户原路由"那条路径（index.ts 在 outgoing ===
  // undefined 时置位），那一步不消耗任何候选配额，canFireAgain 看不见它。
  if (state.exhausted) return 'terminal'
  if (!isSwitchOnEligible(state.chain, code)) return 'terminal'
  if (state.totalAttempts >= state.chain.maxTotalAttempts) return 'terminal'
  if (!canFireAgain(state)) return 'terminal'
  return 'retry'
}

/**
 * The outermost recovery listener's decision before llm-retry is consulted.
 *
 * `delegate` asks the inner layer (llm-retry / compaction) first — the only
 * shape where a same-route retry is still legitimate. `retry` and `terminate`
 * are the plugin's own decisions, taken without llm-retry at all: its backoff
 * and both durable `llm/retry` records never happen, and the record it would
 * have written names the provider the Router may redirect away from anyway.
 */
export type BeforeInnerRuling =
  | { readonly kind: 'delegate'; readonly record: false; readonly log: '' }
  | { readonly kind: 'retry'; readonly record: true; readonly log: string }
  | { readonly kind: 'terminate'; readonly record: true; readonly log: string }

/** What the inner layer decided, as the recovery listener sees it. */
export type InnerDecision = 'retry' | undefined

/**
 * The same decision after llm-retry answered. `honor` passes its retry
 * through untouched (the failure's outcome is not settled yet — llm-retry is
 * still retrying the same route). `terminate` ends the chain when the budget
 * is spent, and `retry` takes over when llm-retry gave up.
 */
export type AfterInnerRuling =
  | { readonly kind: 'honor'; readonly record: false; readonly log: '' }
  | { readonly kind: 'retry'; readonly record: true; readonly log: string }
  | { readonly kind: 'terminate'; readonly record: true; readonly log: string }

/**
 * The two decision points of `agent/request-error`, as pure rulings that
 * DECLARE their side effects — the handler in `index.ts` is an interpreter
 * that applies them.
 *
 * Why this shape: the handler used to grow one branch per case, each
 * attaching its own side effects, and the function's own comment ("whether to
 * record must not depend on which recovery path the failure takes") was
 * wider than the code — the veto branch lost its breaker record while its two
 * siblings kept theirs. That is not a branch to patch; it is the branch TABLE
 * that has no home. The rule, in one sentence: **a failure that takes the
 * current candidate OUT of rotation (switch away, cool it down, or end the
 * chain) is recorded; a failure whose outcome is not yet settled is not.**
 * The discriminated unions encode it — only `delegate` and `honor` may carry
 * `record: false` — and the unit suite asserts it across the whole table, so
 * the next branch added cannot silently drop the record again.
 *
 * `log` is the handler's warn line, built here so the copy is pinned by the
 * same tests as the decision (copy that drifts from behavior is this
 * project's recurring C4-class bug).
 *
 * Note: 五分支收编的来龙去脉（待办 4 是症状不是独立问题，被否的"补一行
 * noteBreaker()"方案）—— 见 .agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md
 */
export function decideBeforeInner(state: StepState, code: string, aborted: boolean): BeforeInnerRuling {
  const current = state.chain.candidates[state.index]!
  const route = routeKeyOf(current.provider, current.model)
  const attempt = `(attempt ${state.totalAttempts}/${state.chain.maxTotalAttempts})`
  // "本候选配额已尽 && 这个错该切换"是插件自己就能定的事：llm-retry 想给同一条
  // 路由第二次本身就是越权（用户配的"这条渠道最多真实调用多少次"已经用完）。
  if (aborted
    || state.attemptsOnCandidate < current.maxAttempts
    || !isSwitchOnEligible(state.chain, code)) {
    return { kind: 'delegate', record: false, log: '' }
  }
  const canAdvance = state.index < state.chain.candidates.length - 1
  if (canAdvance && state.totalAttempts < state.chain.maxTotalAttempts) {
    return {
      kind: 'retry',
      record: true,
      log: `model-router: ${code} on ${route} ${attempt}; this candidate's budget is spent, switching without llm-retry`,
    }
  }
  return {
    kind: 'terminate',
    record: true,
    log: `model-router: ${code} on ${route} ${attempt}; this candidate's budget is spent and the chain has nothing left, terminating without llm-retry`,
  }
}

/** {@link decideBeforeInner} 的姊妹：llm-retry 已经回答之后的裁决。 */
export function decideAfterInner(state: StepState, code: string, aborted: boolean, inner: InnerDecision): AfterInnerRuling {
  const current = state.chain.candidates[state.index]!
  const route = routeKeyOf(current.provider, current.model)
  if (inner === 'retry') {
    // 预算耗尽就否决内层的重试决定：用户配的"最多真实调用多少次"是硬承诺，
    // llm-retry 的同路由重试也不能越过它。终态同样记熔断——这一击已经把当前
    // 候选拿出轮换，记不记不该取决于恢复走哪条路。
    if (state.exhausted || state.totalAttempts >= state.chain.maxTotalAttempts) {
      return {
        kind: 'terminate',
        record: true,
        log: `model-router: attempt budget spent (${state.totalAttempts}/${state.chain.maxTotalAttempts}) on ${route}; terminating instead of retrying`,
      }
    }
    return { kind: 'honor', record: false, log: '' }
  }
  // 内层全部放弃：记录熔断，并决定是否跨候选继续。
  if (decideRecovery(state, code, aborted) === 'terminal') {
    return { kind: 'terminate', record: true, log: '' }
  }
  return {
    kind: 'retry',
    record: true,
    log: `model-router: ${code} on ${route} (attempt ${state.totalAttempts}/${state.chain.maxTotalAttempts}); continuing the chain`,
  }
}
