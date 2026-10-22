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
 * 0 = the first failure moves on, which is the default.
 */
export const DEFAULT_MAX_RETRIES = 0

/** The implicit first hop's default retry budget; 0 = quick failover. */
export const DEFAULT_FIRST_HOP_MAX_RETRIES = 0

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
 */
export const DEFAULT_SWITCH_ON: Record<SwitchOnKey, boolean> = {
  rateLimit: true,
  server: true,
  timeout: true,
  transport: true,
  emptyResponse: false,
  invalidRequest: false,
  // 渠道自身的凭证/额度问题：另一条渠道有自己的密钥和额度，切换通常立刻能救。
  // 2026-10-16 修订，依据见 .agents/notes/implemented/2026-10-16-switch-on-auth-and-quota.md。
  auth: true,
  quota: true,
}

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

/** A `switchOn` config key. */
export type SwitchOnKey = (typeof SWITCH_ON_CODES)[number]['key']

/** A DSH `LlmFailure.code` a chain may switch on. */
export type SwitchOnCode = (typeof SWITCH_ON_CODES)[number]['code']

/** The `switchOn` keys, in table order. */
export const SWITCH_ON_KEYS: readonly SwitchOnKey[] = SWITCH_ON_CODES.map(entry => entry.key)

/** Map a normalized `LlmFailure.code` to its `switchOn` key; undefined = never a Router concern. */
export function switchOnKeyOf(code: string): SwitchOnKey | undefined {
  return SWITCH_ON_CODES.find(entry => entry.code === code)?.key
}
