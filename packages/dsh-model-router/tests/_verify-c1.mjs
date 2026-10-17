/**
 * TEMPORARY verification probe for finding C1 — not part of the suite.
 *
 * C1 claims: `probe.ts:135` only classifies `reason.kind === 'error'`, so the
 * timeout path (which real adapters deliver as an in-band `kind:'aborted'`
 * finish, `llm/src/index.ts:1161-1169`) falls through to `probe.ts:147`'s
 * `unavailable(route, now, 'empty stream')` instead of
 * `unreachable` + `PROBE_TIMEOUT_CODE`.
 *
 * The fake here is shaped after DSH's OWN spec test for the same situation
 * (`llm-pi-ai/tests/adapter.spec.ts:1052-1067`): a pre-aborted caller signal
 * makes `adapter.stream` yield
 * `{type:'finish', reason:{kind:'aborted', failure:{code:'ABORTED'}}}` — it does
 * NOT throw.
 */
import assert from 'node:assert/strict'
import { probeRoute } from '../src/probe.ts'

const route = { provider: 'p', model: 'm' }

/** The llm face: prepare once, stream once — the only seam probeRoute uses. */
const fakeLlm = (makeStream) => ({
  prepareCall: () => Promise.resolve({
    config: { provider: 'p', model: 'm' },
    stream: (options) => makeStream(options.signal),
  }),
})

/**
 * Real adapter shape on abort: the adapter throws ABORTED inside the stream,
 * `adapterStream` catches it (llm/src/index.ts:1111-1114) and yields
 * `adapterFailureChunk(error, options.signal)` — `signal.aborted` is true, so
 * `kind` is `'aborted'` (llm/src/index.ts:1165-1167).
 */
const abortedFinishOnAbort = (signal) => (async function* () {
  await new Promise((resolve) => {
    if (signal?.aborted === true) resolve()
    else signal?.addEventListener('abort', () => resolve(), { once: true })
  })
  yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } }
})()

// ---- the claim ----

const result = await probeRoute(fakeLlm(abortedFinishOnAbort), route, 'ping', 1)
console.log('observed:', JSON.stringify(result))

assert.equal(result.kind, 'unreachable', `expected unreachable, got ${result.kind} (${result.error})`)
assert.equal(result.error, 'TIMEOUT', `expected TIMEOUT, got ${result.error}`)
console.log('PASS: the timeout is reported as unreachable/TIMEOUT')
