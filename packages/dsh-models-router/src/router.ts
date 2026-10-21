/**
 * Pure routing decisions for dsh-models-router.
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
 *   lets it act first — `await next()` — then honors or replaces its decision.
 *   Since 2026-10-17 the Router decides the "candidate's budget is spent && this
 *   error should switch" case before asking llm-retry at all, so that same-route
 *   retry never happens (see index.ts and the note below).
 * - Cross-candidate failover belongs here. The count is per candidate and comes
 *   from the config as retries (`maxRetries`), converted to calls once in
 *   `resolveChain`. There is no request-wide cap: the chain's own candidates and
 *   the per-candidate budgets bound the step (decided 2026-10-20).
 *
 * The recovery listener's two decision points ({@link decideBeforeInner} and
 * {@link decideAfterInner}) also live here: the seam in `index.ts` asks this
 * file both questions and applies the side effects the ruling declares, so
 * the branch table is testable without a boot.
 *
 * Note: 为何可服务性必须由 decideRecovery 在授权下一次发火之前判（C2 原文最小修法
 * 实测只是搬代价）—— 见 .agents/notes/implemented/2026-10-17-attempt-budget-two-layers.md
 * Note: 为何删掉整请求总上限、改回「每条候选重试几次」 —— 见
 * .agents/notes/implemented/2026-10-20-retries-per-candidate.md
 */

import type { LlmCallConfig, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { planBackoff } from './backoff.ts'
import type { ChainConfig, Strategy, SwitchOn } from './config.ts'
import { switchOnKeyOf } from './defaults.ts'
import { routeKeyOf } from './routes.ts'
import type { StepCandidate, StepChain, StepConditions, StepState } from './state.ts'

/**
 * 本步从哪条**降级候选**开始。
 *
 * 第一跳永远是用户当前选中的模型、永远先试；策略只决定它失败之后从降级候选的
 * 哪一条开始。`planFire` 的前进逻辑因此完全不用知道策略存在。`weight` 为 0 的
 * 候选永远不会被抽中，但仍可能在别的候选失败后被试到；一个正权重都没有时退回
 * 第一条，让错误在加载时就被 `assertStructural` 抓到，而不是在这里静默发生。
 *
 * @param candidates - the fallbacks only (the implicit first hop is not in this list).
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
 * This is the ONE place the config's vocabulary becomes the step's: retries
 * (`maxRetries` / `firstHopMaxRetries`, or the session's per-route override)
 * become call counts (`retries + 1`), because that is what `planFire` counts.
 * No other module adds or subtracts that one. The first hop is the selected
 * model; the chain exists to move ON, and same-route retries belong to the
 * plugin since 2026-10-21; the plugin only decides how many fires it will allow
 * on that hop. A fallback that names the selected route is dropped: it is
 * already the first hop, and trying it twice would bill the same channel twice
 * for one request.
 *
 * `retries` carries the session's overrides, keyed by route. It is a lookup
 * table, not a merge: a route it does not name keeps the candidate's own count.
 *
 * Returns undefined when there is nothing to fall back to — an empty chain, or
 * one that only names the selected route. The plugin then stays out of the
 * request path entirely instead of imposing its budgets on a request it has
 * nothing to add to.
 *
 * Note: 首跳尝试次数与 DSH 原生重试协调 —— 见
 * .agents/notes/implemented/2026-10-19-first-hop-attempts-and-dsh-retry-coordination.md
 * Note: 会话覆盖与候选次数的取值顺序（`??` 而不是 `||`）—— 见
 * .agents/notes/implemented/2026-10-21-per-session-bindings.md
 */
export function resolveChain(
  resolved: LlmCallConfig,
  chain: ChainConfig,
  retries: Readonly<Record<string, number>> = {},
): StepChain | undefined {
  const selected = routeKeyOf(resolved.provider, resolved.model)
  const fallbacks = chain.candidates.filter(candidate => routeKeyOf(candidate.provider, candidate.model) !== selected)
  if (fallbacks.length === 0) return undefined
  const implicit: StepCandidate = {
    provider: resolved.provider,
    model: resolved.model,
    maxAttempts: attemptBudget(retries, selected, chain.firstHopMaxRetries),
    weight: 0,
  }
  const candidates: StepCandidate[] = [
    implicit,
    ...fallbacks.map(candidate => ({
      provider: candidate.provider,
      model: candidate.model,
      maxAttempts: attemptBudget(retries, routeKeyOf(candidate.provider, candidate.model), candidate.maxRetries),
      weight: candidate.weight,
      ...(candidate.needs === undefined ? {} : { needs: candidate.needs }),
    })),
  ]
  return {
    candidates,
    // 用户可见编号：0 = 第一跳（他自己选的模型），1..N = 降级第几条。
    order: candidates.map((_, index) => index),
    switchOn: chain.switchOn,
    stickyTurns: chain.stickyTurns,
    strategy: chain.strategy,
  }
}

/**
 * How many real calls one candidate may take: the session's override for this
 * route when it names one, otherwise the candidate's own `maxRetries`; both are
 * "retries after the first call", so this is the `+1`.
 *
 * `??` and not `||`: an override of 0 is a choice ("do not retry here"), and
 * must not be read as "unset". The key is DSH's own route identity
 * (`provider/model`, ./routes.ts), which is what the browser lists.
 */
function attemptBudget(overrides: Readonly<Record<string, number>>, route: string, configRetries: number): number {
  return (overrides[route] ?? configRetries) + 1
}

/**
 * Open a step's cursor at the strategy's start, with the step's frozen conditions.
 *
 * The first hop (the user's selected model) always stays at index 0 — selecting a
 * model means "try this one first", and a start strategy must not silently
 * overrule that. The strategy rotates only the fallbacks after it: `start` is an
 * index into that fallback list. `order` rotates with the fallbacks, so the
 * interface and the notice still speak the user's own numbering (the first hop
 * stays 0).
 */
export function startStep(turn: number, step: number, chain: StepChain, conditions: StepConditions, start: number): StepState {
  const head = chain.candidates[0]
  const headOrder = chain.order[0]
  const candidates = head === undefined ? [] : [head, ...rotate(chain.candidates.slice(1), start)]
  const order = headOrder === undefined ? [] : [headOrder, ...rotate(chain.order.slice(1), start)]
  return {
    turn,
    step,
    chain: { ...chain, candidates, order },
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
 * `pendingAdvance` is the recovery layer's explicit intent: `true` only for a
 * ruling that means "the next fire lands on the next candidate", `false` while
 * llm-retry owns a same-route retry. It wins over `mayAdvance`, which stays as
 * the fallback for a failure the recovery listener never saw. `mayAdvance` is
 * true only when the failure behind this retry is `switchOn`-eligible; a
 * capped-out candidate whose last failure is not eligible stays put, so
 * `llm-retry` burns its own budget and the recovery listener terminates the
 * chain — the user's "don't switch on this error" choice holds even for codes
 * llm-retry retries first.
 *
 * The `exhausted` flag this sets is a FACT about the transition ("the last
 * candidate just hit its cap"), consumed by `decideRecovery` and by the
 * fall-back path; it is not what prevents an extra fire — that is
 * {@link hasNextCandidate}, checked before the next fire is authorized. The
 * branch is defensive: the recovery layer never authorizes an advance that
 * lands nowhere, so a real chain reaches `exhausted` only through
 * `decideBeforeInner`'s terminate.
 */
export function planFire(state: StepState, mayAdvance: boolean): FirePlan {
  const candidates = state.chain.candidates
  const current = candidates[state.index]!
  let index = state.index
  let exhausted = state.exhausted
  let advanced = false
  const shouldAdvance = state.pendingAdvance !== undefined
    ? state.pendingAdvance
    : (mayAdvance && state.attemptsOnCandidate >= current.maxAttempts)
  if (shouldAdvance) {
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
      pendingAdvance: undefined,
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
export function unmetCondition(candidate: { needs?: { images?: boolean; minContextTokens?: number } }, conditions: StepConditions): string | undefined {
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
 * Whether the chain has another candidate to move to.
 *
 * This is the C2 fix in one sentence. `planFire` learns that the last
 * candidate is capped only when it counts that fire — and by then the call
 * has already been dispatched (`index.ts` walks candidates from
 * `plan.state.index` and nothing reads `plan.state.exhausted` before
 * dispatching). The earliest decision point that can PREVENT a fire is
 * `decideRecovery`, which runs after a failure; it may only authorize a fire
 * that lands on a DIFFERENT candidate. A cap that only stops the fire after it
 * has happened is not a cap, and a "retry" that fires the same capped route
 * again is that same bug in another costume.
 */
export function hasNextCandidate(state: StepState): boolean {
  return state.index < state.chain.candidates.length - 1
}

export type RecoveryDecision = 'advance' | 'terminal'

/**
 * Decide what a delegated failure means for the chain. `llm-retry` consults
 * this plugin only after it gives up, so reaching here at all means the
 * same-route layer is finished with this failure.
 *
 * The only forward move left is a DIFFERENT candidate. Remaining budget on the
 * current candidate is not a reason to fire it again: the layer that owns
 * same-route retries already declined, and retrying without its backoff would
 * be the blind retry this plugin promises not to do. So the last candidate ends
 * the step here, exactly once, with `exhausted` unset — the candidate's budget
 * was never reached and the state must not pretend it was.
 *
 * There is no request-wide cap (decided 2026-10-20): a step can cost at most
 * the sum of its candidates' budgets, and for a failure code the user did not
 * check, DSH's own policy is the bound — the plugin never switches on those.
 */
export function decideRecovery(state: StepState, code: string, aborted: boolean): RecoveryDecision {
  if (aborted) return 'terminal'
  // `exhausted` 还服务另一条路径："整条链都服务不了、落回用户原路由"
  // （index.ts 在 outgoing === undefined 时置位），那一步不消耗任何候选配额。
  if (state.exhausted) return 'terminal'
  if (!isSwitchOnEligible(state.chain, code)) return 'terminal'
  if (!hasNextCandidate(state)) return 'terminal'
  return 'advance'
}

/**
 * The outermost recovery listener's decision before llm-retry is consulted.
 *
 * `delegate` asks the inner layer (llm-retry / compaction) first. It is now
 * reserved for what the Router does not own: a code the user did not put under
 * `switchOn`, and an aborted attempt. For the codes it does own, the Router
 * retries the same route itself (`retry-self`) — since 2026-10-21 the
 * configured count is the real count, not a number capped by the provider's
 * policy. `advance` always means "the next fire lands on the next candidate";
 * it is never a same-route retry.
 */
export type BeforeInnerRuling =
  | { readonly kind: 'delegate'; readonly record: false; readonly log: '' }
  /**
   * The router retries the same route itself. `record: false` because nothing
   * left rotation: the outcome is not settled and the candidate is still in
   * play. `delayMs` is the wait before the next fire — the router owns it now
   * (`llm-retry` is not consulted for eligible codes).
   */
  | { readonly kind: 'retry-self'; readonly record: false; readonly log: ''; readonly delayMs: number }
  | { readonly kind: 'advance'; readonly record: true; readonly log: string }
  | { readonly kind: 'terminate'; readonly record: true; readonly log: string }

/** What the backoff needs from the failure, kept out of the decision's other inputs. */
export interface RetryTiming {
  /** The provider's resolved policy: timing parameters, and the default count when unset. */
  readonly policy?: ResolvedRetryPolicy
  /** The server's explicit wait, when the failure carried one. */
  readonly retryAfterMs?: number
  /** Jitter sample; injectable so the decision table stays deterministic in tests. */
  readonly random?: () => number
}

/** What the inner layer decided, as the recovery listener sees it. */
export type InnerDecision = 'retry' | undefined

/**
 * The same decision after llm-retry answered. `honor` passes its retry
 * through untouched (the failure's outcome is not settled yet — llm-retry is
 * still retrying the same route). `advance` takes over when llm-retry gave up
 * and the chain has a next candidate; `terminate` ends the step when it gave up
 * and there is nothing left to switch to.
 */
export type AfterInnerRuling =
  | { readonly kind: 'honor'; readonly record: false; readonly log: '' }
  | { readonly kind: 'advance'; readonly record: true; readonly log: string }
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
 * The discriminated unions encode it — only `delegate`, `retry-self` and
 * `honor` may carry `record: false` — and the unit suite asserts it across the
 * whole table, so the next branch added cannot silently drop the record again.
 *
 * `log` is the handler's warn line, built here so the copy is pinned by the
 * same tests as the decision (copy that drifts from behavior is this
 * project's recurring C4-class bug).
 *
 * Note: 五分支收编的来龙去脉（待办 4 是症状不是独立问题，被否的"补一行
 * noteBreaker()"方案）—— 见 .agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md
 */
export function decideBeforeInner(
  state: StepState,
  code: string,
  aborted: boolean,
  timing: RetryTiming = {},
): BeforeInnerRuling {
  const current = state.chain.candidates[state.index]!
  const route = routeKeyOf(current.provider, current.model)
  const attempt = `(attempt ${state.totalAttempts})`
  // 未勾选的码永远 delegate：路由器不接管它，DSH 自己按它的策略重试与收尾。
  // 取消同理——调用方已经不要这个结果了，替它重试是一次没人等的调用。
  if (aborted || !isSwitchOnEligible(state.chain, code)) {
    return { kind: 'delegate', record: false, log: '' }
  }
  // 勾选的码由路由器自己执行同渠道重试（2026-10-21 定案）：次数就是配置的次数，
  // 不再受 provider 策略里较小那个上限的截断。等待复刻该 provider 的曲线。
  // Note: 为何接管、为何不伪造 llm/retry —— 见
  // .agents/notes/implemented/2026-10-21-plugin-owns-retries.md
  if (state.attemptsOnCandidate < current.maxAttempts) {
    const plan = planBackoff(timing.policy, state.attemptsOnCandidate, timing.retryAfterMs, timing.random)
    if (plan.kind === 'wait') {
      return { kind: 'retry-self', record: false, log: '', delayMs: plan.delayMs }
    }
    // 服务端要求的等待超过该 provider 的上限：照 DSH normal 策略的做法放弃重试，
    // 把这次失败当作"这条候选到此为止"，去换下一条而不是压缩服务端的指令。
    if (hasNextCandidate(state)) {
      return {
        kind: 'advance',
        record: true,
        log: `model-router: ${code} on ${route} ${attempt}; the server asked for a longer wait than this provider's ceiling, switching instead of retrying`,
      }
    }
    return {
      kind: 'terminate',
      record: true,
      log: `model-router: ${code} on ${route} ${attempt}; the server asked for a longer wait than this provider's ceiling and the chain has nothing left, terminating`,
    }
  }
  if (hasNextCandidate(state)) {
    return {
      kind: 'advance',
      record: true,
      log: `model-router: ${code} on ${route} ${attempt}; this candidate's retry budget is spent, switching`,
    }
  }
  return {
    kind: 'terminate',
    record: true,
    log: `model-router: ${code} on ${route} ${attempt}; this candidate's retry budget is spent and the chain has nothing left, terminating`,
  }
}

/** {@link decideBeforeInner} 的姊妹：llm-retry 已经回答之后的裁决。 */
export function decideAfterInner(state: StepState, code: string, aborted: boolean, inner: InnerDecision): AfterInnerRuling {
  const current = state.chain.candidates[state.index]!
  const route = routeKeyOf(current.provider, current.model)
  if (inner === 'retry') {
    // 内层还能重试，就说明这一条的额度没耗尽（耗尽的那条在 decideBeforeInner 已被
    // 提前接管，轮不到这里）。插件没有额外的次数上限可以否决它——重试由 DSH 执行，
    // 插件只负责数次数与换渠道（2026-10-20 删除整请求总上限）。
    return { kind: 'honor', record: false, log: '' }
  }
  // 内层全部放弃：记录熔断，并决定是否跨候选继续。
  if (decideRecovery(state, code, aborted) === 'terminal') {
    return { kind: 'terminate', record: true, log: '' }
  }
  return {
    kind: 'advance',
    record: true,
    log: `model-router: ${code} on ${route} (attempt ${state.totalAttempts}); continuing the chain`,
  }
}
