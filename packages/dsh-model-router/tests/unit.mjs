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
import {
  conditionsMet,
  decideRecovery,
  hasImageContent,
  planFire,
  resolveChain,
  resolveStartIndex,
  rotate,
  startStep,
  unmetCondition,
} from '../src/router.ts'
import { failoverHistoryProjection, failureCodeOfStream, FAILOVER_HISTORY_KEY, MAX_ENTRIES } from '../src/lineage.ts'
import { breakerNotice } from '../src/notice.ts'
import { assertStructural } from '../src/config.ts'
import { emptyConditions } from '../src/state.ts'

let passed = 0
function test(name, body) {
  try {
    body()
    passed += 1
    console.log(`    ok  ${name}`)
  } catch (error) {
    console.log(`    FAIL ${name}: ${error.message}`)
    process.exitCode = 1
  }
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

test('images gate requires an image block', () => {
  assert.equal(unmetCondition(candidate({ images: true }), conditions(false, 5000)), '需图片输入')
  assert.equal(unmetCondition(candidate({ images: true }), conditions(true, 5000)), undefined)
  assert.equal(unmetCondition(candidate({ images: false }), conditions(false, 0)), undefined)
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
  { code: 'AUTH', message: '', cooldownSeconds: 3600 },
  { code: 'RATE_LIMIT', message: '', cooldownSeconds: 60 },
  { code: '', message: 'quota', cooldownSeconds: 7200 },
]

test('matchBreakRule matches on code alone', () => {
  assert.equal(matchBreakRule('RATE_LIMIT', 'too many requests', RULES), 60)
  assert.equal(matchBreakRule('AUTH', 'bad key', RULES), 3600)
})

test('matchBreakRule matches on message when the code says nothing', () => {
  assert.equal(matchBreakRule('PROVIDER_SPECIFIC', 'monthly quota exceeded', RULES), 7200)
})

test('matchBreakRule requires every filled field to match', () => {
  const both = [{ code: 'SERVER', message: 'overloaded', cooldownSeconds: 30 }]
  assert.equal(matchBreakRule('SERVER', 'upstream overloaded', both), 30)
  assert.equal(matchBreakRule('SERVER', 'connection reset', both), undefined)
  assert.equal(matchBreakRule('TIMEOUT', 'upstream overloaded', both), undefined)
})

test('matchBreakRule returns undefined for a failure no rule names', () => {
  assert.equal(matchBreakRule('SERVER', 'internal error', RULES), undefined)
  assert.equal(matchBreakRule('ABORTED', 'user aborted', RULES), undefined)
})

test('matchBreakRule takes the first matching rule', () => {
  const ordered = [
    { code: '', message: 'e', cooldownSeconds: 10 },
    { code: 'SERVER', message: '', cooldownSeconds: 20 },
  ]
  assert.equal(matchBreakRule('SERVER', 'internal error', ordered), 10)
})

test('CircuitBreaker blocks a matched route and lifts it when the cooldown ends', () => {
  const breaker = new CircuitBreaker()
  const t0 = 1_000_000
  assert.equal(breaker.note('real-a', 'm1', 'AUTH', 'bad key', RULES, t0)?.until, t0 + 3_600_000)
  assert.equal(breaker.blockedUntil('real-a', 'm1', t0 + 1_000), t0 + 3_600_000)
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

test('CircuitBreaker.sweep drops expired blocks only', () => {
  const breaker = new CircuitBreaker()
  breaker.note('p', 'short', 'RATE_LIMIT', 'x', RULES, 0)      //  lifts at 60s
  breaker.note('p', 'long', 'AUTH', 'x', RULES, 0)      //  lifts at 3600s
  breaker.sweep(61_000)
  assert.equal(breaker.blockedUntil('p', 'short', 62_000), undefined)
  assert.equal(breaker.blockedUntil('p', 'long', 62_000), 3_600_000)
})

test('breakerNotice states the remaining cooldown', () => {
  const text = breakerNotice({ provider: 'real-a', model: 'm1' }, 10_500, 10_000)
  const rendered = text.content.find(block => block.type === 'text').text
  assert.ok(rendered.includes('已被自动禁用'))
  assert.ok(rendered.includes('1 秒后自动重试'))
})

// ---- config round-trip: the shape the client saves must land where the host reads ----
import { Config } from '../src/config.ts'

const hostConfig = raw => {
  const c = Config(raw)
  return {
    health: c.health.get(),
    default: c.default.get(),
  }
}

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
  assert.throws(() => assertStructural({
    profiles: [],
    default: emptyPool,
    health: { passive: true, discover: { enabled: false, intervalSeconds: 0 }, probe: { enabled: false, intervalSeconds: 0, prompt: '1', prompts: [], timeoutSeconds: 8 }, breaker: { enabled: true, rules: [{ code: '', message: '', cooldownSeconds: 60 }] } },
  }), /matches nothing/)
  // 关着的时候不校验——没启用的规则不该挡住保存。
  assert.doesNotThrow(() => assertStructural({
    profiles: [],
    default: emptyPool,
    health: { passive: true, discover: { enabled: false, intervalSeconds: 0 }, probe: { enabled: false, intervalSeconds: 0, prompt: '1', prompts: [], timeoutSeconds: 8 }, breaker: { enabled: false, rules: [{ code: '', message: '', cooldownSeconds: 60 }] } },
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

