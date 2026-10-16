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

const C = (provider, maxAttempts = 1, over = {}) => ({ provider, model: 'stub-model', maxAttempts, ...over })

// The health projection folds the real durable log, so the fold is asserted
// against events a real boot produced rather than a hand-made fixture. This is
// the check that catches a wrong assumption about an event's shape: the usage a
// settlement reports sits beside `message`, and only real events carry it there.
import { channelHealthProjection } from '../src/health.ts'
import { failoverHistoryProjection } from '../src/lineage.ts'

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
    name: 'weight-strategy-starts-at-the-weighted-candidate',
    note: '权重策略：首个请求直接落在唯一有权重的候选上，不等首选失败',
    router: { enabled: true, profiles: [profile([
      { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, weight: 0 },
      { provider: 'stub-backup', model: 'stub-model', maxAttempts: 1, weight: 1 },
    ], { strategy: 'weight' })], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: {
      // The zero-weight candidate must not be reached at all: if the draw ever
      // lands on it the turn still succeeds, so assert the headers instead.
      'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] },
      'stub-backup': { outcomes: ['ok'] },
    },
    check(events) {
      eq('headers', headers(events), ['stub-backup/stub-model'])
      eq('failed attempts', failedAttempts(events), [])
      eq('notices', notices(events), [], 'a weighted start is not a failover, so no notice')
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
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
      // The failover-history drawer's data, folded by the production lineage
      // projection from the same log: one entry, the throttled route handing
      // over to the route that answered, settled once that route succeeded.
      const history = failoverHistory(events)
      eq('lineage: one entry', history.length, 1)
      eq('lineage: from the throttled route', history[0]?.from, 'stub-primary/stub-model')
      eq('lineage: to the answering route', history[0]?.to, 'stub-backup/stub-model')
      eq('lineage: keeps the failure code', history[0]?.code, 'RATE_LIMIT')
      eq('lineage: settled by the successful turn', history[0]?.settled, true)
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
    name: 'breaker-channel-scope-skips-sibling-models',
    note: '渠道级规则命中后，同渠道其余模型在链上直接被跳过（单 step 内可观测）',
    // 实测依据：一个网关渠道密钥失效，渠道下每条模型都吐同样的错。按路由禁会让
    // 链上把同渠道其余模型各真打一次才跨渠道，白吃 attempt 预算；渠道级禁把整个
    // provider 凉住，链直接跳到下一条渠道。
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-primary', 1, { model: 'stub-model-2' }), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
      breaker: { enabled: true, rules: [{ code: 'RATE_LIMIT', message: '', cooldownSeconds: 3600, scope: 'channel' }] },
    },
    script: {
      // llm-retry 的 normal 策略自己重试 RATE_LIMIT，从不委派——熔断的 note() 在
      // 我们的 recovery listener 里，只有 llm-retry 让位才跑得到。maxRetries: 0
      // 强制让位，让这条场景真正走到熔断记录那一步。
      policy: { maxRetries: 0 },
      'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] },
      'stub-backup': { outcomes: ['ok'] },
    },
    check(events) {
      // 同渠道的第二个模型一次都没真打：headers 里没有它，失败尝试也只有第一条。
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('failed attempt count', failedAttempts(events).length, 1)
      const texts = notices(events).map(n => n.text)
      ok('channel block names the whole provider', texts.some(t => t.includes('渠道 stub-primary 已整体自动禁用') && t.includes('该渠道下所有模型')))
      eq('the block notice fires once', texts.filter(t => t.includes('已整体自动禁用')).length, 1)
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'breaker-disabled-still-fails-over',
    note: '熔断总闸关着：规则留在配置里也不生效，故障转移照常',
    // 回归：host 曾只读 rules 不读 enabled，开关是个摆设；再叠加"关着时允许空规则"，
    // 一条空白规则会命中每一次失败、把所有候选禁掉。这两条都不允许回来。
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
      breaker: { enabled: false, rules: [{ code: 'RATE_LIMIT', message: '', cooldownSeconds: 3600 }] },
    },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT'] }, 'stub-backup': { outcomes: ['ok'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('no breaker notice while disabled', notices(events).filter(n => n.text.includes('自动禁用')).length, 0)
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
    },
  },
  {
    name: 'always-retry-policy-rejected',
    note: '候选渠道声明 always 重试策略：加载即拒绝（无上限重试会让总上限失效）',
    // 已记录决策：docs/design/dsh-capability-boundary.md §三 G2 与 open-questions 一.3。
    // 策略是用户在每个渠道的 Models 设置里自己选的，所以必须在加载时挡住。
    router: { enabled: true, profiles: [profile([C('stub-primary', 1)])], default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { policy: { mode: 'always' }, 'stub-primary': { outcomes: ['ok'] } },
    expectBootFailure: 'retry policy is "always"',
    check() {},
  },
  {
    name: 'budget-cap-when-the-whole-chain-dies',
    note: '整条链都失败：总真实调用数等于用户配的上限，llm-retry 的同路由重试不能越过它',
    // 两个候选各 1 枪、总上限 2，两条都一直 429（既在 switchOn 里、也是 llm-retry
    // 默认可重试码）。这一场景同时钉住两件事：跨候选行走被上限截断，以及 llm-retry
    // 在最后一条候选上自己的 5 次重试也被挡住。
    // 位置依据：`agent/request-error` 用 prepend 注册在最外层，先 await next() 看到
    // 内层决定再处置——预算尽了就否决。注册在 llm-retry 内层时它看不见这些重试，
    // 同一场景实测打 7 次（上限 2）。
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)], { maxTotalAttempts: 2 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 },
    },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT'] }, 'stub-backup': { outcomes: ['fail:RATE_LIMIT'] } },
    check(events) {
      // 每候选一枪，一枪不多：两条各打一次就终态。
      eq('real calls equal the configured cap', failedAttempts(events).length, 2)
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      eq('turn end', turnEnd(events), 'error')
    },
  },
  {
    name: 'auth-dead-key-fails-over',
    note: '主渠道密钥失效（AUTH）：切换至备用并留中文通知，熔断顺手记下这条渠道',
    // 2026-10-16 修订：AUTH 曾因"配置坏了，切换只会把问题藏起来"而不切换。但熔断本来
    // 就会让后续请求跳过死渠道——那条理由只把第一次请求也搭进去。而切换从不是静默的：
    // 中文通知点名失败渠道与码。场景同时钉住"切换"与"下一次请求直接跳过死渠道"。
    router: {
      enabled: true,
      profiles: [profile([C('stub-primary', 1), C('stub-backup', 1)])],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 6 },
      breaker: { enabled: true, rules: [{ code: 'AUTH', message: '', cooldownSeconds: 3600, scope: 'channel' }] },
    },
    script: { policy: { maxRetries: 0 }, 'stub-primary': { outcomes: ['fail:AUTH'] }, 'stub-backup': { outcomes: ['ok'] } },
    check(events) {
      eq('headers', headers(events), ['stub-primary/stub-model', 'stub-backup/stub-model'])
      const texts = notices(events).map(n => n.text)
      ok('notice names the credential failure', texts.some(t => t.includes('凭证或权限被拒')))
      ok('notice says it switched', texts.some(t => t.includes('已切换至')))
      eq('final route', finalRoute(events), 'stub-backup/stub-model')
      eq('turn end', turnEnd(events), 'completed')
      // 熔断的"记录"发生在本轮失败上，但"跳过死渠道"要下一个请求才可见——而本
      // harness 一次 boot 只有一个 step（tools.md 记过这个坑），所以跳过行为由
      // 单测的 CircuitBreaker 系列覆盖；这里只证明 AUTH 触发了切换与通知。
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
  // fork/resume 一致性对每个场景都成立——投影状态必须是已提交事件序列的确定性函数。
  // 各场景的事件形态不同（纯成功 / 跨候选 / 熔断 / 条件跳过），合起来才是完整覆盖。
  assertFoldIsForkSafe(events)
}
console.log(`\n${ran} scenario(s), ${failures.length} failure(s)`)
if (failures.length > 0) {
  console.log(failures.map(f => `  - ${f}`).join('\n'))
  process.exitCode = 1
}
