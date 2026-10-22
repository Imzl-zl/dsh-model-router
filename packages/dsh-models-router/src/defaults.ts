/**
 * Every default value the plugin has, and the switch-on code table: one place.
 *
 * The host schema (config.ts) and the browser half (client/validate.ts,
 * client/controller.ts, client/pipeline.ts, client/modals.ts) each need the
 * same numbers for the same fields. A saved config always carries them, but a
 * fresh draft, a legacy record and a new form row do not — and when each side
 * writes its own copy the two drift. That drift is silent and user-visible:
 * "the UI says 6, the host enforces 3".
 *
 * The switch-on table is here for the same reason. Which `LlmFailure.code`
 * moves a chain to its next candidate is one fact with three readers: the
 * host's `switchOnKeyOf` (routing), the browser's switch-on grid (UI), and the
 * notice's Chinese labels (user-facing text). A ninth code is added here once.
 *
 * Note: 默认值与码清单为何收编到一处、被否方案 —— 见
 * .agents/notes/implemented/2026-10-17-finish-the-abstractions.md
 */

/**
 * One candidate's own retry budget: retries AFTER its first call.
 *
 * **默认 5（2026-10-22）**，与 DSH 自己的 provider 默认完全一致
 * （`llm/llm/src/retry-policy.ts` 的 `DEFAULT_MAX_RETRIES = 5`）。理由有二：
 *
 * - 插件接管重试之后，如果默认比 DSH 小，升级反而让韧性变差——旧行为是"选中模型
 *   先自己重试 5 次"，不能变成"失败一次就换模型"；
 * - 用户的心智是"先让它自己重试，重试还不行才按配置的链路切"。默认 0/1 与这句话
 *   不符，而这两个数就是这句话的唯一开关。
 *
 * 上限仍是 99，逐条候选可调；想"失败即切"就设 0。
 */
export const DEFAULT_MAX_RETRIES = 5

/**
 * The implicit first hop's default retry budget.
 *
 * 与候选同一个默认值：第一跳就是用户选中的模型，它失败了也走同一套"重试若干次再
 * 换"的规则——换模型会打断连贯性，DSH 还会插一条 model changed 通知，不到最后不该动。
 */
export const DEFAULT_FIRST_HOP_MAX_RETRIES = 5

/**
 * The upper bound both retry fields accept. A sanity bound for the stepper, not
 * a policy: the real bound is the provider's own retry policy, which is what
 * actually supplies the retries.
 */
export const MAX_RETRIES = 99

/**
 * The upper bound of a SESSION override for one route's retries (0..99).
 *
 * Same sanity bound as the chain's own budget: an override is the same number
 * (retries after the first call) applied to one session, and a separate lower
 * cap only made users hit an unexplained 9. It is still a bound, not a policy:
 * the provider's retry policy decides how many of those retries can actually
 * run.
 */
export const MAX_SESSION_RETRIES = MAX_RETRIES

/** After an image turn, keep routing to the vision model for this many text turns. */
export const DEFAULT_STICKY_TURNS = 0

/**
 * The id of the chain every session falls back to, and the id the one-time
 * migration gives the single chain an older build stored.
 *
 * It is an id, not a name: the chip and the session bindings reference chains by
 * id, so renaming the default chain never breaks a binding.
 */
export const DEFAULT_CHAIN_ID = 'default'

/** Where a chain starts: the first candidate, by order. */
export const DEFAULT_STRATEGY = 'order'

/**
 * The start strategies, one list for the host schema and the browser's
 * segmented control. Only the START differs; every strategy then walks the
 * same remaining candidates. A fourth value is added here once.
 */
export type Strategy = 'order' | 'weight' | 'round-robin'

export const STRATEGIES: readonly Strategy[] = ['order', 'weight', 'round-robin']

/** No schedule: the health timers are opt-in because they spend money or quota. */
export const DEFAULT_INTERVAL_SECONDS = 0

/** The probe's message: one character is least likely to trip a channel's content filter. */
export const DEFAULT_PROBE_PROMPT = '1'

/** One probe's timeout, in seconds. */
export const DEFAULT_PROBE_TIMEOUT_SECONDS = 8

/** How long a breaker hit takes a route or channel out of rotation, in seconds. */
export const DEFAULT_BREAKER_COOLDOWN_SECONDS = 300

/**
 * One timeline bar's width, in seconds. Re-exported from ./timeline.ts, which
 * owns the window rule both halves read; the default lives here with every
 * other config default so the schema and the browser draft cannot drift.
 */
export { DEFAULT_TIMELINE_BUCKET_SECONDS, TIMELINE_BUCKET_SECONDS } from './timeline.ts'

/** What a breaker hit disables: this route, or the whole provider channel. */
export const DEFAULT_BREAKER_SCOPE = 'route'

/**
 * The `switchOn` defaults, as one object both halves read. The host schema
 * references it per field; the browser draft clones it. Typed by the table's
 * key union below, so a key added there is a compile error here until it is
 * given a default.
 *
 * **全部为 true（2026-10-22 定案）**：此前 `emptyResponse` / `invalidRequest`
 * 默认关，于是"失败后什么也不做"成了默认动作——两层都不管：插件因为没勾不切换，
 * DSH 的 `llm-retry` 因为该码不在它的默认可重试集里也不重试，一个 402 就能让整轮
 * 卡死。用户的原话是"报错就重试或者切换"，所以默认反转为**任何失败都动**，
 * 想不动的码由用户显式取消勾选（取消 = 交给 DSH 收尾，插件不插手）。
 *
 * `other` 是表里那 8 个码之外的一切（`PI_AI_ERROR`、`HTTP_xxx`、以后新增的码）。
 * 它默认也是 true：枚举永远覆盖不全，未知码必须按"该动"处理，而不是静默死区。
 *
 * Note: 默认口径为什么反转、被否的"继续补码"方案 —— 见
 * .agents/notes/implemented/2026-10-22-failover-by-default-and-max-token-continue.md
 */
export const DEFAULT_SWITCH_ON: Record<SwitchOnKey, boolean> = {
  rateLimit: true,
  server: true,
  timeout: true,
  transport: true,
  emptyResponse: true,
  invalidRequest: true,
  // 渠道自身的凭证/额度问题：另一条渠道有自己的密钥和额度，切换通常立刻能救。
  // 2026-10-16 修订，依据见 .agents/notes/implemented/2026-10-16-switch-on-auth-and-quota.md。
  auth: true,
  quota: true,
  other: true,
}

/**
 * 由 DSH 自己的恢复插件拥有的失败码：路由器**永远先问内层**，不抢在它们前面做决定。
 *
 * - `CONTEXT_WINDOW_EXCEEDED` → `compaction-basic`（压缩历史才是对的修法，换渠道只会
 *   把同一个超长请求再撞一次，还可能撞到窗口更小的渠道）；
 * - `IMAGE_OFFLOAD_REQUIRED` → `compaction-image-offload`（按路由声明的图片预算卸载图片）。
 *
 * 这两个码进不了 `switchOn` 表（表只列路由器能决策的码），它们落在 `other` 之下：
 * 内层要接就接，内层放弃之后才轮到路由器按 `other` 的勾选切换。
 * 这是一份**代码级**清单而不是用户配置：它描述的是"DSH 里还有谁在这个扩展点上"，
 * 不是用户的偏好。
 */
export const DELEGATE_FIRST_CODES: readonly string[] = [
  'CONTEXT_WINDOW_EXCEEDED',
  'IMAGE_OFFLOAD_REQUIRED',
]

/**
 * 无论如何都不切换的码：没有"切换"这个动作可言。
 *
 * - `ABORTED` 是用户自己按的停止（真实路径上由 `signal.aborted` 表达，这个码是
 *   兜底）：替一个没人要的结果换渠道是一次白花的调用；
 * - `NO_ADAPTER` 意味着链上根本没有能服务这个请求的适配器，换一条候选也没有对象
 *   （用户自己那条路由的情况已在预检里跳过）。
 *
 * 它们不进 `switchOn` 表、也不吃 `other` 的默认值——兜底说的是"未知不等于不该动"，
 * 不是"已知不该动的也动"。
 */
export const NEVER_SWITCH_CODES: readonly string[] = ['ABORTED', 'NO_ADAPTER']

/** 该码是否必须先交给内层恢复插件试一次。表里没有的码一律如此。 */
export function delegatesFirst(code: string): boolean {
  return switchOnKeyOf(code) === undefined || DELEGATE_FIRST_CODES.includes(code)
}

/**
 * 输出被截断（`max-tokens`）时，同一个候选上自动"继续"几次；用完就换下一个候选。
 *
 * `max-tokens` 不是错误，走不到 `agent/request-error`：DSH 直接在 `agent-loop`
 * 里结束本轮（`agent.ts:547`），界面那条"已达到输出 token 上限 … 发送继续"就是
 * 在让用户自己补这句话。插件的目的是"别停在这儿"，所以默认接管。
 */
export const DEFAULT_MAX_TOKEN_CONTINUES = 2

/** 截断时是否自动续跑；默认开，"续几次、用完换候选"见 {@link DEFAULT_MAX_TOKEN_CONTINUES}。 */
export const DEFAULT_MAX_TOKEN_AUTO_CONTINUE = true

/** 自动续跑次数的上限（每个候选每轮）。 */
export const MAX_TOKEN_CONTINUES = 9

/**
 * 配置策略版本：v2 = "失败默认全切" 这一版语义。
 *
 * 旧配置里 `emptyResponse` / `invalidRequest` 被**显式写成了 false**（那是当时的
 * 默认值，用户从未选择过），只改 schema 默认值救不了已有配置。读取时按这个标记
 * 做一次性改写：没有 v2 标记 = 全部按新默认（true）。第一次保存后标记落盘，
 * 用户之后自己取消勾选的选择就再也不被覆盖。
 */
export const POLICY_VERSION = 2

/**
 * The failure codes a chain may switch on: the config key each maps to, DSH's
 * own `LlmFailure.code`, and the dictionary key the browser labels it with.
 */
export const SWITCH_ON_CODES = [
  { key: 'rateLimit', code: 'RATE_LIMIT', labelKey: 'rateLimit' },
  { key: 'server', code: 'SERVER', labelKey: 'serverError' },
  { key: 'timeout', code: 'TIMEOUT', labelKey: 'timeout' },
  { key: 'transport', code: 'TRANSPORT', labelKey: 'transport' },
  { key: 'emptyResponse', code: 'EMPTY_RESPONSE', labelKey: 'emptyResponse' },
  { key: 'invalidRequest', code: 'INVALID_REQUEST', labelKey: 'invalidRequest' },
  // 渠道自身的凭证/额度问题：另一条渠道有自己的密钥和额度，切换通常立刻能救。
  // 2026-10-16 修订，依据见 .agents/notes/implemented/2026-10-16-switch-on-auth-and-quota.md。
  { key: 'auth', code: 'AUTH', labelKey: 'auth' },
  { key: 'quota', code: 'QUOTA', labelKey: 'quota' },
] as const

/**
 * 表里那 8 个码之外的一切失败码共用的 `switchOn` 键。
 *
 * 它不在 {@link SWITCH_ON_CODES} 里，因为那张表是"码 → 键"的映射，而这一项
 * 没有码：它代表"其余所有码"。界面把它渲染成网格里多出来的一行。
 */
export const OTHER_SWITCH_KEY = 'other' as const

/** A `switchOn` config key. */
export type SwitchOnKey = (typeof SWITCH_ON_CODES)[number]['key'] | typeof OTHER_SWITCH_KEY

/** A DSH `LlmFailure.code` a chain may switch on. */
export type SwitchOnCode = (typeof SWITCH_ON_CODES)[number]['code']

/**
 * Map a normalized `LlmFailure.code` to its `switchOn` key.
 *
 * 表里没有的码返回 `undefined`，调用方用 {@link OTHER_SWITCH_KEY} 兜底——这是
 * 2026-10-22 的结构修正：此前 `undefined` 被当作"路由器永远不管"，于是每一个
 * 枚举外的码都是死区。
 */
export function switchOnKeyOf(code: string): SwitchOnKey | undefined {
  return SWITCH_ON_CODES.find(entry => entry.code === code)?.key
}
