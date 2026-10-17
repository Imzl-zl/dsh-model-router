#!/usr/bin/env node
/**
 * Controller tests for the browser half (client.js).
 *
 * client.js is a Cordis client module in `window.__ModuleLoader__.load` factory
 * form, so these tests load the real file, hand the factory stub modules, run
 * `apply(ctx)` against a stub context, and drive the controller through the
 * exact seam the UI uses: the `sidebar.footer.action` slot registration's
 * `inject()` actions plus the `routerPage` snapshot store. No component is
 * rendered, so no DOM is needed.
 *
 * What these cover is the draft/save state machine — the part the Loader
 * composition tests cannot reach because they exercise the Host half only.
 *
 * The suite runs against the built browser half (lib/client.js, the artifact
 * the client module system serves), so `npm run bundle` in the package
 * directory must have run first; the source-text guards read that same
 * artifact, which is what the browser actually loads.
 *
 * Usage:
 *   node packages/dsh-model-router/tests/client-controller.mjs
 *   CLIENT_PATH=<file> node packages/dsh-model-router/tests/client-controller.mjs
 *     (run the same suite against another revision, e.g. a pre-fix checkout)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = process.env.CLIENT_PATH ?? fileURLToPath(new URL('../lib/client.js', import.meta.url))

/**
 * Authored source of one browser-half module. The structural guards below read
 * source, not the bundle: the bundler re-prints the AST (single quotes become
 * double, `function (current)` loses its space, a ternary condition joins its
 * line), so shape assertions belong on what the author wrote. Behavior is
 * asserted against the bundle through loadClient(), which is what the browser
 * loads.
 */
const sourceOf = (name) => readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')

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

/**
 * Wait out the controller's busy floor (MIN_BUSY_MS) plus slack.
 *
 * An instant failure used to settle in the same React batch that published the
 * busy state, so `await pending` was enough. The floor is deliberate — without
 * it the spinner is never painted — so "wait for the run to settle" now has to
 * wait for the floor too. The value is read from the source, not re-typed here,
 * so raising the floor cannot silently turn these tests into false passes.
 */
const settleBusy = () => {
  const floor = Number(sourceOf('controller.ts').match(/var MIN_BUSY_MS = (\d+)/)[1])
  return new Promise((resolve) => setTimeout(resolve, floor + 120))
}

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
  const require_ = (name) => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: () => null }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        SettingsForm: SettingsFormStub, Switch: 'Switch', Button: 'Button', Tag: 'Tag',
        SegmentedTabs: 'SegmentedTabs', Modal: 'Modal', RiskConfirmation: 'RiskConfirmation',
      }
    }
    if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
    throw new Error(`unexpected require: ${name}`)
  }
  return captured.factory(require_)
}

/**
 * A React stand-in that builds real element objects and collects effects, for
 * the two tests that mount components. `ref` is attached by the renderer below
 * — the way the reconciler does, only for elements that actually reach the
 * tree — which is exactly the distinction the loading-frame case turns on.
 */
const pendingEffects = []
const react = {
  createElement: (type, props, ...children) => {
    const next = props ?? {}
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return { type, props: next, children }
  },
  useState: (init) => [init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: (fn) => { pendingEffects.push(fn) },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}

/**
 * A one-pass renderer: invoke function components, recurse into host elements'
 * children, link siblings so `nextElementSibling` behaves the way the DOM does
 * (the suppression seam in page.ts is a sibling lookup), and attach refs only
 * for elements that reach the tree.
 */
function render(element) {
  if (element === null || element === undefined || element === false || element === true) return null
  if (Array.isArray(element)) return element.map(render).filter((node) => node !== null)
  if (typeof element.type === 'function') return render(element.type(element.props))
  const kids = element.children
  const children = (Array.isArray(kids) ? kids : kids === undefined ? [] : [kids])
    .map(render)
    .filter((node) => node !== null)
  for (let index = 0; index < children.length; index += 1) {
    children[index].nextElementSibling = children[index + 1] ?? null
  }
  const node = {
    type: element.type,
    props: element.props,
    children,
    nextElementSibling: null,
    attributes: {},
    setAttribute: (name, value) => { node.attributes[name] = value },
    removeAttribute: (name) => { delete node.attributes[name] },
  }
  if (element.props?.ref && typeof element.props.ref === 'object') element.props.ref.current = node
  return node
}

/**
 * DSH's SettingsForm, mirrored from
 * packages/client/ui-primitives/src/settings-form/SettingsForm.tsx:50-73.
 * The load-bearing line is :55 — while the namespace is not served the frame
 * renders the unavailable line and NOTHING else, children included. The footer
 * (:61) is the sibling right after the children, which is the seam page.ts
 * looks for. The real source is the spec here, not this plugin.
 */
function SettingsFormStub(props) {
  if (!props.state.available) {
    return { type: 'p', props: { role: 'status' }, children: [props.labels.unavailable] }
  }
  return {
    type: 'div',
    props: {},
    children: [
      !props.state.writable ? { type: 'p', props: { role: 'status' }, children: [props.labels.readOnly] } : null,
      props.children,
      {
        type: 'div',
        props: { className: 'footer' },
        children: [{ type: 'button', props: {}, children: [props.labels.save] }],
      },
    ],
  }
}

/** Depth-first search over a rendered tree. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (predicate(node)) return node
  return find(node.children, predicate)
}

/** The one createElement alias every component module renders through. */
const createEl = (type, props, ...children) => {
  const next = props ?? {}
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return { type, props: next, children }
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
 * @param options.remote - overrides merged over the default remote stubs.
 * @param options.firstFrame - the scope's FIRST snapshot, before the settings
 *   mirror answers (`status: 'loading'`, value undefined) — the frame a user
 *   can open the dialog in.
 */
async function mount({ value, writable = true, mutate, remote, firstFrame } = {}) {
  const calls = []
  let snapshot = firstFrame ?? { status: 'ready', value, writable, revision: 1 }
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
  const shortcutRegistrations = []
  let capturedComponent = null
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => { const off = fn(); return typeof off === 'function' ? off : () => {} },
    // DSH's native shortcuts service: register() hands back a command object the
    // test can drive, exactly like the real client registry does.
    shortcuts: {
      register: (command) => { shortcutRegistrations.push(command); return () => {} },
    },
    configForms: { get: () => scope },
    slots: {
      // The real inject() runs its callback to register, then returns a disposer.
      inject: (_name, fn) => { fn(); return () => {} },
      register: (options, component) => {
        registrations.push(options)
        // The sidebar entry is this plugin's only surface: it renders the whole
        // workbench inside the quick dialog, so it is the component the
        // component-level tests mount.
        if (options.name === 'sidebar.footer.action') capturedComponent = component
        return () => {}
      },
    },
    remote: Object.assign({
      session: {
        list: () => Promise.resolve({ ok: false }),
        projections: () => Promise.resolve({ ok: false }),
      },
      llm: {},
      settings: {},
      // The plugin's own probe Remote, which the browser half's apply mounts
      // from the generated ./remote artifact. The stub answers the shapes the
      // generated client would, so the probe actions run without a Host.
      routerHealth: {
        probeAll: (request) => Promise.resolve({
          ok: true,
          value: {
            at: 1,
            routes: (request?.routes ?? []).map((route) => ({
              provider: route.provider, model: route.model, kind: 'reachable', latencyMs: 5, at: 1,
            })),
          },
        }),
        probeReport: () => Promise.resolve({ ok: true, value: { at: 0, routes: [] } }),
      },
      // The browser half's apply mounts the generated ./remote contribution
      // before registering the UI.
      $mount: () => Promise.resolve(() => Promise.resolve()),
    }, remote),
    // The browser half mounts its own Remote and then registers the UI in a
    // child fiber carrying it; the harness runs the callback against a child
    // that carries the same stubs.
    inject: (_deps, fn) => {
      fn(Object.assign({}, ctx, { remote: ctx.remote }))
      return { dispose: () => Promise.resolve() }
    },
  }
  await loadClient().apply(ctx)
  // The sidebar entry is this plugin's only surface: it renders the whole
  // workbench inside the quick dialog. The Plugins-page carrier
  // (`plugins.bundle.config`) was removed — one editor, one host.
  const registration = registrations.find((entry) => entry.name === 'sidebar.footer.action')
  const injected = registration.inject()
  const store = injected.hooks.routerPage
  return {
    actions: injected,
    store,
    state: () => store.getSnapshot(),
    // The registered sidebar-entry component, for the component-level tests.
    component: capturedComponent,
    republish: (next) => { snapshot = { ...snapshot, ...next }; publish() },
    mutateCalls: calls,
    // The commands this plugin registered with DSH's native shortcuts service.
    shortcutCommands: () => shortcutRegistrations.slice(),
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
  const h = await mount({ value: config(), mutate: () => Promise.reject(new Error('wire down')) })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  h.actions.onSave()
  assert.equal(h.state().saving, true, 'saving is set while the write crosses the wire')
  await flush()
  assert.equal(h.state().saving, false, 'saving clears when mutate rejects')
  assert.equal(h.state().failed, true, 'the rejection is reported, not swallowed')
  assert.equal(h.state().dirty, true, 'a save that did not land keeps the draft')
})

test('an accepted save settles clean once the Host republishes', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  h.actions.onSave()
  await flush()
  assert.equal(h.state().saving, false)
  assert.equal(h.state().failed, false)
  assert.equal(h.state().dirty, false, 'the republished value re-seeds the draft')
  assert.equal(h.state().draft.profiles[0].candidates[0].maxAttempts, 3)
})

// ---- validate() mirrors the Host's assertStructural ----

test('a profile on the weight strategy with no positive weight blocks the save', async () => {
  const h = await mount({ value: config({ profiles: [profile({ strategy: 'weight' })] }) })
  assert.equal(h.state().invalid, true)
  const problem = h.state().problems.find((entry) => entry.key === 'problemProfileWeightNoPositive')
  assert.ok(problem, 'the profile is named in the problem list')
  assert.equal(problem.vars.id, 'p1')
  h.actions.onSave()
  assert.equal(h.mutateCalls.length, 0, 'the write never reaches the Host')
})

test('the default pool keeps its own weight-strategy problem', async () => {
  const h = await mount({ value: config({ default: defaultPool({ enabled: true, strategy: 'weight', candidates: [{ provider: 'a', model: 'x', maxAttempts: 1, weight: 0 }] }) }) })
  assert.ok(h.state().problems.some((entry) => entry.key === 'problemWeightNoPositive'))
})

// ---- the pinned primary vs the default pool ----

test('the profile primary stays pinned', async () => {
  const h = await mount({ value: config() })
  h.actions.onMove('p1', 0, 1, false)
  h.actions.onRemove('p1', 0, false)
  const candidates = h.state().draft.profiles[0].candidates
  assert.equal(candidates.length, 1, 'the primary cannot be removed')
  assert.equal(routeOf(candidates[0]), 'deepseek/m', 'the primary cannot be reordered')
})

test('the default pool has no pinned head: its first candidate moves and removes', async () => {
  const h = await mount({
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
  h.actions.onMove(null, 1, -1, true)
  assert.equal(routeOf(h.state().draft.default.candidates[0]), 'a/x', 'the second pool candidate moves back up')
  h.actions.onMove(null, 0, 1, true)
  h.actions.onRemove(null, 0, true)
  assert.deepEqual(h.state().draft.default.candidates.map(routeOf), ['a/x'], 'the first pool candidate removes')
})

test('the candidates reorder within allowed bounds', async () => {
  const h = await mount({
    value: config({
      default: defaultPool({
        enabled: true,
        candidates: [
          { provider: 'a', model: '1', maxAttempts: 1 },
          { provider: 'b', model: '2', maxAttempts: 1 },
          { provider: 'c', model: '3', maxAttempts: 1 },
        ],
      }),
      profiles: [
        {
          id: 'p1',
          when: { provider: 'deepseek', model: 'm' },
          candidates: [
            { provider: 'deepseek', model: 'm', maxAttempts: 1 },
            { provider: 'sub1', model: 's1', maxAttempts: 1 },
            { provider: 'sub2', model: 's2', maxAttempts: 1 },
          ],
        },
      ],
    }),
  })
  // Default pool: full reorder allowed
  h.actions.onReorder(null, 0, 2, true)
  assert.deepEqual(h.state().draft.default.candidates.map(routeOf), ['b/2', 'c/3', 'a/1'])

  // Profile: primary (index 0) remains pinned
  h.actions.onReorder('p1', 0, 2, false)
  assert.equal(routeOf(h.state().draft.profiles[0].candidates[0]), 'deepseek/m', 'primary cannot be moved via reorder')
  h.actions.onReorder('p1', 2, 0, false)
  assert.equal(routeOf(h.state().draft.profiles[0].candidates[0]), 'deepseek/m', 'candidate cannot replace primary via reorder')

  // Profile: candidates 1 and 2 can reorder freely
  h.actions.onReorder('p1', 2, 1, false)
  assert.deepEqual(h.state().draft.profiles[0].candidates.map(routeOf), ['deepseek/m', 'sub2/s2', 'sub1/s1'])
})

// ---- scope republish vs the draft ----

test('a republication with the same value keeps the unsaved draft', async () => {
  const value = config()
  const h = await mount({ value })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true)
  h.republish({ value, revision: 2 })
  assert.equal(h.state().dirty, true, 'an unrelated republish must not wipe the draft')
  assert.equal(h.state().draft.profiles[0].candidates[0].maxAttempts, 3)
})

test('a genuinely changed Host value re-seeds the draft', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true)
  h.republish({ value: config({ profiles: [profile({ maxTotalAttempts: 9 })] }), revision: 2 })
  assert.equal(h.state().dirty, false, 'the Host is the authority once its value moves')
  assert.equal(h.state().draft.profiles[0].maxTotalAttempts, 9)
})

test('an edit after a value-changing republish keeps the draft dirty', async () => {
  // The production boot path: the controller is built while the scope is still
  // loading, so the first republication is always a value-changing one — the
  // re-seed runs on every real start, and edits come after it.
  const h = await mount({ value: undefined })
  h.republish({ value: config(), revision: 1 })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true, 'the draft and the Host baseline must stay independent objects')
})

// ---- single-route connectivity check ----

/**
 * The plugin's own Host face, answering however the case asks. The connectivity
 * check runs on the Host (see ../../src/connectivity.ts), so the browser half is
 * driven through exactly the seam a real dispatch uses: one `checkConnectivity`
 * call carrying the routes, answering with already-classified verdicts.
 */
function healthStubs(answer) {
  const calls = { checkConnectivity: 0, routes: [] }
  return {
    calls,
    remote: {
      routerHealth: {
        checkConnectivity: (request) => {
          calls.checkConnectivity += 1
          calls.routes.push(request.routes)
          return answer(request.routes)
        },
      },
    },
  }
}

/** The Host's answer shape: one verdict per requested route, in order. */
const answerWith = (verdictFor) => (routes) => Promise.resolve({
  ok: true,
  value: routes.map((route) => verdictFor(route)),
})

test('a single-route check shows busy on that route only, then lands the verdict', async () => {
  const stubs = healthStubs(answerWith(() => ({ provider: 'deepseek', model: 'm', kind: 'reachable' })))
  const h = await mount({ value: config(), remote: stubs.remote })
  const pending = h.actions.onCheckRoute('deepseek', 'm')
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], true, 'the route shows busy while the check crosses the wire')
  assert.equal(h.state().ui.checking, false, 'a single check does not busy the global checker')
  await pending
  await settleBusy()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], undefined, 'busy clears once the verdict lands')
  assert.deepEqual(h.state().ui.discover['deepseek/m'], { provider: 'deepseek', model: 'm', kind: 'reachable' },
    'the verdict is folded into the route map, keyed the way the Host names it')
  assert.equal(stubs.calls.checkConnectivity, 1)
  assert.deepEqual(stubs.calls.routes[0], [{ provider: 'deepseek', model: 'm' }])
})

test('a second check for the same route while one is in flight is ignored', async () => {
  let release
  const stubs = healthStubs(() => new Promise((resolve) => { release = resolve }))
  const h = await mount({ value: config(), remote: stubs.remote })
  h.actions.onCheckRoute('deepseek', 'm')
  await flush()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], true, 'the first check is still in flight')
  const second = h.actions.onCheckRoute('deepseek', 'm')
  assert.equal(second, undefined, 'the duplicate call is dropped, not queued')
  release({ ok: true, value: [{ provider: 'deepseek', model: 'm', kind: 'reachable' }] })
  await flush()
  assert.equal(stubs.calls.checkConnectivity, 1, 'only one wire call was made')
})

test('a failed single check clears the busy state instead of spinning forever', async () => {
  const stubs = healthStubs(() => Promise.reject(new Error('wire down')))
  const h = await mount({ value: config(), remote: stubs.remote })
  await h.actions.onCheckRoute('deepseek', 'm')
  await settleBusy()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], undefined, 'busy clears on failure too')
  assert.deepEqual(h.state().ui.discover['deepseek/m'],
    { provider: 'deepseek', model: 'm', kind: 'unavailable', reason: 'hostUnavailable' },
    'a check that never reached the Host is 没能检查, never a channel fault')
})

test('a route the Host cannot check at all is 没能检查, and a refusal still is not', async () => {
  // The boundary this round fixed: DSH registers no model discovery for the
  // DeepSeek family (llm-deepseek/src/host.ts:55 registers an adapter only), so
  // a connectivity check is structurally impossible for `deepseek-official`.
  // That used to arrive as `unreachable` and painted the card red. The reverse
  // boundary rides along: a discovery that really ran and refused keeps its
  // code and stays a fault.
  const stubs = healthStubs(answerWith((route) => route.provider === 'deepseek'
    ? { provider: route.provider, model: route.model, kind: 'unavailable', reason: 'noDiscovery', error: 'NO_DISCOVERY' }
    : { provider: route.provider, model: route.model, kind: 'unreachable', error: 'AUTH' }))
  const h = await mount({ value: config(), remote: stubs.remote })
  await h.actions.onCheckRoute('deepseek', 'm')
  await settleBusy()
  const verdict = h.state().ui.discover['deepseek/m']
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'noDiscovery')
  assert.equal(verdict.error, 'NO_DISCOVERY')
  await h.actions.onCheckRoute('other', 'm2')
  await settleBusy()
  const refused = h.state().ui.discover['other/m2']
  assert.equal(refused.kind, 'unreachable', 'a discovery that ran and refused is still a fault')
  assert.equal(refused.error, 'AUTH')
})

// ---- route status derivation (the signal dot, nav badge and filters share it) ----

test('routeStatus prefers the passive record; a check that could not run is unknown, not a fault', async () => {
  const routeStatus = loadClient().routeStatus
  assert.equal(routeStatus({ 'a/b': { status: 'unhealthy' } }, { 'a/b': { kind: 'reachable' } }, {}, 'a/b'), 'unhealthy',
    'a real observation outranks a synthetic check')
  assert.equal(routeStatus({}, {}, { 'a/b': { kind: 'reachable', latencyMs: 12 } }, 'a/b'), 'healthy',
    'a passed probe is a real signal, stronger than a connectivity check')
  assert.equal(routeStatus({}, {}, { 'a/b': { kind: 'unreachable', error: 'AUTH' } }, 'a/b'), 'unhealthy')
  assert.equal(routeStatus({}, { 'a/b': { kind: 'reachable' } }, {}, 'a/b'), 'healthy')
  assert.equal(routeStatus({}, { 'a/b': { kind: 'notAdvertised', advertised: 3 } }, {}, 'a/b'), 'degraded')
  assert.equal(routeStatus({}, { 'a/b': { kind: 'unreachable', reason: 'timeout' } }, {}, 'a/b'), 'unhealthy')
  assert.equal(routeStatus({}, { 'a/b': { kind: 'unavailable', reason: 'notConfigurable' } }, {}, 'a/b'), 'unknown',
    'a check that could not run says nothing about the channel')
  assert.equal(routeStatus({}, { 'a/b': { kind: 'unavailable', reason: 'noDiscovery', error: 'NO_DISCOVERY' } }, {}, 'a/b'), 'unknown',
    'a channel DSH cannot check at all is unknown too, never a fault')
  assert.equal(routeStatus({}, {}, { 'a/b': { kind: 'unavailable', reason: 'notConfigurable' } }, 'a/b'), 'unknown',
    'a probe that could not run is unknown too, never a fault')
  assert.equal(routeStatus({}, {}, {}, 'a/b'), 'unknown')
})

// ---- cross-session health merge ----

test('passive health merges the recent sessions into one global record per route', async () => {
  // 实测踩过：合并在并发回调里做，谁最后 resolve 谁赢——同一渠道时而显示三天
  // 前的延迟、时而显示今天的，刷新就变；而数组是新的在前，语义上又恰好反了。
  // 更早一版还整记录覆盖，可用率只反映"赢家会话"——但同一个渠道这个会话用、
  // 那个会话也用，并发三个会话更在同时用，统计必须合在一起算。这条用例守住
  // 三件事：时间线并集（全局可用率）、标量取最新、只有旧会话见过的渠道仍在列。
  const record = (status, latencyMs, time) => ({
    route: 'a/b', provider: 'a', model: 'b', status,
    latencyMs, throughputTps: 1, lastCheckedAt: time,
    timeline: [{ time, status, latencyMs }],
  })
  const bySession = {
    old: { 'a/b': record('healthy', 100, 1), 'a/only-old': { ...record('unhealthy', 50, 1), route: 'a/only-old', model: 'only-old' } },
    new: { 'a/b': record('degraded', 999, 2) },
  }
  const h = await mount({
    value: config(),
    remote: {
      session: {
        // 故意把新的放前面、并给乱序 updatedAt：排序与合并顺序都得由插件自己负责。
        list: () => Promise.resolve({ ok: true, value: { items: [
          { sessionId: 'new', updatedAt: 200 },
          { sessionId: 'old', updatedAt: 100 },
        ] } }),
        projections: (request) => Promise.resolve({ ok: true, value: { values: { 'router/channel-health': bySession[request.sessionId] } } }),
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const passive = h.state().ui.passive
  assert.equal(passive['a/b']?.latencyMs, 999, 'scalars come from the newest session')
  assert.equal(passive['a/b']?.status, 'degraded')
  assert.deepEqual(passive['a/b']?.timeline.map((p) => p.time), [1, 2],
    'the timeline is the union across sessions, ordered by time — the availability is a global fact')
  assert.ok(passive['a/only-old'], 'a route only the older session saw is still listed')
})

test('opening the health workspace re-reads the passive snapshot, so a failover during the session shows up', async () => {
  // 被动快照原本只在控制器创建时读一次：故障转移发生后工作台还显示挂载那一刻
  // 的延迟与可用率——监控视图在事故进行中给人看旧数字。这条守住"打开健康视图
  // 会重取"。
  const records = [
    { 'a/b': { route: 'a/b', provider: 'a', model: 'b', status: 'unhealthy', latencyMs: 10, throughputTps: 1, lastCheckedAt: 1, timeline: [{ time: 1, status: 'unhealthy', latencyMs: 10 }] } },
    { 'a/b': { route: 'a/b', provider: 'a', model: 'b', status: 'healthy', latencyMs: 20, throughputTps: 2, lastCheckedAt: 2, timeline: [{ time: 2, status: 'healthy', latencyMs: 20 }] } },
  ]
  let round = 0
  const h = await mount({
    value: config(),
    remote: {
      session: {
        list: () => Promise.resolve({ ok: true, value: { items: [{ sessionId: 's', updatedAt: 1 }] } }),
        projections: () => {
          const record = records[Math.min(round, records.length - 1)]
          round += 1
          return Promise.resolve({ ok: true, value: { values: { 'router/channel-health': record } } })
        },
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(h.state().ui.passive['a/b']?.status, 'unhealthy', 'the mount-time snapshot shows the pre-failover record')
  h.actions.onActive('__health__')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(h.state().ui.passive['a/b']?.status, 'healthy', 're-opening the health view re-reads the snapshot')
})

// ---- workbench structure (hand-written createElement nesting) ----

// 回归：时间线合并曾是不去重的 concat，而 loadPassive 会在挂载/打开健康页/每轮巡检后
// 重读同样 20 个会话——同一批点被反复并进来，数组无界增长，可用率与"观测点数"漂移。
// 现有两条被动用例每次返回不同记录，恰好绕开"同记录读两次"的形态。
test('re-reading the same passive record does not grow the timeline', async () => {
  const record = {
    'a/b': {
      route: 'a/b', provider: 'a', model: 'b', status: 'healthy', latencyMs: 12, throughputTps: 3, lastCheckedAt: 2,
      timeline: [
        { time: 1, status: 'healthy', latencyMs: 10 },
        { time: 2, status: 'healthy', latencyMs: 12 },
      ],
    },
  }
  const h = await mount({
    value: config(),
    remote: {
      session: {
        list: () => Promise.resolve({ ok: true, value: { items: [{ sessionId: 's', updatedAt: 1 }] } }),
        projections: () => Promise.resolve({ ok: true, value: { values: { 'router/channel-health': record } } }),
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const first = h.state().ui.passive['a/b']?.timeline ?? []
  h.actions.onActive('__health__')            // 打开健康工作台：再读一次
  await new Promise((resolve) => setTimeout(resolve, 60))
  const second = h.state().ui.passive['a/b']?.timeline ?? []
  assert.equal(first.length, 2, 'the first read carries the two observations')
  assert.equal(second.length, 2, 'the same record read again adds nothing')
  assert.deepEqual(second.map((p) => p.time), [1, 2])
  assert.equal(h.state().ui.passive['a/b']?.latencyMs, 12, 'scalars still come from the newest record')
})

// 回归：addCandidates 曾把用户在手录面板填的 maxAttempts 写死成 1（目录选择没有这个
// 字段，1 是它的默认值；手录带了就必须按用户填的走）。
test('a manually added candidate keeps the attempt count the user typed', async () => {
  const h = await mount({ value: config() })
  h.actions.onAddCandidates('p1', [{ provider: 'stub-backup', model: 'stub-model', maxAttempts: 3 }], false)
  const chain = h.state().draft.profiles[0].candidates
  assert.equal(chain.length, 2)
  assert.equal(chain[1].maxAttempts, 3, 'the typed attempt count survives')
  // 目录选择路径不带 maxAttempts：默认 1 仍然生效。
  h.actions.onAddCandidates('p1', [{ provider: 'stub-third', model: 'stub-model' }], false)
  assert.equal(h.state().draft.profiles[0].candidates[2].maxAttempts, 1)
})

// 回归：侧栏弹窗与插件页共用同一个 controller，而 DSH 的 SettingsForm 卸载即 discard。
// 关弹窗曾把另一面未保存的编辑静默丢掉。现在弹窗那一侧传的是 no-op。
test('closing the quick modal does not discard the other surface\'s unsaved edits', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxAttempts('p1', 0, '3', false)
  assert.equal(h.state().dirty, true, 'the edit is unsaved')
  // 弹窗挂一次、再卸一次（等价于打开又关掉侧栏快捷弹窗）。
  h.actions.retainSurface()
  h.actions.releaseSurface()
  assert.equal(h.state().dirty, true, 'the draft survives the modal mount/unmount cycle')
  assert.equal(h.state().draft.profiles[0].candidates[0].maxAttempts, 3)
})

// 原生快捷键：保存命令注册进 DSH 的 shortcuts 服务（可重绑定、进快捷键设置页、按模态
// 仲裁），且只在我们的面在位时接键。自建 window 监听那版不可重绑定、弹窗打开也触发。
test('the save command is registered with DSH\'s shortcuts service and gated by our surface', async () => {
  const h = await mount({ value: config() })
  const commands = h.shortcutCommands()
  assert.equal(commands.length, 1, 'exactly one command contributed')
  const command = commands[0]
  assert.equal(command.id, 'model-router.save')
  assert.ok(command.modals.includes('model-router'), 'the quick modal\'s shortcutModal scope is allowed')
  assert.equal(typeof command.label(), 'string', 'the label comes from the plugin dictionary')
  // 没有面在位：让给别的所有者。
  assert.deepEqual(command.resolve({ modal: null }), { status: 'pass' })
  h.actions.retainSurface()
  const resolution = command.resolve({ modal: null })
  assert.equal(resolution.status, 'handled')
  h.actions.onMaxAttempts('p1', 0, '3', false)
  resolution.run()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(h.mutateCalls.length, 1, 'running the command saves the staged edit')
  assert.equal(h.mutateCalls[0].ops.some((op) => op.path[0] === 'profiles'), true)
})

// ---- component-level mounts (the loading frame and the surface gate) ----

/** The dictionary function the locale stub hands the components. */
const t = (key) => key
/** Render one component the way footer.ts renders it, with the store wired in. */
const propsFor = (h) => Object.assign({}, h.actions, {
  t,
  useRouterPage: (selector) => selector(h.store.getSnapshot()),
  wide: true,
})

// C3：DSH 的 SettingsForm 在 namespace 未就绪时不渲染 children
// （ui-primitives 的 settings-form/SettingsForm.tsx:55），.dsh-router-form-body
// 因此不在树里。把这种帧当成"seam 移动"抛错，等于把"配置未就绪"当成"结构坏了"——
// 侧栏按钮常驻可点，用户在这个窗口点开弹窗就崩，且 effect 的 deps 是 []，抛了
// 本次挂载永不恢复，只能关闭重开。
test('a dialog opened while the config scope is still loading does not throw, and the footer is still suppressed once served', async () => {
  const { RouterPage } = loadClient()
  const loading = await mount({
    value: config(),
    firstFrame: { status: 'loading', value: undefined, writable: false, revision: 0 },
  })
  assert.equal(loading.state().available, false, 'fixture: the namespace is unavailable in the loading frame')
  pendingEffects.length = 0
  // Render the page the way footer.ts does when the dialog is open, then run its
  // mount effects. A throw here is the bug: the tripwire must only fire for a
  // wrapper that EXISTS while its footer sibling moved.
  render(createEl(RouterPage, propsFor(loading)))
  for (const effect of pendingEffects) effect()

  // 对照：namespace 就绪后底栏照旧被压掉，且压制的两个属性都真的落上去了——
  // tripwire 仍然守着"seam 真移动"那一种条件。
  const ready = await mount({ value: config() })
  assert.equal(ready.state().available, true, 'fixture: the namespace is served')
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(ready)))
  for (const effect of pendingEffects) effect()
  const footer = find(tree, (node) => node.props?.className === 'footer')
  assert.ok(footer, 'fixture: the SettingsForm footer reached the tree')
  assert.equal(footer.attributes.hidden, '', 'the suppressed footer must carry hidden so DSH\'s Tab trap ignores it')
  assert.equal(footer.attributes.inert, '', 'and inert, for the same reason')
})

// I4：侧栏入口常驻，它一 retain 就让 surfaceActive() 恒真——Ctrl+S 被全局认领
// （regions 覆盖输入框与终端），而 save() 在只读时只是空转，并不阻止认领。
// 弹窗的挂载（page.ts）本来就独立 retain，footer 那一次是冗余的。
test('the permanent sidebar entry alone does not claim the save key; the open dialog does', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: config() })
  const command = h.shortcutCommands()[0]
  assert.deepEqual(command.resolve({}), { status: 'pass' }, 'nothing mounted: the key passes to its other owners')

  // 只挂侧栏入口那一面（footer action 组件本体，常驻不卸载）。
  pendingEffects.length = 0
  render(createEl(h.component, propsFor(h)))
  for (const effect of pendingEffects) effect()
  assert.deepEqual(command.resolve({}), { status: 'pass' },
    'the permanent sidebar entry alone must not claim the key')

  // 弹窗开着（RouterPage 挂载）时才接键。
  pendingEffects.length = 0
  render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  assert.equal(command.resolve({}).status, 'handled', 'the open dialog claims the key')
})

// 回归：checkAll 曾在内层回调里引用已被删除的 `routes` 对象（keys 改成字符串数组后
// 忘了拆回 provider/model），整个巡检一跑就 ReferenceError，客户端半包激活失败。
// 这条用例让"跑一次全量巡检"成为被覆盖的路径。
test('checkAll walks every configured route and lands its verdict keyed by route', async () => {
  const asked = []
  const h = await mount({
    value: config({
      profiles: [
        profile({ candidates: [
          { provider: 'deepseek', model: 'm', maxAttempts: 1, weight: 0 },
          { provider: 'other', model: 'm2', maxAttempts: 1, weight: 0 },
        ] }),
      ],
      default: defaultPool({ enabled: true, candidates: [{ provider: 'third', model: 'm3', maxAttempts: 1, weight: 0 }] }),
    }),
    remote: {
      routerHealth: {
        checkConnectivity: (request) => {
          asked.push(...request.routes.map((route) => route.provider))
          // 每个渠道广告不同的模型 id，让三种判定各出现一次：在清单里 / 不在清单里。
          var advertised = { deepseek: ['m'], other: ['not-this-one'], third: ['m3'] }
          return Promise.resolve({
            ok: true,
            value: request.routes.map((route) => advertised[route.provider].includes(route.model)
              ? { provider: route.provider, model: route.model, kind: 'reachable' }
              : { provider: route.provider, model: route.model, kind: 'notAdvertised', advertised: advertised[route.provider].length }),
          })
        },
      },
    },
  })
  h.actions.onCheckAll()
  await settleBusy()
  // 三条渠道各问一次（去重后），verdict 按 `provider/model` 落库。
  assert.deepEqual(asked.sort(), ['deepseek', 'other', 'third'])
  const discover = h.state().ui.discover
  assert.equal(discover['deepseek/m']?.kind, 'reachable')
  assert.equal(discover['other/m2']?.kind, 'notAdvertised', 'the endpoint answered but does not list this model')
  assert.equal(discover['third/m3']?.kind, 'reachable')
  assert.equal(h.state().ui.checking, false, 'the run settles')
  assert.ok(h.state().ui.checkSummary, 'the summary line is what the user sees after a run')
  assert.equal(h.state().ui.checkSummary.total, 3, 'the summary counts every route the run was asked about')
})

test('a run the Host cannot answer still counts every route as 没能检查', async () => {
  // The summary must not silently drop the routes nobody answered for: a run
  // that reports "可达 1" when three were asked under-reports what the user
  // asked for, which is the same lie in the other direction.
  const h = await mount({
    value: config({
      profiles: [profile({ candidates: [
        { provider: 'deepseek', model: 'm', maxAttempts: 1, weight: 0 },
        { provider: 'other', model: 'm2', maxAttempts: 1, weight: 0 },
      ] })],
    }),
    remote: { routerHealth: { checkConnectivity: () => Promise.resolve({ ok: false }) } },
  })
  h.actions.onCheckAll()
  await settleBusy()
  const summary = h.state().ui.checkSummary
  assert.equal(summary.total, 2)
  assert.equal(summary.counts.unknown, 2, 'both routes are counted as 没能检查')
  assert.equal(summary.counts.bad, undefined, 'nothing is counted as 不可达')
  assert.match(summary.text, /没能检查 2/)
})

test('the workbench keeps the sidebar and the workspace pane as siblings', async () => {
  // A missing paren in the deep h() nesting does not break `node --check`:
  // the closes just migrate to the end of the return, and the workspace pane
  // silently becomes the sidebar's third child (squeezed into its 260px
  // column). Balance is not structure — assert the shape on the source.
  const source = sourceOf('page.ts')
  const lines = source.split('\n')
  const asideLine = lines.findIndex((l) => l.includes("className: 'dsh-router-master-sidebar'"))
  const ternaryLine = lines.findIndex((l, i) => i > asideLine && /^\s+isHealthMode\s*$/.test(l))
  assert.ok(asideLine >= 0 && ternaryLine > asideLine, 'fixture: sidebar and workspace switch both exist')
  // Depth at the aside's own opening line, after that line is consumed.
  const depthAfter = (upto) => {
    let depth = 0
    for (let i = asideLine; i <= upto; i++) {
      for (const ch of lines[i]) {
        if (ch === '(') depth += 1
        else if (ch === ')') depth -= 1
      }
    }
    return depth
  }
  const asideOpenDepth = depthAfter(asideLine)
  // Walk forward until the aside's call closes; it must happen before the
  // workspace ternary, or the pane lands inside the sidebar.
  let closeLine = -1
  for (let i = asideLine + 1; i < lines.length; i++) {
    if (depthAfter(i) < asideOpenDepth) { closeLine = i; break }
  }
  assert.ok(closeLine >= 0, 'the sidebar call closes somewhere')
  assert.ok(closeLine < ternaryLine,
    `the sidebar must close (L${closeLine + 1}) before the workspace switch (L${ternaryLine + 1})`)
})

// ---- modal bounds (a settings dialog must never escape the viewport) ----

test('every plugin dialog is capped to the viewport and scrolls inside itself', async () => {
  // A `prim.Modal` is centred in a `position: fixed; inset: 0` root, so a card
  // taller than the viewport pushes its own header above the top edge with no
  // way to scroll to it. The bound therefore lives on the dialog element, and
  // it has to be reached through the `className` hook — DSH's own `.dialog`
  // rule carries no `max-height` at all, so dropping either side of this pair
  // (the class on the Modal, or the rule in ROUTER_CSS) silently restores the
  // clipped-header failure the user reported. The class names live on the
  // dialog components; the rules live in the stylesheet module.
  const components = sourceOf('modals.ts')
  const css = sourceOf('styles.ts').slice(
    sourceOf('styles.ts').indexOf('var ROUTER_CSS'),
    sourceOf('styles.ts').indexOf('function ensureStyles'),
  )

  for (const cls of ['dsh-router-settings-modal', 'dsh-router-candidate-modal']) {
    assert.ok(components.includes(`className: '${cls}'`),
      `${cls} must be handed to Modal so the bound has something to bind to`)
    assert.ok(css.includes(`.${cls}`),
      `ROUTER_CSS must carry a rule for .${cls}`)
  }
  // One shared rule block bounds both: assert it once, on the block itself.
  const dialogBlock = css.slice(
    css.indexOf('.dsh-router-settings-modal'),
    css.indexOf('.dsh-router-settings-modal [class*="content"]'),
  )
  assert.match(dialogBlock, /max-height:\s*84vh\s*!important/,
    'the dialog block must cap height against the viewport, not its content')
  assert.match(dialogBlock, /overflow:\s*hidden\s*!important/,
    'the dialog block must clip so the body is the only scroller')
  // The body rule is a separate block that follows the content rule.
  assert.match(css, /\[class\*="body"\][^}]*\{[^}]*overflow-y:\s*auto\s*!important/,
    'the body must scroll, which is what keeps the header and footer on screen')
})

// ---- breaker rule edits must not read the render-time closure ----

test('breaker rule mutations go through the state updater, not the closure', async () => {
  // `setRules(rules.concat(...))` reads the array captured at render. React
  // batches, so two clicks in one tick both append to that same array and the
  // last write wins: a fast double-click on a preset chip or on "+ 添加规则"
  // silently drops a rule the user just saw appear. The updater form is the
  // only version that survives batching.
  const source = sourceOf('modals.ts')
  const closureWrites = source.match(/setRules\(rules[.)]/g) ?? []
  assert.deepEqual(closureWrites, [],
    `breaker rule edits must use setRules(current => ...), found ${closureWrites.length} closure write(s)`)
  // And the updater form must actually be there, so the guard is not vacuous.
  assert.ok(source.includes('setRules(function (current)'),
    'fixture: the updater form is present in the source')
})

// 连通性检查的分类只能发生在宿主侧。`LlmRuntime.discoverModels` 抛的
// `LlmError` 带着可路由的 `code`，而 `remoteDiscoverModels` 用
// `RemoteError('llm/model-discovery-rejected', message)` 把它包掉
// （llm/src/index.ts:639-647），code 到不了浏览器。所以客户端一旦自己调
// `remote.llm.discoverModels`，就只剩下"按 message 猜"这一条路——那正是
// HarnessError 契约明令禁止的（llm/src/error.ts："route on this, never by
// parsing `message`"）。这条守卫盯着那个回归：浏览器半包重新伸手去够 DSH 的
// llm/settings remote。
test('the connectivity check is classified on the Host, never by parsing a message in the browser', async () => {
  // Comments legitimately name DSH's remote to explain why it is not used, so
  // the guard reads code only.
  const codeOf = (name) => sourceOf(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  const controller = codeOf('controller.ts')
  assert.ok(controller.includes('ctx.remote.routerHealth'),
    'the check must go through this plugin\'s own Host face')
  assert.ok(!controller.includes('discoverModels'),
    'the browser half must not call DSH\'s discovery remote itself — its error code does not survive the wrapper')
  assert.ok(!controller.includes('listConfigurableProviders'),
    'the configurable-provider directory is the Host\'s read, not the browser\'s')
  assert.ok(!controller.includes('settings.describe'),
    'the stored baseURL is the Host\'s read, not the browser\'s')
  // 浏览器半包不再需要 DSH 的这两个 remote：留着就是一条没人走的依赖声明，
  // 而"谁能调谁"正是这次搬迁要收窄的东西。
  const apply = codeOf('apply.ts')
  for (const face of ['remote.llm', 'remote.settings']) {
    assert.ok(!apply.includes(`'${face}'`),
      `${face} must leave the browser half's inject list now that the check runs on the Host`)
  }
  // 但 `remote.routerHealth` 只能出现在 UI fiber 的 inject 里：它是本包自己的
  // 贡献，由 applyInner 里的 `$mount` 挂上。写进顶层 inject 就是向一个只有
  // 本次 apply 才能提供的服务要服务——实测整个 entry 永不激活
  // （"waiting for service: remote.routerHealth"）。
  const topLevel = apply.slice(apply.indexOf('export const inject'), apply.indexOf('export async function apply'))
  assert.ok(!topLevel.includes('remote.routerHealth'),
    'the plugin\'s own Remote must not be declared at the top level — only its own $mount can provide it')
  assert.ok(/ctx\.inject\(\['remote\.routerHealth'/.test(apply),
    'the UI fiber declares it after the mount, which is what makes it resolvable')
  // 四个判定理由都必须在渲染侧有名字：少一个就会出现"通用兜底句"把真实
  // 原因抹平——那正是本轮修掉的那条谎的复发形式。
  const workspace = sourceOf('workspace.ts')
  for (const reason of ['notConfigurable', 'noDiscovery', 'hostUnavailable']) {
    assert.ok(workspace.includes(`'${reason}'`),
      `the unavailable reason ${reason} must have its own tooltip branch`)
  }
  for (const key of ['connectivityNoDiscovery', 'connectivityHostUnavailable']) {
    const locales = sourceOf('locales.ts')
    assert.equal((locales.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 2,
      `${key} must be worded in both dictionaries`)
  }
})

// 忙态必须看得见。预检即失败的路由（NO_ADAPTER / MISSING_CREDENTIAL）在微任务里
// resolve，"置忙"和"清忙"两次 publish 被 React 批进同一帧：实测两次 DOM 提交落在
// 点击后 2ms 与 7ms，转圈存在 5 毫秒且从未被绘制——用户看到的就是"点了没反应"。
// 每个异步入口都必须经过 holdBusy，让忙态至少停留 MIN_BUSY_MS。
test('every async run holds its busy state long enough to be painted', async () => {
  const source = sourceOf('controller.ts')
  assert.ok(/var MIN_BUSY_MS = \d+/.test(source), 'the busy floor must be a named constant')
  const floor = Number(source.match(/var MIN_BUSY_MS = (\d+)/)[1])
  assert.ok(floor >= 300 && floor <= 1200,
    `the floor must be perceptible but not sluggish, got ${floor}ms`)
  assert.ok(/function holdBusy|holdBusy: function/.test(source),
    'the floor must live in one helper, not four copies')
  // 四个入口：全量巡检、单路连通性、全量探测、单路探测。
  for (const entry of ['checkAll: function', 'checkRouteSingle: function', 'probeAll: function', 'probeRouteSingle: function']) {
    const at = source.indexOf(entry)
    assert.ok(at > 0, `fixture: ${entry} exists`)
    const end = source.indexOf('\n    },', at)
    const body = source.slice(at, end === -1 ? undefined : end)
    assert.ok(/holdBusy\(started/.test(body),
      `${entry} must settle through holdBusy, or an instant failure shows no feedback`)
  }
  // 而且 settle 必须真的在 holdBusy 里面（在它外面清忙等于没包）。
  const clearings = source.match(/ui\.(checking|probing|checkingRoutes|probingRoutes)\s*=\s*false|delete ui\.(checkingRoutes|probingRoutes)\[key\]/g) ?? []
  assert.ok(clearings.length > 0, 'fixture: busy states are cleared somewhere')
})

// ---- per-candidate edits ----

test('weight edits address the named profile', async () => {
  const h = await mount({ value: config() })
  h.actions.onWeight('p1', 0, '40', false)
  assert.equal(h.state().draft.profiles[0].candidates[0].weight, 40)
})

test('weight edits address the default pool without throwing', async () => {
  const h = await mount({ value: config({ default: defaultPool({ enabled: true, candidates: [{ provider: 'a', model: 'm', maxAttempts: 1, weight: 0 }] }) }) })
  h.actions.onWeight(null, 0, '60', true)
  assert.equal(h.state().draft.default.candidates[0].weight, 60)
})

test('strategy edits address both named profile and default pool', async () => {
  const h = await mount({ value: config({ default: defaultPool({ enabled: true }) }) })
  h.actions.onStrategy('p1', 'round-robin', false)
  assert.equal(h.state().draft.profiles[0].strategy, 'round-robin')
  h.actions.onStrategy(null, 'weight', true)
  assert.equal(h.state().draft.default.strategy, 'weight')
})

test('a strategy edit on an unknown profile id fails loudly', async () => {
  const h = await mount({ value: config() })
  assert.throws(() => h.actions.onStrategy('nope', 'weight', false), /no profile "nope"/)
})

test('an unknown profile id fails loudly instead of editing a phantom list', async () => {
  const h = await mount({ value: config() })
  assert.throws(() => h.actions.onMaxAttempts('nope', 0, '2', false), /no profile "nope"/)
})

// ---- legacy shapes ----

test('a profile saved before candidates existed reads as an empty, reported chain', async () => {
  const legacy = profile()
  delete legacy.candidates
  const h = await mount({ value: config({ profiles: [legacy] }) })
  assert.deepEqual(h.state().draft.profiles[0].candidates, [])
  assert.ok(h.state().problems.some((entry) => entry.key === 'problemEmptyChain'))
})

// ---- one surface, one height source, one tone source ----

// 回归：插件曾在 DSH 插件管理页里再注册一份 `plugins.bundle.config` 页面，与侧栏
// 弹窗渲染同一个 workbench。两个载体 = 两套布局常数：页面的吸顶头（`margin:0 -20px`
// 相对 16px padding 外溢 4px）、只对页面生效的 768px 断点、以及按页面 chrome 高度拍的
// `calc(100vh - 292px)` 上限。浏览器实测：768px 视口下页面比设置列宽 222px（min-content
// 来自吸顶头的 nowrap 行），弹窗里则出现"弹窗体 + 工作区"两条滚动条。现在只有一个
// 载体，这些常数连带消失。
test('the browser half registers exactly one surface: the sidebar dialog', async () => {
  const apply = sourceOf('apply.ts')
  assert.ok(apply.includes("ctx.slots.inject('sidebar.footer.action'"),
    'the sidebar entry must still be registered')
  // Assert on the registration itself, not on the word: the decision note and
  // the comments legitimately name the removed carrier.
  assert.ok(!/ctx\.slots\.inject\('plugins\.bundle\.config'/.test(apply),
    'the Plugins-page carrier must stay removed — one editor, one host')
  assert.ok(!apply.includes("name: 'plugins.bundle.config'"),
    'no registration may claim that slot name either')
  // 页面形状的分支一并死掉：RouterPage 不再有"页面/弹窗"两种形态。
  const page = sourceOf('page.ts')
  assert.ok(!page.includes('isModalView'),
    'the page/modal branch is dead now that the dialog is the only surface')
  assert.ok(page.includes("className: 'dsh-router-page', style: S.modalRoot"),
    'the workbench root is the dialog\'s flex column')
  // 两个视图的外包装必须是 flex 列且 alignSelf: stretch：行向容器里 flex:1 管宽，
  // 高度归 align-self 管；少任何一样，该列就按内容高度算并把弹窗体顶滚。
  for (const id of ['panel-global-health', 'panel-\' + activeProfile.id']) {
    const at = page.indexOf(id)
    assert.ok(at > 0, `fixture: ${id} wrapper exists`)
    const block = page.slice(page.lastIndexOf('style: {', at), at)
    assert.ok(/display: 'flex'/.test(block) && /flexDirection: 'column'/.test(block),
      `${id} wrapper must be a flex column`)
    assert.ok(/alignSelf: 'stretch'/.test(block),
      `${id} wrapper must stretch to the row height, or its column is content-height`)
    assert.ok(/minHeight: 0/.test(block),
      `${id} wrapper must be shrinkable`)
  }
})

// 高度只能来自容器链：任何 `100vh` 常数都是把某个载体的 chrome 高度写死，换一个
// 载体就错（实测弹窗内两条滚动条）。滚动区由 flex + min-height:0 串起来。
test('no viewport arithmetic sizes the workbench; the flex chain does', async () => {
  const styles = sourceOf('styles.ts')
  const vhConstants = styles.match(/calc\(100vh[^)]*\)/g) ?? []
  assert.deepEqual(vhConstants, [],
    `layout must come from the flex chain, not the viewport: found ${vhConstants.join(', ')}`)
  // 取出 S 对象里某个键的整块（按缩进配平到块尾），别用固定字数窗口——注释一长就漏。
  const blockOf = (key) => {
    const at = styles.indexOf(`  ${key}: {`)
    assert.ok(at > 0, `fixture: S.${key} exists`)
    const end = styles.indexOf('\n  },', at)
    return styles.slice(at, end === -1 ? undefined : end)
  }
  for (const key of ['workbench', 'masterList', 'detailWorkspace', 'modalContentArea', 'modalRoot']) {
    const block = blockOf(key)
    assert.ok(/minHeight:\s*0/.test(block), `${key} must be shrinkable (minHeight: 0) so the chain can hand it a height`)
  }
  // 断链的两处也必须都在：DSH 的 SettingsForm 外框（结构性提升）与两个视图包装。
  assert.ok(/\.dsh-router-page div:has\(> \.dsh-router-form-body\)\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/.test(styles),
    'the SettingsForm frame must be promoted to a shrinkable flex column, or the chain breaks there')
  assert.ok(/\.dsh-router-form-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/.test(styles),
    'the children wrapper must be a shrinkable flex column')
  // 侧栏按内容高度走（健康入口紧跟内容），但必须能收缩+自滚（长列表不撑破弹窗）。
  const sidebar = blockOf('masterSidebar')
  assert.ok(/minHeight:\s*0/.test(sidebar), 'masterSidebar must be shrinkable')
  assert.ok(/maxHeight:\s*'100%'/.test(sidebar), 'masterSidebar must cap at the row so a long list scrolls inside it')
  const list = blockOf('masterList')
  assert.ok(/flex:\s*'0 1 auto'/.test(list), 'masterList must be content-height — flex:1 here pushed the health entry 468px down')
})

// 语义色只有一个来源：`healthToneBadge`/`healthToneStyle` 读同一批
// `--dsh-router-tone-*` 变量，文字永远是 label-primary。曾有四套徽标配色各写一份，
// 其中 Bad 用 error-secondary 做底 + error-primary 做字——DSH 暗色下这两个令牌同值，
// 实测对比度 1.00:1（徽标是一条没有字的红条）。
test('semantic tone colour has one source and never paints badge text', async () => {
  const format = sourceOf('format.ts')
  assert.ok(format.includes('export function healthToneBadge'),
    'the badge treatment must be exported from format.ts')
  assert.ok(/healthToneColor\('healthy'\)[^}]*--dsh-router-tone-ok/.test(format.replace(/\s+/g, ' ')) || format.includes("'var(--dsh-router-tone-ok)'"),
    'healthy must read the shared tone variable')
  assert.ok(format.includes("color: 'var(--dsw-alias-label-primary)'"),
    'badge text stays label-primary — never the tone colour')
  // 样式对象里不允许再出现"语义令牌当文字色"的写法。
  const styles = sourceOf('styles.ts')
  const toneAsText = styles.match(/color:\s*'var\(--dsw-alias-state-(success|error|warn)-primary[^)]*\)'/g) ?? []
  assert.deepEqual(toneAsText, [],
    `state-*-primary must not be used as text colour (mid-tone in one theme or the other): ${toneAsText.join(', ')}`)
  // 被压掉的 DSH SettingsForm 底栏必须对 DSH 的焦点圈禁过滤器可见（[hidden]/[inert]），
  // 只靠 display:none 会让它成为弹窗"最后一个可聚焦元素"，Tab 从真正的最后一个控件
  // 走出去（实测 focus 落到 <body>）。
  const page = sourceOf('page.ts')
  assert.ok(page.includes("footer.setAttribute('hidden', '')"),
    'the suppressed footer must carry hidden so DSH\'s Tab trap ignores it')
  assert.ok(page.includes("footer.setAttribute('inert', '')"),
    'the suppressed footer must carry inert for the same reason')
  // 色点必须真的上色：徽标的颜色只剩点和边，点忘了给 background 就是一条
  // 只有边和文字的徽标（实测第一版就漏了，色点是透明的）。
  const workspace = sourceOf('workspace.ts')
  const dots = workspace.match(/S\.toneDot/g) ?? []
  const colored = workspace.match(/Object\.assign\(\{\}, S\.toneDot, healthToneStyle\(/g) ?? []
  assert.equal(dots.length, colored.length,
    `every toneDot must be handed its colour by healthToneStyle: ${dots.length} dot(s), ${colored.length} coloured`)
})

// 时间线窗口只有一个常数（../timeline.ts 的 MAX_TIMELINE_POINTS）：投影按它截断，
// 仪表盘按它画柱子。浏览器半包曾经自己写 24——窗口一调，柱子数和存下来的观测数
// 就对不上，而可用率算的是投影那一套，用户看到的是"柱子比记录少"。
test('the timeline window is one constant: the dashboard reads it, never a bare 24', async () => {
  const source = sourceOf('health-ui.ts')
  assert.ok(source.includes('MAX_TIMELINE_POINTS'),
    'the dashboard must read the shared window constant')
  assert.ok(!/Math\.max\(0, 24\b/.test(source) && !/slice\(-24\)/.test(source) && !/> 24 \?/.test(source),
    'no bare 24 may size the slot math — the bars would drift from the projection\'s own window')
  // 控制器侧同一件事：合并去重也按共享常量截断（它 import 的是同一个符号）。
  const controller = sourceOf('controller.ts')
  assert.ok(/points\.length > MAX_TIMELINE_POINTS/.test(controller),
    'the browser-side merge must cap by the same constant')
})

await Promise.all(pending)
console.log(`${passed} client-controller test(s) passed`)
