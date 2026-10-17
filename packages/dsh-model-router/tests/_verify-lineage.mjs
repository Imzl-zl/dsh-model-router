/**
 * TEMPORARY verification probe for 待核实 #7 — not part of the suite.
 *
 * Does `lineage.ts:146-154` settle an entry on an `assistant/message` from a
 * LATER STEP of the same turn, on a route the failover never named? The settle
 * case filters only on `last.turn !== state.turn` — there is no step gate,
 * unlike the record path (`lineage.ts:129`, which does gate on step).
 */
import assert from 'node:assert/strict'
import { failoverHistoryProjection } from '../src/lineage.ts'

const ev = (type, time, data) => ({ type, time, data, seq: time })

const attempt = (code) => [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code } } } }]

// Turn 1, step 1: the chain fails on A and switches to B (a 'change' header with
// a preceding failure in the same step → one unsettled entry). B then FAILS, so
// no assistant/message settles it. Step 2 of the SAME turn succeeds — on C,
// which the failover never named.
const events = [
  ev('turn/start', 100, { turn: 1 }),
  ev('step/start', 100, { turn: 1, step: 1 }),
  ev('request/header', 200, { header: { config: { provider: 'a', model: 'm' } }, reason: 'initial' }),
  ev('assistant/attempt', 300, { turn: 1, step: 1, stream: attempt('RATE_LIMIT') }),
  ev('request/header', 400, { header: { config: { provider: 'b', model: 'm' } }, reason: 'change' }),
  ev('assistant/attempt', 500, { turn: 1, step: 1, stream: attempt('SERVER') }),
  // Step 2: the user's own route is tried again and succeeds.
  ev('step/start', 600, { turn: 1, step: 2 }),
  ev('request/header', 700, { header: { config: { provider: 'c', model: 'm' } }, reason: 'change' }),
  ev('assistant/message', 800, { turn: 1, step: 2, message: { source: { provider: 'c', model: 'm' } }, usage: { outputTokens: 10 } }),
]

let state = failoverHistoryProjection.init()
for (const event of events) state = failoverHistoryProjection.apply(state, event)
const entries = failoverHistoryProjection.wire.view(state)

console.log('entries:', JSON.stringify(entries))
const entry = entries[0]
console.log(`the a→b failover is settled by a step-2 success on ${entry?.to === 'b/m' ? 'b (correct)' : 'c (a route the failover never named)'}: settled=${entry?.settled}`)

assert.equal(entry?.settled, true, 'expected the cross-step success to settle it — that is the claim under test')
assert.equal(entry?.from, 'a/m')
assert.equal(entry?.to, 'b/m')
assert.equal(entry?.step, 1, 'the entry belongs to step 1')
console.log('CONFIRMED: an assistant/message from a later step of the same turn settles an entry')
console.log('           whose own step never produced one, on a route it never named.')
