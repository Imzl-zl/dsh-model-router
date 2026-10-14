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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PLUGIN = `${ROOT}packages/dsh-model-router/src/index.ts`.replaceAll('\\', '/')
const STUB = `${HERE}stub-adapter.mjs`.replaceAll('\\', '/')
const DSH_BIN = `${ROOT}node_modules/@deepseek-ai/dsh/lib/bin.js`
const HOME = `${HERE}.dshhome`
const SESSIONS = `${HERE}.sessions`

const SWITCH_ON = {
  rateLimit: true, server: true, timeout: true, transport: true,
  emptyResponse: false, invalidRequest: false,
}
const WHEN = { provider: 'stub-primary', model: 'stub-model' }

function profile(candidates, overrides = {}) {
  return {
    id: 'p1',
    when: WHEN,
    candidates,
    switchOn: { ...SWITCH_ON },
    maxTotalAttempts: 6,
    ...overrides,
  }
}

const C = (provider, maxAttempts = 1) => ({ provider, model: 'stub-model', maxAttempts })

// The health projection folds the real durable log, so the fold is asserted
// against events a real boot produced rather than a hand-made fixture. This is
// the check that catches a wrong assumption about an event's shape: the usage a
// settlement reports sits beside `message`, and only real events carry it there.
import { channelHealthProjection } from '../src/health.ts'

const SCENARIOS = [
  {
    name: 'primary-success',
    note: '配了规则的模型，首选直接成功：不切换、不通知',
    router: { enabled: true, profiles: [profile([C('stub-primary', 2)])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['ok'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model'])
      eq('failed attempts', failedAttempts(events), [])
      eq('notices', notices(events), [])
      eq('final route', finalRoute(events), 'stub-primary/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'failover-rate-limit',
    note: '主渠道限流到达单渠道上限，切换到备用并留一条中文通知',
    router: { enabled: true, profiles: [profile([C('stub-primary', 2), C('stub-backup', 1)])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: {
      'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] },
      'stub-backup': { outcomes: ['ok'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      // The fold's failover marker, asserted straight from the durable log: the
      // second header records the route change the lineage unit folds.
      eq('header reasons', headerReasons(events), ['initial', 'change'])
      eq('failed attempt codes', failedAttempts(events).map(a => a.code), ['RATE_LIMIT', 'RATE_LIMIT'])
      eq('notice count', notices(events).length, 1)
      ok('notice mentions 限流', notices(events)[0]?.text.includes('限流'))
      ok('notice names candidate 2/2', notices(events)[0]?.text.includes('候选 2/2'))
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
      // Channel health, folded from the same durable log by the production
      // projection: the throttled route degrades, the route that answered is
      // healthy, and a route nobody used has no record at all.
      const health = channelHealth(events)
      eq('health: throttled route degrades', health['stub-primary/stub-model']?.status, 'degraded')
      eq('health: throttled route keeps the code', health['stub-primary/stub-model']?.lastError, 'RATE_LIMIT')
      eq('health: answering route is healthy', health['stub-backup/stub-model']?.status, 'healthy')
      eq('health: answering route clears the error', health['stub-backup/stub-model']?.lastError, undefined)
      ok('health: answering route measures a turn cost', typeof health['stub-backup/stub-model']?.latencyMs === 'number')
      ok('health: answering route measures throughput', typeof health['stub-backup/stub-model']?.throughputTps === 'number')
      eq('health: timeline is bounded', health['stub-primary/stub-model']?.timeline.length, 2)
    },
  },
  {
    name: 'switch-off-terminal',
    note: '未勾选的异常不切换；同渠道内 llm-retry 仍按策略重试后才终态',
    router: { enabled: true, profiles: [profile([C('stub-primary', 2), C('stub-backup', 1)], { switchOn: { ...SWITCH_ON, rateLimit: false } })], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model'])
      eq('failed attempt count (1 + llm-retry 5)', failedAttempts(events).length, 6)
      eq('notices', notices(events), [])
      eq('final route', finalRoute(events), undefined)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'total-cap',
    note: '总尝试上限硬顶：llm-retry 不重试该码时，上限精确生效',
    router: { enabled: true, profiles: [profile([C('stub-primary', 3), C('stub-backup', 3)], { maxTotalAttempts: 3 })], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: {
      // retryableCodes must be non-empty (retry-policy.ts); leaving only
      // RATE_LIMIT retryable makes llm-retry delegate every TIMEOUT straight
      // to the router, so the total cap binds exactly.
      policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT'] },
      'stub-backup': { outcomes: ['fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model'])
      eq('failed attempt count', failedAttempts(events).length, 3)
      eq('notices', notices(events), [])
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'default-pool',
    note: '未配规则的模型走全局兜底池：用户所选永远是第一跳',
    router: { enabled: true, profiles: [], default: { enabled: true, candidates: [C('stub-backup', 1)], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] }, 'stub-backup': { outcomes: ['ok'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('notice count', notices(events).length, 1)
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'prevalidation-skip',
    note: '候选不支持当前推理档位：调用前预校验跳过，不猝死 step',
    router: { enabled: true, profiles: [profile([C('stub-primary', 1), C('stub-backup', 1), C('stub-third', 1)])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 } },
    selection: { reasoningEffort: 'high' },
    script: {
      'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'], model: { reasoning: { efforts: [{ id: 'high', name: '高' }] } } },
      'stub-backup': { outcomes: ['ok'], model: {} },
      'stub-third': { outcomes: ['ok'], model: { reasoning: { efforts: [{ id: 'high', name: '高' }] } } },
    },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-third/stub-model'])
      const texts = notices(events).map(n => n.text)
      eq('notice count', texts.length, 2)
      ok('failover notice names candidate 3/3', texts.some(t => t.includes('候选 3/3')))
      ok('skip notice names stub-backup', texts.some(t => t.includes('stub-backup') && t.includes('已跳过')))
      eq('final route', finalRoute(events), 'stub-third/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'condition-skip',
    note: '候选条件不满足（预估上下文未达门槛）被跳过，链条继续且留痕',
    router: { enabled: true, profiles: [profile([
      C('stub-primary', 1),
      { provider: 'stub-backup', model: 'stub-model', maxAttempts: 1, needs: { minContextTokens: 999999 } },
      C('stub-third', 1),
    ])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: {
      // TIMEOUT is not retried by llm-retry here, so every failure is delegated
      // and the chain walk is deterministic.
      policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:TIMEOUT'] },
      'stub-third': { outcomes: ['ok'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-third/stub-model'])
      const texts = notices(events).map(n => n.text)
      eq('notice count', texts.length, 2)
      ok('failover notice names candidate 3/3', texts.some(t => t.includes('候选 3/3')))
      ok('condition skip names stub-backup with the threshold reason', texts.some(t => t.includes('stub-backup') && t.includes('使用条件不满足') && t.includes('999999')))
      eq('final route', finalRoute(events), 'stub-third/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'primary-condition-skip',
    note: '条件对 primary 同样生效：本步不满足其显式条件时跳过，链条继续且留痕',
    router: { enabled: true, profiles: [profile([
      // primary 自己配了条件——显式条件是用户意图，不是插件猜测，跳过它不等于静默改路。
      { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, needs: { minContextTokens: 999999 } },
      C('stub-backup', 1),
      C('stub-third', 1),
    ])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: {
      policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:TIMEOUT'] },
      'stub-third': { outcomes: ['ok'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-backup/stub-model'])
      const texts = notices(events).map(n => n.text)
      eq('notice count', texts.length, 1)
      ok('condition skip names the primary with the threshold reason', texts.some(t => t.includes('stub-primary') && t.includes('使用条件不满足') && t.includes('999999')))
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'image-gate-skips-vision-on-text-turn',
    note: '无图轮：主模型失败后，只配了「仅带图」的识图候选被条件跳过（留痕且只发一次），文本请求不会打给识图模型',
    router: { enabled: true, profiles: [profile([
      { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, needs: { images: false } },
      { provider: 'stub-backup', model: 'stub-model', maxAttempts: 1, needs: { images: true } },
    ], { stickyTurns: 2 })], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 } },
    script: {
      policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT', 'fail:TIMEOUT'] },
      'stub-backup': { outcomes: ['ok'] },
    },
    check(events) {
      // 识图候选从头到尾没被调用过；链上无人可接时落回用户原路由，且推翻了
      // 「落回原路径不推进状态 → recovery 永远得到继续 → 无限空转」的旧行为：
      // 第二次触发时链已 exhausted，这一轮就终态，不再空转。
      eq('every header is the primary', headers(events).every(h => h === 'stub-primary/stub-model'), true)
      eq('attempt count bounded by the exhausted chain', failedAttempts(events).length, 2)
      const texts = notices(events).map(n => n.text)
      // 六次触发、同一组条件跳过，只发一次通知。
      eq('condition skip notice fires once', texts.filter(t => t.includes('使用条件不满足')).length, 1)
      ok('condition skip names the vision candidate and the images reason', texts.some(t => t.includes('stub-backup') && t.includes('需图片输入')))
      eq('no failover notice: nothing was switched to', texts.filter(t => t.includes('已切换至')).length, 0)
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'master-off',
    note: '总闸关闭：配了规则也不接管',
    router: { enabled: false, profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model'])
      eq('notices', notices(events), [])
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'breaker-does-not-break-failover',
    note: '自动禁用开着也不破坏正常故障转移（跨 step 的跳过由单测覆盖）',
    // 这个 harness 一次 boot 只有一个 step（stub 不调工具），而熔断的"下一轮跳过"
    // 本质是跨 step 行为，所以端到端只能断言"开着熔断不坏事"。跳过逻辑本身在
    // unit.mjs 的 CircuitBreaker 用例里覆盖。
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 2), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
      breaker: { enabled: true, rules: [{ code: 'RATE_LIMIT', message: '', cooldownSeconds: 3600 }] },
    },
    script: {
      'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] },
      'stub-backup': { outcomes: ['ok'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('failed attempt codes', failedAttempts(events).map(a => a.code), ['RATE_LIMIT', 'RATE_LIMIT'])
      eq('notice count', notices(events).length, 1)
      ok('notice mentions 限流', notices(events)[0]?.text.includes('限流'))
      // 用户自己选的那一条永远不跳过——禁用名单不该能覆盖人的显式选择。
      eq('no breaker notice in a single-step boot', notices(events).filter(n => n.text.includes('已被自动禁用')).length, 0)
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'invalid-config-rejected',
    note: '结构错误（重复 ID）在加载时响亮失败，不静默跳过',
    router: { enabled: true, profiles: [profile([C('stub-primary', 1)], { id: 'dup' }), profile([C('stub-backup', 1)], { id: 'dup', when: { provider: 'stub-backup', model: 'stub-model' } })], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['ok'] } },
    expectBootFailure: 'duplicate profile id "dup"',
    check() {},
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
  return `${indent}- { provider: ${c.provider}, model: ${c.model}, maxAttempts: ${c.maxAttempts}${extra} }`
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
            stickyTurns: ${p.stickyTurns}`}`).join('\n')}
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
${router.breaker.rules.map(r => `              - { code: '${r.code}', message: '${r.message}', cooldownSeconds: ${r.cooldownSeconds} }`).join('\n')}`}
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
const channelHealth = events => {
  let state = channelHealthProjection.init()
  for (const event of events) state = channelHealthProjection.apply(state, event)
  return state.records
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

// ---------- main ----------

mkdirSync(HOME, { recursive: true })
const only = process.argv[2]
let ran = 0
for (const scenario of SCENARIOS) {
  if (only !== undefined && scenario.name !== only) continue
  current = scenario.name
  ran += 1
  console.log(`\n=== ${scenario.name}: ${scenario.note}`)
  const { combined, events } = boot(scenario)
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
}
console.log(`\n${ran} scenario(s), ${failures.length} failure(s)`)
if (failures.length > 0) {
  console.log(failures.map(f => `  - ${f}`).join('\n'))
  process.exitCode = 1
}
