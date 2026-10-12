/**
 * Spike step 5: render the REAL Plugins-page form for the Phase 1 Config.
 *
 * Nothing here routes anything. The only purpose is to make DSH's auto-generated
 * plugin config form render, so the Schema's field labels, nesting, defaults and
 * controls can be looked at instead of described.
 *
 * Two design points this Schema encodes:
 *   1. Same-route retries belong to `llm-retry`, so the Router configures no
 *      backoff and no per-candidate attempt count — only "which candidate next"
 *      and "when to stop".
 *   2. `switchOn` is a fixed set of booleans, not a free-form string list: the
 *      failure-code space is open, so enumerating the codes DSH's own default
 *      policy uses gives the form checkboxes with Chinese labels instead of
 *      asking users to type `RATE_LIMIT`.
 */

import { appendFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

const LOG = new URL('./probe.log', import.meta.url)

function evidence(line) {
  appendFileSync(LOG, `${line}\n`)
}

/** One physical candidate. Credentials stay owned by the provider adapter. */
const candidate = z.object({
  provider: z.string().required().description('provider 名称，例如 deepseek-official'),
  model: z.string().required().description('模型 ID，例如 deepseek-v4-flash'),
})

/** Which failures move to the next candidate. Fixed set, Chinese labels. */
const switchOn = z.object({
  rateLimit: z.boolean().default(true).description('限流（RATE_LIMIT）'),
  server: z.boolean().default(true).description('服务端错误（SERVER）'),
  timeout: z.boolean().default(true).description('超时（TIMEOUT）'),
  transport: z.boolean().default(true).description('网络传输失败（TRANSPORT）'),
  emptyResponse: z.boolean().default(false).description('空回复（EMPTY_RESPONSE）'),
})

/** One backup chain, keyed in `profiles` by the `provider/model` the user picks. */
const profile = z.object({
  candidates: z.array(candidate).description('按顺序尝试的候选渠道，第一个通常是用户自己选的那个'),
  switchOn: switchOn.default({}).description('哪些失败会切换到下一个候选'),
  maxTotalAttempts: z.number().step(1).min(1).default(6).description('这个请求最多尝试多少次（硬上限）'),
})

/** Cordis plugin name. */
export const name = 'spike-probe'
export const inject = ['llm']

/**
 * Plugin Config. Only `Volatile` fields reach the auto-generated form, so the
 * two fields a user edits are the dict of chains and the takeover switch.
 */
export const Config = z.object({
  profiles: z.dict(profile).default({}).volatile()
    .description('备份链配置。键为「provider/model」，即用户选了这个模型时生效'),
  takeOverOthers: z.boolean().default(false).volatile()
    .description('是否也接管未在上面配置的模型'),
})

export function apply(ctx, config) {
  evidence(`apply: profiles=${Object.keys(config.profiles?.get?.() ?? {}).length} `
    + `takeOverOthers=${config.takeOverOthers?.get?.()}`)
  ctx.logger.info('spike-probe: apply() ran')
}
