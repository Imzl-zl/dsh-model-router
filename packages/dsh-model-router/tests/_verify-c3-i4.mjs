/**
 * TEMPORARY verification probe for findings C3 and I4 — not part of the suite.
 *
 * C3 claims: `page.ts:121-133` throws when `.dsh-router-form-body` is absent
 * from the DOM, and DSH's SettingsForm renders no children while the namespace
 * is not served (`SettingsForm.tsx:55`), so a dialog opened during the config
 * scope's loading frame throws.
 *
 * I4 claims: `footer.ts:24-27` retains a surface on mount, the sidebar entry is
 * always mounted, so `surfaceActive()` is permanently true and the Ctrl+S
 * command is claimed even with no dialog open.
 *
 * The React stand-in here runs effects and attaches refs the way React's
 * reconciler does, and the SettingsForm stand-in mirrors DSH's own early return
 * (`SettingsForm.tsx:55`) — the real source is the spec, not the plugin.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

// ---- fixtures (same shapes client-controller.mjs uses) ----

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

function applyOps(value, ops) {
  const next = structuredClone(value)
  for (const op of ops) {
    let cursor = next
    for (let i = 0; i < op.path.length - 1; i++) cursor = cursor[op.path[i]]
    cursor[op.path[op.path.length - 1]] = structuredClone(op.value)
  }
  return next
}

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
  const react = makeReact()
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

/** Load client.js once and keep its exports. */
const clientModule = loadClient()
const RouterPageElement = clientModule.RouterPage

/**
 * A one-pass React stand-in: `useEffect` bodies are collected and the caller
 * runs them, `createElement` attaches `ref` the way the reconciler does.
 */
const pendingEffects = []
function makeReact() {
  return {
    // `ref` is deliberately NOT attached here: React's reconciler attaches it
    // only when the element is actually mounted, which is exactly the
    // distinction C3 turns on (children SettingsForm never renders never get
    // their ref attached). `props.children` follows React's single-child rule.
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
}

/**
 * A one-pass renderer: invoke function components, recurse into host elements'
 * children, and attach refs only for elements that actually reach the tree.
 */
/**
 * A one-pass renderer: invoke function components, recurse into host elements'
 * children, attach refs only for elements that actually reach the tree, and
 * link siblings so `nextElementSibling` behaves the way the DOM does — the
 * suppression seam in page.ts is exactly a sibling lookup.
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
 * (`:61`) is the sibling right after the children, which is the seam
 * page.ts:121-133 looks for.
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

async function mount({ value, firstFrame } = {}) {
  const calls = []
  let snapshot = firstFrame ?? { status: 'ready', value, writable: true, revision: 1 }
  const listeners = new Set()
  const publish = () => { for (const fn of listeners) fn() }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    mutate: (ops, revision) => {
      calls.push({ ops, revision })
      snapshot = { status: 'ready', value: applyOps(snapshot.value, ops), writable: true, revision: revision + 1 }
      publish()
      return Promise.resolve(true)
    },
  }
  const registrations = []
  const shortcutRegistrations = []
  let capturedComponent = null
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => { const off = fn(); return typeof off === 'function' ? off : () => {} },
    shortcuts: { register: (command) => { shortcutRegistrations.push(command); return () => {} } },
    configForms: { get: () => scope },
    slots: {
      inject: (_name, fn) => { fn(); return () => {} },
      register: (options, component) => { registrations.push(options); capturedComponent = component; return () => {} },
    },
    remote: {
      session: { list: () => Promise.resolve({ ok: false }), projections: () => Promise.resolve({ ok: false }) },
      llm: {},
      settings: {},
      routerHealth: {
        probeAll: () => Promise.resolve({ ok: true, value: { at: 1, routes: [] } }),
        probeReport: () => Promise.resolve({ ok: true, value: { at: 0, routes: [] } }),
      },
      $mount: () => Promise.resolve(() => Promise.resolve()),
    },
    inject: (_deps, fn) => {
      fn(Object.assign({}, ctx, { remote: ctx.remote }))
      return { dispose: () => Promise.resolve() }
    },
  }
  await loadClient().apply(ctx)
  const registration = registrations.find((entry) => entry.name === 'sidebar.footer.action')
  const injected = registration.inject()
  const store = injected.hooks.routerPage
  return {
    actions: injected,
    store,
    state: () => store.getSnapshot(),
    component: capturedComponent,
    shortcutCommands: () => shortcutRegistrations.slice(),
    republish: (next) => { snapshot = { ...snapshot, ...next }; publish() },
  }
}

const t = (key) => key
/** The one createElement alias every component module renders through. */
const createEl = (type, props, ...children) => {
  const next = props ?? {}
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return { type, props: next, children }
}
/** Depth-first search over the rendered tree. */
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
const propsFor = (h) => Object.assign({}, h.actions, {
  t,
  useRouterPage: (selector) => selector(h.store.getSnapshot()),
  wide: true,
})

// ---- C3 ----

console.log('=== C3: the dialog opened while the config scope is still loading ===')

{
  // The loading frame the Host serves before the settings mirror answers
  // (tools.md: "scope 首帧可能晚于控制器构建（status loading、value undefined）").
  const h = await mount({ value: config(), firstFrame: { status: 'loading', value: undefined, writable: false, revision: 0 } })
  assert.equal(h.state().available, false, 'fixture: the controller reports the namespace as unavailable')
  pendingEffects.length = 0
  let thrown = null
  try {
    // Render RouterPage the way footer.ts does when the dialog is open
    // (footer.ts:90 `h(RouterPage, props)`), then run its mount effects.
    render(createEl(RouterPageElement, propsFor(h)))
    for (const effect of pendingEffects) effect()
  } catch (error) {
    thrown = error
  }
  console.log('    thrown:', thrown === null ? '(none)' : `${thrown.constructor.name}: ${thrown.message}`)
  assert.ok(thrown !== null, 'expected the suppression-seam tripwire to fire')
  assert.match(thrown.message, /the SettingsForm footer is no longer the sibling after \.dsh-router-form-body/)
}

{
  // Control: the same component with the namespace served. The wrapper exists,
  // the footer is found, and hidden/inert land on it.
  const h = await mount({ value: config() })
  assert.equal(h.state().available, true, 'fixture: the namespace is served')
  pendingEffects.length = 0
  let thrown = null
  try {
    const tree = render(createEl(RouterPageElement, propsFor(h)))
    for (const effect of pendingEffects) effect()
    const wrapper = find(tree, (node) => node.props?.className === 'dsh-router-form-body')
    assert.ok(wrapper, 'fixture: the children wrapper reached the tree')
  } catch (error) {
    thrown = error
  }
  console.log('    thrown:', thrown === null ? '(none)' : `${thrown.constructor.name}: ${thrown.message}`)
  assert.equal(thrown, null, 'with the namespace served the seam holds and nothing throws')
  console.log('    ok  the wrapper is present, so the tripwire does not fire')
}

// ---- I4 ----

console.log('=== I4: surfaceActive() with only the sidebar entry mounted ===')

{
  const h = await mount({ value: config() })
  const command = h.shortcutCommands()[0]
  assert.equal(command.id, 'model-router.save')
  const before = command.resolve({})
  console.log('    resolve() with nothing mounted:', JSON.stringify(before))
  assert.equal(before.status, 'pass', 'baseline: no surface mounted, the command passes')

  // Exactly what footer.ts:24-27 does when the sidebar entry mounts. The entry
  // is permanent, so this happens on every DSH start and never reverses until
  // the plugin unloads.
  h.actions.retainSurface()
  const after = command.resolve({})
  console.log('    resolve() after the footer entry mounted:', JSON.stringify(after))
  assert.equal(after.status, 'handled', 'the permanent sidebar entry alone claims the key')
  assert.equal(typeof after.run, 'function')

  // And the run itself is a no-op when the namespace is read-only — the key is
  // claimed, the save silently does nothing.
  h.republish({ writable: false })
  after.run()
  console.log('    save() while read-only: claimed but empty (no throw, no write)')
}

console.log('PASS: C3 and I4 both reproduce')

