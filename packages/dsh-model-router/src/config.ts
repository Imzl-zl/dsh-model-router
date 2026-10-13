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
 * `when` model — the user's own selection always attempts first.
 */

import z from '@deepseek-ai/schemastery'

/**
 * One physical candidate. Credentials stay owned by the provider adapter.
 *
 * `needs` gates the candidate on the shape of THIS request: `images` requires
 * an image block in the step's admitted user messages, `minContextTokens`
 * requires the context-pressure projection's estimate for the next request.
 * Both are read once per step (agent/pre-step and the projection), so they are
 * stable across the step's retries. The user's own route (a matched profile's
 * pinned candidates[0], or the default pool's implicit first hop) is exempt:
 * skipping it would be a silent reroute.
 */
export const candidateSchema = z.object({
  provider: z.string().required().description('provider 标识，例如 deepseek-official'),
  model: z.string().required().description('模型 ID，例如 deepseek-v4-flash'),
  maxAttempts: z.number().step(1).min(1).max(5).default(1)
    .description('这条渠道最多真实调用多少次（切换前会有一次退避等待）'),
  needs: z.object({
    images: z.boolean().description('仅当本次请求包含图片时使用此候选'),
    minContextTokens: z.number().step(1).min(0).description('仅当预估上下文达到该 token 数时使用此候选；0 表示不限制'),
  }).description('高级路由条件：不满足时跳过此候选'),
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
    .description('按顺序尝试的候选渠道；第一个必须就是 when 模型（钉死）'),
  switchOn: switchOnSchema.default({}).description('哪些失败会切换到下一个候选'),
  maxTotalAttempts: z.number().step(1).min(1).default(6)
    .description('这个请求最多真实调用多少次（硬上限，含同渠道重试与跨渠道降级）'),
})

/** The pure fallback pool for models without a dedicated profile. */
export const defaultSchema = z.object({
  enabled: z.boolean().default(false).description('是否接管未配置专属规则的模型'),
  candidates: z.array(candidateSchema).default([])
    .description('通用降级池；用户当前选中的模型永远是第一跳，本池是纯备用'),
  switchOn: switchOnSchema.default({}).description('哪些失败会切换到下一个候选'),
  maxTotalAttempts: z.number().step(1).min(1).default(3)
    .description('接管时单请求最多真实调用多少次（硬上限）'),
})

/** Health monitoring and proactive probe configuration. */
export const healthSchema = z.object({
  enabled: z.boolean().default(true).description('是否启用渠道健康监控'),
  prompt: z.string().default('hi').description('主动探测消息内容（避免使用渠道违禁词）'),
  intervalMinutes: z.number().step(1).min(0).max(1440).default(0)
    .description('自动探测周期（分钟；0 表示仅手动探测与被动观测，避免产生额外 Token）'),
  timeoutSeconds: z.number().step(1).min(2).max(60).default(8)
    .description('单次探测超时时间（秒）'),
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
    .description('渠道健康监控：被动观测与主动探测配置'),
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

/** One backup chain for the exact provider/model the user picks. */
export interface Profile {
  id: string
  when: { provider: string; model: string }
  candidates: Candidate[]
  switchOn: SwitchOn
  maxTotalAttempts: number
}

/** The pure fallback pool for models without a dedicated profile. */
export interface DefaultProfile {
  enabled: boolean
  candidates: Candidate[]
  switchOn: SwitchOn
  maxTotalAttempts: number
}

/** Health monitoring and proactive probe configuration. */
export interface HealthConfig {
  enabled: boolean
  prompt: string
  intervalMinutes: number
  timeoutSeconds: number
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
    if (profile.maxTotalAttempts < 1) {
      throw new Error(`model-router: profile "${profile.id}" maxTotalAttempts must be >= 1`)
    }
  }
  if (config.default.maxTotalAttempts < 1) {
    throw new Error('model-router: default.maxTotalAttempts must be >= 1')
  }
  if (config.health !== undefined) {
    if (config.health.intervalMinutes < 0) {
      throw new Error('model-router: health.intervalMinutes must be >= 0')
    }
    if (config.health.timeoutSeconds < 1) {
      throw new Error('model-router: health.timeoutSeconds must be >= 1')
    }
  }
}
