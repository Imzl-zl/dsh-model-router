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
import { decideRecovery, hasImageContent, isSwitchOnEligible, planFire, resolveChain, skipTo, startStep, unmetCondition } from './router.ts'
import { RouterState, candidateConfig, emptyConditions, type StepChain, type StepConditions } from './state.ts'
import { conditionSkipNotice, failoverNotice, skipNotice } from './notice.ts'
import { failoverHistoryProjection, failureCodeOfStream } from './lineage.ts'
import { HealthMonitor, RouterHealthService, channelHealthProjection } from './health.ts'

export const name = 'model-router'
export const inject = ['llm']

export { Config } from './config.ts'

export function apply(ctx: Context, config: Config): void {
  const states = new RouterState()
  const healthMonitor = new HealthMonitor(ctx)

  // Structural validation at load: wrong in every environment, so it fails loud.
  assertStructural(readConfig(config))

  const getHealthCandidates = (): readonly { provider: string; model: string }[] => {
    const list: { provider: string; model: string }[] = []
    const profiles = config.profiles.get() as readonly Profile[] | undefined
    if (profiles) {
      for (const p of profiles) {
        for (const c of p.candidates) list.push({ provider: c.provider, model: c.model })
      }
    }
    const def = config.default.get() as DefaultProfile | undefined
    if (def?.candidates) {
      for (const c of def.candidates) list.push({ provider: c.provider, model: c.model })
    }
    return list
  }

  // Register Host Typert Remote service for health checks
  new RouterHealthService(ctx, healthMonitor, () => {
    const h = config.health?.get() as HealthConfig | undefined
    return {
      prompt: h?.prompt ?? 'hi',
      timeoutSeconds: h?.timeoutSeconds ?? 8,
      getCandidates: getHealthCandidates,
    }
  })

  const updateHealthSchedule = (): void => {
    const h = config.health?.get() as HealthConfig | undefined
    if (h?.enabled !== false && (h?.intervalMinutes ?? 0) > 0) {
      healthMonitor.updateInterval(getHealthCandidates, h!.intervalMinutes, h!.prompt || 'hi', h!.timeoutSeconds || 8)
    } else {
      healthMonitor.updateInterval(getHealthCandidates, 0, 'hi', 8)
    }
  }
  updateHealthSchedule()

  ctx.effect(() => () => {
    healthMonitor.dispose()
  })

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
    updateHealthSchedule()
    return raw
  })

  // Environmental drift (a provider uninstalled after configuration) degrades
  // at runtime: the candidate is skipped and the request falls through to the
  // user's own route. This warning is best-effort only — providers registered
  // after this plugin loads are not visible here.
  warnUnregisteredProviders(ctx, readConfig(config))

  // The durable failover ledger. Registered through an inject intercept (the
  // llm-pi-ai pattern for an optional service): the child fiber waits for the
  // projection registry instead of reading it once at apply time, so this
  // plugin loads and routes even in a composition without the registry — the
  // child simply stays pending there and only the history view degrades.
  // The durable failover ledger. The registry is a core service in every real
  // profile; read it through `ctx.get` (the optional-service rule) so a
  // composition without it still routes — only the history view degrades.
  const projections = ctx.get('sessionProjections') as ProjectionRegistryFace | undefined
  projections?.register(failoverHistoryProjection)
  projections?.register(channelHealthProjection)

  // Failure and success observation. `session/event` is the sanctioned post-commit feed;
  // `agent/request-error` records synchronously for delegated failures. Both
  // write the same fact, and the notice reads whichever arrived.
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type === 'assistant/attempt') {
      const failure = failureCodeOfStream(event.data.stream)
      if (failure !== undefined) states.noteFailure(session, event.data.turn, event.data.step, failure)
    } else if (event.type === 'assistant/message') {
      const source = (event.data as unknown as { message?: { source?: { provider?: string; model?: string } } })?.message?.source
      if (source?.provider && source?.model) {
        healthMonitor.noteSuccess(source.provider, source.model)
      }
    }
  })

  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    // Conditions are gathered once per step, before route selection: pre-step
    // sees the admitted user messages (the images gate) and the
    // context-pressure projection answers for the next request (the token
    // gate). Neither re-runs on retries, so the conditions stay stable across
    // a step's attempts. This listener only observes.
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
          state = startStep(turn, step, chain, states.conditionsFor(agent, turn, step))
          states.start(agent, state)
        }

        const plan = planFire(state, mayAdvance(states, agent, turn, step, state.chain))
        const candidates = plan.state.chain.candidates

        // Walk forward from the planned index, skipping candidates this exact
        // request cannot be served by: an unmet `needs` condition first, then a
        // capability rejection. The user's own route is exempt from both —
        // DSH validated the selection when it was made, and skipping it would
        // be a silent reroute.
        let index = plan.state.index
        const skipped: Candidate[] = []
        const conditionSkipped: { candidate: Candidate; reason: string }[] = []
        let outgoing: LlmCallConfig | undefined
        while (index < candidates.length) {
          const candidate = candidates[index]!
          if (candidate.provider === resolved.provider && candidate.model === resolved.model) {
            outgoing = candidateConfig(resolved, candidate)
            break
          }
          const unmet = unmetCondition(candidate, plan.state.conditions)
          if (unmet !== undefined) {
            conditionSkipped.push({ candidate, reason: unmet })
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
        if (outgoing === undefined) {
          // Nothing in the chain can serve this request. Fall through to the
          // user's own route so the real failure surfaces there instead of a
          // silent swap.
          return resolved
        }
        states.start(agent, skipped.length === 0 && conditionSkipped.length === 0 && index === plan.state.index ? plan.state : skipTo(plan.state, index))

        if (plan.advanced) {
          agent.session.append(
            'user/message',
            failoverNotice(
              candidates[plan.fromIndex]!,
              candidates[index]!,
              index + 1,
              candidates.length,
              states.failureCodeOf(agent.session, turn, step),
            ),
            { surfaceOp: 'append' },
          )
        }
        for (const entry of conditionSkipped) {
          agent.session.append('user/message', conditionSkipNotice(entry.candidate, entry.reason), { surfaceOp: 'append' })
        }
        for (const candidate of skipped) {
          agent.session.append('user/message', skipNotice(candidate), { surfaceOp: 'append' })
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
      healthMonitor.noteFailure(current.provider, current.model, failure.code)
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
