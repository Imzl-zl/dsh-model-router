/**
 * TEMPORARY verification probe for finding C2 — not part of the suite.
 *
 * C2 claims `planFire` fires the LAST candidate once more after its cap is hit:
 * `router.ts:135-142` sets `exhausted = true` and leaves `index` unchanged, but
 * line 148 still returns a servable state, and nothing in the request handler
 * (`index.ts:216-264`) reads `plan.state.exhausted` before dispatching.
 *
 * This re-derives the call sequence from scratch (not from the audit's table),
 * mirroring index.ts exactly: the dispatch target is `plan.state.index`, and
 * `decideRecovery`'s stop conditions are re-applied to the stored state.
 */
import assert from 'node:assert/strict'
import { planFire, startStep } from '../src/router.ts'

function chain(n, maxAttempts, maxTotalAttempts) {
  return {
    candidates: Array.from({ length: n }, (_, i) => ({ provider: `c${i}`, model: 'm', maxAttempts })),
    order: Array.from({ length: n }, (_, i) => i),
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false },
    maxTotalAttempts,
    stickyTurns: 0,
    strategy: 'order',
  }
}

/** Replay the index.ts loop; return the candidate index each real call went to. */
function replay(n, maxAttempts, maxTotalAttempts, mayAdvance) {
  let state = startStep(0, 0, chain(n, maxAttempts, maxTotalAttempts), { hasImages: false, projectedTokens: undefined }, 0)
  const calls = []
  for (let guard = 0; guard < 30; guard += 1) {
    const plan = planFire(state, mayAdvance)      // index.ts:216
    state = plan.state                            // index.ts:294 states.start(...)
    calls.push(plan.state.index)                  // index.ts:227 let index = plan.state.index
    // every attempt fails; index.ts:330 noteFailure, then the recovery listener
    // (index.ts:356) runs decideRecovery over the state just stored.
    if (state.exhausted) break
    if (!mayAdvance) break                        // not switch-on eligible → terminal
    if (state.totalAttempts >= state.chain.maxTotalAttempts) break
  }
  return { calls, finalState: state }
}

// ---- independent re-derivation ----

{
  // The default shape: maxAttempts defaults to 1 (config.ts:58) and
  // maxTotalAttempts to 6 (config.ts:107).
  const { calls, finalState } = replay(3, 1, 6, true)
  console.log('3 candidates, cap 1 each, total 6, mayAdvance=true ->', JSON.stringify(calls))
  assert.deepEqual(calls, [0, 1, 2, 2], 'the last candidate is fired twice')
  assert.equal(finalState.exhausted, true)
  assert.equal(finalState.totalAttempts, 4)
}

{
  const { calls } = replay(1, 1, 6, true)
  console.log('1 candidate,  cap 1,     total 6, mayAdvance=true ->', JSON.stringify(calls))
  assert.deepEqual(calls, [0, 0], 'a single-candidate chain fires twice with cap 1')
}

{
  // mayAdvance false on a CAPPED LAST candidate: llm-retry's own retries keep
  // firing the same candidate (documented intent, router.ts:124-127), and the
  // router's recovery listener terminates the chain. Confirm this path does NOT
  // produce the C2 shape: `index` and `exhausted` are both untouched.
  const state = { ...startStep(0, 0, chain(1, 1, 6), { hasImages: false, projectedTokens: undefined }, 0), attemptsOnCandidate: 1, totalAttempts: 1 }
  const plan = planFire(state, false)
  console.log('1 candidate, capped, mayAdvance=false ->', JSON.stringify({ index: plan.state.index, exhausted: plan.state.exhausted, advanced: plan.advanced, attempts: plan.state.attemptsOnCandidate, total: plan.state.totalAttempts }))
  assert.equal(plan.state.index, 0, 'index unchanged')
  assert.equal(plan.state.exhausted, false, 'exhausted stays false — the router lets llm-retry burn its budget')
  assert.equal(plan.advanced, false)
  assert.equal(plan.state.attemptsOnCandidate, 2)
}

{
  // Boundary: when sum(maxAttempts) >= maxTotalAttempts the total cap binds
  // first, so no extra call is observable.
  const { calls } = replay(3, 2, 6, true)
  console.log('3 candidates, cap 2 each, total 6, mayAdvance=true ->', JSON.stringify(calls))
  assert.deepEqual(calls, [0, 0, 1, 1, 2, 2], 'the total cap binds first — no extra call')
}

{
  // Same chain with headroom: the extra call reappears.
  const { calls } = replay(3, 2, 8, true)
  console.log('3 candidates, cap 2 each, total 8, mayAdvance=true ->', JSON.stringify(calls))
  assert.deepEqual(calls, [0, 0, 1, 1, 2, 2, 2], 'one extra call on the last candidate')
}

console.log('PASS: planFire fires the last candidate once past its cap, exactly when')
console.log('      sum(candidates.maxAttempts) < chain.maxTotalAttempts')
