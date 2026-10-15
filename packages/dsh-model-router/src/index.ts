/**
 * dsh-model-router — transparent cross-provider failover for Agent main requests.
 *
 * The plugin owns exactly two seams, both verified against the real Loader
 * composition in the Phase 1 spike (docs/design/dsh-capability-boundary.md 7):
 *
 * - `agent/request` with `prepend: true`, so this listener runs OUTSIDE
 *   `installModelSelection` and its post-`next()` override wins. Every attempt
 *   passes through here, which is what makes the per-candidate attempt cap
 *   enforceable while `llm-retry` owns same-route retries.
 * - `agent/request-error` registered on `agent.ctx` at `agent/created` WITHOUT
 *   prepend, so it sits INSIDE `llm-retry`: built-in same-route recovery acts
 *   first, and its `return next()` hand-off is what reaches this plugin.
 *
 * Nothing here re-implements backoff, adapter dispatch, credentials, or the
 * durable attempt record. What the plugin adds is the candidate cursor, the
 * capability pre-check, and the Chinese reason notice.
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  Config,
  assertStructural,
  type Candidate,
  type DefaultProfile,
  type HealthConfig,
  type Profile,
  type RouterOptions,
} from './config.ts'
import { decideRecovery, hasImageContent, isSwitchOnEligible, planFire, resolveChain, resolveStartIndex, skipTo, startStep, toolResultHasImage, unmetCondition } from './router.ts'
import { RouterState, candidateConfig, emptyConditions, type StepChain, type StepConditions } from './state.ts'
import { conditionSkipNotice, failoverNotice, breakerNotice, skipNotice } from './notice.ts'
import { failoverHistoryProjection, failureCodeOfStream } from './lineage.ts'
import { channelHealthProjection } from './health.ts'
import { CircuitBreaker, type RouteBlock } from './breaker.ts'

export const name = 'model-router'
export const inject = ['llm']

export { Config } from './config.ts'

// The Typert host-face surface: re-exported so the generator's package model
// collects the @typert-marked declaration from this entry module
// (packages/typert/generator/src/analyzer.ts:748-789).
export type { Profile } from './config.ts'

export function apply(ctx: Context, config: Config): void {
  const states = new RouterState()
  const breaker = new CircuitBreaker()
  /** Live agents by session, so the session/event feed can reach their state. */
  const agentsBySession = new WeakMap<Session, Agent>()

  // Structural validation at load: wrong in every environment, so it fails loud.
  assertStructural(readConfig(config))
  // Hot updates are validated before Cordis restarts this fiber, so a bad edit
  // is rejected at save time instead of killing the running plugin.
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw: unknown = next()
    if (this !== ctx.fiber) return raw
    const candidate = Config(raw as RouterOptions)
    assertStructural({
      profiles: candidate.profiles.get() as readonly Profile[],
      default: candidate.default.get() as DefaultProfile,
      health: candidate.health?.get() as HealthConfig | undefined,
    })
    return raw
  })

  // Environmental drift (a provider uninstalled after configuration) degrades
  // at runtime: the candidate is skipped and the request falls through to the
  // user's own route. This warning is best-effort only — providers registered
  // after this plugin loads are not visible here.
  warnUnregisteredProviders(ctx, readConfig(config))

  // The durable failover ledger and the channel-health fold, both registered
  // through `ctx.get` (the optional-service rule): a composition without the
  // registry still routes — only the two views degrade.
  const projections = ctx.get('sessionProjections') as ProjectionRegistryFace | undefined
  projections?.register(failoverHistoryProjection)
  projections?.register(channelHealthProjection)

  // The router's own failure ledger. `agent/request-error` records synchronously
  // for the failure it is handed, but a delegated failure reaches the next
  // attempt through the durable log first, so the committed `assistant/attempt`
  // is what `mayAdvance` reads when it decides whether the chain may advance.
  // This listener exists for the router's state alone — channel health is folded
  // by the `router/channel-health` projection, which the registry drives itself.
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // read_image's image enters the conversation as a tool result, so the turn
    // becomes image-bearing from the next step on — without this the walk would
    // send the very next request (the one that actually contains the image) to
    // a candidate the user gated on `images: false`.
    if (event.type === 'tool/result') {
      const agent = agentsBySession.get(session)
      if (agent !== undefined) states.noteToolResult(agent, event.data.turn, toolResultHasImage(event.data))
    }
    if (event.type !== 'assistant/attempt') return
    const failure = failureCodeOfStream(event.data.stream)
    if (failure !== undefined) states.noteFailure(session, event.data.turn, event.data.step, failure)
  })

  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    // 工具结果里的图片经 session/event 进来，而该事件只有 session 没有 agent；
    // 这张表把两者接上，条目随 agent 消亡。
    agentsBySession.set(agent.session, agent)
    // Conditions are gathered once per step, before route selection: pre-step
    // sees the admitted user messages (the images gate) and the
    // context-pressure projection answers for the next request (the token
    // gate). The image flag accumulates across the turn's steps and is
    // extended by the sticky window, so it stays stable across a step's
    // retries without pretending later steps claimed the same input. This
    // listener only observes.
    agent.ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      states.noteConditions(agent, payload.turn, payload.step, gatherConditions(ctx, agent.session, payload.messages))
      return decision
    })

    // Outermost on agent/request: the override applied after next() wins over
    // installModelSelection's write-back of the user's selection.
    agent.ctx.on(
      'agent/request',
      async (payload, next) => {
        const { turn, step, signal } = payload
        const resolved = await next()
        if (!config.enabled.get()) return resolved

        let state = states.current(agent, turn, step)
        if (state === undefined) {
          const chain = resolveChain(
            resolved,
            config.profiles.get() as readonly Profile[],
            config.default.get() as DefaultProfile,
          )
          if (chain === undefined) return resolved
          states.setStickyTurns(agent, chain.stickyTurns)
          // 策略只决定从哪条开始；起点之后的前进逻辑与策略无关。
          const start = resolveStartIndex(chain.candidates, chain.strategy, states.nextCursor(agent.session, chain.candidates.length))
          state = startStep(turn, step, chain, states.conditionsFor(agent, turn, step), start)
          states.start(agent, state)
        }

        const plan = planFire(state, mayAdvance(states, agent, turn, step, state.chain))
        const candidates = plan.state.chain.candidates

        // Walk forward from the planned index, skipping candidates this exact
        // request cannot be served by: an unmet `needs` condition first, then a
        // capability rejection. Conditions apply to EVERY candidate — including
        // the user's own route: an explicit `needs` is the user's stated intent,
        // and skipping a primary that fails it honors the configuration instead
        // of silently ignoring it. What the user's own route stays exempt from
        // is the automatic machinery: breaker cooldowns and capability
        // pre-validation, which DSH already settled when the selection was made.
        let index = plan.state.index
        const skipped: Candidate[] = []
        const conditionSkipped: { candidate: Candidate; reason: string }[] = []
        const blocked: { candidate: Candidate; block: RouteBlock }[] = []
        let outgoing: LlmCallConfig | undefined
        const now = Date.now()
        breaker.sweep(now)
        while (index < candidates.length) {
          const candidate = candidates[index]!
          const unmet = unmetCondition(candidate, plan.state.conditions)
          if (unmet !== undefined) {
            conditionSkipped.push({ candidate, reason: unmet })
            index += 1
            continue
          }
          // 禁用的渠道直接跳过——但用户自己选的那一条永远不跳过：那是他明确
          // 要用的，禁用名单不该能覆盖人的显式选择。
          if (candidate.provider === resolved.provider && candidate.model === resolved.model) {
            outgoing = candidateConfig(resolved, candidate)
            break
          }
          const block = breaker.blockedUntil(candidate.provider, candidate.model, now)
          if (block !== undefined) {
            blocked.push({ candidate, block })
            index += 1
            continue
          }
          try {
            outgoing = await ctx.llm.resolveCallConfig(candidateConfig(resolved, candidate), signal)
            break
          } catch (error) {
            ctx.logger.warn(
              `model-router: candidate ${candidate.provider}/${candidate.model} cannot serve this request, skipping: ${String(error)}`,
            )
            skipped.push(candidate)
            index += 1
          }
        }
        // 跳过通知在“落回用户原路由”之前发：那条路径上没有任何切换 Notice，
        // 而“为什么链上没人能接这一击”恰恰是用户最需要看到的。条件跳过按
        // (turn, 跳过组) 去重——工具循环轮次每步都重决一遍，同样的跳过发一次就够。
        if (conditionSkipped.length > 0 && states.shouldNoteConditionSkip(agent, turn, conditionSkipKey(conditionSkipped))) {
          for (const entry of conditionSkipped) {
            agent.session.append('user/message', conditionSkipNotice(entry.candidate, entry.reason), { surfaceOp: 'append' })
          }
        }
        for (const candidate of skipped) {
          agent.session.append('user/message', skipNotice(candidate), { surfaceOp: 'append' })
        }
        for (const entry of blocked) {
          agent.session.append('user/message', breakerNotice(entry.candidate, entry.block), { surfaceOp: 'append' })
        }
        if (outgoing === undefined) {
          // Nothing in the chain can serve this request. Fall through to the
          // user's own route so the real failure surfaces there instead of a
          // silent swap. The chain is spent for this step: record it, or every
          // retry re-walks the same dead chain, the recovery listener keeps
          // answering "continue" (totalAttempts never moves), and the turn
          // spins on the user's route until the boot is killed.
          // Note: 这个 exhausted 修复的来龙去脉 —— 见
          // .agents/notes/implemented/2026-10-14-image-route-conditions-and-admission-gate-boundary.md
          states.start(agent, { ...plan.state, exhausted: true })
          return resolved
        }
        states.start(agent, skipped.length === 0 && conditionSkipped.length === 0 && index === plan.state.index ? plan.state : skipTo(plan.state, index))

        if (plan.advanced) {
          const order = plan.state.chain.order
          agent.session.append(
            'user/message',
            failoverNotice(
              candidates[plan.fromIndex]!,
              candidates[index]!,
              // 用户自己排的编号，不是策略旋转后的位置。
              (order[index] ?? index) + 1,
              order.length,
              states.failureCodeOf(agent.session, turn, step),
            ),
            { surfaceOp: 'append' },
          )
        }
        return outgoing
      },
      { prepend: true },
    )

    // Innermost on agent/request-error: llm-retry owns same-route retries and
    // delegates here only when it gives up, which is the hand-off that makes
    // cross-candidate failover reachable at all.
    agent.ctx.on('agent/request-error', async (payload, next) => {
      const { turn, step, failure, signal } = payload
      const state = states.current(agent, turn, step)
      if (state === undefined) return next()
      states.noteFailure(agent.session, turn, step, failure.code)
      const current = state.chain.candidates[state.index]!
      // A failure the user said should disqualify the channel takes it out of
      // rotation; the block always expires, so this is a cooldown, not a ban.
      const rules = (config.health?.get() as HealthConfig | undefined)?.breaker.rules ?? []
      breaker.note(current.provider, current.model, failure.code, failure.message ?? '', rules, Date.now())
      if (decideRecovery(state, failure.code, signal.aborted) === 'terminal') return next()
      ctx.logger.warn(
        `model-router: ${failure.code} on ${current.provider}/${current.model} `
        + `(attempt ${state.totalAttempts}/${state.chain.maxTotalAttempts}); continuing the chain`,
      )
      return { kind: 'retry' as const }
    })
  })
}

function readConfig(config: Config): { profiles: readonly Profile[]; default: DefaultProfile; health?: HealthConfig } {
  return {
    profiles: config.profiles.get() as readonly Profile[],
    default: config.default.get() as DefaultProfile,
    health: config.health?.get() as HealthConfig | undefined,
  }
}

/** Stable identity of one turn's condition-skip set, for the once-per-turn notice. */
function conditionSkipKey(skipped: readonly { candidate: Candidate; reason: string }[]): string {
  return skipped.map(entry => `${entry.candidate.provider}/${entry.candidate.model}:${entry.reason}`).join('|')
}

/**
 * Whether the next fire may move to the next candidate. The failure behind the
 * retry must be `switchOn`-eligible; an unrecorded code (a first attempt, or a
 * feed that has not committed yet) fails closed — the recovery listener, which
 * sees the failure synchronously, remains the authority.
 */
function mayAdvance(
  states: RouterState,
  agent: Agent,
  turn: number,
  step: number,
  chain: StepChain,
): boolean {
  const code = states.failureCodeOf(agent.session, turn, step)
  return code !== undefined && isSwitchOnEligible(chain, code)
}

function warnUnregisteredProviders(ctx: Context, config: { profiles: readonly Profile[]; default: DefaultProfile }): void {
  const registered = new Set(ctx.llm.listProviders().map(provider => provider.id))
  const check = (candidates: readonly Candidate[], where: string): void => {
    for (const candidate of candidates) {
      if (!registered.has(candidate.provider)) {
        ctx.logger.warn(
          `model-router: ${where} candidate ${candidate.provider}/${candidate.model} names an unregistered provider; `
          + 'that candidate is skipped at runtime and the profile degrades to the remaining chain',
        )
      }
    }
  }
  for (const profile of config.profiles) check(profile.candidates, `profile "${profile.id}"`)
  check(config.default.candidates, 'default pool')
}

/** The projection registry's read face this plugin uses; structurally typed to keep the service optional. */
interface ProjectionReadFace {
  snapshot(session: Session): { values: Record<string, unknown> }
}

/** The projection registry's write face: one namespaced unit, disposed with this fiber. */
interface ProjectionRegistryFace {
  register(definition: unknown): () => void
}

/**
 * Gather the step's request-shape conditions. The images gate reads the
 * admitted user messages; the token gate reads the context-pressure wire view,
 * whose `projectedTokens` is the canonical "what the next request will cost"
 * answer (present only after the first usage sample). When the registry or the
 * unit is absent the gate reads as unmet rather than guessing.
 */
function gatherConditions(ctx: Context, session: Session, messages: readonly { content: readonly { type: string }[] }[]): StepConditions {
  let projectedTokens: number | undefined
  const projections = ctx.get('sessionProjections') as ProjectionReadFace | undefined
  if (projections !== undefined) {
    const pressure = projections.snapshot(session).values['contextPressure'] as { projectedTokens?: number } | undefined
    projectedTokens = pressure?.projectedTokens
  }
  return { hasImages: hasImageContent(messages), projectedTokens }
}
