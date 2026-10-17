/**
 * TEMPORARY verification probe for finding I6 — not part of the suite.
 *
 * I6 claims `assertStructural` (config.ts:367-445) carries 8 numeric guards that
 * the schema already makes unreachable, because BOTH production call paths run
 * the schema first:
 *   - `index.ts:117` reads a Cordis-validated Config;
 *   - `index.ts:126` runs `Config(raw)` itself before calling assertStructural.
 *
 * This feeds a value that violates ONLY each guard's condition through the
 * schema and asserts the schema refuses it. If the schema refuses, the guard
 * behind it can never fire in production. `assertStructural` is then called with
 * the same value directly to show the guard WOULD fire — i.e. it is dead only
 * because the schema precedes it, not because the condition is impossible.
 */
import assert from 'node:assert/strict'
import { Config, assertStructural } from '../src/config.ts'

const when = { provider: 'p', model: 'm' }
const candidate = (over = {}) => ({ provider: 'p', model: 'm', maxAttempts: 1, weight: 0, ...over })

/** A structurally valid profile whose only defect is `over`. */
function profile(over = {}, candidates = [candidate()]) {
  return {
    id: 'p1',
    when,
    candidates,
    switchOn: {},
    maxTotalAttempts: 6,
    stickyTurns: 0,
    strategy: 'order',
    ...over,
  }
}

const base = (over = {}) => ({
  enabled: true,
  profiles: [profile()],
  default: { enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order' },
  ...over,
})

/** Run a raw value through the schema the way index.ts:126 does. */
function schemaVerdict(raw) {
  try {
    Config(raw)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/** Run the same value straight at assertStructural, bypassing the schema. */
function guardVerdict(raw) {
  try {
    assertStructural(raw)
    return { threw: false }
  } catch (error) {
    return { threw: true, message: String(error) }
  }
}

const cases = [
  ['config.ts:389 candidate.maxAttempts < 1', base({ profiles: [profile({}, [candidate({ maxAttempts: 0 })])] })],
  ['config.ts:397 profile.maxTotalAttempts < 1', base({ profiles: [profile({ maxTotalAttempts: 0 })] })],
  ['config.ts:400 profile.stickyTurns < 0', base({ profiles: [profile({ stickyTurns: -1 })] })],
  ['config.ts:404 default.maxTotalAttempts < 1', base({ default: { enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 0, stickyTurns: 0, strategy: 'order' } })],
  ['config.ts:407 default.stickyTurns < 0', base({ default: { enabled: false, candidates: [], switchOn: {}, maxTotalAttempts: 3, stickyTurns: -1, strategy: 'order' } })],
  ['config.ts:421 health.discover.intervalSeconds < 0', base({ health: { discover: { intervalSeconds: -1 } } })],
  ['config.ts:423 health.probe.intervalSeconds < 0', base({ health: { probe: { intervalSeconds: -1 } } })],
  ['config.ts:430 health.probe.timeoutSeconds < 1', base({ health: { probe: { timeoutSeconds: 0 } } })],
]

for (const [label, raw] of cases) {
  const schema = schemaVerdict(raw)
  const guard = guardVerdict(raw)
  console.log(`${label}`)
  console.log(`  schema refuses it : ${schema.ok ? 'NO — the value is schema-legal' : 'yes'}`)
  console.log(`  guard would fire  : ${guard.threw ? 'yes' : 'no'}`)
  assert.equal(schema.ok, false, `${label}: the schema must refuse this value, or the guard is reachable`)
  assert.equal(guard.threw, true, `${label}: the guard must fire on the same value when the schema is bypassed`)
}

// The schema is strictly stronger than the guard on timeoutSeconds: `.min(2)`
// vs `< 1`. A value of 1 passes the guard and fails the schema — the guard is
// not just unreachable, it is weaker than the thing in front of it.
{
  const raw = base({ health: { probe: { timeoutSeconds: 1 } } })
  const schema = schemaVerdict(raw)
  const guard = guardVerdict(raw)
  console.log('config.ts:430 guard is weaker than the schema (.min(2) vs < 1)')
  console.log(`  timeoutSeconds = 1: schema refuses it : ${schema.ok ? 'NO' : 'yes'}`)
  console.log(`  timeoutSeconds = 1: guard fires        : ${guard.threw ? 'yes' : 'no'}`)
  assert.equal(schema.ok, false)
  assert.equal(guard.threw, false, 'the guard is weaker than the schema it hides behind')
}

console.log('PASS: all 8 numeric guards are unreachable behind the schema')

