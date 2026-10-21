/**
 * Config schema for dsh-model-router.
 *
 * Schemastery is the DSH plugin Config library (184 in-tree users); `.volatile()`
 * marks the fields the Plugins-page form edits. Values are read through
 * `config.<field>.get()` in `apply`, and a hot update is validated in the
 * `internal/config` waterfall before Cordis restarts the plugin fiber.
 *
 * The shape is the canonical schema from docs/design/product-plan.md section 3:
 * an `enabled` master switch and a set of named fallback chains, one of which is
 * the default. A chain's first hop is the model the user selected in DSH — it is
 * not configured here and the plugin does not own it — so `candidates` lists the
 * fallbacks only. A session may bind itself to any chain by id; `chain` is the
 * legacy single-chain key and is read only while `chains` is absent.
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_BREAKER_SCOPE,
  DEFAULT_CHAIN_ID,
  DEFAULT_FIRST_HOP_MAX_RETRIES,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_MAX_RETRIES,
  MAX_RETRIES,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_SECONDS,
  DEFAULT_STICKY_TURNS,
  DEFAULT_STRATEGY,
  DEFAULT_SWITCH_ON,
  STRATEGIES,
  type Strategy,
  DEFAULT_TIMELINE_BUCKET_SECONDS,
} from './defaults.ts'
import { structuralViolations } from './rules.ts'

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
 * claim no new input. The gates apply to every candidate including the first
 * hop (the user's own selection): an explicit condition is the user's stated
 * intent, and honoring it is configuration, not a silent reroute. What stays
 * exempt is the automatic machinery (breaker cooldowns, capability
 * pre-validation) — DSH validated the selection when it was made.
 */
// 联合手写而不用 `(typeof STRATEGIES)[number]`：Typert 的 Zod 发射器不支持
// indexed-access 节点（packages/typert/generator/src/emitter.ts:777-788），
// 而 `ChainConfig` 的 Typert surface 经由 `strategy` 引用它。清单本身在
// ./defaults.ts（浏览器半包也读它，不能把 schemastery 拖进 bundle），显式
// 注解让 schema 与 UI 的选项在编译期保持同源。
/**
 * 降级起点策略：只决定"第一跳失败后，从哪条降级候选开始"。
 *
 * 第一跳永远是用户当前选中的模型、永远先试——选一个模型就意味着先试它，
 * 起点策略不能悄悄推翻这件事。三种策略只改降级候选的起点：按顺序、按权重
 * 随机抽、还是轮流顺移；之后的前进逻辑完全一样，继续试其余候选直到成功或
 * 用尽预算。DSH 核心没有任何原生的权重/轮询/负载均衡，所以这里自己实现，
 * 但枚举用 schemastery 的 `union` 写法（`llm-pi-ai` 的 `transport` 同款），
 * 没有 `z.enum`。
 */
export type { Strategy }
export { STRATEGIES }

export const strategySchema = z.union([...STRATEGIES]).default(DEFAULT_STRATEGY)
  .description('第一跳（你选中的模型）失败后从哪条降级候选开始：按顺序 / 按权重随机 / 轮询。第一跳永远先试，不参与抽签')

export const candidateSchema = z.object({
  provider: z.string().required().description('provider 标识，例如 deepseek-official'),
  model: z.string().required().description('模型 ID，例如 deepseek-v4-flash'),
  maxRetries: z.number().step(1).min(0).max(MAX_RETRIES).default(DEFAULT_MAX_RETRIES)
    .description('这条渠道失败后最多重试几次（不含首次调用；0 = 失败即切下一条）。重试由 DSH 执行，实际次数还受该 provider 重试策略的限制'),
  weight: z.number().step(1).min(0).max(100).default(0)
    .description('权重；只有「按权重」策略会读它，其他策略下写多少都不影响'),
  needs: z.object({
    images: z.boolean().description('图片条件：true = 仅当本次请求包含图片时使用此候选；false = 仅当本次请求不含图片时使用；不填 = 不限。对第一个候选（你选中的模型）同样生效'),
    minContextTokens: z.number().step(1).min(0).description('仅当预估上下文达到该 token 数时使用此候选；0 表示不限制'),
  }).description('高级路由条件：不满足时跳过此候选（含第一个候选）'),
})

/** Which failures move to the next candidate. Fixed set, Chinese labels. */
export const switchOnSchema = z.object({
  rateLimit: z.boolean().default(DEFAULT_SWITCH_ON.rateLimit).description('限流（RATE_LIMIT）'),
  server: z.boolean().default(DEFAULT_SWITCH_ON.server).description('服务端错误（SERVER）'),
  timeout: z.boolean().default(DEFAULT_SWITCH_ON.timeout).description('超时（TIMEOUT）'),
  transport: z.boolean().default(DEFAULT_SWITCH_ON.transport).description('网络传输失败（TRANSPORT）'),
  emptyResponse: z.boolean().default(DEFAULT_SWITCH_ON.emptyResponse).description('空回复（EMPTY_RESPONSE）。勾选时按候选的重试次数用尽后切换；不勾则由 DSH 按它自己的策略重试，重试完即失败、不切换'),
  invalidRequest: z.boolean().default(DEFAULT_SWITCH_ON.invalidRequest).description('请求被拒绝 / 能力不兼容（INVALID_REQUEST）；分类依赖 provider，不保证精确'),
  // 凭证与额度是"渠道自己的毛病"，换一条渠道往往立刻就能救——另一条渠道有自己的
  // 密钥和额度。2026-10-16 修订：此前把它们列为"配置坏了，切换只会把问题藏起来"而
  // 不切换，但熔断本来就会让后续请求跳过死渠道，那条理由只把第一次请求也搭进去；
  // 而切换从不是静默的（中文 notice 点名失败路由与码 + 熔断冷却），比干失败更响。
  auth: z.boolean().default(DEFAULT_SWITCH_ON.auth).description('凭证或权限被拒（AUTH）：换一条渠道通常立刻能救，另一条渠道有自己的密钥'),
  quota: z.boolean().default(DEFAULT_SWITCH_ON.quota).description('额度用尽（QUOTA）：同上，换渠道可继续；熔断会让后续请求先跳过这条'),
})

/**
 * 一条链的全部可编辑字段。`chainSchema`（旧形状：唯一的全局链）与
 * `namedChainSchema`（新形状：`chains[]` 里的一条）共用这份字段表——两份字段定义
 * 会让"链有哪些字段"变成两个事实，加一个字段就得记得改两处。
 */
const chainFields = {
  candidates: z.array(candidateSchema).default([])
    .description('降级候选：第一跳永远是你当前选中的模型、永远先试；失败后从这里的候选里按起点策略开始走'),
  switchOn: switchOnSchema.default({}).description('哪些失败会切换到下一个候选'),
  stickyTurns: z.number().step(1).min(0).max(99).default(DEFAULT_STICKY_TURNS)
    .description('带图轮之后，继续按「有图」路由的无图轮数；0 = 无图轮立即切回（默认）'),
  strategy: strategySchema,
  firstHopMaxRetries: z.number().step(1).min(0).max(MAX_RETRIES).default(DEFAULT_FIRST_HOP_MAX_RETRIES)
    .description('第一跳（当前选中的模型）失败后最多重试几次（不含首次调用；0 = 首发失败即降级）'),
}

export const chainSchema = z.object(chainFields)

/**
 * 一条命名链：同一份字段，外加身份。
 *
 * `id` 是会话绑定的引用键，**不可变**（改名只改 `name`）；`name` 留空时界面按
 * 「默认链」显示——把中文名字写进迁移出来的配置会让英文界面显示中文，也会让
 * 用户以为这是个必须填的字段。
 */
export const namedChainSchema = z.object({
  id: z.string().required().description('链的稳定标识；会话按它绑定，改显示名不影响绑定'),
  name: z.string().default('').description('显示名；留空表示「默认链」'),
  ...chainFields,
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
  intervalSeconds: z.number().step(1).min(0).max(86400).default(DEFAULT_INTERVAL_SECONDS)
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
  intervalSeconds: z.number().step(1).min(0).max(86400).default(DEFAULT_INTERVAL_SECONDS)
    .description('定时真探测周期（秒；0 表示只手动跑）'),
  prompt: z.string().default(DEFAULT_PROBE_PROMPT)
    .description('探测发什么内容；默认单个字符最不容易触发渠道内容过滤'),
  prompts: z.array(z.object({
    route: z.string().required().description('渠道，格式 provider/model'),
    prompt: z.string().required().description('这个渠道专用探测内容，覆盖全局默认'),
  })).default([]).description('按渠道覆盖探测内容：不同渠道违禁词不同，被拦的就单独写一个'),
  timeoutSeconds: z.number().step(1).min(2).max(60).default(DEFAULT_PROBE_TIMEOUT_SECONDS)
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
  cooldownSeconds: z.number().step(1).min(1).max(86400).default(DEFAULT_BREAKER_COOLDOWN_SECONDS)
    .description('命中后禁用多少秒；冷却到了自动放行重试，不是永久拉黑'),
  scope: z.union(['route', 'channel']).default(DEFAULT_BREAKER_SCOPE)
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
  timelineBucketSeconds: z.number().step(1).min(60).max(3600).default(DEFAULT_TIMELINE_BUCKET_SECONDS)
    .description('健康时间轴每一格代表多长时间（秒）。格子数固定 24，所以窗口 = 24 × 这一格'),
})

/** Plugin Config. Every field is volatile: all of them reach the settings form. */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile()
    .description('接管总闸：关闭时所有模型绕过插件，直接走官方适配器。默认关——接管会改请求实际打到的渠道，必须由用户显式打开'),
  // `chains` 故意不写 `.default()`：这个字段的"有没有"就是"是不是旧形状"。
  // 但 schemastery 会给任何 array 盖默认值 `[]`，所以真正判形状的是
  // `chain.ts` 的 effectiveChains（非空列表 = 新形状），这里只能去掉一层默认。
  chains: z.array(namedChainSchema).volatile()
    .description('命名链：每条链是一套完整的降级顺序；会话可以绑定到其中一条'),
  defaultChainId: z.string().default(DEFAULT_CHAIN_ID).volatile()
    .description('没有绑定（或绑定指向已删除的链）的会话走哪条链'),
  chain: chainSchema.default({}).volatile()
    .description('旧形状：唯一的全局链。只在新形状缺失时读取，首次保存后会被移除'),
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
  /** Retries AFTER the first call; the step core works in call counts (`maxRetries + 1`). */
  maxRetries: number
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
  auth: boolean
  quota: boolean
}

// The `@typert` tag below marks this interface as the package's host-face
// surface: the generator emits a contribution only for a package whose
// reachable sources carry a marked declaration
// (packages/typert/generator/src/analyzer.ts:2775-2808), and `ChainConfig` is
// the plugin's central business type. Why this type, and which alternatives were
// rejected, are recorded in
// .agents/notes/implemented/2026-10-15-out-of-tree-build-pipeline.md
/** The one global fallback chain; the first hop is the user's own selection.
 *
 * @typert
 */
export interface ChainConfig {
  candidates: Candidate[]
  switchOn: SwitchOn
  stickyTurns: number
  strategy: Strategy
  /** Retries AFTER the first hop's first call; the step core converts to calls. */
  firstHopMaxRetries: number
}

/**
 * One named chain: the same fields plus the identity a session binds to.
 *
 * `id` is the immutable reference key (rename only touches `name`); an empty
 * `name` means "the default chain" and is labelled by the dictionary, so a
 * migrated config never hard-codes a Chinese name into YAML.
 */
export interface NamedChain extends ChainConfig {
  id: string
  name: string
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
  /** One timeline bar's width, in seconds. The window is 24 × this. */
  timelineBucketSeconds: number
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
  /** Absent (an undefined value, not an empty array) in a config written by an older build. */
  chains: Volatile<NamedChain[] | undefined>
  defaultChainId: Volatile<string>
  /** The legacy single chain; read only while `chains` is absent. */
  chain: Volatile<ChainConfig>
  health: Volatile<HealthConfig>
}

/** The plain config value shape, for validating a hot update before it applies. */
export type RouterOptions = { [K in keyof Config]?: Config[K] extends Volatile<infer T> ? T : never }

/**
 * Structural CROSS-FIELD validation, run before a config update restarts the
 * plugin fiber. Single-field bounds (a negative number, an empty string) are
 * the schema's job — both production code paths run the schema first, so a
 * guard repeated here is dead code that only starts lying when the schema
 * tightens. What is left is what no single field can know: a repeated route in
 * the chain, a weight strategy with nothing to draw, a breaker rule that
 * matches nothing.
 *
 * Note: 为何删掉 8 个数值 guard（实测全被 schema 挡在前面）—— 见
 * .agents/notes/implemented/2026-10-17-finish-the-shared-modules.md；
 * 为何跨字段规则与浏览器半包同源（被否的「两边各留 + 对账测试」方案）—— 见
 * .agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md
 *
 * The rules themselves live once in ./rules.ts, shared with the browser half
 * (which formats every violation instead of throwing the first); this
 * function is the host's rendering.
 *
 * Deliberately narrow: only errors that are wrong in every environment. A
 * candidate whose provider is not registered is environmental drift (the user
 * may uninstall a provider later), so it degrades to a warning instead of
 * failing the whole plugin — see .agents/notes and
 * docs/design/product-plan.md section 9.
 */
export function assertStructural(config: {
  chains: NamedChain[]
  defaultChainId: string
  health?: HealthConfig
}): void {
  const [first] = structuralViolations(config)
  if (first !== undefined) throw new Error(first.message)
}
