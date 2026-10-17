/**
 * TEMPORARY verification probe for finding I3 — not part of the suite.
 *
 * I3 claims: `health.ts:116-118` anchors the latency on `request/header`, which
 * DSH emits once per request series (agent.ts:635-651: `requestHeaderLogged` is
 * set true and never reset), so a tool-loop turn's step 2..N and any step with
 * an `llm/retry` inherit earlier time. DSH's own `session-stats` projection
 * anchors on `step/start` and gates by `(turn, step)`
 * (session-stats/src/projection.ts:133-149, gates at :140/:147).
 *
 * This folds the SAME event sequence through both projections and prints what
 * each reports. The event shapes are DSH's own: `step/start {turn, step}`
 * (agent.ts:331), `request/header {header, reason}` (agent.ts:637-650),
 * `llm/retry {retryId, turn, step, provider, mode, policyKey, retry,
 * maxRetries, delayMs, failure}` (llm-retry/src/index.ts:164-188),
 * `assistant/message {message, usage}` (health.ts:208-209 reads `usage` beside
 * `message`).
 */
import assert from 'node:assert/strict'
import { channelHealthProjection } from '../src/health.ts'
import { failoverHistoryProjection } from '../src/lineage.ts'

const ROUTE = 'stub-a/stub-model'

const ev = (type, time, data) => ({ type, time, data, seq: time })

/** One turn, two steps, one in-step llm/retry, 100 output tokens per step. */
const events = [
  ev('step/start', 1000, { turn: 1, step: 1 }),
  ev('request/header', 1100, { header: { config: { provider: 'stub-a', model: 'stub-model' } }, reason: 'initial' }),
  // llm-retry: durable commit, then the backoff (500ms), then llm/retry-started.
  ev('llm/retry', 1500, { retryId: 'r1', turn: 1, step: 1, provider: 'stub-a', mode: 'normal', policyKey: 'p', retry: 1, maxRetries: 5, delayMs: 500, failure: { code: 'RATE_LIMIT', message: 'throttled' } }),
  ev('llm/retry-started', 2000, { retryId: 'r1', turn: 1, step: 1, retry: 1 }),
  ev('assistant/attempt', 2100, { turn: 1, step: 1, stream: [{ chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'throttled' } } } }] }),
  ev('assistant/message', 2600, { turn: 1, step: 1, message: { source: { provider: 'stub-a', model: 'stub-model' } }, usage: { outputTokens: 100 } }),
  // Step 2 of the SAME turn: the tool took 2.4s. No new request/header — the
  // header is unchanged and `requestHeaderLogged` is already true
  // (agent.ts:635-651), so DSH appends nothing here.
  ev('step/start', 5000, { turn: 1, step: 2 }),
  ev('assistant/message', 5500, { turn: 1, step: 2, message: { source: { provider: 'stub-a', model: 'stub-model' } }, usage: { outputTokens: 100 } }),
  ev('turn/end', 5600, { turn: 1, reason: { kind: 'completed' } }),
]

let health = channelHealthProjection.init()
let lineage = failoverHistoryProjection.init()
for (const event of events) {
  health = channelHealthProjection.apply(health, event)
  lineage = failoverHistoryProjection.apply(lineage, event)
}
const record = channelHealthProjection.wire.view(health)[ROUTE]

console.log('step 1 (one llm/retry, 500ms backoff):')
console.log('  health latencyMs       =', record?.timeline[0]?.latencyMs, '(true model+backoff time = 2600-1100 = 1500)')
console.log('  health throughputTps   =', record?.timeline[0]?.throughputTps, '(100 tok / 1.5s = 66.7)')
console.log('step 2 (same turn, no new header):')
console.log('  health latencyMs       =', record?.timeline[1]?.latencyMs, '(true step-2 model time = 5500-5000 = 500)')
console.log('  health throughputTps   =', record?.timeline[1]?.throughputTps, '(100 tok / 0.5s = 200.0)')
console.log('lineage entries settled =', failoverHistoryProjection.wire.view(lineage).length)

// What the fold reports for step 2 must be the step-2 cost, not the turn cost.
const step2 = record?.timeline[1]
assert.equal(step2?.latencyMs, 500, `step 2 latencyMs should be 500 (step/start → assistant/message), got ${step2?.latencyMs}`)
assert.equal(step2?.throughputTps, 200, `step 2 throughputTps should be 200.0, got ${step2?.throughputTps}`)
console.log('PASS')
