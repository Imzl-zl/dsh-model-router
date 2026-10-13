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
  startStep,
  unmetCondition,
} from '../src/router.ts'
import { failoverHistoryProjection, failureCodeOfStream, FAILOVER_HISTORY_KEY, MAX_ENTRIES } from '../src/lineage.ts'
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

const chainOf = (maxAttempts, count = 3) => ({
  candidates: Array.from({ length: count }, (_, index) => ({ provider: 'p', model: `m${index}`, maxAttempts })),
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
  maxTotalAttempts: 10,
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
  candidates: [{ provider, model, maxAttempts: 2 }],
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
  maxTotalAttempts: 6,
})

test('resolveChain matches the exact route, else the enabled default pool with an implicit first hop', () => {
  const resolved = { provider: 'a', model: 'x' }
  assert.equal(resolveChain(resolved, [profile('a', 'x')], { enabled: false, candidates: [], switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }, maxTotalAttempts: 3 })?.candidates.length, 1)
  assert.equal(resolveChain(resolved, [profile('b', 'y')], { enabled: false, candidates: [], switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }, maxTotalAttempts: 3 }), undefined)
  const pooled = resolveChain(resolved, [], {
    enabled: true,
    candidates: [{ provider: 'c', model: 'z', maxAttempts: 1 }],
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
    maxTotalAttempts: 3,
  })
  assert.equal(pooled?.candidates.length, 2)
  assert.equal(pooled?.candidates[0].provider, 'a')
  assert.equal(pooled?.candidates[0].maxAttempts, 1)
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

// ---- Health Monitoring unit tests ----
import { HealthMonitor, classifyHealth, routeKeyOf, channelHealthProjection, CHANNEL_HEALTH_KEY } from '../src/health.ts'

test('classifyHealth classifies RATE_LIMIT as degraded and SERVER/TIMEOUT as unhealthy', () => {
  assert.equal(classifyHealth('RATE_LIMIT'), 'degraded')
  assert.equal(classifyHealth('SERVER'), 'unhealthy')
  assert.equal(classifyHealth('TIMEOUT'), 'unhealthy')
  assert.equal(classifyHealth('TRANSPORT'), 'unhealthy')
  assert.equal(classifyHealth('AUTH_FAILED'), 'unhealthy')
})

test('routeKeyOf formats provider and model as provider/model', () => {
  assert.equal(routeKeyOf('deepseek-official', 'deepseek-chat'), 'deepseek-official/deepseek-chat')
})

test('HealthMonitor passively notes successes and failures', () => {
  const fakeCtx = { llm: {} }
  const monitor = new HealthMonitor(fakeCtx)

  monitor.noteSuccess('prov-a', 'mod-a', 150)
  const recA = monitor.getRecord('prov-a', 'mod-a')
  assert.ok(recA)
  assert.equal(recA.status, 'healthy')
  assert.equal(recA.latencyMs, 150)
  assert.equal(recA.source, 'passive')

  monitor.noteFailure('prov-b', 'mod-b', 'RATE_LIMIT', 300)
  const recB = monitor.getRecord('prov-b', 'mod-b')
  assert.ok(recB)
  assert.equal(recB.status, 'degraded')
  assert.equal(recB.lastError, 'RATE_LIMIT')

  monitor.noteFailure('prov-c', 'mod-c', 'SERVER')
  const recC = monitor.getRecord('prov-c', 'mod-c')
  assert.ok(recC)
  assert.equal(recC.status, 'unhealthy')
  assert.equal(recC.lastError, 'SERVER')

  const snap = monitor.getSnapshot()
  assert.equal(Object.keys(snap).length, 3)
  assert.equal(snap['prov-a/mod-a'].status, 'healthy')
  monitor.dispose()
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
    data: { message: { source: { provider: 'prov-2', model: 'mod-2' } } },
  })
  assert.ok(state.records['prov-2/mod-2'])
  assert.equal(state.records['prov-2/mod-2'].status, 'healthy')
  assert.equal(state.records['prov-2/mod-2'].latencyMs, 400)

  // Wire view returns records
  assert.equal(channelHealthProjection.wire.view(state), state.records)
})

