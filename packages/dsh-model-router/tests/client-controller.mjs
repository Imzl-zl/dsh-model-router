#!/usr/bin/env node
/**
 * Controller tests for the browser half (client.js).
 *
 * client.js is a Cordis client module in `window.__ModuleLoader__.load` factory
 * form, so these tests load the real file, hand the factory stub modules, run
 * `apply(ctx)` against a stub context, and drive the controller through the
 * exact seam the UI uses: the `plugins.bundle.config` slot registration's
 * `inject()` actions plus the `routerPage` snapshot store. No component is
 * rendered, so no DOM is needed.
 *
 * What these cover is the draft/save state machine — the part the Loader
 * composition tests cannot reach because they exercise the Host half only.
 *
 * Usage:
 *   node packages/dsh-model-router/tests/client-controller.mjs
 *   CLIENT_PATH=<file> node packages/dsh-model-router/tests/client-controller.mjs
 *     (run the same suite against another revision, e.g. a pre-fix checkout)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = process.env.CLIENT_PATH ?? fileURLToPath(new URL('../src/client.js', import.meta.url))

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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Minimal stand-in for the real snapshot store: set/get/subscribe, no freezing. */
function createSnapshotStore(init) {
  let current = init
  const listeners = new Set()
  return {
    getSnapshot: () => current,
    set: (next) => { current = next; for (const fn of listeners) fn() },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}

/** Load client.js and return its module exports. */
function loadClient() {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
  new Function(source)()
  const react = {
    createElement: () => null,
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    Fragment: 'Fragment',
  }
  const require_ = (name) => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: () => null }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        SettingsForm: 'SettingsForm', Switch: 'Switch', Button: 'Button', Tag: 'Tag',
        SegmentedTabs: 'SegmentedTabs', Modal: 'Modal', RiskConfirmation: 'RiskConfirmation',
      }
    }
    if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
    throw new Error(`unexpected require: ${name}`)
  }
  return captured.factory(require_)
}

/** Apply one wire mutation to a config value, the way the Host would. */
function applyOps(value, ops) {
  const next = structuredClone(value)
  for (const op of ops) {
    if (op.op !== 'set') throw new Error(`harness applies only set ops, got ${op.op}`)
    let cursor = next
    for (let i = 0; i < op.path.length - 1; i++) cursor = cursor[op.path[i]]
    cursor[op.path[op.path.length - 1]] = structuredClone(op.value)
  }
  return next
}

/**
 * Mount the client against a stub context.
 * @param options.value - the Host-held config section the scope serves.
 * @param options.writable - whether the section accepts writes.
 * @param options.mutate - override for scope.mutate; the default folds the ops
 *   into the served value and republishes, the way the Host's write answer does.
 */
function mount({ value, writable = true, mutate } = {}) {
  const calls = []
  let snapshot = { status: 'ready', value, writable, revision: 1 }
  const listeners = new Set()
  const publish = () => { for (const fn of listeners) fn() }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    mutate: mutate ?? ((ops, revision) => {
      calls.push({ ops, revision })
      snapshot = { status: 'ready', value: applyOps(snapshot.value, ops), writable, revision: revision + 1 }
      publish()
      return Promise.resolve(true)
    }),
  }
  const registrations = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => { const off = fn(); return typeof off === 'function' ? off : () => {} },
    configForms: { get: () => scope },
    slots: {
      // The real inject() runs its callback to register, then returns a disposer.
      inject: (_name, fn) => { fn(); return () => {} },
      register: (options) => { registrations.push(options); return () => {} },
    },
    remote: {
      session: {
        list: () => Promise.resolve({ ok: false }),
        projections: () => Promise.resolve({ ok: false }),
      },
      llm: {},
      settings: {},
    },
  }
  loadClient().apply(ctx)
  const registration = registrations.find((entry) => entry.name === 'plugins.bundle.config')
  const injected = registration.inject()
  const store = injected.hooks.routerPage
  return {
    actions: injected,
    store,
    state: () => store.getSnapshot(),
    republish: (next) => { snapshot = { ...snapshot, ...next }; publish() },
    mutateCalls: calls,
  }
}

// ---- fixtures ----

const switchOn = () => ({ rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false })
const profile = (over = {}) => ({
  id: 'p1',
  when: { provider: 'deepseek', model: 'm' },
  candidates: [{ provider: 'deepseek', model: 'm', maxAttempts: 1, weight: 0 }],
  switchOn: switchOn(),
  maxTotalAttempts: 3,
  stickyTurns: 0,
  strategy: 'order',
  ...over,
})
const defaultPool = (over = {}) => ({ enabled: false, candidates: [], switchOn: switchOn(), maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order', ...over })
const config = (over = {}) => ({ enabled: true, profiles: [profile()], default: defaultPool(), ...over })
const routeOf = (candidate) => `${candidate.provider}/${candidate.model}`

// ---- save() settlement ----

test('a rejected save surfaces the failure and clears saving', async () => {
  const h = mount({ value: config(), mutate: () => Promise.reject(new Error('wire down')) })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  h.actions.onSave()
  assert.equal(h.state().saving, true, 'saving is set while the write crosses the wire')
  await flush()
  assert.equal(h.state().saving, false, 'saving clears when mutate rejects')
  assert.equal(h.state().failed, true, 'the rejection is reported, not swallowed')
  assert.equal(h.state().dirty, true, 'a save that did not land keeps the draft')
})

test('an accepted save settles clean once the Host republishes', async () => {
  const h = mount({ value: config() })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  h.actions.onSave()
  await flush()
  assert.equal(h.state().saving, false)
  assert.equal(h.state().failed, false)
  assert.equal(h.state().dirty, false, 'the republished value re-seeds the draft')
  assert.equal(h.state().draft.profiles[0].candidates[0].maxAttempts, 3)
})

// ---- validate() mirrors the Host's assertStructural ----

test('a profile on the weight strategy with no positive weight blocks the save', () => {
  const h = mount({ value: config({ profiles: [profile({ strategy: 'weight' })] }) })
  assert.equal(h.state().invalid, true)
  const problem = h.state().problems.find((entry) => entry.key === 'problemProfileWeightNoPositive')
  assert.ok(problem, 'the profile is named in the problem list')
  assert.equal(problem.vars.id, 'p1')
  h.actions.onSave()
  assert.equal(h.mutateCalls.length, 0, 'the write never reaches the Host')
})

test('the default pool keeps its own weight-strategy problem', () => {
  const h = mount({ value: config({ default: defaultPool({ enabled: true, strategy: 'weight', candidates: [{ provider: 'a', model: 'x', maxAttempts: 1, weight: 0 }] }) }) })
  assert.ok(h.state().problems.some((entry) => entry.key === 'problemWeightNoPositive'))
})

// ---- the pinned primary vs the default pool ----

test('the profile primary stays pinned', () => {
  const h = mount({ value: config() })
  h.actions.onMove('p1', 0, 1, false)
  h.actions.onRemove('p1', 0, false)
  const candidates = h.state().draft.profiles[0].candidates
  assert.equal(candidates.length, 1, 'the primary cannot be removed')
  assert.equal(routeOf(candidates[0]), 'deepseek/m', 'the primary cannot be reordered')
})

test('the default pool has no pinned head: its first candidate moves and removes', () => {
  const h = mount({
    value: config({
      default: defaultPool({
        enabled: true,
        candidates: [
          { provider: 'a', model: 'x', maxAttempts: 1 },
          { provider: 'b', model: 'y', maxAttempts: 1 },
        ],
      }),
    }),
  })
  h.actions.onActive('__default__')
  h.actions.onMove(null, 0, 1, true)
  assert.equal(routeOf(h.state().draft.default.candidates[0]), 'b/y', 'the first pool candidate moves down')
  h.actions.onRemove(null, 0, true)
  assert.deepEqual(h.state().draft.default.candidates.map(routeOf), ['a/x'], 'the first pool candidate removes')
})

// ---- scope republish vs the draft ----

test('a republication with the same value keeps the unsaved draft', () => {
  const value = config()
  const h = mount({ value })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true)
  h.republish({ value, revision: 2 })
  assert.equal(h.state().dirty, true, 'an unrelated republish must not wipe the draft')
  assert.equal(h.state().draft.profiles[0].candidates[0].maxAttempts, 3)
})

test('a genuinely changed Host value re-seeds the draft', () => {
  const h = mount({ value: config() })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true)
  h.republish({ value: config({ profiles: [profile({ maxTotalAttempts: 9 })] }), revision: 2 })
  assert.equal(h.state().dirty, false, 'the Host is the authority once its value moves')
  assert.equal(h.state().draft.profiles[0].maxTotalAttempts, 9)
})

// ---- per-candidate edits ----

test('weight edits address the named profile', () => {
  const h = mount({ value: config() })
  h.actions.onWeight('p1', 0, '40', false)
  assert.equal(h.state().draft.profiles[0].candidates[0].weight, 40)
})

test('weight edits address the default pool without throwing', () => {
  const h = mount({ value: config({ default: defaultPool({ enabled: true, candidates: [{ provider: 'a', model: 'm', maxAttempts: 1, weight: 0 }] }) }) })
  h.actions.onWeight(null, 0, '60', true)
  assert.equal(h.state().draft.default.candidates[0].weight, 60)
})

test('strategy edits address both named profile and default pool', () => {
  const h = mount({ value: config({ default: defaultPool({ enabled: true }) }) })
  h.actions.onStrategy('p1', 'round-robin', false)
  assert.equal(h.state().draft.profiles[0].strategy, 'round-robin')
  h.actions.onStrategy(null, 'weight', true)
  assert.equal(h.state().draft.default.strategy, 'weight')
})

test('an unknown profile id fails loudly instead of editing a phantom list', () => {
  const h = mount({ value: config() })
  assert.throws(() => h.actions.onMaxAttempts('nope', 0, '2', false), /no profile "nope"/)
})

// ---- legacy shapes ----

test('a profile saved before candidates existed reads as an empty, reported chain', () => {
  const legacy = profile()
  delete legacy.candidates
  const h = mount({ value: config({ profiles: [legacy] }) })
  assert.deepEqual(h.state().draft.profiles[0].candidates, [])
  assert.ok(h.state().problems.some((entry) => entry.key === 'problemEmptyChain'))
})

await Promise.all(pending)
console.log(`${passed} client-controller test(s) passed`)
