/**
 * Config schema for dsh-model-router.
 *
 * Schemastery is the DSH plugin Config library (184 in-tree users); `.volatile()`
 * marks the fields the Plugins-page form edits. Values are read through
 * `config.<field>.get()` in `apply`, and a hot update is validated in the
 * `internal/config` waterfall before Cordis restarts the plugin fiber.
 *
 * The shape is the canonical schema from docs/design/product-plan.md section 3:
 * an `enabled` master switch, an array of per-model profiles, and a `default`
 * pure-fallback pool. `candidates[0]` of a matched profile is pinned to the
 * `when` model, so the user's own selection is always in the chain and always
 * attempted — but under the `weight` and `round-robin` strategies it is not
 * necessarily the first hop. Those strategies move the start on purpose.
 */

import z from '@deepseek-ai/schemastery'
import { routeKeyOf } from './routes.ts'

/**
 * One physical candidate. Credentials stay owned by the provider adapter.
 *
 * `needs` gates the candidate on the shape of THIS request: `images` is
 * tri-state (`true` = only when the step's admitted user messages carry an
 * image, `false` = only when they do not, absent = unconstrained),
 * `minContextTokens` requires the context-pressure projection's estimate for
 * the next request. Both are read once per step (agent/pre-step and the
 * projection), so they are stable across the step's retries — with `images`
 * accumulating across a turn's steps, because a tool-loop turn's later steps
 * claim no new input. The gates apply to every candidate including a matched
 * profile's pinned `candidates[0]`: an explicit condition is the user's stated
 * intent, and honoring it is configuration, not a silent reroute. What stays
 * exempt is the automatic machinery (breaker cooldowns, capability
 * pre-validation) — DSH validated the selection when it was made.
 */
// 联合手写而不用 `(typeof STRATEGIES)[number]`：Typert 的 Zod 发射器不支持
// indexed-access 节点（packages/typert/generator/src/emitter.ts:777-788），
// 而 `Profile` 的 Typert surface 经由 `strategy` 引用它。`STRATEGIES` 的显式
// 注解让两份清单在编译期保持同源——写错一个值 tsc 就红。
/**
 * 选路策略：只决定"从哪条渠道开始"。
 *
 * 三种策略失败之后的行为完全一样——继续试链上其余渠道，直到成功或用尽预算。
 * 它们唯一的区别是起点：永远第一条、按权重比例随机抽一条、还是轮流顺移。
 * DSH 核心没有任何原生的权重/轮询/负载均衡，所以这里自己实现，但枚举用
 * schemastery 的 `union` 写法（`llm-pi-ai` 的 `transport` 同款），没有 `z.enum`。
 */
export type Strategy = 'order' | 'weight' | 'round-robin'

export const STRATEGIES: readonly Strategy[] = ['order', 'weight', 'round-robin']

export const strategySchema = z.union([...STRATEGIES]).default('order')
  .description('从哪条渠道开始：按顺序 / 按权重随机 / 轮询')

export const candidateSchema = z.object({
  provider: z.string().required().description('provider 标识，例如 deepseek-official'),
  model: z.string().required().description('模型 ID，例如 deepseek-v4-flash'),
  maxAttempts: z.number().step(1).min(1).max(5).default(1)
    .description('这条渠道最多真实调用多少次（切换前会有一次退避等待）'),
  weight: z.number().step(1).min(0).max(100).default(0)
    .description('权重；只有「按权重」策略会读它，其他策略下写多少都不影响'),
  needs: z.object({
    images: z.boolean().description('图片条件：true = 仅当本次请求包含图片时使用此候选；false = 仅当本次请求不含图片时使用；不填 = 不限。对第一个候选（你选中的模型）同样生效'),
    minContextTokens: z.number().step(1).min(0).description('仅当预估上下文达到该 token 数时使用此候选；0 表示不限制'),
  }).description('高级路由条件：不满足时跳过此候选（含第一个候选）'),
})

/** Which failures move to the next candidate. Fixed set, Chinese labels. */
export const switchOnSchema = z.object({
  rateLimit: z.boolean().default(true).description('限流（RATE_LIMIT）'),
  server: z.boolean().default(true).description('服务端错误（SERVER）'),
  timeout: z.boolean().default(true).description('超时（TIMEOUT）'),
  transport: z.boolean().default(true).description('网络传输失败（TRANSPORT）'),
  emptyResponse: z.boolean().default(false).description('空回复（EMPTY_RESPONSE）'),
  invalidRequest: z.boolean().default(false).description('请求被拒绝 / 能力不兼容（INVALID_REQUEST）；分类依赖 provider，不保证精确'),
})

/** One backup chain for the exact provider/model the user picks. */
export const profileSchema = z.object({
  id: z.string().required().description('规则 ID，不可与其他规则重复'),
  when: z.object({
    provider: z.string().required().description('用户选中的 provider'),
    model: z.string().required().description('用户选中的模型 ID'),
  }).required().description('用户选中这个模型时，本规则生效'),
  candidates: z.array(candidateSchema).required()
    .description('按顺序尝试的候选渠道；第一个必须就是 when 模型（钉死，但权重/轮询策略下不一定是第一跳）'),
  switchOn: switchOnSchema.default({}).description('哪些失败会切换到下一个候选'),
  maxTotalAttempts: z.number().step(1).min(1).default(6)
    .description('这个请求最多真实调用多少次（硬上限，含同渠道重试与跨渠道降级）'),
  stickyTurns: z.number().step(1).min(0).max(99).default(0)
    .description('带图轮之后，继续按「有图」路由的无图轮数；0 = 无图轮立即切回（默认）。追问刚发过的图片时设 2~3，识图模型多粘几轮'),
  strategy: strategySchema,
})

/** The pure fallback pool for models without a dedicated profile. */
export const defaultSchema = z.object({
  enabled: z.boolean().default(false).description('是否接管未配置专属规则的模型'),
  candidates: z.array(candidateSchema).default([])
    .description('通用降级池；用户当前选中的模型永远是第一跳，本池是纯备用'),
  switchOn: switchOnSchema.default({}).description('哪些失败会切换到下一个候选'),
  maxTotalAttempts: z.number().step(1).min(1).default(3)
    .description('接管时单请求最多真实调用多少次（硬上限）'),
  stickyTurns: z.number().step(1).min(0).max(99).default(0)
    .description('带图轮之后，继续按「有图」路由的无图轮数；0 = 无图轮立即切回（默认）'),
  strategy: strategySchema,
})

/**
 * "敲门"档：向渠道要一份模型清单，不生成任何内容。
 *
 * 走 DSH 原生的 `ctx.llm.discoverModels`——就是设置页「获取可用模型」按钮的同一套。
 * 它能证明端点可达、凭证有效、这个模型 ID 被广告，但不证明模型真能出字。
 * 零输出 Token；provider 在适配器目录里时甚至不发网络请求。
 */
export const discoverSchema = z.object({
  enabled: z.boolean().default(true).description('定时连通性检查：到点向渠道要一份模型清单，不生成内容、不花 Token'),
  intervalSeconds: z.number().step(1).min(0).max(86400).default(0)
    .description('定时检查周期（秒；0 表示只手动跑，不后台轮询）。限流是每个渠道各自的，按你自己渠道的承受能力设'),
})

/**
 * "真探测"档：真的发一条最小消息。
 *
 * 这是唯一能证明「模型现在真能出字」的方式——配额打满、上游容量不足、模型被下线但仍在
 * 清单里，都只有真生成才暴露。代价是花 Token，所以默认关闭，由用户自己决定要不要花。
 *
 * `prompt` 与 `prompts` 只对这一档有意义：前两档不发消息，碰不到渠道违禁词。违禁词是
 * 每个渠道各不一样的，所以全局默认之外再给按渠道覆盖。
 */
export const probeSchema = z.object({
  enabled: z.boolean().default(false).description('定时真探测：真的发一条最小消息，唯一能证明模型能出字，但会花 Token'),
  intervalSeconds: z.number().step(1).min(0).max(86400).default(0)
    .description('定时真探测周期（秒；0 表示只手动跑）'),
  prompt: z.string().default('1')
    .description('探测发什么内容；默认单个字符最不容易触发渠道内容过滤'),
  prompts: z.array(z.object({
    route: z.string().required().description('渠道，格式 provider/model'),
    prompt: z.string().required().description('这个渠道专用探测内容，覆盖全局默认'),
  })).default([]).description('按渠道覆盖探测内容：不同渠道违禁词不同，被拦的就单独写一个'),
  timeoutSeconds: z.number().step(1).min(2).max(60).default(8)
    .description('单次探测超时时间（秒）'),
})

/**
 * 一条自动禁用（熔断）规则。
 *
 * `code` 与 `message` 都是可选的，填几个就按几个匹配，都填就是两条都要满足——
 * 这样"只知道码"和"只有错误信息能判断"两种情况能用同一种规则表达。留空一个是
 * 为了让规则表保持一种形状，而不是逼用户在两种规则类型之间选。
 */
export const breakRuleSchema = z.object({
  code: z.string().default('').description('错误码，精确匹配；留空表示这一条不按码匹配'),
  message: z.string().default('').description('错误信息包含这个字符串就命中；留空表示不按信息匹配'),
  cooldownSeconds: z.number().step(1).min(1).max(86400).default(300)
    .description('命中后禁用多少秒；冷却到了自动放行重试，不是永久拉黑'),
  scope: z.union(['route', 'channel']).default('route')
    .description('禁用范围：仅此模型 = 只禁这条 provider/model；整条渠道 = 该 provider 下所有模型一起禁（密钥失效、网关整体故障时用）'),
})

/**
 * 自动禁用：渠道命中规则后凉一段时间。DSH 核心没有任何熔断/冷却机制
 * （`llm-retry` 的计数在 step/start 就清零，明确是单次请求内），所以这里自己做。
 */
export const breakerSchema = z.object({
  enabled: z.boolean().default(false).description('自动禁用：渠道命中规则后凉一段时间，冷却到了自动放行重试'),
  rules: z.array(breakRuleSchema).default([]),
})

/** 渠道健康监控配置：四档各自独立，用户自己选开哪些。 */
export const healthSchema = z.object({
  passive: z.boolean().default(true)
    .description('运行时记录：正常对话的结果自动记入渠道健康，零成本，但只能反映已经发生过的事'),
  discover: discoverSchema.default({}),
  probe: probeSchema.default({}),
  breaker: breakerSchema.default({}),
})

/** Plugin Config. Every field is volatile: all of them reach the settings form. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile()
    .description('总闸：关闭时所有模型绕过插件，直接走官方适配器'),
  profiles: z.array(profileSchema).default([]).volatile()
    .description('路由规则列表；按 when 精确匹配'),
  default: defaultSchema.default({}).volatile()
    .description('全局默认兜底：接管未配置专属规则的模型'),
  health: healthSchema.default({}).volatile()
    .description('渠道健康监控：运行时记录、连通性检查、发送测试消息、自动禁用四档'),
})

/**
 * Hand-written value types. Schemastery has no type inference (`z.infer` does
 * not exist), so the DSH pattern (see llm-pi-ai's config.ts) is three
 * declarations sharing one name space split: the value interfaces, a `Config`
 * interface whose fields are `Volatile<T>` accessors for `apply`, and the
 * schema value. Cordis freezes config values at runtime, which is what makes
 * the stored snapshots safe to share without defensive copies.
 */

import type { Volatile } from '@deepseek-ai/cordis'

/** One physical candidate. Credentials stay owned by the provider adapter. */
export interface Candidate {
  provider: string
  model: string
  maxAttempts: number
  /** Only read by the `weight` strategy. */
  weight: number
  needs?: { images?: boolean; minContextTokens?: number }
}

/** Which failures move to the next candidate. Fixed set, Chinese labels. */
export interface SwitchOn {
  rateLimit: boolean
  server: boolean
  timeout: boolean
  transport: boolean
  emptyResponse: boolean
  invalidRequest: boolean
}

// The `@typert` tag below marks this interface as the package's host-face
// surface: the generator emits a contribution only for a package whose
// reachable sources carry a marked declaration
// (packages/typert/generator/src/analyzer.ts:2775-2808), and `Profile` is the
// plugin's central business type. Why this type, and which alternatives were
// rejected, are recorded in
// .agents/notes/implemented/2026-10-15-out-of-tree-build-pipeline.md
/** One backup chain for the exact provider/model the user picks.
 *
 * @typert
 */
export interface Profile {
  id: string
  when: { provider: string; model: string }
  candidates: Candidate[]
  switchOn: SwitchOn
  maxTotalAttempts: number
  stickyTurns: number
  strategy: Strategy
}

/** The pure fallback pool for models without a dedicated profile. */
export interface DefaultProfile {
  enabled: boolean
  candidates: Candidate[]
  switchOn: SwitchOn
  maxTotalAttempts: number
  stickyTurns: number
  strategy: Strategy
}

/** "敲门"档配置：要一份模型清单，不生成内容。 */
export interface DiscoverConfig {
  enabled: boolean
  intervalSeconds: number
}

/** "真探测"档配置：真的发一条最小消息，唯一能证明模型能出字。 */
export interface ProbeConfig {
  enabled: boolean
  intervalSeconds: number
  prompt: string
  prompts: { route: string; prompt: string }[]
  timeoutSeconds: number
}

/** 渠道健康监控配置：四档各自独立。 */
export interface HealthConfig {
  passive: boolean
  discover: DiscoverConfig
  probe: ProbeConfig
  breaker: BreakerConfig
}

/** 一条自动禁用规则。 */
export interface BreakRule {
  code: string
  message: string
  cooldownSeconds: number
  /**
   * `route`（默认）只禁这一条 provider/model；`channel` 把该 provider 下所有模型
   * 一起禁。区分来自实测：同一个网关渠道里模型各坏各的（按路由禁才不会埋掉好
   * 模型），而密钥失效、网关整体故障是按渠道坏的（只禁一个模型，链上会把同渠道
   * 其余模型各真打一次才跨渠道，白白吃掉 attempt 预算）。哪种码属于哪种，provider
   * 之间没有共识，所以由用户在规则上显式声明，不猜。
   */
  scope: BreakerScope
}

/** 熔断作用域：禁一条路由，还是禁整条 provider 渠道。 */
export type BreakerScope = 'route' | 'channel'

/** 自动禁用配置。 */
export interface BreakerConfig {
  enabled: boolean
  rules: BreakRule[]
}

/** Plugin configuration as `apply` sees it: every field is a Volatile accessor. */
export interface Config {
  enabled: Volatile<boolean>
  profiles: Volatile<Profile[]>
  default: Volatile<DefaultProfile>
  health: Volatile<HealthConfig>
}

/** The plain config value shape, for validating a hot update before it applies. */
export type RouterOptions = { [K in keyof Config]?: Config[K] extends Volatile<infer T> ? T : never }

/** The failure codes `switchOn` can name, and the config key each maps to. */
export const SWITCH_ON_KEYS = [
  'rateLimit',
  'server',
  'timeout',
  'transport',
  'emptyResponse',
  'invalidRequest',
] as const

/** Map a normalized `LlmFailure.code` to its `switchOn` key; undefined = never a Router concern. */
export function switchOnKeyOf(code: string): (typeof SWITCH_ON_KEYS)[number] | undefined {
  switch (code) {
    case 'RATE_LIMIT': return 'rateLimit'
    case 'SERVER': return 'server'
    case 'TIMEOUT': return 'timeout'
    case 'TRANSPORT': return 'transport'
    case 'EMPTY_RESPONSE': return 'emptyResponse'
    case 'INVALID_REQUEST': return 'invalidRequest'
    default: return undefined
  }
}

/** Reject one chain naming the same physical route twice. */
function assertNoDuplicateRoutes(candidates: readonly Candidate[], where: string): void {
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = routeKeyOf(candidate.provider, candidate.model)
    if (seen.has(key)) {
      throw new Error(`model-router: ${where} names ${key} more than once — a repeated candidate is attempted twice and burns the budget twice`)
    }
    seen.add(key)
  }
}

/**
 * Structural cross-field validation, run before a config update restarts the
 * plugin fiber. Deliberately narrow: only errors that are wrong in every
 * environment. A candidate whose provider is not registered is environmental
 * drift (the user may uninstall a provider later), so it degrades that profile
 * to disabled with a warning instead of failing the whole plugin — see
 * .agents/notes and docs/design/product-plan.md section 9.
 */
export function assertStructural(config: {
  profiles: readonly Profile[]
  default: DefaultProfile
  health?: HealthConfig
}): void {
  const seen = new Set<string>()
  for (const profile of config.profiles) {
    if (seen.has(profile.id)) {
      throw new Error(`model-router: duplicate profile id "${profile.id}"`)
    }
    seen.add(profile.id)
    if (profile.candidates.length === 0) {
      throw new Error(`model-router: profile "${profile.id}" has no candidates`)
    }
    const head = profile.candidates[0]!
    if (head.provider !== profile.when.provider || head.model !== profile.when.model) {
      throw new Error(
        `model-router: profile "${profile.id}" candidates[0] must be the when model `
        + `(${profile.when.provider}/${profile.when.model}), got ${head.provider}/${head.model}`,
      )
    }
    for (const candidate of profile.candidates) {
      if (candidate.maxAttempts < 1) {
        throw new Error(`model-router: profile "${profile.id}" candidate maxAttempts must be >= 1`)
      }
    }
    // 同一条链上重复的 provider/model 没有意义：它会被各打一遍（各含一次退避等待），
    // 白吃 attempt 预算，而用户看到的是"我配了两条备用"。目录选择和多条目手录都可能
    // 录出重复，所以在结构校验就挡住，和 ID 重复同级。
    assertNoDuplicateRoutes(profile.candidates, `profile "${profile.id}"`)
    if (profile.maxTotalAttempts < 1) {
      throw new Error(`model-router: profile "${profile.id}" maxTotalAttempts must be >= 1`)
    }
    if (profile.stickyTurns < 0) {
      throw new Error(`model-router: profile "${profile.id}" stickyTurns must be >= 0`)
    }
  }
  if (config.default.maxTotalAttempts < 1) {
    throw new Error('model-router: default.maxTotalAttempts must be >= 1')
  }
  if (config.default.stickyTurns < 0) {
    throw new Error('model-router: default.stickyTurns must be >= 0')
  }
  assertNoDuplicateRoutes(config.default.candidates, 'default pool')
  // A weight strategy with no positive weight has nothing to draw from, and the
  // failure would surface as every request silently starting at candidate 0.
  for (const [where, chain] of [['profile', config.profiles], ['default', [config.default]]] as const) {
    for (const entry of chain) {
      if (entry.strategy !== 'weight') continue
      if (entry.candidates.every(candidate => candidate.weight <= 0)) {
        throw new Error(`model-router: ${where} uses the weight strategy but no candidate has a positive weight`)
      }
    }
  }
  if (config.health !== undefined) {
    for (const [where, seconds] of [
      ['health.discover.intervalSeconds', config.health.discover?.intervalSeconds],
      ['health.probe.intervalSeconds', config.health.probe?.intervalSeconds],
    ] as const) {
      if (seconds !== undefined && seconds < 0) {
        throw new Error(`model-router: ${where} must be >= 0`)
      }
    }
    if (config.health.probe !== undefined && config.health.probe.timeoutSeconds < 1) {
      throw new Error('model-router: health.probe.timeoutSeconds must be >= 1')
    }
  }
  // 一条两个字段都空白的规则永远命中不了任何东西，留着只会让人以为配过了。
  // 空规则在任何状态下都是配置错误：breaker.ts 对 code/message 全空的规则命中每一次
  // 失败，"关着开关存下一条空规则"会让所有候选被禁。所以这里不看 enabled——规则可以
  // 留着（再开时不用重填），空白规则不行。
  if (config.health?.breaker !== undefined) {
    (config.health.breaker.rules ?? []).forEach((rule, index) => {
      if (rule.code.length === 0 && rule.message.length === 0) {
        throw new Error(`model-router: health.breaker rule ${index + 1} matches nothing — fill in a code or a message`)
      }
    })
  }
}
