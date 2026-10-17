#!/usr/bin/env node
/**
 * TEMPORARY composition runner for findings C2 and I1 — not part of the suite.
 *
 * It is `tests/run.mjs` with its SCENARIOS array replaced, so every helper
 * (real headless boot, durable-log reader, real projection fold) is the same
 * code the suite uses.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(`${HERE}run.mjs`, 'utf8')
const head = source.slice(0, source.indexOf('const SWITCH_ON = {'))
const tail = source.slice(source.indexOf('// ---------- boot ----------'))
const SCENARIOS = `
import { channelHealthProjection } from '../src/health.ts'
import { failoverHistoryProjection } from '../src/lineage.ts'

const SWITCH_ON = {
  rateLimit: true, server: true, timeout: true, transport: true,
  emptyResponse: false, invalidRequest: false,
}
const WHEN = { provider: 'stub-primary', model: 'stub-model' }
function profile(candidates, overrides = {}) {
  return { id: 'p1', when: WHEN, candidates, switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6, ...overrides }
}
const C = (provider, maxAttempts = 1, over = {}) => ({ provider, model: 'stub-model', maxAttempts, ...over })

const SCENARIOS = [
  {
    name: 'last-candidate-cap-fires-once-more',
    note: 'C2: 末位候选被 cap 之后是否又多打一次真实调用',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1), C('stub-third', 1)], { maxTotalAttempts: 6 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 },
    },
    // AUTH is switch-on eligible by default and is NOT in llm-retry's default
    // retryable set, so every failure is delegated to the router immediately.
    script: {
      policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:AUTH', 'fail:AUTH', 'fail:AUTH', 'fail:AUTH'] },
      'stub-backup': { outcomes: ['fail:AUTH', 'fail:AUTH', 'fail:AUTH', 'fail:AUTH'] },
      'stub-third': { outcomes: ['fail:AUTH', 'fail:AUTH', 'fail:AUTH', 'fail:AUTH'] },
    },
    check(events) {
      const attempts = events.filter(e => e.type === 'assistant/attempt')
      // Which route each real call actually went to: the health fold counts
      // failures per route key, and the last candidate's key must show TWO.
      const health = channelHealth(events)
      console.log('    -- health per-route failure counts:', JSON.stringify(Object.fromEntries(
        Object.entries(health).map(([k, v]) => [k, v.timeline?.length ?? v.failures ?? null]),
      )))
      eq('real calls', failedAttempts(events).length, 3)
      eq('the last candidate absorbed two of them', health['stub-third/stub-model']?.timeline.length, 2)
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model', 'stub-third/stub-model'])
      const texts = notices(events).map(n => n.text)
      eq('failover notices', texts.filter(t => t.includes('已切换至')).length, 2)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'budget-cap-when-the-whole-chain-dies',
    note: 'I1: 预算耗尽时 durable log 里 llm/retry 与 llm/retry-started 是否成对',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)], { maxTotalAttempts: 2 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 },
    },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT'] }, 'stub-backup': { outcomes: ['fail:RATE_LIMIT'] } },
    check(events) {
      eq('real calls equal the configured cap', failedAttempts(events).length, 2)
      const retry = events.filter(e => e.type === 'llm/retry')
      const started = events.filter(e => e.type === 'llm/retry-started')
      console.log('    -- llm/retry:', JSON.stringify(retry.map(e => ({ provider: e.data.provider, retry: e.data.retry, delayMs: e.data.delayMs, policyKey: e.data.policyKey }))))
      console.log('    -- llm/retry-started:', JSON.stringify(started.map(e => ({ provider: e.data.provider, retry: e.data.retry }))))
      eq('llm/retry count', retry.length, 2)
      eq('llm/retry-started count', started.length, 2)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'veto-cost-backoff-already-elapsed',
    note: 'I1②: 否决发生在 llm-retry 退避之后——终态比必要时间晚多少',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1)], { maxTotalAttempts: 1 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 },
    },
    // RATE_LIMIT is in llm-retry's default retryable set, so llm-retry itself
    // schedules the retry, sleeps the backoff, commits llm/retry-started and
    // only THEN hands the plugin a retry decision to veto. maxTotalAttempts 1
    // means the plugin vetoes the very first one.
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] } },
    check(events) {
      eq('one real call', failedAttempts(events).length, 1)
      const retry = events.filter(e => e.type === 'llm/retry')
      const started = events.filter(e => e.type === 'llm/retry-started')
      eq('llm/retry committed before the veto', retry.length, 1)
      eq('llm/retry-started committed before the veto', started.length, 1)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'same-shape-with-a-code-llm-retry-delegates',
    note: 'I1② 对照组：同一配置、llm-retry 立即委派的码，零退避',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1)], { maxTotalAttempts: 1 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 },
    },
    // AUTH is NOT in llm-retry's default retryable set (retry-policy.ts:18-24),
    // so llm-retry delegates immediately and the plugin terminates with no wait.
    script: { policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 }, 'stub-primary': { outcomes: ['fail:AUTH'] } },
    check(events) {
      eq('one real call', failedAttempts(events).length, 1)
      eq('no llm/retry at all', events.filter(e => e.type === 'llm/retry').length, 0)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'auth-switch-pays-no-backoff',
    note: 'I2: AUTH 跨候选切换是否零退避（slow stub，3000ms/次）',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
    },
    // auth/quota default to true (config.ts:80-81); AUTH is not in llm-retry's
    // default retryable set, so the switch to the next candidate is immediate.
    script: { 'stub-primary': { outcomes: ['fail:AUTH'] }, 'stub-backup': { outcomes: ['ok'] } },
    check(events) {
      eq('two real calls', failedAttempts(events).length, 1)
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('zero llm/retry records: the switch waits for nothing', events.filter(e => e.type === 'llm/retry').length, 0)
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'rate-limit-switch-pays-the-backoff',
    note: 'I2 对照组：RATE_LIMIT 在同一形状下 llm-retry 自己退避',
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
    },
    // RATE_LIMIT IS in llm-retry's default retryable set, so the same shape
    // pays the backoff before the chain moves on.
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT'] }, 'stub-backup': { outcomes: ['ok'] } },
    check(events) {
      eq('one real call', failedAttempts(events).length, 1)
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      const retry = events.filter(e => e.type === 'llm/retry')
      eq('llm/retry records', retry.length, 1)
      eq('the backoff really was scheduled', retry[0]?.delayMs, 3000)
      eq('turn end', turnEnd(events), 'completed')
    },
  },
]
`
writeFileSync(`${HERE}_verify-run.mjs`, head + SCENARIOS + tail, 'utf8')
// Time each boot so I1's backoff cost is measured, not inferred.
let timed = readFileSync(`${HERE}_verify-run.mjs`, 'utf8')
timed = timed.replace(
  '  const { combined, events } = boot(scenario)',
  '  const __t0 = Date.now()\n  const { combined, events } = boot(scenario)\n  console.log(`    -- boot wall time: ${Date.now() - __t0}ms`)',
)
timed = timed.replace(
  `const STUB = \`\${HERE}stub-adapter.mjs\`.replaceAll('\\\\', '/')`,
  `const STUB = \`\${HERE}_verify-stub-slow.mjs\`.replaceAll('\\\\', '/')`,
)
writeFileSync(`${HERE}_verify-run.mjs`, timed, 'utf8')
console.log('wrote _verify-run.mjs (stub: _verify-stub-slow.mjs, 3000ms backoff)')
