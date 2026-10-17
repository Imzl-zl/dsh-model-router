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
 *
 * The class form carries the plugin's own Remote: `TypertRemoteService` makes
 * this one class the Cordis Service, the plugin, and the Remote owner at once,
 * which is what lets the browser ask the Host to run a probe
 * (docs/design/build-pipeline-and-plugin-remote.md). The `./typert` artifact
 * the generator emits from this class is the registration channel.
 *
 * Note: 类形态转换与 Remote 探针的取舍 —— 见
 * .agents/notes/implemented/2026-10-15-plugin-remote-probe.md
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
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
import { configuredRoutes, routeKeyOf, routeParts } from './routes.ts'
import { DEFAULT_PROBE_PROMPT, DEFAULT_PROBE_TIMEOUT_SECONDS } from './defaults.ts'
import { RouterState, candidateConfig, emptyConditions, type StepChain, type StepConditions } from './state.ts'
import { conditionSkipNotice, failoverNotice, breakerNotice, skipNotice } from './notice.ts'
import { failoverHistoryProjection, failureCodeOfStream } from './lineage.ts'
import { channelHealthProjection } from './health.ts'
import { CircuitBreaker, type RouteBlock } from './breaker.ts'
import { checkConnectivity, type ConnectivityLlm, type ConnectivitySettings } from './connectivity.ts'
import { probePromptFor, probeRoute } from './probe.ts'
import type { ConnectivityRequest, ConnectivityVerdict, ProbeReport, ProbeRequest, ProbeRoute } from './types.ts'

/**
 * No `declare module '@deepseek-ai/cordis'` augmentation here on purpose. The
 * gateway binding is syntactic — the generator reads the `extends
 * TypertRemoteService` heritage and the `super(ctx, serviceKey)` call
 * (packages/typert/generator/src/analyzer.ts:1274-1296) — but a Context member
 * typed as this class feeds the service model, whose walk reaches
 * `Context.typert` → `TypertRegistryContract` → `TypertLookupRegistry` →
 * `TypertLookupMap`, a merge-extensible interface that DSH packages augment
 * from node_modules. Out-of-tree those augmentations sit in no registration, so
 * the face analysis refuses the merge. Consumers reach this service through the
 * generated `./remote` artifact, not through a Context key.
 */

/**
 * Every physical route the config names, deduplicated: the target set both the
 * probe and the connectivity check run over. The rule lives in ./routes.ts
 * because the browser half lists the same set for its checks — one definition,
 * both halves.
 */
function configuredRunRoutes(config: { profiles: readonly Profile[]; default: DefaultProfile }): ProbeRoute[] {
  return configuredRoutes(config.profiles, config.default).map((key) => routeParts(key))
}

export default class ModelRouter extends TypertRemoteService {
  static inject = ['llm']
  static Config = Config

  // Assigned in the constructor rather than declared as a parameter property:
  // the headless composition loads this file from source through Node's
  // strip-only type removal, which rejects parameter properties outright.
  private readonly config: Config
  private readonly states = new RouterState()
  private readonly breaker = new CircuitBreaker()
  /** Live agents by session, so the session/event feed can reach their state. */
  private readonly agentsBySession = new WeakMap<Session, Agent>()
  /** The last scheduled probe's report, held for the browser's read. */
  private lastProbeReport: ProbeReport = { at: 0, routes: [] }
  /** Probes currently running (scheduled or manual); a scheduled tick skips while any is in flight. */
  private probeInFlight = 0
  /** The scheduled timer's own cancellation, aborted when this fiber unloads. */
  private probeTimer: AbortController | undefined
  private probeTimerId: ReturnType<typeof setInterval> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelRouter', { namespace: 'routerHealth' })
    this.config = config
    this.install()
    this.armProbeTimer()
  }

  // ---- routing seams (the apply body, unchanged) ----

  private install(): void {
    const ctx = this.ctx
    const config = this.config
    const states = this.states
    const breaker = this.breaker
    const agentsBySession = this.agentsBySession

    // Structural validation at load: wrong in every environment, so it fails loud.
    assertStructural(readConfig(config))
    // Provider audit: same rule at load and at save, so a bad save is rejected by the
    // waterfall instead of killing the running plugin (see the internal/config listener).
    assertNoAlwaysPolicy(ctx, readConfig(config))
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
      assertNoAlwaysPolicy(ctx, {
        profiles: candidate.profiles.get() as readonly Profile[],
        default: candidate.default.get() as DefaultProfile,
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
    // One face, two uses: registering this plugin's own units, and reading another
    // package's wire view for the token gate. Both are structurally typed because
    // the registry is optional (packages/AGENTS.md: the ctx.get rule).
    const projections = ctx.get('sessionProjections') as (ProjectionRegistryFace & ProjectionReadFace) | undefined
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
        states.noteConditions(agent, payload.turn, payload.step, gatherConditions(projections, agent.session, payload.messages))
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
                `model-router: candidate ${routeKeyOf(candidate.provider, candidate.model)} cannot serve this request, skipping: ${String(error)}`,
              )
              skipped.push(candidate)
              index += 1
            }
          }
          // 跳过通知在"落回用户原路由"之前发：那条路径上没有任何切换 Notice，
          // 而"为什么链上没人能接这一击"恰恰是用户最需要看到的。三类跳过都按
          // (turn, 跳过组) 去重——工具循环轮次每步都重决一遍，同样的跳过发一次就够；
          // 这些 notice 是 durable 的 user 消息且进模型上下文，重复发就是重复花钱。
          if (conditionSkipped.length > 0 && states.shouldNoteSkip(agent, turn, `condition:${conditionSkipKey(conditionSkipped)}`)) {
            for (const entry of conditionSkipped) {
              agent.session.append('user/message', conditionSkipNotice(entry.candidate, entry.reason), { surfaceOp: 'append' })
            }
          }
          for (const candidate of skipped) {
            if (!states.shouldNoteSkip(agent, turn, `capability:${routeKeyOf(candidate.provider, candidate.model)}`)) continue
            agent.session.append('user/message', skipNotice(candidate), { surfaceOp: 'append' })
          }
          for (const entry of blocked) {
            if (!states.shouldNoteSkip(agent, turn, `breaker:${routeKeyOf(entry.candidate.provider, entry.candidate.model)}`)) continue
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
    })

    // 最外层 on agent/request-error（`prepend: true`，注册在 root ctx 一次，agent 从
    // payload 取——按 agent/created 逐个注册会让每个 agent 漏一条 root listener）。
    // 位置是"硬上限"能否成立的关键：注册在 llm-retry 内层时，它自己的 5 次同路由重试
    // 发生在插件看不到的地方，用户配的 maxTotalAttempts 会被越过（实测：配 2 打 7 次）。
    // 所以这里先 `await next()` 让内层（llm-retry / compaction）各自决定，再处置：
    //   内层决定重试 + 预算已尽 → 否决（返回 undefined 即终态）；
    //   内层决定重试 + 预算还有 → 原样放行（与注册在内层时行为一致）；
    //   内层全部放弃（undefined）→ 才轮到插件做跨候选 failover。
    ctx.on('agent/request-error', async (payload, next) => {
      const { agent, turn, step, failure, signal } = payload
      const state = states.current(agent, turn, step)
      // 不是本插件接管的 step：纯透传，不改变任何既有恢复行为。
      if (state === undefined) return next()
      states.noteFailure(agent.session, turn, step, failure.code)
      const current = state.chain.candidates[state.index]!

      const inner = await next()

      if (inner?.kind === 'retry') {
        // 预算耗尽就否决内层的重试决定：用户配的"最多真实调用多少次"是硬承诺，
        // llm-retry 的同路由重试也不能越过它。返回 undefined 即终态。
        if (state.exhausted || state.totalAttempts >= state.chain.maxTotalAttempts) {
          ctx.logger.warn(
            `model-router: attempt budget spent (${state.totalAttempts}/${state.chain.maxTotalAttempts}) on ${routeKeyOf(current.provider, current.model)}; terminating instead of retrying`,
          )
          return undefined
        }
        return inner
      }

      // 内层全部放弃：记录熔断，并决定是否跨候选继续。
      // A failure the user said should disqualify the channel takes it out of
      // rotation; the block always expires, so this is a cooldown, not a ban.
      // 总闸关着就不记：`enabled` 是用户的显式选择。规则留着（再开时不用重填），
      // 但关着的时候一条都不能生效——此前只读 rules 不读 enabled，开关是个摆设。
      const breakerConfig = (config.health?.get() as HealthConfig | undefined)?.breaker
      if (breakerConfig?.enabled === true) {
        breaker.note(current.provider, current.model, failure.code, failure.message ?? '', breakerConfig.rules, Date.now())
      }
      if (decideRecovery(state, failure.code, signal.aborted) === 'terminal') return undefined
      ctx.logger.warn(
        `model-router: ${failure.code} on ${routeKeyOf(current.provider, current.model)} `
        + `(attempt ${state.totalAttempts}/${state.chain.maxTotalAttempts}); continuing the chain`,
      )
      return { kind: 'retry' as const }
    }, { prepend: true })
  }

  // ---- the plugin's own Remote ----

  /**
   * Probe routes end to end: one minimal message each, cut at the first content
   * byte. An empty `routes` means every route the config names. The caller's
   * signal cancels the whole run — a browser that closes the page mid-probe
   * stops spending tokens.
   */
  @Remote
  async probeAll(request: ProbeRequest, signal: AbortSignal): Promise<ProbeReport> {
    const health = (this.config.health?.get() as HealthConfig | undefined)?.probe
    const fallback = health?.prompt ?? DEFAULT_PROBE_PROMPT
    const overrides = health?.prompts ?? []
    const timeoutSeconds = health?.timeoutSeconds ?? DEFAULT_PROBE_TIMEOUT_SECONDS
    const wanted = request.routes.length > 0
      ? request.routes
      : configuredRunRoutes(readConfig(this.config))
    const at = Date.now()
    const routes: ProbeReport['routes'] = []
    this.probeInFlight += 1
    try {
      for (const route of wanted) {
        if (signal.aborted) break
        routes.push(await probeRoute(
          this.ctx.llm,
          route,
          probePromptFor(route, fallback, overrides),
          timeoutSeconds,
          signal,
        ))
      }
    } finally {
      this.probeInFlight -= 1
    }
    const report: ProbeReport = { at, routes }
    // 取消产生的残篇不当最新报告：用户合上面板后，工作台不该显示一次"只测了两条"的结果。
    if (!signal.aborted) this.lastProbeReport = report
    return report
  }

  /**
   * The last report the scheduled run produced. The browser reads this when the
   * health view opens, so a timer-driven probe is visible without the client
   * holding a subscription — the same snapshot pattern the passive fold uses.
   */
  @Remote
  async probeReport(): Promise<ProbeReport> {
    return this.lastProbeReport
  }

  /**
   * Ask one or more routes whether their endpoint answers and advertises this
   * model, through DSH's own model discovery. An empty `routes` means every
   * route the config names.
   *
   * This runs on the Host because the classification needs the `LlmError` code
   * that `remoteDiscoverModels` strips: see ./connectivity.ts. The browser used
   * to call `remote.llm.discoverModels` itself and could not tell a channel DSH
   * cannot check at all from one whose endpoint refused the listing.
   *
   * The routes are checked concurrently, as the browser half did before the
   * move: a check costs no tokens, so a run's wall clock is the slowest
   * provider rather than their sum.
   *
   * Note: 为何搬宿主、封闭集合只收哪两个码、为何不禁用按钮 —— 见
   * .agents/notes/implemented/2026-10-16-connectivity-no-discovery-is-not-a-refusal.md
   */
  @Remote
  async checkConnectivity(request: ConnectivityRequest): Promise<ConnectivityVerdict[]> {
    const wanted = request.routes.length > 0
      ? request.routes
      : configuredRunRoutes(readConfig(this.config))
    // `settings` is read through the optional-service rule (packages/AGENTS.md):
    // a composition without it still checks, it just cannot supply a stored
    // baseURL and lets the discovery decide from the provider route alone.
    const settings = this.ctx.get('settings') as ConnectivitySettings | undefined
    return await Promise.all(wanted.map(route => checkConnectivity(this.ctx.llm, settings, route)))
  }

  /**
   * Arm the scheduled probe. The interval is user config and defaults to 0
   * (off): a probe spends a token on every tick, so whether that is acceptable
   * is the user's call. A config save restarts this fiber, which re-arms with
   * the new interval — there is no separate update path to keep in sync.
   *
   * 两个不变量：周期到点时若仍有探测在飞（手动或上一轮），本轮直接跳过——不排队、
   * 不叠加，否则 1s 周期叠 8s 超时会并发出几十轮探测，token 与限流都失控；
   * fiber 卸载时 clearInterval 之外还必须 abort 掉飞行中的那轮，否则配置一保存，
   * 上一轮的请求还在花钱。
   */
  private armProbeTimer(): void {
    const health = (this.config.health?.get() as HealthConfig | undefined)?.probe
    const seconds = health?.enabled === true ? (health.intervalSeconds || 0) : 0
    if (seconds <= 0) return
    const controller = new AbortController()
    this.probeTimer = controller
    this.probeTimerId = setInterval(() => {
      if (this.probeInFlight > 0) return
      void this.probeAll({ routes: [] }, controller.signal).catch((error: unknown) => {
        this.ctx.logger.warn(`model-router: scheduled probe failed: ${String(error)}`)
      })
    }, seconds * 1000)
    this.ctx.effect(() => () => {
      if (this.probeTimerId !== undefined) clearInterval(this.probeTimerId)
      controller.abort()
    }, 'router: probe timer')
  }
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
  return skipped.map(entry => `${routeKeyOf(entry.candidate.provider, entry.candidate.model)}:${entry.reason}`).join('|')
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

/**
 * 拒绝候选 provider 声明 `always` 重试策略。
 *
 * 这是已记录的加载时拒绝项（docs/design/dsh-capability-boundary.md §三 G2 与
 * open-questions 一.3）：always 模式没有重试上限（llm/src/retry-policy.ts），且它先
 * await 下游——下游说终态它仍会自行退避重试。放着它，`maxTotalAttempts` 就不是硬上限，
 * 用户没勾选的失败码也会被无限重试，"绝不盲重试"的承诺失效。策略是用户在每个渠道的
 * Models 设置里自己选的（llm-deepseek/src/config.ts 的 RetryPolicySchema），所以必须在
 * 这里挡住，而不是在运行时悄悄降级——降级会静默改变用户依赖的重试行为。
 *
 * `providerRetryPolicy` 是 llm 服务的原生读口（llm/src/index.ts:656），只对已注册的
 * provider 调用（未注册的会抛），未注册的漂移由 warnUnregisteredProviders 处理。
 */
function assertNoAlwaysPolicy(ctx: Context, config: { profiles: readonly Profile[]; default: DefaultProfile }): void {
  const registered = new Set(ctx.llm.listProviders().map(provider => provider.id))
  const check = (candidates: readonly Candidate[], where: string): void => {
    for (const candidate of candidates) {
      if (!registered.has(candidate.provider)) continue
      const policy = ctx.llm.providerRetryPolicy(candidate.provider)
      if (policy?.mode === 'always') {
        throw new Error(
          `model-router: ${where} candidate ${routeKeyOf(candidate.provider, candidate.model)} names a provider whose retry policy is "always" — `
          + 'unbounded same-route retries would make the total attempt cap unenforceable; '
          + 'set that provider back to the normal policy, or remove it from the chain',
        )
      }
    }
  }
  for (const profile of config.profiles) check(profile.candidates, `profile "${profile.id}"`)
  check(config.default.candidates, 'default pool')
}

function warnUnregisteredProviders(ctx: Context, config: { profiles: readonly Profile[]; default: DefaultProfile }): void {
  const registered = new Set(ctx.llm.listProviders().map(provider => provider.id))
  const check = (candidates: readonly Candidate[], where: string): void => {
    for (const candidate of candidates) {
      if (!registered.has(candidate.provider)) {
        ctx.logger.warn(
          `model-router: ${where} candidate ${routeKeyOf(candidate.provider, candidate.model)} names an unregistered provider; `
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
  /** `keys` is the native filter (session-projection/src/index.ts:339): only those units' wire views are produced. */
  snapshot(session: Session, keys?: readonly string[]): { values: Record<string, unknown> }
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
function gatherConditions(
  projections: ProjectionReadFace | undefined,
  session: Session,
  messages: readonly { content: readonly { type: string }[] }[],
): StepConditions {
  let projectedTokens: number | undefined
  if (projections !== undefined) {
    // keys 过滤是原生读口（session-projection/src/index.ts:339-353）：只产出这一个
    // 单元的 wire view。不传 keys 会把所有客户端可见单元整份过 viewSchema.parse——
    // 每步一次，含本插件自己的 24 点时间线与账本。
    const pressure = projections.snapshot(session, ['contextPressure']).values['contextPressure'] as { projectedTokens?: number } | undefined
    projectedTokens = pressure?.projectedTokens
  }
  return { hasImages: hasImageContent(messages), projectedTokens }
}

// The Typert host-face surface: re-exported so the generator's package model
// collects the @typert-marked declaration from this entry module
// (packages/typert/generator/src/analyzer.ts:748-789).
export type { Profile } from './config.ts'
