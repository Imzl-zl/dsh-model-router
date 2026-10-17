#!/usr/bin/env node
/**
 * Phase 1 composition tests for dsh-model-router.
 *
 * Each scenario boots the REAL headless Loader (`node lib/bin.js --profile
 * headless --patch`) with the stub adapter and the router plugin inserted by
 * absolute-path overlay, then asserts on the durable session log. This is the
 * "real Cordis Loader composition" the DSH package rules require — no
 * hand-built Context, no mocked waterfall.
 *
 * Usage: node packages/dsh-model-router/tests/run.mjs [scenario-name]
 * Expected wall time: roughly 10-20s per scenario on a warm DSH_HOME.
 */

import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// The BUILT host entry, not src/index.ts: the host half is a class carrying
// @Remote decorators, and the source-mode loader strips types without
// transforming decorators (Node rejects the `@` token outright). tsdown lowers
// them during the build, so the composition runs against the artifact the
// browser and a real install would load. `npm run bundle` must have run.
const PLUGIN = `${ROOT}packages/dsh-model-router/lib/index.js`.replaceAll('\\', '/')
const STUB = `${HERE}_verify-stub-slow.mjs`.replaceAll('\\', '/')
const DSH_BIN = `${ROOT}node_modules/@deepseek-ai/dsh/lib/bin.js`
const HOME = `${HERE}.dshhome`
const SESSIONS = `${HERE}.sessions`


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
// ---------- boot ----------

function candidateYaml(c, indent) {
  const needs = c.needs ?? {}
  const parts = []
  if (needs.images === true) parts.push('images: true')
  if (needs.images === false) parts.push('images: false')
  if (needs.minContextTokens !== undefined && needs.minContextTokens > 0) parts.push(`minContextTokens: ${needs.minContextTokens}`)
  const extra = parts.length > 0 ? `, needs: { ${parts.join(', ')} }` : ''
  // weight must cross the overlay: an unset field reads as 0, which silently
  // turns a weight strategy into an order one.
  const weight = c.weight === undefined ? '' : `, weight: ${c.weight}`
  return `${indent}- { provider: ${c.provider}, model: ${c.model}, maxAttempts: ${c.maxAttempts}${weight}${extra} }`
}

function overlayYaml(router, selection) {
  return `- id: llm-deepseek
  disabled: true

- id: llm-deepseek-account
  disabled: true

- id: session-persistence-jsonl
  config:
    root: './.sessions'
    compression: none

- id: agent-default-model
  config:
    provider: stub-primary
    model: stub-model
${selection?.reasoningEffort === undefined ? '' : `    reasoningEffort: ${selection.reasoningEffort}\n`}
- insert:
    - id: stub-adapter
      name: '${STUB}'
    - id: model-router
      name: '${PLUGIN}'
      config:
        enabled: ${router.enabled}
        profiles:
${router.profiles.map(p => `          - id: ${p.id}
            when: { provider: ${p.when.provider}, model: ${p.when.model} }
            candidates:
${p.candidates.map(c => candidateYaml(c, '              ')).join('\n')}
            switchOn: { rateLimit: ${p.switchOn.rateLimit}, server: ${p.switchOn.server}, timeout: ${p.switchOn.timeout}, transport: ${p.switchOn.transport}, emptyResponse: ${p.switchOn.emptyResponse}, invalidRequest: ${p.switchOn.invalidRequest} }
            maxTotalAttempts: ${p.maxTotalAttempts}${p.stickyTurns === undefined ? '' : `
            stickyTurns: ${p.stickyTurns}`}${p.strategy === undefined ? '' : `
            strategy: ${p.strategy}`}`).join('\n')}
        default:
          enabled: ${router.default.enabled}
          candidates:
${router.default.candidates.map(c => candidateYaml(c, '            ')).join('\n')}
          switchOn: { rateLimit: ${router.default.switchOn.rateLimit}, server: ${router.default.switchOn.server}, timeout: ${router.default.switchOn.timeout}, transport: ${router.default.switchOn.transport}, emptyResponse: ${router.default.switchOn.emptyResponse}, invalidRequest: ${router.default.switchOn.invalidRequest} }
          maxTotalAttempts: ${router.default.maxTotalAttempts}
${router.breaker === undefined ? '' : `        health:
          breaker:
            enabled: ${router.breaker.enabled}
            rules:
${router.breaker.rules.map(r => `              - { code: '${r.code}', message: '${r.message}', cooldownSeconds: ${r.cooldownSeconds}, scope: '${r.scope ?? 'route'}' }`).join('\n')}`}
`
}

function boot(scenario) {
  rmSync(SESSIONS, { recursive: true, force: true })
  writeFileSync(`${HERE}stub-script.json`, JSON.stringify(scenario.script, null, 2))
  writeFileSync(`${HERE}overlay.yml`, overlayYaml(scenario.router, scenario.selection))
  // spawnSync over execFileSync: dsh writes load warnings to stderr even when
  // it exits 0, and an error-terminal turn exits non-zero — neither fact says
  // anything about the plugin, so capture both streams and read the log.
  const result = spawnSync(
    process.execPath,
    [DSH_BIN, '--profile', 'headless', '--patch', `${HERE}overlay.yml`, 'reply with the single word OK'],
    { cwd: HERE, env: { ...process.env, DSH_HOME: HOME }, encoding: 'utf8', timeout: 180000 },
  )
  return { combined: `${result.stdout ?? ''}${result.stderr ?? ''}`, events: readEvents() }
}

function readEvents() {
  if (!existsSync(SESSIONS)) return []
  const events = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl')) {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (line.trim() === '') continue
          try { events.push(JSON.parse(line)) } catch { /* partial line */ }
        }
      }
    }
  }
  walk(SESSIONS)
  return events.sort((a, b) => a.seq - b.seq)
}

// ---------- projections ----------

const headers = events => events.filter(e => e.type === 'request/header')
  .map(e => `${e.data.header.config.provider}/${e.data.header.config.model}`)

const headerReasons = events => events.filter(e => e.type === 'request/header').map(e => e.data.reason)

const failedAttempts = events => events.filter(e => e.type === 'assistant/attempt').map(e => {
  const chunks = [...e.data.stream].reverse()
  const finish = chunks.find(c => c.chunk.type === 'finish')
  return { turn: e.data.turn, step: e.data.step, code: finish?.chunk.reason?.failure?.code }
})

const notices = events => events.filter(e => e.type === 'user/message' && e.data.source?.kind === 'model-router')
  .map(e => ({ text: e.data.content.find(c => c.type === 'text')?.text ?? '', summary: e.data.source.summary }))

const finalRoute = events => {
  const last = events.filter(e => e.type === 'assistant/message').at(-1)
  return last === undefined ? undefined : `${last.data.message.source.provider}/${last.data.message.source.model}`
}

const turnEnd = events => events.filter(e => e.type === 'turn/end').at(-1)?.data.reason.kind

/** Fold one boot's durable log through the real health projection. */
/** Fold one boot's durable log through the real lineage projection (the drawer's data). */
const failoverHistory = events => {
  let state = failoverHistoryProjection.init()
  for (const event of events) state = failoverHistoryProjection.apply(state, event)
  return failoverHistoryProjection.wire.view(state)
}

const channelHealth = events => {
  let state = channelHealthProjection.init()
  for (const event of events) state = channelHealthProjection.apply(state, event)
  return state.records
}

/**
 * fork/resume 一致性（open-questions §三.3 的待实测项）。
 *
 * DSH 的 resume/fork 靠「checkpoint + 尾序重放」重建投影状态
 * （docs/subsystems/session-projection.md），所以插件侧有两条硬契约：
 *   ① apply 是纯函数——不改入参、不依赖调用顺序之外的任何东西；
 *   ② state 是 plain JSON，且它的 JSON 形态过得了自己单元的 stateSchema
 *      （持久缓存与冷读路径都要 parse 它）。
 * 任一条件被破坏，分段时间线就会与一次 fold 分叉——而那正是 fork/resume 会暴露的错误。
 *
 * 这里用真 boot 产生的 durable 日志验：一次 fold vs 分三段 fold、每段边界过一遍
 * JSON 往返（等价于 checkpoint 的 detached structured clone），两者必须逐字相等；
 * 再把一次 fold 的 JSON 形态喂回 stateSchema（冷读就是这么做的）。
 */
const assertFoldIsForkSafe = events => {
  for (const [name, projection] of [
    ['failover-history', failoverHistoryProjection],
    ['channel-health', channelHealthProjection],
  ]) {
    let one = projection.init()
    let purityViolations = 0
    for (const event of events) {
      // 纯函数的一半：apply 不得就地修改入参。checkpoint 是"当时状态的副本"，若 apply
      // 改入参，已取走的 checkpoint 会被后续事件悄悄改写——分段时间线因此与一次 fold
      // 分叉。持有入参引用，apply 之后再序列化它，与调用前快照比较；汇总成一条断言，
      // 不每个事件刷一行。
      const inputSnapshot = JSON.stringify(one)
      const inputRef = one
      one = projection.apply(one, event)
      if (JSON.stringify(inputRef) !== inputSnapshot) purityViolations += 1
    }
    eq(`fold ${name}: apply never mutates its input`, purityViolations, 0)

    let chunked = projection.init()
    const size = Math.max(1, Math.ceil(events.length / 3))
    for (let i = 0; i < events.length; i += size) {
      for (const event of events.slice(i, i + size)) chunked = projection.apply(chunked, event)
      chunked = JSON.parse(JSON.stringify(chunked))
    }

    // 比较落在**持久化形态**上：fork/resume 重建的就是 JSON 化后的状态，所以
    // "键顺序"与"值为 undefined 的键被 JSON 丢掉"都不该算差异——两者在冷读时
    // 语义一致（读回来都是 undefined，schema 也是 .optional()）。
    const persisted = state => JSON.parse(JSON.stringify(state))
    deep(`fold ${name}: chunked replay equals one pass`, persisted(chunked), persisted(one))
    deep(`fold ${name}: wire view survives replay`, persisted(projection.wire.view(chunked)), persisted(projection.wire.view(one)))
    // 冷读路径：持久化的是 JSON 形态，读回来要过自己的 schema。
    projection.stateSchema.parse(JSON.parse(JSON.stringify(one)))
  }
}

// ---------- assertions ----------

const failures = []
let current = ''
function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) console.log(`    ok  ${label}`)
  else { console.log(`    FAIL ${label}: expected ${b}, got ${a}`); failures.push(`${current}: ${label}`) }
}
function ok(label, condition) {
  if (condition) console.log(`    ok  ${label}`)
  else { console.log(`    FAIL ${label}`); failures.push(`${current}: ${label}`) }
}
/** 语义相等（忽略键顺序）——JSON 往返会丢掉可选键、由后续 apply 加到末尾，改的是
 *  插入顺序不是值，投影契约对键顺序无要求（持久化再 parse、fold 都不看顺序）。 */
function deep(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log(`    ok  ${label}`)
  } catch (error) {
    console.log(`    FAIL ${label}: ${error.message.split('\n').slice(0, 6).join(' ')}`)
    failures.push(`${current}: ${label}`)
  }
}

// ---------- main ----------

mkdirSync(HOME, { recursive: true })
const only = process.argv[2]
let ran = 0
for (const scenario of SCENARIOS) {
  if (only !== undefined && scenario.name !== only) continue
  current = scenario.name
  ran += 1
  console.log(`\n=== ${scenario.name}: ${scenario.note}`)
  const __t0 = Date.now()
  const { combined, events } = boot(scenario)
  console.log(`    -- boot wall time: ${Date.now() - __t0}ms`)
  if (scenario.expectBootFailure !== undefined) {
    ok(`boot surfaces "${scenario.expectBootFailure}"`, combined.includes(scenario.expectBootFailure))
    continue
  }
  if (events.length === 0) {
    console.log(`    FAIL boot produced no session events\n${combined.slice(-2000)}`)
    failures.push(`${scenario.name}: boot produced no session events`)
    continue
  }
  scenario.check(events)
  // fork/resume 一致性对每个场景都成立——投影状态必须是已提交事件序列的确定性函数。
  // 各场景的事件形态不同（纯成功 / 跨候选 / 熔断 / 条件跳过），合起来才是完整覆盖。
  assertFoldIsForkSafe(events)
}
console.log(`\n${ran} scenario(s), ${failures.length} failure(s)`)
if (failures.length > 0) {
  console.log(failures.map(f => `  - ${f}`).join('\n'))
  process.exitCode = 1
}
