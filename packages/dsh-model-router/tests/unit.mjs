#!/usr/bin/env node
/**
 * Unit tests for the pure routing decisions.
 *
 * The plugin's decision modules are erasable TypeScript, so Node's built-in
 * type stripping imports them directly — no build step, no mocked Cordis
 * context. What these cover is the logic the Loader composition tests exercise
 * only through one deterministic path (minContextTokens); the rest is here.
 *
 * Usage: node packages/dsh-model-router/tests/unit.mjs
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  conditionsMet,
  decideRecovery,
  hasImageContent,
  planFire,
  resolveChain,
  resolveStartIndex,
  rotate,
  startStep,
  toolResultHasImage,
  unmetCondition,
} from '../src/router.ts'
import { failoverHistoryProjection, failureCodeOfStream, FAILOVER_HISTORY_KEY, MAX_ENTRIES } from '../src/lineage.ts'
import { breakerNotice } from '../src/notice.ts'
import { assertStructural } from '../src/config.ts'
import { SWITCH_ON_CODES, switchOnKeyOf } from '../src/defaults.ts'
import { defaultSwitchOn } from '../src/client/validate.ts'
import { emptyConditions, RouterState } from '../src/state.ts'
import { probePromptFor, probeRoute } from '../src/probe.ts'
import { checkConnectivity } from '../src/connectivity.ts'
import { routeParts } from '../src/routes.ts'

let passed = 0
const pending = []
function test(name, body) {
  let result
  try {
    result = body()
  } catch (error) {
    console.log(`    FAIL ${name}: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (result && typeof result.then === 'function') {
    pending.push(result.then(
      () => { passed += 1; console.log(`    ok  ${name}`) },
      (error) => { console.log(`    FAIL ${name}: ${error.message}`); process.exitCode = 1 },
    ))
    return
  }
  passed += 1
  console.log(`    ok  ${name}`)
}

const image = (type) => [{ type: 'text', text: 'hi' }, { type, attachment: { name: 'x.png' } }]

// ---- hasImageContent ----

test('detects an image block in any admitted message', () => {
  assert.equal(hasImageContent([{ content: image('image') }]), true)
  assert.equal(hasImageContent([{ content: image('text') }, { content: image('image') }]), true)
})

test('no image block means no images', () => {
  assert.equal(hasImageContent([{ content: image('text') }]), false)
  assert.equal(hasImageContent([]), false)
  assert.equal(hasImageContent([{ content: [] }]), false)
})

// ---- unmetCondition ----

const candidate = (needs) => ({ provider: 'p', model: 'm', maxAttempts: 1, ...(needs === undefined ? {} : { needs }) })
const conditions = (hasImages, projectedTokens) => ({ hasImages, projectedTokens })

test('no needs means always eligible', () => {
  assert.equal(unmetCondition(candidate(undefined), conditions(false, undefined)), undefined)
  assert.equal(unmetCondition(candidate({}), conditions(false, undefined)), undefined)
})

test('images gate requires an image block; false requires its absence', () => {
  assert.equal(unmetCondition(candidate({ images: true }), conditions(false, 5000)), '需图片输入')
  assert.equal(unmetCondition(candidate({ images: true }), conditions(true, 5000)), undefined)
  assert.equal(unmetCondition(candidate({ images: false }), conditions(false, 0)), undefined)
  assert.equal(unmetCondition(candidate({ images: false }), conditions(true, 0)), '本请求包含图片')
})

test('context gate: 0 disables, unmeasured is unmet, boundary is inclusive', () => {
  assert.equal(unmetCondition(candidate({ minContextTokens: 0 }), conditions(false, undefined)), undefined)
  assert.equal(unmetCondition(candidate({ minContextTokens: 100 }), conditions(false, undefined)), '需预估上下文 ≥ 100 tokens')
  assert.equal(unmetCondition(candidate({ minContextTokens: 100 }), conditions(false, 99)), '需预估上下文 ≥ 100 tokens')
  assert.equal(unmetCondition(candidate({ minContextTokens: 100 }), conditions(false, 100)), undefined)
  assert.equal(unmetCondition(candidate({ minContextTokens: 100 }), conditions(false, 101)), undefined)
})

test('conditionsMet is the negation of unmetCondition', () => {
  const c = candidate({ images: true, minContextTokens: 50 })
  assert.equal(conditionsMet(c, conditions(true, 50)), true)
  assert.equal(conditionsMet(c, conditions(false, 50)), false)
  assert.equal(conditionsMet(c, conditions(true, 49)), false)
})

// ---- planFire (attempt accounting) ----

const chainOf = (maxAttempts, count = 3, strategy = 'order') => ({
  candidates: Array.from({ length: count }, (_, index) => ({ provider: 'p', model: `m${index}`, maxAttempts, weight: 0 })),
  order: Array.from({ length: count }, (_, index) => index),
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
  maxTotalAttempts: 10,
  strategy,
})

test('planFire gives each candidate exactly maxAttempts fires before advancing', () => {
  let state = startStep(1, 1, chainOf(2), emptyConditions())
  const fires = []
  for (let i = 0; i < 6; i += 1) {
    const plan = planFire(state, true)
    fires.push(plan.state.index)
    state = plan.state
  }
  assert.deepEqual(fires, [0, 0, 1, 1, 2, 2])
})

test('planFire marks exhausted at the last candidate and never advances past it', () => {
  let state = startStep(1, 1, chainOf(1, 2), emptyConditions())
  const seen = []
  for (let i = 0; i < 5; i += 1) {
    const plan = planFire(state, true)
    seen.push({ index: plan.state.index, exhausted: plan.state.exhausted })
    state = plan.state
  }
  assert.deepEqual(seen, [
    { index: 0, exhausted: false },
    { index: 1, exhausted: false },
    { index: 1, exhausted: true },
    { index: 1, exhausted: true },
    { index: 1, exhausted: true },
  ])
})

test('planFire without mayAdvance stays on the capped candidate', () => {
  let state = startStep(1, 1, chainOf(1, 2), emptyConditions())
  state = planFire(state, false).state
  const second = planFire(state, false)
  assert.equal(second.state.index, 0)
  assert.equal(second.advanced, false)
})

// ---- decideRecovery ----

test('recovery terminates on an unchecked code even when the cap allows more', () => {
  const state = { ...startStep(1, 1, chainOf(1, 2), emptyConditions()), totalAttempts: 1 }
  assert.equal(decideRecovery(state, 'AUTH', false), 'terminal')
  assert.equal(decideRecovery(state, 'ABORTED', false), 'terminal')
})

test('recovery retries an eligible code within budget, terminates at the cap', () => {
  const base = { ...startStep(1, 1, chainOf(1, 2), emptyConditions()), totalAttempts: 1 }
  assert.equal(decideRecovery(base, 'TIMEOUT', false), 'retry')
  assert.equal(decideRecovery({ ...base, totalAttempts: 10 }, 'TIMEOUT', false), 'terminal')
  assert.equal(decideRecovery(base, 'TIMEOUT', true), 'terminal')
})

// ---- resolveChain ----

const profile = (provider, model) => ({
  id: 'p1',
  when: { provider, model },
  candidates: [{ provider, model, maxAttempts: 2, weight: 0 }],
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
  maxTotalAttempts: 6,
  strategy: 'order',
})

test('resolveChain matches the exact route, else the enabled default pool with an implicit first hop', () => {
  const resolved = { provider: 'a', model: 'x' }
  assert.equal(resolveChain(resolved, [profile('a', 'x')], { enabled: false, candidates: [], switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }, maxTotalAttempts: 3 })?.candidates.length, 1)
  assert.equal(resolveChain(resolved, [profile('b', 'y')], { enabled: false, candidates: [], switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }, maxTotalAttempts: 3 }), undefined)
  const pooled = resolveChain(resolved, [], {
    enabled: true,
    candidates: [{ provider: 'c', model: 'z', maxAttempts: 1, weight: 0 }],
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
    maxTotalAttempts: 3,
    strategy: 'order',
  })
  assert.equal(pooled?.candidates.length, 2)
  assert.equal(pooled?.candidates[0].provider, 'a')
  assert.equal(pooled?.candidates[0].maxAttempts, 1)
})

// ---- strategy: the start index ----

test('resolveStartIndex always starts at the head for the order strategy', () => {
  const chain = chainOf(1, 4)
  for (let cursor = 0; cursor < 8; cursor += 1) {
    assert.equal(resolveStartIndex(chain.candidates, 'order', cursor), 0)
  }
})

test('resolveStartIndex walks the chain one step per cursor for round-robin', () => {
  const chain = chainOf(1, 3)
  assert.deepEqual([0, 1, 2, 3, 4].map(cursor => resolveStartIndex(chain.candidates, 'round-robin', cursor)), [0, 1, 2, 0, 1])
})

test('resolveStartIndex draws by weight, and never picks a zero-weight candidate', () => {
  const candidates = [
    { provider: 'free', model: 'm', weight: 0 },
    { provider: 'paid', model: 'm', weight: 30 },
    { provider: 'spare', model: 'm', weight: 70 },
  ]
  const picked = new Set()
  for (let i = 0; i < 400; i += 1) picked.add(resolveStartIndex(candidates, 'weight', 0))
  // 权重 0 的那条永远不会被抽中，另外两条都出现过。
  assert.deepEqual([...picked].sort(), [1, 2])
})

test('resolveStartIndex falls back to the head when no candidate has weight', () => {
  const chain = chainOf(1, 3)
  assert.equal(resolveStartIndex(chain.candidates, 'weight', 7), 0)
})

test('resolveStartIndex ignores the cursor for a single-candidate chain', () => {
  assert.equal(resolveStartIndex([{ weight: 5 }], 'round-robin', 9), 0)
  assert.equal(resolveStartIndex([{ weight: 5 }], 'weight', 9), 0)
})

test('rotate wraps so the start is the head and the rest follow in order', () => {
  assert.deepEqual(rotate(['a', 'b', 'c'], 1), ['b', 'c', 'a'])
  assert.deepEqual(rotate(['a', 'b', 'c'], 3), ['a', 'b', 'c'])
  assert.deepEqual(rotate(['a', 'b', 'c'], 5), ['c', 'a', 'b'])
  assert.deepEqual(rotate([], 2), [])
})

test('startStep rotates the chain but keeps the user-visible order', () => {
  const chain = chainOf(1, 3)
  const state = startStep(1, 1, chain, emptyConditions(), 1)
  assert.deepEqual(state.chain.candidates.map(c => c.model), ['m1', 'm2', 'm0'])
  // 界面和通知说的"第几条"仍是用户自己排的那一套。
  assert.deepEqual(state.chain.order, [1, 2, 0])
  assert.equal(state.index, 0)
})

test('startStep at the head leaves the chain untouched', () => {
  const chain = chainOf(1, 3)
  const state = startStep(1, 1, chain, emptyConditions(), 0)
  assert.deepEqual(state.chain.candidates.map(c => c.model), ['m0', 'm1', 'm2'])
  assert.deepEqual(state.chain.order, [0, 1, 2])
})

// ---- Circuit breaker ----
import { CircuitBreaker, matchBreakRule } from '../src/breaker.ts'

const RULES = [
  { code: 'AUTH', message: '', cooldownSeconds: 3600, scope: 'route' },
  { code: 'RATE_LIMIT', message: '', cooldownSeconds: 60, scope: 'route' },
  { code: '', message: 'quota', cooldownSeconds: 7200, scope: 'channel' },
]

test('matchBreakRule matches on code alone', () => {
  assert.equal(matchBreakRule('RATE_LIMIT', 'too many requests', RULES).seconds, 60)
  assert.equal(matchBreakRule('AUTH', 'bad key', RULES).seconds, 3600)
})

test('matchBreakRule matches on message when the code says nothing', () => {
  assert.equal(matchBreakRule('PROVIDER_SPECIFIC', 'monthly quota exceeded', RULES).seconds, 7200)
})

test('matchBreakRule requires every filled field to match', () => {
  const both = [{ code: 'SERVER', message: 'overloaded', cooldownSeconds: 30, scope: 'route' }]
  assert.equal(matchBreakRule('SERVER', 'upstream overloaded', both).seconds, 30)
  assert.equal(matchBreakRule('SERVER', 'connection reset', both), undefined)
  assert.equal(matchBreakRule('TIMEOUT', 'upstream overloaded', both), undefined)
})

test('matchBreakRule returns undefined for a failure no rule names', () => {
  assert.equal(matchBreakRule('SERVER', 'internal error', RULES), undefined)
  assert.equal(matchBreakRule('ABORTED', 'user aborted', RULES), undefined)
})

test('matchBreakRule takes the first matching rule', () => {
  const ordered = [
    { code: '', message: 'e', cooldownSeconds: 10, scope: 'route' },
    { code: 'SERVER', message: '', cooldownSeconds: 20, scope: 'channel' },
  ]
  assert.equal(matchBreakRule('SERVER', 'internal error', ordered).seconds, 10)
})

test('matchBreakRule carries the rule scope through', () => {
  assert.equal(matchBreakRule('AUTH', 'bad key', RULES).scope, 'route')
  assert.equal(matchBreakRule('PROVIDER_SPECIFIC', 'quota gone', RULES).scope, 'channel')
})

test('CircuitBreaker blocks a matched route and lifts it when the cooldown ends', () => {
  const breaker = new CircuitBreaker()
  const t0 = 1_000_000
  assert.equal(breaker.note('real-a', 'm1', 'AUTH', 'bad key', RULES, t0)?.until, t0 + 3_600_000)
  assert.equal(breaker.blockedUntil('real-a', 'm1', t0 + 1_000).until, t0 + 3_600_000)
  // 冷却到了就自动放行——不是永久拉黑。
  assert.equal(breaker.blockedUntil('real-a', 'm1', t0 + 3_600_001), undefined)
})

test('CircuitBreaker leaves an unmatched failure alone', () => {
  const breaker = new CircuitBreaker()
  assert.equal(breaker.note('real-a', 'm1', 'SERVER', 'boom', RULES, 1000), undefined)
  assert.equal(breaker.blockedUntil('real-a', 'm1', 2000), undefined)
})

test('CircuitBreaker blocks per route, not per provider', () => {
  const breaker = new CircuitBreaker()
  breaker.note('real-a', 'm1', 'AUTH', 'bad key', RULES, 1000)
  assert.equal(breaker.blockedUntil('real-a', 'm2', 2000), undefined)
  assert.equal(breaker.blockedUntil('real-b', 'm1', 2000), undefined)
})

test('a channel-scope rule blocks every model under the provider', () => {
  // 实测依据：一个网关渠道里密钥失效，链上每条模型都会吐同样的错。按路由禁，
  // 链上会把同渠道其余模型各真打一次才跨渠道——那正是用户配的 attempt 预算。
  const breaker = new CircuitBreaker()
  breaker.note('real-a', 'm1', 'QUOTA_EXCEEDED', 'quota gone', RULES, 1000)
  assert.equal(breaker.blockedUntil('real-a', 'm1', 2000).scope, 'channel')
  assert.equal(breaker.blockedUntil('real-a', 'm2', 2000)?.until, 1000 + 7_200_000)
  assert.equal(breaker.blockedUntil('real-a', 'm3', 2000)?.scope, 'channel')
  // 别的渠道不受影响。
  assert.equal(breaker.blockedUntil('real-b', 'm1', 2000), undefined)
})

test('a route sits out until both its own block and its channel block lift', () => {
  const breaker = new CircuitBreaker()
  const t0 = 1_000_000
  breaker.note('real-a', 'm1', 'RATE_LIMIT', 'slow down', RULES, t0)          // route, 60s
  breaker.note('real-a', 'm2', 'QUOTA_EXCEEDED', 'quota gone', RULES, t0)     // channel, 7200s
  // m1 自己的 60s 先到，但渠道的 7200s 还没到——它仍然不可用，且绑定的是渠道。
  assert.equal(breaker.blockedUntil('real-a', 'm1', t0 + 61_000)?.until, t0 + 7_200_000)
  assert.equal(breaker.blockedUntil('real-a', 'm1', t0 + 61_000)?.scope, 'channel')

  // 反过来：渠道 block 短、路由 block 长时，绑定的回归路由，且渠道的到期会放行
  // 只有渠道 block 的兄弟路由。
  const shortChannel = [{ code: 'QUOTA', message: '', cooldownSeconds: 60, scope: 'channel' }]
  const longRoute = [{ code: 'AUTH', message: '', cooldownSeconds: 3600, scope: 'route' }]
  const other = new CircuitBreaker()
  other.note('real-a', 'm2', 'QUOTA', 'q', shortChannel, t0)                  // channel, 60s
  other.note('real-a', 'm1', 'AUTH', 'k', longRoute, t0)                      // route, 3600s
  assert.equal(other.blockedUntil('real-a', 'm1', t0 + 61_000)?.until, t0 + 3_600_000)
  assert.equal(other.blockedUntil('real-a', 'm1', t0 + 61_000)?.scope, 'route')
  assert.equal(other.blockedUntil('real-a', 'm2', t0 + 61_000), undefined)
})

test('CircuitBreaker.sweep drops expired blocks only', () => {
  const breaker = new CircuitBreaker()
  breaker.note('p', 'short', 'RATE_LIMIT', 'x', RULES, 0)      //  lifts at 60s
  breaker.note('p', 'long', 'AUTH', 'x', RULES, 0)      //  lifts at 3600s
  breaker.sweep(61_000)
  assert.equal(breaker.blockedUntil('p', 'short', 62_000), undefined)
  assert.equal(breaker.blockedUntil('p', 'long', 62_000).until, 3_600_000)
})

test('breakerNotice states the remaining cooldown', () => {
  const text = breakerNotice({ provider: 'real-a', model: 'm1' }, { until: 10_500, scope: 'route' }, 10_000)
  const rendered = text.content.find(block => block.type === 'text').text
  assert.ok(rendered.includes('已被自动禁用'))
  assert.ok(rendered.includes('1 秒后自动重试'))
})

test('breakerNotice names the whole channel for a channel-scope block', () => {
  const text = breakerNotice({ provider: 'real-a', model: 'm1' }, { until: 10_500, scope: 'channel' }, 10_000)
  const rendered = text.content.find(block => block.type === 'text').text
  assert.ok(rendered.includes('渠道 real-a 已整体自动禁用'), rendered)
  assert.ok(rendered.includes('该渠道下所有模型'), rendered)
  // 路由自己的名字不该出现——用户会以为只凉了这一个。
  assert.ok(!rendered.includes('m1'), rendered)
})

// ---- config round-trip: the shape the client saves must land where the host reads ----
import { Config, switchOnSchema } from '../src/config.ts'

const hostConfig = raw => {
  const c = Config(raw)
  return {
    health: c.health.get(),
    default: c.default.get(),
  }
}

test('the skip-notice gate is one gate for all three skip kinds, keyed per turn', () => {
  const states = new RouterState()
  const agent = {} // state 只拿它当 WeakMap 键；agentKey 助手在本文件后部定义
  // 同一 (turn, key) 只放行一次：工具循环每步都重决同一批跳过，发一次就够。
  assert.equal(states.shouldNoteSkip(agent, 1, 'condition:a/b:需图片输入'), true)
  assert.equal(states.shouldNoteSkip(agent, 1, 'condition:a/b:需图片输入'), false)
  // 不同 key（另一类跳过 / 另一个候选）互不遮挡，且各自都被去重——一次 fire 可能
  // 同时跳过条件候选、能力候选和冷却候选，三种都得各自只报一次。
  assert.equal(states.shouldNoteSkip(agent, 1, 'breaker:a/b'), true)
  assert.equal(states.shouldNoteSkip(agent, 1, 'capability:a/b'), true)
  assert.equal(states.shouldNoteSkip(agent, 1, 'breaker:a/b'), false)
  assert.equal(states.shouldNoteSkip(agent, 1, 'capability:a/b'), false)
  assert.equal(states.shouldNoteSkip(agent, 1, 'condition:a/b:需图片输入'), false, 'an earlier key stays deduped after others were announced')
  // 新一轮重新武装：新的失败链要重新告知。
  assert.equal(states.shouldNoteSkip(agent, 2, 'breaker:a/b'), true)
})

test('switchOnKeyOf maps the channel-own faults (AUTH/QUOTA) and never the user-abort', () => {
  // 2026-10-16 修订：AUTH/QUOTA 是渠道自己的毛病（密钥、额度），另一条渠道有自己的
  // 密钥和额度，所以切换通常立刻能救；ABORTED 是用户自己按的停止，永远不切换。
  assert.equal(switchOnKeyOf('AUTH'), 'auth')
  assert.equal(switchOnKeyOf('QUOTA'), 'quota')
  assert.equal(switchOnKeyOf('ABORTED'), undefined)
  assert.equal(switchOnKeyOf('NO_ADAPTER'), undefined)
  assert.equal(switchOnKeyOf('RATE_LIMIT'), 'rateLimit')
})

test('the switch-on table, the host schema and the browser draft are one fact', () => {
  // 表里每一个键都必须同时是 host schema 的字段——否则 UI 上那个开关根本存不进
  // host；浏览器草棒的默认值必须与 schema 解析出的默认值逐字相同。三处各写一遍
  // 就会漂移，而漂移是静默的："UI 说开着、host 说关着"。默认值与码清单的唯一
  // 来源是 ../defaults.ts，这条用例钉住两边都真的读它。
  const hostDefaults = switchOnSchema({})
  const browserDefaults = defaultSwitchOn()
  assert.deepEqual(Object.keys(browserDefaults).sort(), SWITCH_ON_CODES.map(entry => entry.key).sort(),
    'the browser draft names exactly the table\'s keys')
  for (const entry of SWITCH_ON_CODES) {
    assert.ok(Object.hasOwn(hostDefaults, entry.key), `the host schema has no field for ${entry.key}`)
    assert.equal(browserDefaults[entry.key], hostDefaults[entry.key],
      `the browser default for ${entry.key} drifted from the host schema's`)
    assert.equal(switchOnKeyOf(entry.code), entry.key, `the table's code ${entry.code} no longer maps to ${entry.key}`)
  }
})

test('the client save shape lands where the host reads it', () => {
  // 这正是 client.js 的 save() 写进去的形状：四档全在 health 底下。
  // 曾经 breaker 被提到顶层 schema，客户端却存进 health——保存成功、Host 读到
  // 默认值，整个功能静默失效。这条用例守住那个错误。
  const raw = {
    enabled: true,
    profiles: [],
    default: { enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 3, strategy: 'order' },
    health: {
      passive: true,
      discover: { enabled: true, intervalSeconds: 5 },
      probe: { enabled: true, intervalSeconds: 0, prompt: '1', prompts: [], timeoutSeconds: 8 },
      breaker: { enabled: true, rules: [{ code: 'AUTH', message: '', cooldownSeconds: 3600 }] },
    },
  }
  const seen = hostConfig(raw)
  assert.equal(seen.health.breaker.enabled, true)
  assert.equal(seen.health.breaker.rules.length, 1)
  assert.equal(seen.health.breaker.rules[0].code, 'AUTH')
  assert.equal(seen.health.discover.intervalSeconds, 5)
})

test('a legacy flat health config keeps its schedule by converting minutes to seconds', () => {
  const seen = hostConfig({
    enabled: true,
    profiles: [],
    default: { enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 3, strategy: 'order' },
    health: { enabled: true, prompt: 'hi', intervalMinutes: 5, timeoutSeconds: 8 },
  })
  // normalizeHealth 负责迁移；这里断言的是 Host 不会因为旧形状而丢字段或报错。
  assert.ok(seen.health.discover !== undefined)
  assert.ok(seen.health.probe !== undefined)
})

test('assertStructural rejects a weight strategy with no positive weight', () => {
  const so = { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
  const base = { profiles: [], default: { enabled: false, candidates: [], switchOn: so, maxTotalAttempts: 3, strategy: 'weight' } }
  assert.throws(() => assertStructural(base), /weight strategy but no candidate has a positive weight/)
  assert.doesNotThrow(() => assertStructural({
    ...base,
    default: { ...base.default, candidates: [{ provider: 'a', model: 'm', maxAttempts: 1, weight: 5 }] },
  }))
})

test('assertStructural rejects a breaker rule that matches nothing', () => {
  const so = { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
  const emptyPool = { enabled: false, candidates: [], switchOn: so, maxTotalAttempts: 3, strategy: 'order' }
  const health = (breaker) => ({ passive: true, discover: { enabled: false, intervalSeconds: 0 }, probe: { enabled: false, intervalSeconds: 0, prompt: '1', prompts: [], timeoutSeconds: 8 }, breaker })
  assert.throws(() => assertStructural({
    profiles: [],
    default: emptyPool,
    health: health({ enabled: true, rules: [{ code: '', message: '', cooldownSeconds: 60 }] }),
  }), /matches nothing/)
  // 关着也校验：空规则在 breaker.ts 里命中每一次失败，"关着开关存下的空规则"会让
  // 所有候选被禁、failover 静默失效。规则可以留着（再开不用重填），空白规则不行。
  assert.throws(() => assertStructural({
    profiles: [],
    default: emptyPool,
    health: health({ enabled: false, rules: [{ code: '', message: '', cooldownSeconds: 60 }] }),
  }), /matches nothing/)
  // 关着 + 正常规则照常放行。
  assert.doesNotThrow(() => assertStructural({
    profiles: [],
    default: emptyPool,
    health: health({ enabled: false, rules: [{ code: 'RATE_LIMIT', message: '', cooldownSeconds: 60 }] }),
  }))
})

test('assertStructural rejects a chain that names the same route twice', () => {
  const so = { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
  const base = { enabled: false, candidates: [], switchOn: so, maxTotalAttempts: 3, strategy: 'order' }
  const twice = [
    { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, weight: 0 },
    { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, weight: 0 },
  ]
  // 同链重复的渠道会被各打一遍（各含一次退避等待），白吃 attempt 预算——和 ID 重复同级，
  // 结构校验就挡住。目录多选与多行手录都可能录出重复。
  assert.throws(() => assertStructural({
    profiles: [{ id: 'p', when: { provider: 'stub-primary', model: 'stub-model' }, candidates: twice, switchOn: so, maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order' }],
    default: base,
  }), /names stub-primary\/stub-model more than once/)
  assert.throws(() => assertStructural({
    profiles: [],
    default: { ...base, candidates: twice },
  }), /default pool names stub-primary\/stub-model more than once/)
  // 同一个模型出现在不同规则里没问题：那是两个用户选择，各自成链。
  assert.doesNotThrow(() => assertStructural({
    profiles: [
      { id: 'p1', when: { provider: 'stub-primary', model: 'stub-model' }, candidates: [{ provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, weight: 0 }], switchOn: so, maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order' },
      { id: 'p2', when: { provider: 'stub-backup', model: 'stub-model' }, candidates: [{ provider: 'stub-backup', model: 'stub-model', maxAttempts: 1, weight: 0 }, { provider: 'stub-primary', model: 'stub-model', maxAttempts: 1, weight: 0 }], switchOn: so, maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order' },
    ],
    default: base,
  }))
})

test('classifyHealth uses DSH own codes, not invented ones', () => {
  // DSH 的码是 AUTH / QUOTA（llm/src/error.ts 的 QUOTA_EXCEEDED_CODE），
  // 全树没有 AUTH_FAILED。写成不存在的码会让密钥失效永远不标记渠道异常。
  assert.equal(classifyHealth('AUTH'), 'unhealthy')
  assert.equal(classifyHealth('QUOTA'), 'unhealthy')
  assert.equal(classifyHealth('AUTH_FAILED'), undefined)
  assert.equal(classifyHealth('QUOTA_EXCEEDED'), undefined)
})

test('single-field bounds belong to the schema: it refuses each value the deleted guards used to catch', () => {
  // assertStructural 曾经自己拦这 8 个条件，而两条生产调用路径都先过 schema
  // （index.ts:117 读 Cordis 已校验值、index.ts:126 的 Config(raw) 自己跑一遍），
  // 那些 guard 全是死分支——只在 schema 收紧时变成"接不住"的谎言。删掉之后这条
  // 用例钉住 schema 真的拥有它们：任何一个条件被 schema 放行就红。
  const candidate = (over = {}) => ({ provider: 'p', model: 'm', maxAttempts: 1, weight: 0, ...over })
  const profile = (over = {}, candidates = [candidate()]) => ({
    id: 'p1', when: { provider: 'p', model: 'm' }, candidates, switchOn: {},
    maxTotalAttempts: 6, stickyTurns: 0, strategy: 'order', ...over,
  })
  const pool = (over = {}) => ({ enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order', ...over })
  const base = (over = {}) => ({ enabled: true, profiles: [profile()], default: pool(), ...over })
  const cases = [
    ['candidate.maxAttempts < 1', base({ profiles: [profile({}, [candidate({ maxAttempts: 0 })])] })],
    ['profile.maxTotalAttempts < 1', base({ profiles: [profile({ maxTotalAttempts: 0 })] })],
    ['profile.stickyTurns < 0', base({ profiles: [profile({ stickyTurns: -1 })] })],
    ['default.maxTotalAttempts < 1', base({ default: pool({ maxTotalAttempts: 0 }) })],
    ['default.stickyTurns < 0', base({ default: pool({ stickyTurns: -1 }) })],
    ['health.discover.intervalSeconds < 0', base({ health: { discover: { intervalSeconds: -1 } } })],
    ['health.probe.intervalSeconds < 0', base({ health: { probe: { intervalSeconds: -1 } } })],
    // schema 是 .min(2)，比曾经的 `< 1` guard 还严：1 也过不去。
    ['health.probe.timeoutSeconds < 2', base({ health: { probe: { timeoutSeconds: 1 } } })],
  ]
  const throws = (fn) => { try { fn(); return false } catch { return true } }
  for (const [label, raw] of cases) {
    assert.ok(throws(() => Config(raw)), `${label}: the schema must refuse it, or a bound moved out of the schema`)
    assert.doesNotThrow(() => assertStructural(raw),
      `${label}: assertStructural must not re-guard it — that guard is what made the function look stricter than the schema`)
  }
})

console.log(`\n${passed} unit test(s) passed`)

// ---- failover-history fold ----

/** Minimal committed-event shapes the fold reads. */
const header = (provider, model, reason, time = 1000) => ({
  type: 'request/header', time, data: { header: { config: { provider, model } }, reason },
})
const failedAttempt = (code, turn = 1, step = 1) => ({
  type: 'assistant/attempt', time: 1100, data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code } } } }] },
})
const okAttempt = (turn = 1, step = 1) => ({
  type: 'assistant/attempt', time: 1100, data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }] },
})
const message = (turn = 1) => ({ type: 'assistant/message', time: 1200, data: { turn } })
const fold = (...events) => events.reduce(failoverHistoryProjection.apply, failoverHistoryProjection.init())

test('fold records a failover: from, to, code, settled', () => {
  const state = fold(
    { type: 'turn/start', time: 900, data: { turn: 1 } },
    { type: 'step/start', time: 950, data: { turn: 1, step: 1 } },
    header('p-a', 'm-a', 'initial'),
    failedAttempt('RATE_LIMIT'),
    header('p-b', 'm-b', 'change'),
    okAttempt(),
    message(),
  )
  assert.equal(state.entries.length, 1)
  assert.deepEqual(state.entries[0], {
    time: 1000, turn: 1, step: 1, from: 'p-a/m-a', to: 'p-b/m-b', code: 'RATE_LIMIT', settled: true,
  })
})

test('fold ignores a user-initiated switch (change without a failure)', () => {
  const state = fold(header('p-a', 'm-a', 'initial'), header('p-b', 'm-b', 'change'))
  assert.equal(state.entries.length, 0)
})

test('fold ignores series headers and successful attempts', () => {
  const state = fold(header('p-a', 'm-a', 'initial'), okAttempt(), header('p-a', 'm-a', 'series'))
  assert.equal(state.entries.length, 0)
})

test('a failure older than the previous header does not leak into the next switch', () => {
  const state = fold(
    header('p-a', 'm-a', 'initial'),
    failedAttempt('TIMEOUT'),
    header('p-b', 'm-b', 'change'),      // failover #1 (TIMEOUT)
    okAttempt(),
    message(),
    header('p-c', 'm-c', 'change'),      // no failure since the last header: a user switch
  )
  assert.equal(state.entries.length, 1)
  assert.equal(state.entries[0].to, 'p-b/m-b')
})

// 终态失败（不切换）之后用户自己换模型：header 的 reason 也是 'change'，任何 header
// 差异都是（agent.ts:643-648），所以判据不能只问"变更前有没有失败"——失败还必须是
// 同一步里发生的，否则用户的操作会被记成插件的 failover。
test('a user model switch after a terminal failure is not a failover', () => {
  const state = fold(
    { type: 'turn/start', time: 900, data: { turn: 1 } },
    { type: 'step/start', time: 950, data: { turn: 1, step: 1 } },
    header('p-a', 'm-a', 'initial'),
    failedAttempt('AUTH'),               // 终态：不切换，turn 在这里结束
    { type: 'turn/start', time: 1900, data: { turn: 2 } },
    { type: 'step/start', time: 1950, data: { turn: 2, step: 1 } },
    header('p-b', 'm-b', 'change'),      // 用户自己换的模型
  )
  assert.equal(state.entries.length, 0)
})

// 同 turn 内的 llm-retry 恢复：失败后同路由重试成功，之后用户换模型——那次切换
// 同样不该被记成 failover（失败属于上一步/上一轮，且 turn/start 已清掉未决失败）。
test('a recovered transient failure does not arm a later user switch', () => {
  const state = fold(
    { type: 'turn/start', time: 900, data: { turn: 1 } },
    { type: 'step/start', time: 950, data: { turn: 1, step: 1 } },
    header('p-a', 'm-a', 'initial'),
    failedAttempt('RATE_LIMIT'),
    okAttempt(),                          // llm-retry 同路由重试成功
    message(),
    { type: 'turn/start', time: 1900, data: { turn: 2 } },
    { type: 'step/start', time: 1950, data: { turn: 2, step: 1 } },
    header('p-b', 'm-b', 'change'),
  )
  assert.equal(state.entries.length, 0)
})

// settled 只归当轮：切过去的路由当轮就失败，之后任意一轮的成功消息不能把这条
// 旧条目标成"已兑现"。
test('a success in a later turn does not settle an older failover entry', () => {
  const state = fold(
    { type: 'turn/start', time: 900, data: { turn: 1 } },
    { type: 'step/start', time: 950, data: { turn: 1, step: 1 } },
    header('p-a', 'm-a', 'initial'),
    failedAttempt('RATE_LIMIT'),
    header('p-b', 'm-b', 'change'),
    failedAttempt('RATE_LIMIT'),          // 切过去也失败：条目保持未结算
    { type: 'turn/start', time: 1900, data: { turn: 2 } },
    { type: 'step/start', time: 1950, data: { turn: 2, step: 1 } },
    header('p-c', 'm-c', 'change'),       // 用户换模型（无同 step 失败）
    okAttempt(),
    message(),
  )
  assert.equal(state.entries.length, 1)
  assert.equal(state.entries[0].settled, false)
})

test('chained failovers each get an entry, unsettled when the chain dies', () => {
  const state = fold(
    header('p-a', 'm-a', 'initial'),
    failedAttempt('RATE_LIMIT'),
    header('p-b', 'm-b', 'change'),
    failedAttempt('TIMEOUT'),
    header('p-c', 'm-c', 'change'),
    failedAttempt('SERVER'),
  )
  assert.equal(state.entries.length, 2)
  assert.equal(state.entries[0].settled, false)
  assert.equal(state.entries[1].code, 'TIMEOUT')
  assert.equal(state.entries[1].settled, false)
})

test('entries are bounded to MAX_ENTRIES', () => {
  let state = failoverHistoryProjection.init()
  for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
    state = failoverHistoryProjection.apply(state, header(`p-${i}`, 'm', i === 0 ? 'initial' : 'change'))
    state = failoverHistoryProjection.apply(state, failedAttempt('RATE_LIMIT'))
  }
  assert.equal(state.entries.length, MAX_ENTRIES)
  assert.equal(state.entries[0].to, 'p-5/m')
  assert.equal(state.entries[MAX_ENTRIES - 1].to, `p-${MAX_ENTRIES + 4}/m`)
})

test('unrelated events return the same state reference', () => {
  const state = fold(header('p-a', 'm-a', 'initial'))
  assert.equal(failoverHistoryProjection.apply(state, { type: 'turn/end', time: 1, data: { turn: 1, reason: { kind: 'completed' } } }), state)
})

test('the wire view returns the state-held array reference', () => {
  const state = fold(header('p-a', 'm-a', 'initial'), failedAttempt('RATE_LIMIT'), header('p-b', 'm-b', 'change'))
  assert.equal(failoverHistoryProjection.wire.view(state), state.entries)
})

test('failureCodeOfStream reads the terminal finish chunk', () => {
  assert.equal(failureCodeOfStream([{ type: 'text-chunks', time0: 0, index: 0, dt: [1], texts: ['x'] }, { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } } }]), 'AUTH')
  assert.equal(failureCodeOfStream([{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }]), undefined)
  assert.equal(failureCodeOfStream([]), undefined)
})

test('projection key is namespaced and stateVersion is a positive integer', () => {
  assert.equal(FAILOVER_HISTORY_KEY, 'router/failover-history')
  assert.ok(Number.isSafeInteger(failoverHistoryProjection.stateVersion) && failoverHistoryProjection.stateVersion >= 1)
})

// ---- Channel Health unit tests ----
import { classifyHealth, routeKeyOf, channelHealthProjection, CHANNEL_HEALTH_KEY, pushTimelinePoint, MAX_TIMELINE_POINTS } from '../src/health.ts'

test('pushTimelinePoint caps the window at MAX_TIMELINE_POINTS', () => {
  let timeline
  for (let i = 0; i < 30; i++) {
    timeline = pushTimelinePoint(timeline, {
      time: 1000 + i * 10,
      status: i % 2 === 0 ? 'healthy' : 'degraded',
      latencyMs: 100,
    })
  }
  assert.equal(timeline.length, MAX_TIMELINE_POINTS)
  assert.equal(timeline.length, 24)
  // The oldest points are the ones dropped, so the survivor is the newest.
  assert.equal(timeline[timeline.length - 1].time, 1000 + 29 * 10)
  assert.equal(timeline[0].time, 1000 + 6 * 10)
})

test('pushTimelinePoint does not mutate the timeline it was given', () => {
  const original = [{ time: 1, status: 'healthy' }]
  const next = pushTimelinePoint(original, { time: 2, status: 'healthy' })
  assert.equal(original.length, 1)
  assert.equal(next.length, 2)
})

test('channelHealthProjection reads throughput from the usage beside message', () => {
  let state = channelHealthProjection.init()
  state = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 1000,
    data: { reason: 'initial', header: { config: { provider: 'prov-fast', model: 'mod-fast' } } },
  })
  // 100 tokens over the 500ms the turn took = 200 tok/s.
  // `usage` is a sibling of `message` on the event data — core/session/src/types.ts:341-349.
  state = channelHealthProjection.apply(state, {
    type: 'assistant/message',
    time: 1500,
    data: {
      turn: 1,
      step: 1,
      message: { id: 'm1', role: 'assistant', content: [], source: { kind: 'model', provider: 'prov-fast', model: 'mod-fast' } },
      stream: [],
      usage: { inputTokens: 10, outputTokens: 100 },
    },
  })
  const rec = state.records['prov-fast/mod-fast']
  assert.ok(rec)
  assert.equal(rec.status, 'healthy')
  assert.equal(rec.latencyMs, 500)
  assert.equal(rec.throughputTps, 200)
  assert.equal(rec.timeline.length, 1)
  assert.equal(rec.timeline[0].throughputTps, 200)
})

test('channelHealthProjection ignores usage nested inside message', () => {
  // The wrong shape must yield no throughput rather than a silently wrong one:
  // a fixture that restates the implementation proves nothing when it changes.
  let state = channelHealthProjection.init()
  state = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 1000,
    data: { reason: 'initial', header: { config: { provider: 'prov-fast', model: 'mod-fast' } } },
  })
  state = channelHealthProjection.apply(state, {
    type: 'assistant/message',
    time: 1500,
    data: { message: { usage: { outputTokens: 100 } }, stream: [] },
  })
  const rec = state.records['prov-fast/mod-fast']
  assert.ok(rec)
  assert.equal(rec.throughputTps, undefined)
})

test('classifyHealth scores only faults that belong to the channel', () => {
  assert.equal(classifyHealth('RATE_LIMIT'), 'degraded')
  assert.equal(classifyHealth('SERVER'), 'unhealthy')
  assert.equal(classifyHealth('TIMEOUT'), 'unhealthy')
  assert.equal(classifyHealth('TRANSPORT'), 'unhealthy')
  assert.equal(classifyHealth('AUTH'), 'unhealthy')
  assert.equal(classifyHealth('QUOTA'), 'unhealthy')
  // A rejected request, an empty reply and a user-initiated abort say nothing
  // about the channel; scoring them would paint a working route red.
  assert.equal(classifyHealth('INVALID_REQUEST'), undefined)
  assert.equal(classifyHealth('EMPTY_RESPONSE'), undefined)
  assert.equal(classifyHealth('ABORTED'), undefined)
  assert.equal(classifyHealth('NO_ADAPTER'), undefined)
  // The same three codes the probe must report as `unavailable`: a call that
  // never happened indicts the channel no more here than it does there.
  assert.equal(classifyHealth('MISSING_CREDENTIAL'), undefined)
  assert.equal(classifyHealth('INVALID_CREDENTIAL'), undefined)
})

test('routeKeyOf formats provider and model as provider/model', () => {
  assert.equal(routeKeyOf('deepseek-official', 'deepseek-chat'), 'deepseek-official/deepseek-chat')
})

test('channelHealthProjection folds session headers and attempts into channel records', () => {
  assert.equal(CHANNEL_HEALTH_KEY, 'router/channel-health')
  let state = channelHealthProjection.init()
  assert.deepEqual(state.records, {})

  // 1. Initial request header
  state = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 1000,
    data: { reason: 'initial', header: { config: { provider: 'prov-1', model: 'mod-1' } } },
  })
  assert.equal(state.currentRoute, 'prov-1/mod-1')

  // 2. Failed attempt with 500
  state = channelHealthProjection.apply(state, {
    type: 'assistant/attempt',
    time: 1500,
    data: {
      stream: [
        { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER' } } } },
      ],
    },
  })
  assert.ok(state.records['prov-1/mod-1'])
  assert.equal(state.records['prov-1/mod-1'].status, 'unhealthy')
  assert.equal(state.records['prov-1/mod-1'].lastError, 'SERVER')

  // 3. Switch to candidate 2
  state = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 2000,
    data: { reason: 'change', header: { config: { provider: 'prov-2', model: 'mod-2' } } },
  })

  // 4. Successful assistant message
  state = channelHealthProjection.apply(state, {
    type: 'assistant/message',
    time: 2400,
    data: { message: { content: [] }, stream: [], usage: { inputTokens: 5, outputTokens: 40 } },
  })
  assert.ok(state.records['prov-2/mod-2'])
  assert.equal(state.records['prov-2/mod-2'].status, 'healthy')
  assert.equal(state.records['prov-2/mod-2'].latencyMs, 400)
  // 40 tokens over 400ms = 100 tok/s.
  assert.equal(state.records['prov-2/mod-2'].throughputTps, 100)
  // A settlement clears the error the failed attempt left behind.
  assert.equal(state.records['prov-2/mod-2'].lastError, undefined)

  // Wire view returns records
  assert.equal(channelHealthProjection.wire.view(state), state.records)
})

test('channelHealthProjection leaves the record alone for a non-channel fault', () => {
  let state = channelHealthProjection.init()
  state = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 1000,
    data: { reason: 'initial', header: { config: { provider: 'prov-1', model: 'mod-1' } } },
  })
  const before = state
  state = channelHealthProjection.apply(state, {
    type: 'assistant/attempt',
    time: 1500,
    data: {
      turn: 1,
      step: 1,
      stream: [
        { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST' } } } },
      ],
    },
  })
  assert.deepEqual(state.records, {})
  assert.equal(state, before)
})

test('channelHealthProjection returns the same state reference for events it ignores', () => {
  const state = channelHealthProjection.init()
  for (const type of ['turn/start', 'tool/call', 'user/message', 'step/start']) {
    assert.equal(channelHealthProjection.apply(state, { type, time: 1, data: {} }), state)
  }
  // A settlement with no preceding header has no route to attribute to.
  assert.equal(
    channelHealthProjection.apply(state, { type: 'assistant/message', time: 1, data: { message: {}, stream: [] } }),
    state,
  )
})

test('channelHealthProjection tolerates a header that names no route', () => {
  const state = channelHealthProjection.init()
  const next = channelHealthProjection.apply(state, {
    type: 'request/header',
    time: 1,
    data: { reason: 'initial', header: { config: { provider: '', model: '' } } },
  })
  assert.equal(next, state)
})

// ---- the round-robin cursor ----
// 轮询游标按请求推进（每个 step 一次 startStep），重试不推进——所以同一步的
// llm-retry 重试不会把链拧走。组合测试够不到它：一次 headless 只有一个 step，
// 要第二个请求得让 stub 驱动一次工具循环。

test('the cursor advances one step per request and wraps, per session', () => {
  const states = new RouterState()
  const session = { id: {} }
  assert.equal(states.nextCursor(session, 2), 0, 'the first request of a session starts at the head')
  assert.equal(states.nextCursor(session, 2), 1, 'the next request advances one step')
  assert.equal(states.nextCursor(session, 2), 0, 'and wraps at the chain length')
  assert.equal(states.nextCursor({ id: {} }, 2), 0, 'another session counts from its own head')
})

test('a single-candidate chain never moves the cursor', () => {
  const states = new RouterState()
  const session = { id: {} }
  assert.equal(states.nextCursor(session, 1), 0)
  assert.equal(states.nextCursor(session, 1), 0)
})

// ---- turn-accumulated image conditions (RouterState) ----// 图片条件按 turn 累积：pre-step 的 messages 只是本步新 claimed 的输入，一个
// 带图 turn 的第二步之后通常是空的——按 step 判会让工具循环的第二步滑回文本
// 模型，而图片还在请求历史里（read_image 也会再次撞门禁）。

const turnConditions = (hasImages, projectedTokens) => ({ hasImages, projectedTokens })
// RouterState 只按身份键控，任何对象都能当 Agent 用。
const agentKey = () => ({ id: {} })

test('image conditions accumulate across the steps of one turn', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(true, 100))
  // 第二步没有新的 claimed 输入，但这一轮已经有图。
  assert.equal(states.conditionsFor(agent, 1, 2).hasImages, true)
  // 新轮次重新评估，不继承上一轮。
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, false)
})

test('projectedTokens stays step-scoped while hasImages is turn-scoped', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(false, 500))
  assert.equal(states.conditionsFor(agent, 1, 1).projectedTokens, 500)
  // 第二步带来图片：整轮按有图算，token 估算换成本步新鲜的数值。
  states.noteConditions(agent, 1, 2, turnConditions(true, 900))
  assert.equal(states.conditionsFor(agent, 1, 2).hasImages, true)
  assert.equal(states.conditionsFor(agent, 1, 2).projectedTokens, 900)
})

test('a no-image turn clears the accumulated image condition', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(true, undefined))
  states.noteConditions(agent, 2, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, false)
})

test('stickyTurns 0 reverts on the very next no-image turn', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.setStickyTurns(agent, 0)
  states.noteConditions(agent, 1, 1, turnConditions(true, undefined))
  states.noteConditions(agent, 2, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, false)
})

test('stickyTurns holds the image condition for N no-image turns, then reverts', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.setStickyTurns(agent, 2)
  states.noteConditions(agent, 1, 1, turnConditions(true, undefined))
  states.noteConditions(agent, 2, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, true)
  states.noteConditions(agent, 3, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 3, 1).hasImages, true)
  states.noteConditions(agent, 4, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 4, 1).hasImages, false)
})

// 生产时序：pre-step 先于 agent/request，而 sticky 值只在 request 里写入
// （resolveChain 之后）。所以会话的第一个带图轮，noteConditions 时 sticky 还是 0。
// setStickyTurns 必须把当前轮刚写的窗口补上，否则紧随的无图追问不粘——这一条不预置
// setStickyTurns，复现的就是"新会话第一条消息带图"的真实顺序。
test('the session first image turn still arms the sticky window (pre-step precedes the request)', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(true, undefined))
  assert.equal(states.conditionsFor(agent, 1, 1).hasImages, true)
  // 此刻还没有任何 setStickyTurns：链未解析。请求到达、链解析出来后才写入。
  states.setStickyTurns(agent, 2)
  states.noteConditions(agent, 2, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, true, 'the first no-image follow-up sticks')
  states.noteConditions(agent, 3, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 3, 1).hasImages, true)
  states.noteConditions(agent, 4, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 4, 1).hasImages, false)
})

test('an image turn refreshes the sticky window', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.setStickyTurns(agent, 1)
  states.noteConditions(agent, 1, 1, turnConditions(true, undefined))
  states.noteConditions(agent, 2, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 2, 1).hasImages, true)
  // 第 2 轮又带来图片：窗口重新计，后面还能再粘一轮。
  states.noteConditions(agent, 3, 1, turnConditions(true, undefined))
  states.noteConditions(agent, 4, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 4, 1).hasImages, true)
  states.noteConditions(agent, 5, 1, turnConditions(false, undefined))
  assert.equal(states.conditionsFor(agent, 5, 1).hasImages, false)
})

test('an image tool result marks the turn image-bearing for later steps', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(false, undefined))
  // read_image 的图经工具结果进来：本步请求里还没有它，下一步才有。
  states.noteToolResult(agent, 1, true)
  assert.equal(states.conditionsFor(agent, 1, 2).hasImages, true)
})

test('a text-only tool result leaves the turn condition alone', () => {
  const states = new RouterState()
  const agent = agentKey()
  states.noteConditions(agent, 1, 1, turnConditions(false, undefined))
  states.noteToolResult(agent, 1, false)
  assert.equal(states.conditionsFor(agent, 1, 2).hasImages, false)
})

test('toolResultHasImage reads the nested tool-result content', () => {
  assert.equal(
    toolResultHasImage({ message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: 'x' }] }] } }),
    false,
  )
  assert.equal(
    toolResultHasImage({ message: { content: [{ type: 'tool-result', toolCallId: 'c', content: [{ type: 'image', attachment: {} }] }] } }),
    true,
  )
  // 顶层直接是图片块（非工具结果路径）也算。
  assert.equal(toolResultHasImage({ message: { content: [{ type: 'image', attachment: {} }] } }), true)
  assert.equal(toolResultHasImage({ message: { content: [] } }), false)
  assert.equal(toolResultHasImage({}), false)
  assert.equal(toolResultHasImage(undefined), false)
})

// ---- stickyTurns structural validation ----

test('a negative stickyTurns is refused by the schema, not by a structural guard', () => {
  // 曾经 assertStructural 自己拦 stickyTurns < 0——而两条生产调用路径都先过
  // schema（index.ts:117 读 Cordis 已校验值、index.ts:126 的 Config(raw) 自己
  // 跑一遍），.min(0) 永远拦在前面，那个 guard 是死分支，只在 schema 收紧时
  // 变成"接不住"的谎言。单字段边界归 schema：这里钉住它真的归 schema。
  assert.throws(() => Config({
    profiles: [{
      id: 'p1',
      when: { provider: 'p', model: 'm' },
      candidates: [{ provider: 'p', model: 'm', maxAttempts: 1, weight: 0 }],
      switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
      maxTotalAttempts: 6,
      stickyTurns: -1,
    }],
    default: { enabled: false, candidates: [], switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }, maxTotalAttempts: 3, stickyTurns: 0 },
  }), /stickyTurns/)
})

test('assertStructural accepts stickyTurns 0 and a positive value', () => {
  const base = {
    id: 'p1',
    when: { provider: 'p', model: 'm' },
    candidates: [{ provider: 'p', model: 'm', maxAttempts: 1, weight: 0 }],
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
    maxTotalAttempts: 6,
  }
  const fallback = { enabled: false, candidates: [], switchOn: base.switchOn, maxTotalAttempts: 3, stickyTurns: 0 }
  assertStructural({ profiles: [{ ...base, stickyTurns: 0 }], default: fallback })
  assertStructural({ profiles: [{ ...base, stickyTurns: 3 }], default: fallback })
})

// ---- the probe (pure paths the integration suite cannot reach) ----

/**
 * An llm face that answers however the case asks. The stream factory receives
 * the request options, so a fake stream can observe the probe's signal the way
 * a real adapter does — which is also what lets an abandoned stream finish.
 */
function fakeLlm({ makeStream, prepareError } = {}) {
  return {
    prepareCall: () => prepareError === undefined
      ? Promise.resolve({ config: { provider: 'p', model: 'm' }, stream: (options) => makeStream(options.signal) })
      : Promise.reject(prepareError),
  }
}

/** A stream that never produces and never ends until the signal aborts it. */
const neverEnding = (signal) => (async function* () {
  await new Promise((_resolve, reject) => {
    if (signal?.aborted === true) reject(signal.reason)
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
})()

const reachableStream = () => (async function* () {
  yield { type: 'text-delta', index: 0, text: 'x' }
})()

const route = { provider: 'p', model: 'm' }

test('probeRoute measures the first content byte and reports reachable', async () => {
  const result = await probeRoute(fakeLlm({ makeStream: () => reachableStream() }), route, 'ping', 8)
  assert.equal(result.kind, 'reachable')
  assert.equal(typeof result.latencyMs, 'number')
  assert.equal(result.error, undefined)
})

test('probeRoute reports an error finish as unreachable with its code', async () => {
  const failing = (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'denied' } } }
  })()
  const result = await probeRoute(fakeLlm({ makeStream: () => failing }), route, 'ping', 8)
  assert.equal(result.kind, 'unreachable')
  assert.equal(result.error, 'AUTH')
  assert.equal(result.latencyMs, undefined, 'a route that never answered has no TTFT')
})

test('probeRoute reports a thrown adapter error by its code', async () => {
  const thrown = Object.assign(new Error('stub refused'), { code: 'RATE_LIMIT' })
  const result = await probeRoute({
    prepareCall: () => Promise.resolve({
      config: {},
      stream: () => { throw thrown },
    }),
  }, route, 'ping', 8)
  assert.equal(result.kind, 'unreachable')
  assert.equal(result.error, 'RATE_LIMIT')
})

test('probeRoute times out as unreachable, never as a silent hang', async () => {
  const started = Date.now()
  const result = await probeRoute(fakeLlm({ makeStream: (signal) => neverEnding(signal) }), route, 'ping', 1)
  assert.equal(result.kind, 'unreachable')
  assert.equal(result.error, 'TIMEOUT')
  assert.ok(Date.now() - started < 5000, 'the deadline fired instead of waiting on the stream')
})

test('probeRoute reads a route it cannot even call as unavailable, not as a fault', async () => {
  const result = await probeRoute(fakeLlm({ prepareError: new Error('no adapter') }), route, 'ping', 8)
  assert.equal(result.kind, 'unavailable')
  assert.match(result.error ?? '', /no adapter/)
})

// The boundary `types.ts:30-34` draws: `unreachable` is reserved for "the call
// was made and the endpoint, the credential, or the model refused it". A code
// DSH raises while *assembling* the call means no request ever existed, so it
// must land on `unavailable` — otherwise a profile that never registered the
// provider, or one with no key stored, is painted as a red channel fault.
//
// Both delivery shapes are real and both are pinned here:
//   - `prepareCall` rejects outright (`llm/src/index.ts:995` for `NO_ADAPTER`);
//   - the adapter fails inside the stream and `adapterStream` converts the
//     throw into an in-band error finish (`llm/src/index.ts:1113,1161`) — that
//     is how a keyless `deepseek-official` reports `MISSING_CREDENTIAL`, from
//     `llm-deepseek-api-key/src/index.ts:30`.
test('probeRoute reads a provider with no registered adapter as unavailable', async () => {
  const thrown = Object.assign(
    new Error('no adapter registered for provider "real-a"'),
    { code: 'NO_ADAPTER' },
  )
  const result = await probeRoute({ prepareCall: () => Promise.reject(thrown) }, route, 'ping', 8)
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.error, 'NO_ADAPTER')
})

test('probeRoute reads a route with no credential as unavailable, in band', async () => {
  const keyless = (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'no key' } } }
  })()
  const result = await probeRoute(fakeLlm({ makeStream: () => keyless }), route, 'ping', 8)
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.error, 'MISSING_CREDENTIAL')
  assert.equal(result.latencyMs, undefined, 'a route that never answered has no TTFT')
})

test('probeRoute reads a stored credential no header can carry as unavailable', async () => {
  // `assertUsableApiKey` (llm/src/index.ts:151) refuses a blank or
  // header-hostile key before any request is built — the same class.
  const unusable = (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_CREDENTIAL', message: 'blank' } } }
  })()
  const result = await probeRoute(fakeLlm({ makeStream: () => unusable }), route, 'ping', 8)
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.error, 'INVALID_CREDENTIAL')
})

test('probeRoute keeps a refusal that really left the Host unreachable', async () => {
  // The counterpart: the classification is per code, not a blanket downgrade.
  // `AUTH` means a request went out and the endpoint refused it, so it stays a
  // fault — in band and thrown alike.
  const denied = (async function* () {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'denied' } } }
  })()
  const inBand = await probeRoute(fakeLlm({ makeStream: () => denied }), route, 'ping', 8)
  assert.equal(inBand.kind, 'unreachable')
  assert.equal(inBand.error, 'AUTH')
  const thrown = Object.assign(new Error('refused'), { code: 'TRANSPORT' })
  const raised = await probeRoute({
    prepareCall: () => Promise.resolve({ config: {}, stream: () => { throw thrown } }),
  }, route, 'ping', 8)
  assert.equal(raised.kind, 'unreachable')
  assert.equal(raised.error, 'TRANSPORT')
})

test('probeRoute stops when the caller cancels, and says so', async () => {
  const controller = new AbortController()
  const running = probeRoute(fakeLlm({ makeStream: (signal) => neverEnding(signal) }), route, 'ping', 8, controller.signal)
  controller.abort()
  const result = await running
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.error, 'cancelled')
})

test('probeRoute reports a stream that ends empty as unavailable, not as a fault', async () => {
  const empty = (async function* () {
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
  const result = await probeRoute(fakeLlm({ makeStream: () => empty }), route, 'ping', 8)
  assert.equal(result.kind, 'unavailable')
  assert.equal(result.error, 'empty stream')
})

test('probePromptFor uses the per-route override, else the shared default', () => {
  const overrides = [{ route: 'p/m', prompt: 'hi there' }]
  assert.equal(probePromptFor(route, '1', overrides), 'hi there')
  assert.equal(probePromptFor({ provider: 'p', model: 'other' }, '1', overrides), '1')
  assert.equal(probePromptFor(route, '1', []), '1')
})

// ---- the connectivity check's classification (the Host side) ----

/**
 * An llm face with a configurable-provider directory and one discovery answer
 * per namespace. `answer` may return a model list or throw, which is how a
 * real discovery refuses.
 */
function discoveryLlm({ directory = [], answers = {}, settings } = {}) {
  const asked = []
  return {
    asked,
    listConfigurableProviders: () => directory,
    discoverModels: (settingsNs, request) => {
      asked.push({ settingsNs, request })
      const answer = answers[settingsNs]
      if (answer === undefined) {
        // Exactly what LlmRuntime does when no discovery is registered for the
        // namespace (packages/llm/llm/src/index.ts:594-597).
        throw Object.assign(new Error(`no model discovery is registered for "${settingsNs}"`), { code: 'NO_DISCOVERY' })
      }
      // A function answer is the discovery itself: calling it is what lets a
      // case make the refusal happen on the call rather than before it.
      return typeof answer === 'function' ? answer() : answer
    },
  }
}

const checkRoute = { provider: 'deepseek-official', model: 'deepseek-chat' }

test('checkConnectivity reports a route whose endpoint lists the model as reachable', async () => {
  const llm = discoveryLlm({
    directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'ns-a', settingsPath: [] }],
    answers: { 'ns-a': Promise.resolve([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]) },
  })
  const verdict = await checkConnectivity(llm, undefined, checkRoute)
  assert.deepEqual(verdict, { provider: 'deepseek-official', model: 'deepseek-chat', kind: 'reachable' })
  assert.deepEqual(llm.asked, [{ settingsNs: 'ns-a', request: { provider: 'deepseek-official' } }],
    'the request names the provider; the namespace comes from the directory entry')
})

test('checkConnectivity reads the stored baseURL out of the settings namespace', async () => {
  // The settingsPath walk is the plugin's own: the directory entry says where
  // inside the namespace the profile lives, and only the Host can read it.
  const llm = discoveryLlm({
    directory: [{ provider: 'gw', displayName: 'Gateway', settingsNs: 'ns-a', settingsPath: ['providers', 'gw'] }],
    answers: { 'ns-a': Promise.resolve([{ id: 'm' }]) },
  })
  await checkConnectivity(llm, {
    describe: () => [{ ns: 'ns-a', value: { providers: { gw: { baseURL: 'https://gw.example/v1' } } } }],
  }, { provider: 'gw', model: 'm' })
  assert.deepEqual(llm.asked[0].request, { provider: 'gw', baseURL: 'https://gw.example/v1' })
})

test('checkConnectivity reports an endpoint that answered without this model as notAdvertised', async () => {
  const llm = discoveryLlm({
    directory: [{ provider: 'gw', displayName: 'Gateway', settingsNs: 'ns-a', settingsPath: [] }],
    answers: { 'ns-a': Promise.resolve([{ id: 'other' }, { id: 'another' }]) },
  })
  const verdict = await checkConnectivity(llm, undefined, { provider: 'gw', model: 'm' })
  assert.equal(verdict.kind, 'notAdvertised')
  assert.equal(verdict.advertised, 2)
})

test('checkConnectivity reads a namespace with no registered discovery as unavailable, not as a refusal', async () => {
  // The whole DeepSeek family: `registerDeepSeekProvider` registers an adapter
  // and never a model discovery (llm-deepseek/src/host.ts:55), so the provider
  // is configurable and usable while a connectivity check is structurally
  // impossible. Reporting that as "the endpoint did not answer" accuses an
  // endpoint that was never contacted.
  const llm = discoveryLlm({
    directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'ns-a', settingsPath: [] }],
    answers: {},
  })
  const verdict = await checkConnectivity(llm, undefined, checkRoute)
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'noDiscovery')
  assert.equal(verdict.error, 'NO_DISCOVERY')
  assert.equal(verdict.advertised, undefined, 'a check that never ran counted no models')
})

test('checkConnectivity reads a request that names neither provider nor baseURL as unavailable', async () => {
  // The runtime's other pre-dispatch guard (llm/src/index.ts:600-602). This
  // plugin always names the configured provider, so the case is unreachable
  // today; it is pinned so a future call shape that forgets the provider lands
  // in the honest bucket instead of in "the endpoint did not answer".
  const llm = discoveryLlm({
    directory: [{ provider: 'gw', displayName: 'Gateway', settingsNs: 'ns-a', settingsPath: [] }],
    answers: {
      'ns-a': () => { throw Object.assign(new Error('needs a provider or a baseURL'), { code: 'INVALID_DISCOVERY' }) },
    },
  })
  const verdict = await checkConnectivity(llm, undefined, { provider: 'gw', model: 'm' })
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'noDiscovery')
  assert.equal(verdict.error, 'INVALID_DISCOVERY')
})

test('checkConnectivity keeps a discovery that really ran and refused unreachable', async () => {
  // The counterpart, and the reason the set is closed rather than "any refusal
  // is unavailable": these codes come from a discovery the runtime DID invoke,
  // and each is the channel's own answer about this route.
  const refused = Object.assign(new Error('401 from the gateway'), { code: 'AUTH' })
  const llm = discoveryLlm({
    directory: [{ provider: 'gw', displayName: 'Gateway', settingsNs: 'ns-a', settingsPath: [] }],
    answers: { 'ns-a': () => { throw refused } },
  })
  const verdict = await checkConnectivity(llm, undefined, { provider: 'gw', model: 'm' })
  assert.equal(verdict.kind, 'unreachable')
  assert.equal(verdict.error, 'AUTH')
  assert.equal(verdict.reason, undefined)
})

test('checkConnectivity keeps a provider-family refusal unreachable, with its code', async () => {
  // pi-ai's own discovery raises these after the runtime invoked it
  // (llm-pi-ai/src/discovery.ts:243,288,301). They name something the user can
  // fix for THIS channel, so they stay facts about the channel.
  for (const code of ['DISCOVERY_FAILED', 'DISCOVERY_UNSUPPORTED', 'INVALID_CREDENTIAL']) {
    const llm = discoveryLlm({
      directory: [{ provider: 'gw', displayName: 'Gateway', settingsNs: 'ns-a', settingsPath: [] }],
      answers: { 'ns-a': () => { throw Object.assign(new Error('no'), { code }) } },
    })
    const verdict = await checkConnectivity(llm, undefined, { provider: 'gw', model: 'm' })
    assert.equal(verdict.kind, 'unreachable', `${code} is the discovery's own answer about this route`)
    assert.equal(verdict.error, code)
  }
})

test('checkConnectivity reads a route with no configurable-provider entry as unavailable', async () => {
  // Nothing in DSH's directory declares this provider, so there is no settings
  // namespace to interrogate and no endpoint to ask.
  const llm = discoveryLlm({ directory: [], answers: {} })
  const verdict = await checkConnectivity(llm, undefined, checkRoute)
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'notConfigurable')
  assert.equal(llm.asked.length, 0, 'no discovery was asked for a route with no namespace')
})

test('routeParts is the exact inverse of routeKeyOf', () => {
  // 真实形状：provider 段永不含 `/`（DSH 的 provider 名是标识符），model 段
  // 可以含（网关自己的模型路径）。所以切分必须停在第一个 `/`——这是
  // routes.ts 写下的唯一口径，九个原先各写一遍的解码点都照它。
  assert.deepEqual(routeParts(routeKeyOf('gw', 'kimi-k3')), { provider: 'gw', model: 'kimi-k3' })
  assert.deepEqual(routeParts(routeKeyOf('gw', 'vendor/kimi-k3')), { provider: 'gw', model: 'vendor/kimi-k3' })
  // 没有斜杠的串不是路由键。折叠一条坏记录不能抛，所以它作为"没有 model"
  // 回来，由调用方自己的空值守卫丢掉（health workspace 的 ensure 正是这么用）。
  assert.deepEqual(routeParts('gw'), { provider: 'gw', model: '' })
})

// 路由键的拼与拆只能有一个表达式。`routes.ts` 的 docstring 断言"Everything
// here is pure and shared"——而实现层审查实测 host 8 处 + browser 18 处编码、
// 9 处解码全是手抄的，那条断言为假。这条守卫让"再手抄一处"立刻转红：src/ 里
// 任何 `provider + '/'`、模板串 `${a}/${b}`、`indexOf('/')`、`split('/')`
// 都不允许出现（routes.ts 自身除外，它拥有这个表达式）。
test('a route key is built and split in exactly one place', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url))
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
  const files = walk(srcDir).filter((file) => relative(srcDir, file) !== 'routes.ts')
  // 注释里合法地提到 `/`（说明口径），所以守卫只读代码；块注释按原样留白，
  // 行号才不会因为剥离而漂移。
  const codeOf = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  const shapes = [
    { pattern: /provider \+ '\/'|model \+ '\/'|\+ '\/' \+/, why: 'a hand-joined route key' },
    // 插值尾巴必须是 provider 或 model（可带 `?? ''` 兜底）：`${position}/${total}`
    // 这类分数展示长得一样但不是路由键，守卫不拦它。
    { pattern: /(?:provider|model)(?:\s*\?\?\s*'')?\}\//, why: 'a route key spliced inside a template literal' },
    { pattern: /indexOf\('\/'\)|split\('\/'\)/, why: 'a hand-split route key' },
  ]
  const found = []
  for (const file of files) {
    const code = codeOf(readFileSync(file, 'utf8'))
    for (const { pattern, why } of shapes) {
      for (const match of code.matchAll(new RegExp(pattern.source, 'g'))) {
        const line = code.slice(0, match.index).split('\n').length
        found.push(`${relative(srcDir, file)}:${line}: ${why}`)
      }
    }
  }
  assert.deepEqual(found, [], `route keys must go through routes.ts, found ${found.length}:\n${found.join('\n')}`)
})

await Promise.all(pending)
console.log(`\n${passed} unit test(s) passed`)

