/**
 * The Chinese failover notice.
 *
 * Appended to the session surface as a `user/message` with
 * `source.form: 'notice'`, the same shape DSH's own model-switch notice uses
 * (`model-selection.ts`). The client renders any `notice` form as a collapsed
 * row regardless of the producer kind, and an unknown kind falls back to a
 * visible label — both verified in the Phase 1 spike (see
 * docs/design/dsh-capability-boundary.md 7.7).
 *
 * One failover therefore shows two notices: DSH's English "model changed" row
 * (unavoidable, factual) and this one (the reason). That trade-off is a
 * recorded product decision, not an oversight.
 */

import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { BreakerScope } from './config.ts'
import type { SwitchOnCode } from './defaults.ts'
import { routeKeyOf, routeLabel } from './routes.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'model-router': { readonly kind: 'model-router'; readonly form: 'notice'; readonly summary: string }
  }
}

/**
 * Chinese labels for the codes the switch-on table names. Keyed by that
 * table's own code union, so a code added there without a label is a compile
 * error — the label map cannot drift from the list of codes that switch.
 * `codeLabel` still answers for any code (a breaker rule may name one the
 * chain never switches on), falling back to the raw code.
 */
const CODE_LABELS: Readonly<Record<SwitchOnCode, string>> = {
  RATE_LIMIT: '限流',
  SERVER: '服务端错误',
  TIMEOUT: '超时',
  TRANSPORT: '网络传输中断',
  EMPTY_RESPONSE: '空回复',
  INVALID_REQUEST: '请求被拒绝',
  AUTH: '凭证或权限被拒',
  QUOTA: '额度用尽',
}

export function codeLabel(code: string): string {
  return Object.hasOwn(CODE_LABELS, code) ? CODE_LABELS[code as SwitchOnCode] : code
}

function notice(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text' as const, text }],
    source: { kind: 'model-router', form: 'notice', summary: boundContextSummary(text) },
  })
}

/**
 * The chain moved to the next candidate after a failure.
 *
 * The wording says "降级 N/M", not "候选 N/M", and never "主模型": there is one
 * global chain and its first hop is whatever the user selected, so a failing
 * hop may itself be a fallback. `position` is the user-visible fallback number
 * (1-based, the order they configured), not the rotated index. `position === 0`
 * means the chain moved BACK to the user's own model (possible under the
 * weight/round-robin start strategies), which is not a fallback at all — saying
 * "降级 0/N" there would be a number that cannot exist.
 */
export function failoverNotice(
  from: { provider: string; model: string },
  to: { provider: string; model: string },
  position: number,
  total: number,
  code: string | undefined,
): UserMessage {
  const reason = code === undefined ? '连续失败' : `失败（${codeLabel(code)}）`
  const target = routeLabel(to.provider, to.model, from.provider)
  const move = position <= 0
    ? `已切回你选择的模型 ${target}`
    : `已切换至 ${target}（降级 ${position}/${total}）`
  return notice(
    `[路由切换] ${routeLabel(from.provider, from.model, to.provider)} ${reason}，${move}`,
  )
}

/** A candidate was skipped before any call: it cannot serve this request. */
export function skipNotice(candidate: { provider: string; model: string }): UserMessage {
  return notice(
    `[路由切换] 候选 ${routeKeyOf(candidate.provider, candidate.model)} 不支持当前请求参数，已跳过`,
  )
}

/**
 * A candidate the router could not even address: the provider has no adapter
 * registered here, or the model is not in its catalog. The wording points at
 * the Models page rather than at this chain — nothing in the chain is wrong,
 * and the previous catch-all notice sent users to edit the wrong thing.
 */
export function routeMissingNotice(
  candidate: { provider: string; model: string },
  code: string,
): UserMessage {
  return notice(
    `[路由切换] 候选 ${routeKeyOf(candidate.provider, candidate.model)} 无法路由（${code}）：该 provider 未注册或模型不在目录里，请到「模型」页确认这条渠道；已跳过`,
  )
}

/**
 * A candidate whose adapter broke its own contract: it returned exact-model
 * metadata that fails the runtime's shape check. Not rethrown — one broken
 * adapter must not take the whole chain down, which is the opposite of what
 * this plugin is for — but it is loud: `ctx.logger.error` on the Host and a
 * notice that says outright this is an adapter defect, not a chain problem.
 */
export function adapterDefectNotice(
  candidate: { provider: string; model: string },
  code: string,
): UserMessage {
  return notice(
    `[路由切换] 候选 ${routeKeyOf(candidate.provider, candidate.model)} 的适配器返回了无效的模型元数据（${code}）：这是适配器缺陷，不是这条链的问题，请向该 provider 的适配器反馈；已跳过`,
  )
}

/**
 * A candidate was skipped because its `needs` condition is not met. This is
 * not a failure — the candidate is servable, just not for this request's
 * shape — but the chain visibly jumped over it, so the reason is recorded.
 */
export function conditionSkipNotice(
  candidate: { provider: string; model: string },
  reason: string,
): UserMessage {
  return notice(
    `[路由切换] 候选 ${routeKeyOf(candidate.provider, candidate.model)} 的使用条件不满足（${reason}），已跳过`,
  )
}

/**
 * A candidate is sitting out a cooldown. The remaining time is stated because
 * "skipped" alone reads like the channel is broken, and the whole point of a
 * cooldown is that it comes back on its own. A channel-scope block says so,
 * because the user configured it to take the whole provider out and would
 * otherwise wonder why the sibling models vanished too.
 */
export function breakerNotice(
  candidate: { provider: string; model: string },
  block: { until: number; scope: BreakerScope },
  now: number = Date.now(),
): UserMessage {
  const seconds = Math.max(1, Math.ceil((block.until - now) / 1000))
  const subject = block.scope === 'channel'
    ? `渠道 ${candidate.provider} 已整体自动禁用（该渠道下所有模型）`
    : `候选 ${routeKeyOf(candidate.provider, candidate.model)} 已被自动禁用`
  return notice(`${subject}，约 ${seconds} 秒后自动重试，本次跳过`)
}
