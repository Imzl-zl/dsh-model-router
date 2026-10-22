#!/usr/bin/env node
/**
 * Controller tests for the browser half (client.js).
 *
 * client.js is a Cordis client module in `window.__ModuleLoader__.load` factory
 * form, so these tests load the real file, hand the factory stub modules, run
 * `apply(ctx)` against a stub context, and drive the controller through the
 * exact seam the UI uses: the `main` panel slot registration's
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
 *   node packages/dsh-models-router/tests/client-controller.mjs
 *   CLIENT_PATH=<file> node packages/dsh-models-router/tests/client-controller.mjs
 *     (run the same suite against another revision, e.g. a pre-fix checkout)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RELEASE_NOTES, RELEASE_VERSION } from '../src/release.generated.ts'
import { changelogSection } from '../../../scripts/changelog-section.mjs'

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

test('the client bundle carries its own remote artifact instead of requiring it', () => {
  // 构建顺序陷阱（2026-10-21 CI 抓到）：tsdown 默认并行构建 host 与 client；client 里的
  // 自引用 `dsh-models-router/remote` 在 lib/typert.remote-client.js 尚未生成时会退化成
  // 一个真实的 require——浏览器 loader 答不了它，本套件的 require 表也答不了。
  // npm run bundle 用 `--concurrency 1` 强制 host 先构建；这条守着构建产物。
  const source = readFileSync(CLIENT_PATH, 'utf8')
  assert.equal(/require\(["']dsh-models-router\/remote["']\)/.test(source), false,
    'client.js must inline the generated remote artifact (build with npm run bundle)')
})

test('the embedded release notes are the packaged version CHANGELOG section', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(RELEASE_VERSION, pkg.version, 'the bundle names the version it was built from')
  const changelog = readFileSync(fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)), 'utf8')
  assert.equal(RELEASE_NOTES, changelogSection(pkg.version, changelog),
    'the dialog must describe the installed artifact, not a hand-copied note')
})

/** The version the stubbed browser storage reports; each mount resets it. */
let seenVersionState = RELEASE_VERSION

/** Load client.js and return its module exports. */
function loadClient() {
  const source = readFileSync(CLIENT_PATH, 'utf8')
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (mod) => { captured = mod } },
    localStorage: {
      getItem: () => seenVersionState,
      setItem: (_key, value) => { seenVersionState = value },
    },
  }
  new Function(source)()
  const require_ = (name) => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: () => null }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        SettingsForm: SettingsFormStub, Switch: 'Switch', Button: 'Button', Tag: 'Tag',
        SegmentedTabs: 'SegmentedTabs', Modal: 'Modal', RiskConfirmation: 'RiskConfirmation',
        SegmentedControl: 'SegmentedControl', Checkbox: 'Checkbox', Input: 'Input',
        // 更新日志用 DSH 的 MarkdownText 渲染，而不是把 markdown 原样塞进 <pre>。
        MarkdownText: 'MarkdownText',
        // 会话 chip 的弹层是 DSH 的 Menu 原语（portal 模式），按钮由它包一层 span。
        Menu: 'Menu', MenuItemButton: 'MenuItemButton',
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

/**
 * Every string a rendered tree would paint, joined.
 *
 * Walks `props.children` as well as the rendered `children`: the harness's
 * `render` turns a raw string child into a node with no children of its own, so
 * the text only survives in `props.children`. `title` is included because the
 * timeline's per-bucket rate lives in the tooltip.
 */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (typeof node.props?.title === 'string') out.push(node.props.title)
  collectText(node.props?.children, out)
  collectText(node.children, out)
  return out
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
    let cursor = next
    for (let i = 0; i < op.path.length - 1; i++) cursor = cursor[op.path[i]]
    const leaf = op.path[op.path.length - 1]
    // The settings wire supports `set` and `unset`; the plugin's save uses both
    // (it removes the legacy single-chain key once the chains are written).
    if (op.op === 'set') cursor[leaf] = structuredClone(op.value)
    else if (op.op === 'unset') delete cursor[leaf]
    else throw new Error(`harness applies set/unset ops, got ${op.op}`)
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
 * @param options.seenVersion - the release this browser has already acknowledged;
 *   the running version by default, so most tests do not open the notes dialog.
 */
async function mount({ value, writable = true, mutate, remote, firstFrame, seenVersion = RELEASE_VERSION } = {}) {
  seenVersionState = seenVersion
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
  // The fiber's effect cleanups, recorded the way Cordis keeps them: unloading
  // the plugin runs every one. The M11/M4 tests need a real unload — the
  // controller's timer and in-flight checks are cleaned in that cleanup.
  const effectDisposers = []
  let capturedComponent = null
  let capturedChip = null
  /** What the Host would have stored, per session: the chip tests drive this. */
  const bindings = new Map()
  // `session` 是按字段合并的一份面：用例覆盖自己关心的那一两个读口（list /
  // projections）时不该顺手把别的读口拆掉——真宿主上它们是同一个面的方法，拆掉只会
  // 得到 "modelCatalog is not a function" 这种夹具自己的错。
  const sessionFace = Object.assign({
    list: () => Promise.resolve({ ok: false }),
    projections: () => Promise.resolve({ ok: false }),
    // 行上的显示名来自这份目录（真实宿主是 session-controller 的
    // `session/modelCatalog`）。默认给一份空目录：名字回落到原始键，与"宿主还没答
    // 上来"同一个结果——需要映射名的用例自己给一份带名字的目录。
    modelCatalog: () => Promise.resolve({ ok: true, value: { groups: [] } }),
  }, remote?.session)
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => {
      const off = fn()
      const disposer = typeof off === 'function' ? off : () => {}
      effectDisposers.push(disposer)
      return disposer
    },
    // DSH's native shortcuts service: register() hands back a command object the
    // test can drive, exactly like the real client registry does.
    shortcuts: {
      register: (command) => { shortcutRegistrations.push(command); return () => {} },
    },
    configForms: { get: () => scope },
    slots: {
      // The real inject() runs its callback to register, then returns a disposer.
      inject: (_name, fn) => { fn(); return () => {} },
      // 侧栏面板行的顺序不再写死：插件读已注册的同伴、排到他们后面。harness 要
      // 提供这个读口，否则 apply 在挂载时就抛——真实宿主一定有它（ui-slots）。
      entriesOfSlot: () => [],
      register: (options, component) => {
        registrations.push(options)
        // The main panel is this plugin's only surface: it renders the whole
        // workbench, so it is the component the component-level tests mount.
        if (options.name === 'main') capturedComponent = component
        // 会话 chip 的注册：组件 + 它的 inject 面（controller/model）。
        if (options.name === 'conversation.input.left') capturedChip = { options, component }
        return () => {}
      },
    },
    // `session` 单独按字段合并：用例覆盖自己关心的那一两个读口（list / projections）
    // 时不该顺手把别的读口拆掉——真宿主上它们是同一个面的方法，拆掉只会得到
    // "modelCatalog is not a function" 这种夹具自己的错。
    remote: Object.assign({
      session: sessionFace,
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
        // 「检查更新」：宿主替浏览器去问 registry 与 release。默认答"已是最新"，
        // 需要别的答案的用例自己覆盖这一个方法。
        checkUpdate: () => Promise.resolve({
          ok: true,
          value: {
            current: RELEASE_VERSION,
            latest: RELEASE_VERSION,
            newer: false,
            publishedAt: null,
            notes: null,
            error: null,
            notesError: null,
          },
        }),
        // 会话绑定的两个 Remote：这个桩就是宿主的内存版——写进去、读出来，
        // 与真宿主同一份语义（没有绑定读成"跟随默认链"）。
        sessionBinding: (sessionId) => Promise.resolve({
          ok: true,
          value: { ...(bindings.get(sessionId) ?? { chain: null, retries: {} }), persistent: true },
        }),
        setSessionBinding: (request) => {
          const stored = { chain: request.chain, retries: request.retries ?? {} }
          bindings.set(request.sessionId, stored)
          return Promise.resolve({ ok: true, value: { ...stored, persistent: true } })
        },
      },
      // The browser half's apply mounts the generated ./remote contribution
      // before registering the UI.
      $mount: () => Promise.resolve(() => Promise.resolve()),
    }, remote, { session: sessionFace }),
    // The browser half mounts its own Remote and then registers the UI in a
    // child fiber carrying it; the harness runs the callback against a child
    // that carries the same stubs.
    inject: (_deps, fn) => {
      fn(Object.assign({}, ctx, { remote: ctx.remote }))
      return { dispose: () => Promise.resolve() }
    },
  }
  await loadClient().apply(ctx)
  // The main panel is this plugin's only surface: the sidebar's panel row opens
  // it. The Plugins-page carrier (`plugins.bundle.config`) was removed — one
  // editor, one host.
  const registration = registrations.find((entry) => entry.name === 'main')
  const injected = registration.inject()
  const store = injected.hooks.routerPage
  const chipInjected = capturedChip === null ? null : capturedChip.options.inject()
  return {
    actions: injected,
    store,
    state: () => store.getSnapshot(),
    /** The session chip: its registration, its model, and what the Host stored. */
    chip: {
      registration: capturedChip === null ? null : capturedChip.options,
      component: capturedChip === null ? null : capturedChip.component,
      model: chipInjected === null ? null : chipInjected.sessionChip,
      bindings,
    },
    /** Unload the plugin fiber: run every effect cleanup, the way Cordis does. */
    unload: () => { for (const disposer of effectDisposers.slice()) disposer() },
    // The registered panel component, for the component-level tests.
    component: capturedComponent,
    republish: (next) => { snapshot = { ...snapshot, ...next }; publish() },
    mutateCalls: calls,
    // The commands this plugin registered with DSH's native shortcuts service.
    shortcutCommands: () => shortcutRegistrations.slice(),
    // What the stubbed browser storage now remembers as the acknowledged release.
    seenVersion: () => seenVersionState,
  }
}

// ---- fixtures ----

const switchOn = () => ({ rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false })
const cand = (provider = 'deepseek', model = 'm', over = {}) => ({ provider, model, maxRetries: 0, weight: 0, ...over })
// 一条全局降级链：候选就是降级候选，第一跳是用户选中的模型（不在配置里）。
// 默认给一条候选——大部分用例要有个第 0 个候选可编辑。
const chainValue = (candidates = [cand()], over = {}) => ({
  candidates,
  switchOn: switchOn(),
  firstHopMaxRetries: 0,
  stickyTurns: 0,
  strategy: 'order',
  ...over,
})
const config = (over = {}) => ({ enabled: true, chain: chainValue(), ...over })
const routeOf = (candidate) => `${candidate.provider}/${candidate.model}`

// ---- save() settlement ----

test('a rejected save surfaces the failure and clears saving', async () => {
  const h = await mount({ value: config(), mutate: () => Promise.reject(new Error('wire down')) })
  h.actions.onMaxRetries(0, '3')
  h.actions.onSave()
  assert.equal(h.state().saving, true, 'saving is set while the write crosses the wire')
  await flush()
  assert.equal(h.state().saving, false, 'saving clears when mutate rejects')
  assert.equal(h.state().failed, true, 'the rejection is reported, not swallowed')
  assert.equal(h.state().dirty, true, 'a save that did not land keeps the draft')
})

test('an accepted save settles clean once the Host republishes', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxRetries(0, '3')
  h.actions.onSave()
  await flush()
  assert.equal(h.state().saving, false)
  assert.equal(h.state().failed, false)
  assert.equal(h.state().dirty, false, 'the republished value re-seeds the draft')
  assert.equal(h.state().draft.chain.candidates[0].maxRetries, 3)
})

// ---- validate() renders the shared cross-field rules (../rules.ts) ----

// 这些用例曾经的名字是 "mirrors the Host's assertStructural"——两份规则、一个镜像。
// 2026-10-17 起规则只有一个表达式（src/rules.ts），host 抛第一条、这里收全部；
// 本组钉住的是浏览器侧的保存拦截仍按 key 工作。

test('a weight strategy with no positive weight blocks the save', async () => {
  const h = await mount({ value: config({ chain: chainValue([cand('a', 'x')], { strategy: 'weight' }) }) })
  assert.equal(h.state().invalid, true)
  assert.ok(h.state().problems.some((entry) => entry.key === 'problemWeightNoPositive'))
  h.actions.onSave()
  assert.equal(h.mutateCalls.length, 0, 'the write never reaches the Host')
})

// ---- one chain: every candidate moves and removes ----

test('the drag guard is scoped to the card, not the whole document', () => {
  // 浏览器实测抓到的真 bug：卡外还有一层 role="tabpanel"（选路策略面板），
  // `closest` 拿整篇文档当边界时每张卡都被判成"在面板里"，拖拽一次也发不起来。
  const source = sourceOf('pipeline.ts')
  assert.ok(/event\.currentTarget\.contains\(interactive\)/.test(source),
    'the interactive-element check must confirm the hit is inside THIS row')
  assert.ok(!/document\.querySelector|target\.closest\('button, input/.test(source.replace(/\s+/g, ' ')),
    'a bare closest() over the document is the bug — the outer tabpanel would swallow every drag')
})

test('every candidate moves and removes: there is no pinned head any more', async () => {
  const h = await mount({
    value: config({
      chain: chainValue([cand('a', 'x'), cand('b', 'y')]),
    }),
  })
  h.actions.onMove(0, 1)
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['b/y', 'a/x'], 'the first candidate moves down')
  h.actions.onMove(1, -1)
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['a/x', 'b/y'], 'the second candidate moves back up')
  h.actions.onRemove(0)
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['b/y'], 'the first candidate removes')
})

test('the candidates reorder within bounds', async () => {
  const h = await mount({
    value: config({
      chain: chainValue([cand('a', '1'), cand('b', '2'), cand('c', '3')]),
    }),
  })
  h.actions.onReorder(0, 2)
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['b/2', 'c/3', 'a/1'])
  h.actions.onReorder(2, 1)
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['b/2', 'a/1', 'c/3'])
})

// ---- scope republish vs the draft ----

test('a republication with the same value keeps the unsaved draft', async () => {
  const value = config()
  const h = await mount({ value })
  h.actions.onMaxRetries(0, '3')
  assert.equal(h.state().dirty, true)
  h.republish({ value, revision: 2 })
  assert.equal(h.state().dirty, true, 'an unrelated republish must not wipe the draft')
  assert.equal(h.state().draft.chain.candidates[0].maxRetries, 3)
})

test('a genuinely changed Host value re-seeds the draft', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxRetries(0, '3')
  assert.equal(h.state().dirty, true)
  h.republish({ value: config({ chain: chainValue([], { firstHopMaxRetries: 4 }) }), revision: 2 })
  assert.equal(h.state().dirty, false, 'the Host is the authority once its value moves')
  assert.equal(h.state().draft.chain.firstHopMaxRetries, 4)
})

test('an edit after a value-changing republish keeps the draft dirty', async () => {
  // The production boot path: the controller is built while the scope is still
  // loading, so the first republication is always a value-changing one — the
  // re-seed runs on every real start, and edits come after it.
  const h = await mount({ value: undefined })
  h.republish({ value: config(), revision: 1 })
  h.actions.onMaxRetries(0, '3')
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
  assert.equal(h.state().ui.passiveError, null, 'a whole read raises no warning')
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

// 回归：读失败曾被 `.catch(() => null)` 与最外层 `.catch(() => {})` 一起吞掉，页面照常
// 渲染成"未调用 / 无记录"——与"这条渠道真的没跑过"长得一模一样。一个健康视图最不能
// 犯的就是这个错：它的全部工作就是报告渠道做过什么。
test('a refused history read says so instead of rendering an empty history', async () => {
  const h = await mount({
    value: config(),
    remote: {
      session: {
        list: () => Promise.resolve({ ok: true, value: { items: [{ sessionId: 's', updatedAt: 1 }] } }),
        projections: () => Promise.resolve({ ok: false, error: { message: 'projection registry is not ready' } }),
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const state = h.state()
  assert.deepEqual(state.ui.passive, {}, 'nothing was read, so nothing is claimed')
  // harness 的 locale 桩绑定的是恒等函数（`bind: () => (key) => key`），所以这里
  // 断言的是字典键：真宿主上它会翻成整句「渠道历史读不到：<原因>」。
  assert.match(state.ui.passiveError ?? '', /healthHistoryUnreadable/,
    'the refusal reaches the screen instead of folding into an empty history')
})

test('a history list that cannot be read says so too', async () => {
  const h = await mount({
    value: config(),
    remote: {
      session: { list: () => Promise.resolve({ ok: false, error: { message: 'the session directory refused' } }) },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.match(h.state().ui.passiveError ?? '', /healthHistoryUnreadable/,
    'a list nobody can read is reported, not rendered as an empty history')
})

// 回归（显示层，走真实构建产物）：窗口可用率曾在两个界面里各写一遍且都多乘了一个
// bar.count——healthy 本身就是桶内计数，再乘就是平方。用户实测印出 3578%。纯函数
// 那两条用例钉算法，这一条钉"渲染出来的字符串"：繁忙桶 + 真实 RouterPage。
// 桶里只有一次观测时 1×1=1，所以隔离浏览器实测（一次调用）完全看不出来。
test('a channel with real volume renders a rate that is still a percentage', async () => {
  const { RouterPage } = loadClient()
  const now = Date.now()
  // 60 次观测，全部落在最近这一个 10 分钟桶里：错公式给 60×60/60 = 60 → 6000%。
  const timeline = Array.from({ length: 60 }, (_, i) => ({ time: now - i * 900, status: 'healthy', latencyMs: 20 }))
  const record = {
    'a/b': {
      route: 'a/b', provider: 'a', model: 'b', status: 'healthy', latencyMs: 20, throughputTps: 5, lastCheckedAt: now,
      timeline,
    },
  }
  const h = await mount({
    value: config({ chain: chainValue([cand('a', 'b')]) }),
    remote: {
      session: {
        list: () => Promise.resolve({ ok: true, value: { items: [{ sessionId: 's', updatedAt: 1 }] } }),
        projections: () => Promise.resolve({ ok: true, value: { values: { 'router/channel-health': record } } }),
      },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  h.actions.onActive('__health__')
  await new Promise((resolve) => setTimeout(resolve, 60))

  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const text = collectText(tree).join(' ')
  // 树里每一个百分比都必须 ≤ 100。错公式在这里会渲染出 "6000%"。
  const found = text.match(/(\d+(?:\.\d+)?)%/g) ?? []
  assert.ok(found.length > 0, 'fixture: the rendered tree carries at least one percentage')
  for (const value of found) {
    assert.ok(parseFloat(value) <= 100, `a rendered percentage must stay ≤ 100, got ${value}`)
  }
  // 桩 t() 返回字典键本身，所以文案部分是 availabilityRate 而不是"可用率"；
  // 要钉的是那个数字：60 次观测全部成功 → 卡片徽标与大盘表头都是 100%。
  assert.ok(text.includes('availabilityRate 100%'), 'a fully healthy busy bucket reads 100% on the card')
  assert.ok(text.includes('timelineWindowLabel'), 'fixture: the metrics header reached the tree')
})

// 回归（显示层）：健康大盘的渠道清单曾读 `draft.profiles` / `draft.default`——单链化
// 之后那两个键不复存在，整段变成死代码，**配置的降级候选一个都不进大盘**：新加的候选
// 既不能被连通性检查也不能被探测，用户看到的大盘只有"用过的"。这条用例让"配了就要
// 出现在大盘里"成为被守住的契约。
test('a configured but never-used candidate still appears in the health dashboard', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({
    value: config({
      chain: chainValue([
        cand('configured-unused', 'never-called'),
        cand('other-unused', 'also-never-called'),
      ]),
    }),
    // 没有任何被动观测、没有任何发现、没有任何探测：纯粹的"配了但没用过"。
    remote: {
      session: {
        list: () => Promise.resolve({ ok: true, value: { items: [] } }),
        projections: () => Promise.resolve({ ok: true, value: { values: {} } }),
      },
    },
  })
  h.actions.onActive('__health__')
  await new Promise((resolve) => setTimeout(resolve, 60))

  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const text = collectText(tree).join(' ')

  assert.ok(text.includes('configured-unused'), 'the configured candidate must reach the dashboard')
  assert.ok(text.includes('never-called'), 'and its model id must be printed')
  assert.ok(text.includes('other-unused'), 'every configured candidate, not just the first')
  // 位次徽标说清它在这条链里的顺序；没有观测时不是"历史留痕"。
  assert.ok(text.includes('channelUsedInChain'), 'the badge must name the chain, not a rule')
  assert.ok(!text.includes('noChannelsConfigured'), 'the empty state must not fire while the chain has candidates')
})

// 目录多选一次加多条：每条都要拿到 schema 允许范围内的尝试次数，否则用户点完
// "添加"立刻被保存校验挡住，还得逐条手改。
test('a catalog multi-select adds every picked route with a save-valid attempt count', async () => {
  const h = await mount({ value: config() })
  h.actions.onAddCandidates([
    { provider: 'stub-backup', model: 'stub-model' },
    { provider: 'stub-third', model: 'other-model' },
  ])
  const chain = h.state().draft.chain.candidates
  assert.deepEqual(chain.slice(1).map(c => c.provider + '/' + c.model),
    ['stub-backup/stub-model', 'stub-third/other-model'],
    'every picked route lands once, in selection order')
  for (const candidate of chain.slice(1)) {
    assert.ok(candidate.maxRetries >= 0 && candidate.maxRetries <= 99,
      'a candidate added from the catalog must satisfy the schema range without an extra edit')
  }
  assert.equal(h.state().ui.modal, null, 'adding closes the dialog')
})

// 回归：侧栏弹窗与插件页共用同一个 controller，而 DSH 的 SettingsForm 卸载即 discard。
// 关弹窗曾把另一面未保存的编辑静默丢掉。现在弹窗那一侧传的是 no-op。
test('closing the quick modal does not discard the other surface\'s unsaved edits', async () => {
  const h = await mount({ value: config() })
  h.actions.onMaxRetries(0, '3')
  assert.equal(h.state().dirty, true, 'the edit is unsaved')
  // 弹窗挂一次、再卸一次（等价于打开又关掉侧栏快捷弹窗）。
  h.actions.retainSurface()
  h.actions.releaseSurface()
  assert.equal(h.state().dirty, true, 'the draft survives the modal mount/unmount cycle')
  assert.equal(h.state().draft.chain.candidates[0].maxRetries, 3)
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
  h.actions.onMaxRetries(0, '3')
  resolution.run()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(h.mutateCalls.length, 1, 'running the command saves the staged edit')
  assert.equal(h.mutateCalls[0].ops.some((op) => op.path[0] === 'chain'), true)
})

// ---- 检查更新弹窗 ----
// 右上角那个按钮从"更新日志"变成"检查更新"：版本与它改了什么本来就该一起看。
// 三种结果都要有明确的说法：已是最新 / 有新版本 / 查不到。

/** The dialog's tree, opened through the page head's button. */
const renderUpdateDialog = async (h, RouterPage) => {
  h.actions.onOpenUpdateCheck()
  await flush()
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  await flush()
  return tree
}

test('the update check reports the running version and that it is the latest one', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: config() })
  const tree = await renderUpdateDialog(h, RouterPage)
  const text = collectText(tree).join(' ')
  assert.ok(text.includes('updateCurrentVersion'), 'the running version is named')
  assert.ok(text.includes('updateLatestVersion'), 'the newest published version is named')
  assert.ok(text.includes('updateUpToDate'), 'the answer says "up to date"')
  // 已是最新时给的是当前版本自己的说明（内嵌在产物里，不联网）。
  assert.ok(text.includes('updateNotesTitle'), 'the notes section is there')
  assert.ok(!text.includes('updateCheckFailed'), 'a successful check is not an error')
})

test('a newer version is announced with its notes and a way to reach the release', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({
    value: config(),
    remote: {
      routerHealth: {
        checkUpdate: () => Promise.resolve({
          ok: true,
          value: {
            current: '0.3.3',
            latest: '0.4.0',
            newer: true,
            publishedAt: '2026-10-25T08:00:00Z',
            notes: '新的说明正文',
            error: null,
            notesError: null,
          },
        }),
      },
    },
  })
  const tree = await renderUpdateDialog(h, RouterPage)
  const text = collectText(tree).join(' ')
  assert.ok(text.includes('updateNewVersion'), 'the new version is announced')
  // 说明正文走 MarkdownText 原语，harness 把它换成了宿主元素：断言它的 text prop。
  const notes = find(tree, (node) => node.type === 'MarkdownText')
  assert.ok(notes, 'the notes are rendered')
  assert.equal(notes.props.text, '新的说明正文', 'the NEW version\'s notes are shown, not the running one')
  assert.ok(!text.includes('updateUpToDate'), 'a newer version is not "up to date"')
  const link = find(tree, (node) => node.props?.className === 'dsh-router-update-link')
  assert.ok(link, 'the release page is reachable from the dialog')
  assert.equal(link.props.href, 'https://github.com/Imzl-zl/dsh-models-router/releases/tag/v0.4.0')
})

test('a check that could not run says so, and never claims the artifact is up to date', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({
    value: config(),
    remote: {
      routerHealth: {
        checkUpdate: () => Promise.resolve({
          ok: true,
          value: {
            current: '0.3.3',
            latest: null,
            newer: false,
            publishedAt: null,
            notes: null,
            error: 'registry 读不到',
            notesError: null,
          },
        }),
      },
    },
  })
  const tree = await renderUpdateDialog(h, RouterPage)
  const text = collectText(tree).join(' ')
  assert.ok(text.includes('updateCheckFailed'), 'the failure is on screen')
  // 失败用 alert 角色上屏：它是这一条对话框里唯一的结论，不能只是灰色小字。
  assert.ok(find(tree, (node) => node.props?.role === 'alert'), 'the failure is an alert')
  assert.equal(text.includes('updateUpToDate'), false,
    'a check that did not run must not be reported as "up to date"')
})

test('the page head offers the update check, not a changelog viewer', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: config() })
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const button = find(tree, (node) => node.props?.onClick === h.actions.onOpenUpdateCheck)
  assert.ok(button, 'the head button opens the update check')
  const text = collectText(tree).join(' ')
  assert.ok(text.includes('updateCheckButton'), 'and it says so')
  assert.equal(text.includes('whatsNewButton'), false,
    'the old "what\'s new" button is gone from the head')
})

// ---- component-level mounts (the loading frame and the surface gate) ----

/** The dictionary function the locale stub hands the components. */
const t = (key) => key
/** Render one component the way panel.ts renders it, with the store wired in. */
const propsFor = (h) => Object.assign({}, h.actions, {
  t,
  useRouterPage: (selector) => selector(h.store.getSnapshot()),
  wide: true,
})
// Two candidates so the pipeline renders a Connector: the render path covers the
// dictionary-driven failover tag/notice, not just the form.
const twoCandidates = () => config({
  chain: chainValue([cand('deepseek', 'm'), cand('deepseek', 'm2')]),
})

// ---- 显示名：行上画目录里的名字，原始 id 只留在 tooltip 里 ----
// 判据取自用户现场的形状：provider `cherry` 下模型 id 是 `<uuid>:<model>`、name 是
// 映射名。用户映射名字就是为了让这些行分得出来，所以"画出来的文字"里不能再有 id。

/** 只收真正画出来的文字：`title` 是 tooltip，不算"这一行写了什么"。 */
function paintedText(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) {
    for (const child of node) paintedText(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  paintedText(node.props?.children, out)
  paintedText(node.children, out)
  return out
}

const MAPPED_ROUTE = 'cherry/c518aa0a-1e0e-46bd-a8b4-e94cd22ddd93:deepseek-4.1-flash'
const MAPPED_MODEL = 'c518aa0a-1e0e-46bd-a8b4-e94cd22ddd93:deepseek-4.1-flash'
const mappedCatalog = {
  ok: true,
  value: {
    groups: [{
      id: 'cherry',
      name: 'Cherry',
      models: [
        { id: MAPPED_MODEL, name: 'LunaRoute:deepseek-4.1-flash' },
        { id: '9c8f709a-d6e6-42a7-b4de-fc17c3bc3a08:deepseek-v4.1-flash', name: 'RelayFor-L:deepseek-v4.1-flash' },
      ],
    }],
  },
}
const mappedConfig = (over = {}) => config({
  chain: chainValue([
    cand('cherry', MAPPED_MODEL),
    cand('cherry', '9c8f709a-d6e6-42a7-b4de-fc17c3bc3a08:deepseek-v4.1-flash'),
  ]),
  ...over,
})
/** Mount against the mapped catalog; the remote override replaces the whole session face. */
const mountMapped = (value = mappedConfig(), catalog = mappedCatalog) => mount({
  value,
  remote: {
    session: {
      list: () => Promise.resolve({ ok: true, value: { items: [] } }),
      projections: () => Promise.resolve({ ok: true, value: { values: {} } }),
      modelCatalog: () => Promise.resolve(catalog),
    },
  },
})
/** Load the catalog the way the page's mount effect does, and let it land. */
const loadCatalog = async (h) => { h.actions.onLoadCatalog(); await flush() }

test('candidate rows paint the catalog names and keep the raw route in the tooltip', async () => {
  const { RouterPage } = loadClient()
  const h = await mountMapped()
  await loadCatalog(h)
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const painted = paintedText(tree).join(' ')
  assert.ok(painted.includes('LunaRoute:deepseek-4.1-flash'), '候选行写的是映射名')
  assert.ok(painted.includes('RelayFor-L:deepseek-v4.1-flash'), '每一行写自己的名字')
  assert.ok(painted.includes('Cherry'), 'provider 那一半也写映射名')
  assert.equal(painted.includes(MAPPED_MODEL), false, '画出来的文字里不该再有原始模型 id')
  assert.ok(find(tree, (node) => node.props?.title === MAPPED_ROUTE),
    '原始路由键仍在 title 里，排查时读得到')
})

test('health rows paint the catalog names too', async () => {
  const { RouterPage } = loadClient()
  const h = await mountMapped()
  await loadCatalog(h)
  h.actions.onActive('__health__')
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const painted = paintedText(tree).join(' ')
  assert.ok(painted.includes('LunaRoute:deepseek-4.1-flash'), '健康页与链路页同一套名字')
  assert.ok(painted.includes('RelayFor-L:deepseek-v4.1-flash'))
  assert.equal(painted.includes(MAPPED_MODEL), false)
})

test('the probe-override dropdown lists the names but keeps the raw route as its value', async () => {
  const { RouterPage } = loadClient()
  const h = await mountMapped(mappedConfig({
    health: {
      passive: true,
      probe: {
        enabled: true, intervalSeconds: 0, prompt: '1', timeoutSeconds: 8,
        prompts: [{ route: MAPPED_ROUTE, prompt: '1' }],
      },
    },
  }))
  await loadCatalog(h)
  h.actions.onOpenHealthModal()
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const options = []
  const collect = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) collect(child); return }
    if (node.type === 'option') options.push(node)
    collect(node.children)
  }
  collect(tree)
  const chosen = options.find((option) => option.props.value === MAPPED_ROUTE)
  assert.ok(chosen, '选项的 value 仍是原始路由键——写进配置的必须是真键')
  assert.equal(chosen.props.children, 'Cherry · LunaRoute:deepseek-4.1-flash', '下拉里给人看的是映射名')
})

test('the chip retry rows paint the catalog names', async () => {
  const h = await mountMapped()
  await h.chip.model.open('s1')
  await flush()
  const painted = paintedText(renderChip(h)).join(' ')
  assert.ok(painted.includes('LunaRoute:deepseek-4.1-flash'), '重试行写映射名')
  assert.ok(painted.includes('RelayFor-L:deepseek-v4.1-flash'))
  assert.equal(painted.includes(MAPPED_MODEL), false)
})

// C3：DSH 的 SettingsForm 在 namespace 未就绪时不渲染 children
// （ui-primitives 的 settings-form/SettingsForm.tsx:55），.dsh-router-form-body
// 因此不在树里。把这种帧当成"seam 移动"抛错，等于把"配置未就绪"当成"结构坏了"——
// 侧栏按钮常驻可点，用户在这个窗口点开弹窗就崩，且 effect 的 deps 是 []，抛了
// 本次挂载永不恢复，只能关闭重开。
test('a page opened while the config scope is still loading shows the unavailable line instead of the controls', async () => {
  const { RouterPage } = loadClient()
  const loading = await mount({
    value: twoCandidates(),
    firstFrame: { status: 'loading', value: undefined, writable: false, revision: 0 },
  })
  assert.equal(loading.state().available, false, 'fixture: the namespace is unavailable in the loading frame')
  pendingEffects.length = 0
  const loadingTree = render(createEl(RouterPage, propsFor(loading)))
  for (const effect of pendingEffects) effect()
  const loadingText = collectText(loadingTree).join(' ')
  assert.ok(loadingText.includes('formUnavailable'), 'the loading frame says the configuration is unavailable')
  assert.ok(!find(loadingTree, (node) => node.props?.className === 'dsh-router-tabs'), 'no view tabs without a served config')
  assert.ok(!find(loadingTree, (node) => node.props?.className === 'dsh-router-footer'), 'no save bar without a served config')

  // 就绪后：保存条常驻（用户不必先改一下才找得到保存）；干净时保存禁用，
  // 有改动时启用，且页面里只有一个保存动作。
  const ready = await mount({ value: twoCandidates() })
  assert.equal(ready.state().available, true, 'fixture: the namespace is served')
  pendingEffects.length = 0
  const cleanTree = render(createEl(RouterPage, propsFor(ready)))
  for (const effect of pendingEffects) effect()
  assert.ok(find(cleanTree, (node) => node.props?.className === 'dsh-router-footer'),
    'the save bar is always present once the config is served')
  const cleanSave = find(cleanTree, (node) => node.props?.onClick === ready.actions.onSave)
  assert.ok(cleanSave, 'the clean bar still carries the save control')
  assert.equal(cleanSave.props.disabled, true, 'a clean draft cannot be saved again')

  ready.actions.onStickyTurns(3)
  pendingEffects.length = 0
  const dirtyTree = render(createEl(RouterPage, propsFor(ready)))
  for (const effect of pendingEffects) effect()
  const footer = find(dirtyTree, (node) => node.props?.className === 'dsh-router-footer')
  assert.ok(footer, 'a dirty draft shows the same save bar')
  const dirtySave = find(dirtyTree, (node) => node.props?.onClick === ready.actions.onSave)
  assert.equal(dirtySave.props.disabled, false, 'a dirty draft enables the save control')
  assert.ok(find(dirtyTree, (node) => node.props?.onClick === ready.actions.onSave),
    'the save bar carries the save action')
  assert.ok(find(dirtyTree, (node) => node.props?.onClick === ready.actions.onDiscard),
    'and the discard action beside it')
})

// I4：注册本身不能 retain——否则 Ctrl+S 被全局认领（regions 覆盖输入框与终端），
// 而 save() 在只读时只是空转，并不阻止认领。载体换成主列面板之后这条更硬：
// 侧栏那一行是 DSH 自己的 PanelRow，本插件只提供图标、根本不渲染它，所以能
// retain 的只有面板页自己——没有任何"常驻但不该认领"的组件存在。
// （harness 的 useEffect 只收集不回收，所以卸载分支无法在这里表达；上面那条
// `nothing mounted` 就是它的反面。）
test('the panel page claims the save key only while it is mounted', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: twoCandidates() })
  const command = h.shortcutCommands()[0]
  assert.deepEqual(command.resolve({}), { status: 'pass' }, 'nothing mounted: the key passes to its other owners')

  pendingEffects.length = 0
  render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  assert.equal(command.resolve({}).status, 'handled', 'the open panel claims the key')
})

// 回归：checkAll 曾在内层回调里引用已被删除的 `routes` 对象（keys 改成字符串数组后
// 忘了拆回 provider/model），整个巡检一跑就 ReferenceError，客户端半包激活失败。
// 这条用例让"跑一次全量巡检"成为被覆盖的路径。
test('checkAll walks every configured route and lands its verdict keyed by route', async () => {
  const asked = []
  const h = await mount({
    value: config({
      chain: chainValue([cand('deepseek', 'm'), cand('other', 'm2'), cand('third', 'm3')]),
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
      chain: chainValue([cand('deepseek', 'm'), cand('other', 'm2')]),
    }),
    remote: { routerHealth: { checkConnectivity: () => Promise.resolve({ ok: false }) } },
  })
  h.actions.onCheckAll()
  await settleBusy()
  const summary = h.state().ui.checkSummary
  assert.equal(summary.total, 2)
  assert.equal(summary.counts.unknown, 2, 'both routes are counted as 没能检查')
  assert.equal(summary.counts.bad, undefined, 'nothing is counted as 不可达')
  // The stub dictionary returns keys, so the assertion is on the key and count;
  // the Chinese/English text itself lives in locales.ts and is covered there.
  assert.match(summary.text, /checkSummaryUnknown 2/)
})

test('the workbench is one page with top view tabs, not an internal sidebar', async () => {
  // 旧版为两个一级视图塞了一个 260px 侧栏：只有两行内容，下方 80% 是空地，
  // 右侧工作区被无谓挤窄。新结构照 DSH 自己的面板页：一个滚动列、顶部页签。
  const { RouterPage } = loadClient()
  const h = await mount({ value: twoCandidates() })
  pendingEffects.length = 0
  const tree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()

  assert.ok(find(tree, (node) => node.props?.className === 'dsh-router-page'), 'the page root exists')
  assert.ok(find(tree, (node) => node.props?.className === 'dsh-router-top'), 'the head and the switch travel in one sticky row')
  assert.ok(find(tree, (node) => node.props?.className === 'dsh-router-content'), 'the 960px content column exists')
  assert.ok(!find(tree, (node) => node.props?.className === 'dsh-router-scroll'),
    'the split scroller is gone — the page itself scrolls, so no row owns its own geometry')
  assert.ok(!find(tree, (node) => String(node.props?.className ?? '').includes('master-sidebar')),
    'the internal sidebar is gone')

  const tabs = find(tree, (node) => node.type === 'SegmentedTabs')
  assert.ok(tabs, 'the views are switched by top tabs')
  // 两个视图：链配置 / 渠道健康。会话级选链只在 composer 的 chip 里，不另设管理页。
  assert.deepEqual(tabs.props.items.map((item) => item.value), ['chain', 'health'])
  assert.equal(tabs.props.value, 'chain', 'the chain is the default view')

  h.actions.onActive('__health__')
  pendingEffects.length = 0
  const healthTree = render(createEl(RouterPage, propsFor(h)))
  for (const effect of pendingEffects) effect()
  const healthTabs = find(healthTree, (node) => node.type === 'SegmentedTabs')
  assert.equal(healthTabs.props.value, 'health')
  assert.ok(find(healthTree, (node) => node.props?.id === 'model-router-panel-health'),
    'the selected tab names the panel that is rendered')
})

test('chain rows reserve one default slot so their name inputs end on the same column', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: twoCandidates() })
  const tree = render(createEl(RouterPage, propsFor(h)))
  const row = find(tree, (node) => String(node.props?.className ?? '').startsWith('dsh-router-chain-row'))
  assert.ok(row, 'a chain row renders')
  assert.ok(find(row, (node) => node.props?.className === 'dsh-router-chain-default-slot'),
    'the default badge/button occupies its own fixed slot')
})

test('the chip popover and chain rows keep one aligned column', () => {
  // 用户截图里的两处“长短不一”：弹层随长路由变宽、链行的默认徽标/按钮宽度不同
  // 把改名输入框挤成不同长度。这里锁住两个容器级修复，而不是逐像素调。
  const css = sourceOf('styles.ts')
  assert.match(css, /\.dsh-router-session-chip-menu \{ width: 280px; max-width: calc\(100vw - 24px\); \}/)
  assert.match(css, /\.dsh-router-session-chip-menu > div\[role="presentation"\] > div:first-child \{[^}]*font-weight: 600;/,
    'the popover title must read as a heading')
  assert.match(css, /\.dsh-router-session-chip-retry-note-title \{[^}]*font-weight: 600;/,
    'the retry group title must read as a heading')
  assert.match(css, /\.dsh-router-chain-pick \{[^}]*width: 68px;/, 'the edit/editing control has one width')
  assert.match(css, /\.dsh-router-chain-default-slot \{[^}]*width: 92px;/, 'the default slot has one width')
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

  // One carrier class for every dialog, handed to each Modal instance.
  assert.ok(components.includes("const MODAL_CLASS = 'dsh-router-modal'"),
    'the shared dialog class must be named once')
  const handed = components.match(/className: MODAL_CLASS/g) ?? []
  assert.equal(handed.length, 4, `every dialog must hand the class to Modal, found ${handed.length}`)
  assert.ok(css.includes('.dsh-router-modal {'),
    'ROUTER_CSS must carry the dialog rule')
  // One shared rule block bounds both: assert it once, on the block itself.
  const dialogBlock = css.slice(
    css.indexOf('.dsh-router-modal {'),
    css.indexOf('.dsh-router-modal-content {'),
  )
  assert.match(dialogBlock, /height:\s*min\(560px,\s*84vh\)\s*!important/,
    'the dialog must have a fixed height so switching sections cannot resize it')
  assert.match(dialogBlock, /max-height:\s*84vh\s*!important/,
    'the dialog block must cap height against the viewport, not its content')
  assert.match(dialogBlock, /overflow:\s*hidden\s*!important/,
    'the dialog block must clip so the body is the only scroller')
  // DSH's scroll region (the content wrapper's last child) is reached structurally
  // from the contentClassName hook — no hashed class name is guessed anywhere.
  assert.match(css, /\.dsh-router-modal-content > div:last-child\s*\{[^}]*overflow-y:\s*auto\s*!important/,
    'the scroll region must scroll, which is what keeps the header and footer on screen')
  assert.ok(components.includes('contentClassName: MODAL_CONTENT'),
    'the modal must hand DSH its own content hook, or the height chain has no first link')
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

test('the catalog multi-select writes through the state updater, not the closure', async () => {
  // 与 setRules 同一类（M13）：读渲染期闭包里的 selected，同一 tick 的两次点击
  // 互相覆盖——用户看得见却存不上。目录多选曾是这个形状。
  const source = sourceOf('modals.ts')
  assert.equal((source.match(/setSelected\(next\)/g) ?? []).length, 0,
    'catalog selection must not write the render-scope object')
  assert.ok(source.includes('setSelected(function (current)'),
    'fixture: the updater form is present in the source')
})

test('the configured-route list has one expression, shared by both halves', async () => {
  // M15：controller 与 page 曾各写一份 two-line wrapper（configuredRoutes 的
  // 草稿适配）——两份适配改一处忘一处，巡检与列表就会看到不同的路由集。
  const routes = readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8')
  assert.ok(routes.includes('export function configuredRouteList'), 'the adapter lives in routes.ts')
  for (const name of ['controller.ts', 'page.ts']) {
    const source = sourceOf(name)
    assert.equal((source.match(/function configuredRouteList/g) ?? []).length, 0,
      `${name} must not carry its own copy of the route-list adapter`)
    assert.ok(source.includes('configuredRouteList'), `fixture: ${name} uses the shared adapter`)
  }
})

test('the accent is never used as text colour', async () => {
  // 浏览器实测（2026-10-19）：accent 当文字色 —— 深色 2.61:1、浅色 4.28:1，
  // 均低于 AA 的 4.5:1。新 UI 用 Tag 的 tone 表达状态，accent 只做底/边/图标；
  // 确实需要 accent 文字的地方走按主题混到 AA 的 --dsh-router-accent-text。
  const format = sourceOf('format.ts')
  assert.ok(!format.includes('export function accentBadge'),
    'the unused accent-badge helper is gone')
  for (const name of ['styles.ts', 'page.ts', 'chain.ts', 'pipeline.ts', 'workspace.ts', 'modals.ts', 'health-ui.ts']) {
    const text = sourceOf(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const hits = text.match(/color:\s*'var\(--dsh-router-accent\)'/g) ?? []
    assert.deepEqual(hits, [], `${name} must colour accent text with --dsh-router-accent-text, not the raw accent`)
  }
  // 该 token 必须在两个主题里都有解析值，否则深色会退回一个不达标的中调。
  const styles = sourceOf('styles.ts')
  assert.ok(styles.includes('--dsh-router-accent-text: color-mix(in srgb, var(--dsh-router-accent) 80%, black)'),
    'light theme resolves accent text towards black')
  assert.ok(styles.includes('--dsh-router-accent-text: color-mix(in srgb, var(--dsh-router-accent) 60%, white)'),
    'dark theme resolves accent text towards white')
})

test('no injected hover rule repaints an accent-surface glyph with the accent', async () => {
  // 曾经 `.dsh-router-add-profile-btn:hover` 把 color 设成 accent，而那个按钮的底色
  // 本来就是 accent —— 悬停时图标变成 accent-on-accent（1:1），加号直接消失（实测）。
  // 那个按钮随"按模型分规则"一起删了，但这类错误会再来：任何 hover 规则都不得把
  // accent 同时给底色和字形。这里对整段注入 CSS 立规矩，不针对某一个类名。
  const styles = sourceOf('styles.ts')
  const rules = [...styles.matchAll(/\.dsh-router-[\w-]+:hover[^{]*\{([^}]*)\}/g)]
  assert.ok(rules.length > 0, 'fixture: the bundle carries hover rules')
  for (const [, body] of rules) {
    const paintsAccent = /(?:^|;|\s)(?:color|background):\s*var\(--dsh-router-accent\)/.test(body)
    assert.ok(!paintsAccent,
      `a hover rule must not paint with the raw accent (it is the surface colour): ${body.trim().slice(0, 80)}`)
  }
})

test('the health settings modal is handed the section’s writability', async () => {
  // M21：弹窗里的 SegmentedControl 读 props.disabled（熔断作用域），而 page 渲染
  // HealthSettingsModal 时没传——只读/保存中它仍然可点，与其余控件不一致。
  // 熔断 tier 在弹窗自己的 tab 状态后面，一次性渲染够不着它，所以这里钉接线
  // 本身（与 hidden/inert 同类的接线守卫）：生产方传、消费方读，两个方向都在。
  const page = sourceOf('page.ts')
  const modalRender = page.slice(page.indexOf('h(HealthSettingsModal'), page.indexOf('h(NewProfileModal'))
  assert.ok(modalRender.includes('disabled: disabled'),
    'page.ts must pass the section’s writability into HealthSettingsModal')
  assert.ok(sourceOf('modals.ts').includes('disabled: props.disabled'),
    'fixture: the modal consumes the prop (the breaker scope control reads it)')
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

test('weight edits address the one chain', async () => {
  const h = await mount({ value: config() })
  h.actions.onWeight(0, '40')
  assert.equal(h.state().draft.chain.candidates[0].weight, 40)
  h.actions.onStrategy('round-robin')
  assert.equal(h.state().draft.chain.strategy, 'round-robin')
  h.actions.onStrategy('weight')
  assert.equal(h.state().draft.chain.strategy, 'weight')
})

test('chain-level edits land on the chain, and none of them throw', async () => {
  const h = await mount({ value: config() })
  h.actions.onStickyTurns('2')
  h.actions.onToggleSwitchOn('rateLimit')
  h.actions.onFirstHopMaxRetries('2')
  h.actions.onMaxRetries(0, '3')
  assert.equal(h.state().draft.chain.stickyTurns, 2)
  assert.equal(h.state().draft.chain.switchOn.rateLimit, false)
  assert.equal(h.state().draft.chain.firstHopMaxRetries, 2)
  assert.equal(h.state().draft.chain.candidates[0].maxRetries, 3)
})

test('unloading stops the discover timer, aborts the checks in flight, and survives late publishes', async () => {
  // M11 + M4：控制器的定时器与在飞检查是裸的（不归 Cordis 管）。修复前 dispose
  // 根本没有被接线——巡检 interval 对着卸载了的 fiber 空转、继续打端点；在飞的
  // 远程回调经 publish 把它复活。卸载 = effect 清理 = 停表 + abort 在飞检查。
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const armed = []
  globalThis.setInterval = (fn, ms) => { const id = realSetInterval(fn, ms); armed.push(id); return id }
  let settle = null
  const h = await mount({
    value: config({ health: {
      passive: true,
      discover: { enabled: true, intervalSeconds: 60 },
      probe: { enabled: false, intervalSeconds: 0, prompt: '1', prompts: [], timeoutSeconds: 8 },
      breaker: { enabled: false, rules: [] },
    } }),
    remote: {
      routerHealth: {
        checkConnectivity: (_request, signal) => new Promise((resolve) => { settle = { signal, resolve: () => resolve([]) } }),
        probeAll: () => Promise.resolve({ ok: true, value: { at: 1, routes: [] } }),
        probeReport: () => Promise.resolve({ ok: true, value: { at: 0, routes: [] } }),
      },
    },
  })
  try {
    h.actions.onCheckAll()
    assert.equal(armed.length, 1, 'fixture: the discover timer armed from the saved config')
    assert.ok(settle, 'fixture: the check is in flight')
    h.unload()
    assert.equal(settle.signal.aborted, true, 'unloading aborts the check in flight')
    assert.equal(armed.length, 1, 'no new timer while unloading')
    // 迟到的发布（在飞回调、忙态下限的 setTimeout）不能把定时器复活。
    settle.resolve()
    await settleBusy()
    assert.equal(armed.length, 1, 'a late publish does not re-arm the timer')
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
    for (const id of armed) realClearInterval(id)
  }
})

// ---- legacy shapes ----

test('a chain saved before candidates existed reads as an empty chain', async () => {
  const h = await mount({ value: config({ chain: chainValue([]) }) })
  assert.deepEqual(h.state().draft.chain.candidates, [])
  // 空链不是配置错误：插件就是不接管（first hop 之外没有降级可走）。
  assert.equal(h.state().invalid, false)
})

test('a legacy default pool is adopted as the chain', async () => {
  const h = await mount({
    value: {
      enabled: true,
      default: { enabled: true, candidates: [cand('a', 'x', { maxAttempts: 3 }), cand('b', 'y')], switchOn: switchOn(), maxTotalAttempts: 5, stickyTurns: 1, strategy: 'round-robin' },
    },
  })
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['a/x', 'b/y'])
  // 旧字段是"调用次数"：3 次调用 = 2 次重试。maxTotalAttempts 已被删除，不再出现。
  assert.equal(h.state().draft.chain.candidates[0].maxRetries, 2)
  assert.equal('maxTotalAttempts' in h.state().draft.chain, false)
  assert.equal(h.state().draft.chain.stickyTurns, 1)
  assert.equal(h.state().draft.chain.strategy, 'round-robin')
})

// ---- one surface, one height source, one tone source ----

// 回归：插件曾在 DSH 插件管理页里再注册一份 `plugins.bundle.config` 页面，与侧栏
// 弹窗渲染同一个 workbench。两个载体 = 两套布局常数：页面的吸顶头（`margin:0 -20px`
// 相对 16px padding 外溢 4px）、只对页面生效的 768px 断点、以及按页面 chrome 高度拍的
// `calc(100vh - 292px)` 上限。浏览器实测：768px 视口下页面比设置列宽 222px（min-content
// 来自吸顶头的 nowrap 行），弹窗里则出现"弹窗体 + 工作区"两条滚动条。现在只有一个
// 载体，这些常数连带消失。
test('the sidebar panel row does not hardcode its order', () => {
  // `order: 120` 是一个"别人不会用同一个数"的假设。两个插件选同一个数时，先后
  // 只能靠注册顺序定，而注册顺序跨插件不确定——用户实测撞到过。改成读已注册的
  // 同伴、排到他们后面；这条守卫让"再写死一个魔数"立刻转红。
  // 注释里合法地提到那个旧魔数（说明为什么不那么写），所以先剥注释再查。
  const apply = sourceOf('apply.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  assert.ok(!/order:\s*\d/.test(apply), 'no literal order may be registered')
  assert.ok(/entriesOfSlot\('sidebar\.panellist'\)/.test(apply),
    'the order must be derived from the entries already registered in that slot')
  assert.ok(/highestOrder \+ 1/.test(apply),
    'the entry must sort after every peer, not merely tie with them')
})

test('the panel row and its main panel are registered as one pair', () => {
  // DSH 的面板行自己接管点击并调 `layout.selectPanel(id)`，而那个调用对没有
  // `main` 注册的 id 会抛（ui-layout service.ts:72-78）。所以两条注册必须成对、
  // 用同一个 id——少任何一条，点侧栏那一行就是运行时抛错。
  const apply = sourceOf('apply.ts')
  assert.ok(/ctx\.slots\.inject\('main'/.test(apply), 'the main panel must be registered')
  assert.ok(/ctx\.slots\.inject\('sidebar\.panellist'/.test(apply), 'the panel row must be registered')
  assert.ok(/key: PANEL_ID/.test(apply) && /id: PANEL_ID/.test(apply),
    'both registrations must address the same panel id')
  // -footer-action 已不再是载体：那个槽位是多插件共享一行、没有分宽规则的。
  assert.ok(!/ctx\.slots\.inject\('sidebar\.footer\.action'/.test(apply),
    'the shared footer-action row must stay unused — two occupants squeeze each other')
})

test('the browser half registers exactly one surface: the main panel', async () => {
  const apply = sourceOf('apply.ts')
  assert.ok(apply.includes("ctx.slots.inject('main'"),
    'the main panel must still be registered')
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
  assert.ok(page.includes("className: 'dsh-router-page'"),
    'the workbench root is the page column')
  assert.ok(!/h\(SettingsForm/.test(page),
    'the page no longer borrows the SettingsForm frame — it owns its own chrome')
  // 唯一保存入口：底部保存条。页面头、视图里都不许再出现第二个保存动作。
  const saves = page.match(/onClick: props\.onSave/g) ?? []
  assert.equal(saves.length, 1, `exactly one save affordance on the page, found ${saves.length}`)
  assert.ok(/var footer = state\.available/.test(page),
    'the save bar is mounted whenever the config is served, so it never has to be discovered')
  assert.ok(/disabled: !state\.dirty \|\| !state\.writable \|\| state\.saving/.test(page),
    'a clean draft keeps the save control visible but disabled')
  // 两个视图共用一个 tabpanel 容器，id/aria 跟着选中项走。
  assert.ok(page.includes("role: 'tabpanel'") && page.includes("'aria-labelledby'"),
    'the rendered view is the selected tab\'s panel')
})

// 高度只能来自容器链，且不许猜 DSH 的类名。两条硬不变量：
// ① 内容链里不允许任何 vh 算术——`calc(84vh - 70px)` 曾在 settings 弹窗上，它的 70px
//    既不是 DSH 真实头高（62px）也没算 footer 与 gap，内容盒一变滚动区就错尺寸。vh
//    常数只允许出现在"载体本身"的 dialog 根上（"载体不超过视口 84%"是合法常数）。
// ② 注入 CSS 与组件不许出现 `[class*=`——那是猜 DSH 的 CSS-module 哈希类名，失败模式
//    是静默的（DSH 改名后选择器静默失配）。够到 DSH 的节点只能从插件自己的类/结构出发
//    （Modal.tsx:64 的 clsx(css.dialog, className)、:73 的 contentClassName、:83 的
//    body 是 content 的最后一个孩子）。
test('the modal height chain derives from the dialog root, and no DSH class name is guessed', async () => {
  const styles = sourceOf('styles.ts')
  // 只读注入的那段 CSS（S 对象是 JS，不是规则），且注释里合法地提到历史常量与
  // DSH 的类名形状，所以再剥掉注释。
  const css = styles
    .slice(styles.indexOf('var ROUTER_CSS'), styles.indexOf('function ensureStyles'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
  // ① vh 算术：一条也不许有（旧守卫只匹配 calc(100vh…)，84vh/88vh 全漏）。
  const vhMath = css.match(/calc\([^)]*vh/g) ?? []
  assert.deepEqual(vhMath, [],
    `viewport arithmetic must not size the content chain: ${vhMath.join(', ')}`)
  // vh 常数只属于 dialog 根：把注入 CSS 拆成规则逐条查。
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const [, selector, body] of rules) {
    if (!/\d+vh/.test(body)) continue
    assert.ok(/\.dsh-router-modal\b/.test(selector),
      `a vh constant may only size the dialog root itself, found in: ${selector.trim()}`)
  }
  // ② 类名猜测：注入 CSS 一条也不许有。
  const guesses = css.match(/\[class\*=/g) ?? []
  assert.deepEqual(guesses, [],
    `DSH's hashed module class names must not be guessed: ${guesses.length} occurrence(s)`)
  // contentClassName 这条 DSH 自己的钩子必须真的接上，且给出链上第一环。
  assert.ok(/\.dsh-router-modal-content\s*\{[\s\S]*?flex:\s*1\s*!important;[\s\S]*?min-height:\s*0\s*!important;/.test(css),
    'the contentClassName rule must make DSH\'s content wrapper the first shrinkable link')
  assert.ok(/\.dsh-router-modal-content > div:last-child\s*\{[\s\S]*?flex:\s*1\s*!important;[\s\S]*?min-height:\s*0\s*!important;[\s\S]*?overflow-y:\s*auto\s*!important;/.test(css),
    'DSH\'s scroll region (the content wrapper\'s last child) must be reached structurally, with min-height:0 + overflow')
  const modals = sourceOf('modals.ts')
  const contentHooks = modals.match(/contentClassName: MODAL_CONTENT/g) ?? []
  assert.equal(contentHooks.length, 4,
    `every dialog must pass the content hook so the chain has its first link, found ${contentHooks.length}`)
  // 新增覆盖行要滚进视野：用 scrollIntoView 找最近的可滚动祖先，而不是猜 DSH 类名
  // 或给某个内部 div 挂 id 自己滚（那会变成第二个滚动容器）。
  assert.ok(modals.includes('scrollIntoView'),
    'a newly added row must scroll into view through its nearest scrollable ancestor')
  assert.ok(!modals.includes("closest('[class*="),
    'the effect must not hunt for a DSH class — a rename used to silence it')
  // 页面壳的容器链：页面自己滚动并拥有水平留白，四行共享一条 960 居中列。
  // 旧壳把滚动区拆出页面、每行各写一份 padding，而滚动条只压窄滚动区（9px），
  // 结果页头/页签比正文缩进 52px、页脚又差 4px（2026-10-20 隔离实例实测）。
  assert.ok(/\.dsh-router-page\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable;/.test(css),
    'the page must own the height and the scrollport, gutter included')
  assert.ok(!css.includes('.dsh-router-scroll'),
    'the split scroller must stay deleted — it is what let the rows drift')
  assert.ok(/\.dsh-router-top, \.dsh-router-content, \.dsh-router-footer\s*\{[\s\S]*?max-width:\s*960px;[\s\S]*?margin:\s*0 auto;/.test(css),
    'one column rule must cap every direct row of the page')
  assert.ok(/\.dsh-router-top\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/.test(css),
    'the head and the switch travel in one sticky wrapper, so no head height is hard-coded')
  assert.ok(/\.dsh-router-footer\s*\{\s*position:\s*sticky;[\s\S]*?bottom:\s*0;/.test(css),
    'the save bar must stay reachable at the bottom of the same scrollport')
  assert.ok(/\.dsh-router-head\s*\{[\s\S]*?padding:\s*28px\s+0\s+16px;/.test(css),
    'the head carries the 28px top inset and no horizontal padding of its own')
  // 旧版的两处结构债必须真的消失：SettingsForm 外框与内部侧栏。
  assert.ok(!styles.includes('dsh-router-form-body'), 'the SettingsForm frame hack is gone')
  assert.ok(!styles.includes('master-sidebar') && !styles.includes('masterSidebar'),
    'the internal sidebar styles are gone')
})

// 注入的每一段 CSS 都必须自己站得住：一个没闭合的注释会把**后面所有**规则吞成
// 注释，浏览器不报错、页面只是"少了几条样式"——2026-10-22 实测踩到：一条
// `/* …` 少了 `*/`，后面 150 行规则一起消失（对话框的版本行挤成一行）。
test('the injected stylesheet is balanced, so one bad rule cannot swallow the rest', () => {
  const styles = sourceOf('styles.ts')
  // 只取 ROUTER_CSS 数组里的字符串字面量：注释与文档不参与 CSS 解析。
  const array = styles.slice(styles.indexOf('var ROUTER_CSS'), styles.indexOf('function ensureStyles'))
  const fragments = [...array.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(match => match[1].replace(/\\'/g, "'"))
  assert.ok(fragments.length > 50, 'the style array is found')
  // 数组元素是拼成一张样式表的（注释常常跨元素），所以判据落在**整张表**上：
  // 注释必须成对闭合，花括号必须配平。少一个 `*/` 就会把后面所有规则吞成注释，
  // 浏览器不报错，只是"少了几条样式"——2026-10-22 实测踩到过。
  const sheet = fragments.join('\n')
  const opens = (sheet.match(/\/\*/g) ?? []).length
  const closes = (sheet.match(/\*\//g) ?? []).length
  assert.equal(opens, closes, `every CSS comment must be closed (${String(opens)} open, ${String(closes)} closed)`)
  const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
  const braces = (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length
  assert.equal(braces, 0, `every CSS rule must close its block (off by ${String(braces)})`)
})

// 语义色只有一个来源：`healthToneStyle` 读 `--dsh-router-tone-*` 变量；状态文字
// 一律走 DSH 的 `Tag` tone，不再自绘徽标。曾有四套徽标配色各写一份，其中 Bad 用
// error-secondary 做底 + error-primary 做字——DSH 暗色下这两个令牌同值，实测
// 对比度 1.00:1（徽标是一条没有字的红条）。
test('semantic tone colour has one source and never paints badge text', async () => {
  const format = sourceOf('format.ts')
  assert.ok(!format.includes('healthToneBadge'),
    'the hand-rolled badge helper is gone; status tags use the Tag primitive')
  assert.ok(/healthToneColor\('healthy'\)[^}]*--dsh-router-tone-ok/.test(format.replace(/\s+/g, ' ')) || format.includes("'var(--dsh-router-tone-ok)'"),
    'healthy must read the shared tone variable')
  // 样式对象里不允许再出现"语义令牌当文字色"的写法。
  const styles = sourceOf('styles.ts')
  const toneAsText = styles.match(/color:\s*'var\(--dsw-alias-state-(success|error|warn)-primary[^)]*\)'/g) ?? []
  assert.deepEqual(toneAsText, [],
    `state-*-primary must not be used as text colour (mid-tone in one theme or the other): ${toneAsText.join(', ')}`)
  // 页面不再借用 SettingsForm，也就没有"被压掉的底栏"这个焦点圈禁陷阱：
  // 唯一的底栏是本插件自己的保存条。
  const page = sourceOf('page.ts')
  assert.ok(!page.includes('dsh-router-form-body'),
    'no SettingsForm children wrapper is left to suppress')
  // 色点必须真的上色：颜色只进点和边，点忘了给 background 就是透明的。
  const workspace = sourceOf('workspace.ts')
  assert.equal((workspace.match(/className: 'dsh-router-dot'/g) ?? []).length, 1,
    'the channel status dot exists once per row')
  assert.ok(workspace.includes('style: healthToneStyle(status)'),
    'the dot takes its colour from healthToneStyle')
  // 色点/色边的背景同理：DSH 的 state-* 是中间调（某个主题下看不见或刺眼），
  // 未保存点曾直接借 --dsw-alias-state-warn-primary 当背景（M18）。
  for (const name of ['panel.ts', 'chain.ts', 'workspace.ts', 'modals.ts', 'pipeline.ts', 'page.ts', 'health-ui.ts']) {
    const toneAsBackground = sourceOf(name).match(/background:\s*'var\(--dsw-alias-state-(success|error|warn)-primary[^)]*\)'/g) ?? []
    assert.deepEqual(toneAsBackground, [],
      `${name} must paint points and edges from --dsh-router-tone-*, not DSH's mid-tone state aliases: ${toneAsBackground.join(', ')}`)
  }
})

// 强调色只有一个来源：`--dsh-router-accent`（styles.ts 的 :root 声明）。DSH 的
// `--dsw-alias-brand-primary` 是**品牌墨色**（亮色近黑、暗色近白），借它着色会让
// Logo 与强调元素在某个主题里渲染成近黑/近白——而且因为插件令牌已定义，写在内联
// 里的 `#4A65E8` 回退永不生效，错得完全静默。手算的 `rgba(74,101,232,x)` 同理：
// accent 一改，二十处淡染不会跟着改。两者都归 color-mix / 变量。
test('the plugin accent has one source, and DSH brand ink is never borrowed', async () => {
  const modules = ['styles.ts', 'panel.ts', 'modals.ts', 'pipeline.ts', 'icons.ts', 'format.ts', 'health-ui.ts', 'workspace.ts', 'chain.ts', 'controller.ts', 'page.ts']
  for (const name of modules) {
    const source = sourceOf(name)
    const borrowed = source.match(/--dsw-alias-brand-primary/g) ?? []
    assert.deepEqual(borrowed, [],
      `${name} must not borrow DSH's brand-ink token — it is near-black on light and near-white on dark`)
    const handMixed = source.match(/rgba\(\s*74,\s*101,\s*232/g) ?? []
    assert.deepEqual(handMixed, [],
      `${name} must not hand-mix the accent's rgba — use color-mix on --dsh-router-accent so the token stays the only source`)
  }
  // 令牌本身仍在，且声明一次。
  const styles = sourceOf('styles.ts')
  assert.equal((styles.match(/--dsh-router-accent:/g) ?? []).length, 1,
    'the accent token is declared exactly once')
  // Logo 的渐变判断认的是插件自己的令牌，不是品牌墨色。
  assert.ok(sourceOf('icons.ts').includes("color.indexOf('accent')"),
    'the logo gradient must key off the plugin accent, not the brand-ink token')
})

// 时间轴窗口只有一个真值（../timeline.ts）：格数是 TIMELINE_BAR_COUNT，一格的时长是
// 用户配的 timelineBucketSeconds，观测点的保留规则是 pruneTimeline。浏览器半包曾经
// 自己写 24——窗口一调，柱子数和存下来的观测数就对不上，而可用率算的是投影那一套，
// 用户看到的是"柱子比记录少"。
test('the timeline window is one rule: the dashboard reads the shared module, never a bare 24', async () => {
  const source = sourceOf('health-ui.ts')
  assert.ok(source.includes("from '../timeline.ts'"),
    'the dashboard must bucket through the shared module')
  // 代码里不许出现字面 24：格数来自 bucketTimeline 返回的数组长度，写死就会在窗口
  // 规则调整时与投影里存的观测数脱节。注释里提 24 是说明，不算。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/\b24\b/.test(code),
    'no bare 24 may size the bar math — the bars would drift from the projection\'s own window')
  // 控制器侧同一件事：合并去重也走同一个 pruneTimeline（它 import 的是同一个符号）。
  const controller = sourceOf('controller.ts')
  assert.ok(controller.includes('pruneTimeline'),
    'the browser-side merge must prune by the same rule')
})

// ---- 接管开关（浏览器侧） ----
// 开关此前没有控件：apply.ts 的 onEnabled 是个死入口，顶栏徽标只是状态展示。这里
// 钉住：草稿改得动、保存载荷带得上、新草稿默认关。

test('the takeover switch edits the draft, and the save payload carries it', async () => {
  const h = await mount({ value: config({ enabled: false }) })
  assert.equal(h.state().draft.enabled, false)
  h.actions.onEnabled(true)
  assert.equal(h.state().draft.enabled, true)
  assert.equal(h.state().dirty, true)
  h.actions.onSave()
  await flush()
  const saved = h.mutateCalls.at(-1).ops
  assert.ok(saved.some((op) => op.op === 'set' && op.path[0] === 'enabled' && op.value === true),
    'the takeover switch must reach the Host through the save payload')
  assert.ok(saved.some((op) => op.op === 'set' && op.path[0] === 'chains'),
    'the chains must be saved alongside the switch')
  assert.ok(saved.some((op) => op.op === 'set' && op.path[0] === 'defaultChainId'),
    'and so must which chain is the default')
  assert.ok(saved.some((op) => op.op === 'unset' && op.path[0] === 'chain'),
    'the legacy single-chain key is removed, so the stored config has one shape')
})

test('a fresh draft defaults the takeover switch off, like the host schema', async () => {
  const h = await mount({ value: { chain: chainValue() } })
  assert.equal(h.state().draft.enabled, false)
})

test('a legacy per-model config is read as the one chain the Host executes', async () => {
  // 旧形状：按模型分规则 + 默认兜底池。浏览器看到的必须是宿主 effectiveChain 迁出来的
  // 那一条——被钉死的 candidates[0]（就是"选中模型"本身）成为隐式第一跳，不再占降级位。
  const legacy = {
    enabled: true,
    profiles: [{
      id: 'p1',
      when: { provider: 'deepseek', model: 'm' },
      candidates: [cand('deepseek', 'm', { maxAttempts: 3 }), cand('backup', 'b')],
      switchOn: switchOn(),
      maxTotalAttempts: 6,
      stickyTurns: 0,
      strategy: 'order',
    }],
    default: { enabled: false, candidates: [], switchOn: switchOn(), maxTotalAttempts: 3, stickyTurns: 0, strategy: 'order' },
  }
  const h = await mount({ value: legacy })
  assert.deepEqual(h.state().draft.chain.candidates.map(routeOf), ['backup/b'])
  // 被钉死的第一跳把它的调用次数（3）迁成重试次数（2），总上限字段消失。
  assert.equal(h.state().draft.chain.firstHopMaxRetries, 2)
  assert.equal('maxTotalAttempts' in h.state().draft.chain, false)
  // 保存一次之后，配置就是新形状：旧的 profiles/default 不再被写回。
  h.actions.onMaxRetries(0, '2')
  h.actions.onSave()
  await flush()
  const saved = h.mutateCalls.at(-1).ops
  assert.ok(saved.every((op) => !['profiles', 'default', 'primaryProfileId'].includes(op.path[0])),
    'the legacy keys must not be written back')
})

// ---- 会话内 chip（composer 工具行） ----
// chip 是"挂进会话槽位的控件"里唯一能无 DOM 验证的部分：注册面、读绑定、写绑定、
// 写失败不关闭弹层、以及 chip 文本真的跟着落库的值走。视觉与位置由浏览器实测覆盖。

const chipConfig = () => config({
  chains: [
    { id: 'default', name: '', candidates: [cand('a')], switchOn: switchOn(), firstHopMaxRetries: 0, stickyTurns: 0, strategy: 'order' },
    { id: 'coding', name: '写代码', candidates: [cand('b')], switchOn: switchOn(), firstHopMaxRetries: 0, stickyTurns: 0, strategy: 'order' },
  ],
  defaultChainId: 'default',
})

/** The dictionary in these tests is the key itself (`locale.bind` stub); names come from config. */
const chipDict = (key) => key

function renderChip(h, sessionId = 's1') {
  return render(createEl(h.chip.component, { t: chipDict, sessionId, sessionChip: h.chip.model }))
}

/**
 * The chip's visible text. It lives in the Menu's `anchor` prop, not in its
 * children, so the tree walker (which follows children only) cannot reach it.
 */
function chipLabel(menu) {
  const kids = menu.props.anchor.props.children
  const span = kids.find((child) => child.props?.className === 'dsh-router-session-chip-label')
  return span === undefined ? undefined : span.props.children
}

/** A Remote surface whose write always fails; the read still answers. */
const rejectingWrite = (message) => ({
  routerHealth: {
    sessionBinding: () => Promise.resolve({ ok: true, value: { chain: null, retries: {}, persistent: true } }),
    setSessionBinding: () => Promise.reject(new Error(message)),
  },
})

test('the session chip registers into the composer tool row as a session-scoped occupant', async () => {
  const h = await mount({ value: chipConfig() })
  assert.equal(h.chip.registration.name, 'conversation.input.left')
  assert.equal(h.chip.registration.id, 'model-router-session')
  assert.equal(h.chip.registration.locale, 'dsh-models-router')
  // 槽位自己给 sessionId（scope: 'session'），组件不猜前台会话，所以这里也不能传。
  assert.equal('sessionId' in h.chip.registration, false)
  // 模型走普通 prop，不进 hooks：那是保留键，装的是 observable source，运行时会
  // 转成 use* 选择器——把普通对象塞进去，组件拿到的就是 undefined（浏览器实测踩过）。
  const face = h.chip.registration.inject()
  assert.equal(typeof face.sessionChip.load, 'function')
  assert.equal('hooks' in face, false)
})

test('the chip names the bound chain and lists every chain in its popover', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.load('s1')
  // 未绑定 = 跟随默认链：chip 文本是字典里的「默认链」。
  assert.equal(chipLabel(renderChip(h)), 'chainDefaultName')
  await h.chip.model.open('s1')
  const menu = renderChip(h)
  assert.equal(menu.props.open, true)
  assert.equal(menu.props.items[0].text, 'sessionRouteTitle')
  // 链行带子菜单：跟随默认 + 配置里的每一条链（名字来自配置，不来自字典）。
  assert.deepEqual(menu.props.items[1].submenu.map((row) => row.label),
    ['sessionChainFollowDefault', 'chainDefaultName', '写代码'])
  // 链行本身就写着"实际会走哪条"（未命名默认链 → 字典的「默认链」）；弹层不再另加脚注。
  assert.equal(collectText(menu).includes('sessionChainHint'), false)
})

test('an unbound session shows the default chain it will actually run', async () => {
  // 默认链改名后，chip 与链行必须跟着写新名字：写死「默认链」等于告诉用户一条不存在的链。
  const h = await mount({ value: config({
    chains: [
      { id: 'default', name: '主力', candidates: [cand('a')], switchOn: switchOn(), firstHopMaxRetries: 0, stickyTurns: 0, strategy: 'order' },
      { id: 'coding', name: '写代码', candidates: [cand('b')], switchOn: switchOn(), firstHopMaxRetries: 0, stickyTurns: 0, strategy: 'order' },
    ],
    defaultChainId: 'default',
  }) })
  await h.chip.model.load('s1')
  assert.equal(chipLabel(renderChip(h)), '主力')
  await h.chip.model.open('s1')
  // 链行的 label 是「链 | 名字 | ›」节点：名字在 value 子节点里。
  const chainLabel = renderChip(h).props.items[1].label
  const value = chainLabel.props.children.find(child => child.props?.className === 'dsh-router-session-chip-chain-value')
  assert.equal(value.props.children, '主力')
})

test('choosing a chain stores it, refreshes the chip and closes the popover', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  await h.chip.model.choose('s1', 'coding')
  const view = h.chip.model.view('s1')
  assert.equal(view.open, false, 'the popover closes only after the write landed')
  assert.equal(view.chain, 'coding')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: 'coding', retries: {} })
  assert.equal(chipLabel(renderChip(h)), '写代码', 'the chip text follows the stored binding')
})

test('a failed write keeps the popover open, shows the error inside and leaves the chip alone', async () => {
  const h = await mount({ value: chipConfig(), remote: rejectingWrite('disk is full') })
  await h.chip.model.open('s1')
  await h.chip.model.choose('s1', 'coding')
  const view = h.chip.model.view('s1')
  assert.equal(view.open, true, 'a rejected write must not close the surface the user is using')
  assert.match(view.error, /disk is full/)
  assert.equal(view.chain, null, 'the chip keeps the stored value, not the attempted one')
  assert.equal(h.chip.bindings.get('s1'), undefined)
  assert.ok(collectText(renderChip(h)).includes('disk is full'), 'the error is rendered inside the popover')
})

test('the "follow the default chain" row writes null rather than the default chain id', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  const follow = renderChip(h).props.items[1].submenu[0]
  await h.chip.model.choose('s1', follow.id)
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: {} })
})

test('choosing a chain keeps the session retry overrides and re-reads them on open', async () => {
  const h = await mount({ value: chipConfig() })
  h.chip.bindings.set('s1', { chain: null, retries: { 'a/m': 5 } })
  await h.chip.model.open('s1')
  assert.deepEqual(h.chip.model.view('s1').retries, { 'a/m': 5 }, 'opening re-reads the binding')
  await h.chip.model.choose('s1', 'coding')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: 'coding', retries: { 'a/m': 5 } },
    'a chain switch must not drop the per-route retry overrides')
})

test('a Host without durable storage says so in the popover', async () => {
  const h = await mount({
    value: chipConfig(),
    remote: {
      routerHealth: {
        sessionBinding: () => Promise.resolve({ ok: true, value: { chain: null, retries: {}, persistent: false } }),
        setSessionBinding: () => Promise.resolve({ ok: true, value: { chain: null, retries: {}, persistent: false } }),
      },
    },
  })
  await h.chip.model.open('s1')
  assert.equal(h.chip.model.view('s1').persistent, false)
  assert.ok(collectText(renderChip(h)).includes('sessionChainMemoryOnly'))
})

// ---- 链管理：编辑哪一条、改名、默认、增删 ----

test('adding a chain selects it for editing, and saving carries the whole list', async () => {
  const h = await mount({ value: chipConfig() })
  h.actions.onAddChain()
  const draft = h.state().draft
  assert.deepEqual(draft.chains.map((c) => c.id), ['default', 'coding', 'chain-2'])
  assert.equal(draft.chain.id, 'chain-2', 'the new chain becomes the edit target')
  h.actions.onSave()
  await flush()
  const op = h.mutateCalls.at(-1).ops.find((entry) => entry.op === 'set' && entry.path[0] === 'chains')
  assert.deepEqual(op.value.map((c) => c.id), ['default', 'coding', 'chain-2'])
})

test('copying a chain brings its candidates and budgets along under a new id', async () => {
  const h = await mount({ value: chipConfig() })
  h.actions.onCopyChain('coding')
  const draft = h.state().draft
  const copy = draft.chains[draft.chains.length - 1]
  assert.deepEqual(draft.chains.map((c) => c.id), ['default', 'coding', 'chain-2'])
  // 夹具的字典返回 key 本身（与其它用例同一约定），所以这里断言的是用了哪个键。
  assert.equal(copy.name, 'chainCopyName')
  assert.deepEqual(copy.candidates, draft.chains[1].candidates, 'the candidates come along')
  assert.equal(copy.firstHopMaxRetries, draft.chains[1].firstHopMaxRetries)
  assert.deepEqual(copy.switchOn, draft.chains[1].switchOn)
  assert.equal(draft.chain.id, copy.id, 'the copy becomes the edit target')
  // 副本与原链互不影响：改副本的候选不动原件。
  h.actions.onRemove(0)
  assert.equal(h.state().draft.chains[2].candidates.length, 0)
  assert.equal(h.state().draft.chains[1].candidates.length, 1, 'the source chain is untouched')
  h.actions.onSave()
  await flush()
  const op = h.mutateCalls.at(-1).ops.find((entry) => entry.op === 'set' && entry.path[0] === 'chains')
  assert.deepEqual(op.value.map((c) => c.id), ['default', 'coding', 'chain-2'])
})

test('renaming a chain changes its display name, never its id', async () => {
  const h = await mount({ value: chipConfig() })
  h.actions.onRenameChain('coding', '写文档')
  const draft = h.state().draft
  assert.equal(draft.chains[1].name, '写文档')
  assert.equal(draft.chains[1].id, 'coding', 'sessions bind by id, so a rename must not touch it')
  assert.equal(h.state().dirty, true)
})

test('the edit target follows the default chain until the user picks one', async () => {
  const h = await mount({ value: chipConfig() })
  // 没显式选过链时，页面编辑的就是默认链——"设为默认"之后编辑目标自然跟着走。
  h.actions.onSetDefaultChain('coding')
  assert.equal(h.state().draft.defaultChainId, 'coding')
  assert.equal(h.state().draft.chain.id, 'coding')
  // 显式选一条之后，编辑目标跟选择走，不跟默认走。
  h.actions.onSelectChain('default')
  assert.equal(h.state().draft.chain.id, 'default')
  assert.equal(h.state().draft.defaultChainId, 'coding')
})

test('the last chain cannot be removed', async () => {
  const h = await mount({ value: config({ chains: [{ id: 'default', name: '', ...chainValue() }], defaultChainId: 'default' }) })
  h.actions.onRemoveChain('default')
  assert.deepEqual(h.state().draft.chains.map((c) => c.id), ['default'])
})

test('removing the default chain moves the default to the first remaining one', async () => {
  const h = await mount({ value: chipConfig() })
  h.actions.onRemoveChain('default')
  const draft = h.state().draft
  assert.deepEqual(draft.chains.map((c) => c.id), ['coding'])
  assert.equal(draft.defaultChainId, 'coding')
  assert.equal(draft.chain.id, 'coding', 'the edit target follows when its chain is gone')
})

// ---- 会话内 chip：每路由重试覆盖 ----

test('a retry override is written per route, and an empty box removes it again', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  h.chip.model.setRetryText('s1', 'b/m', '5')
  await h.chip.model.commitRetry('s1', 'b/m')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: { 'b/m': 5 } })
  assert.deepEqual(h.chip.model.view('s1').retries, { 'b/m': 5 })
  // 清空 = 跟随链：键被删掉，而不是写成 0。
  h.chip.model.setRetryText('s1', 'b/m', '')
  await h.chip.model.commitRetry('s1', 'b/m')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: {} })
})

test('a retry above the sanity bound is refused without a write, and the typed value stays', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  // 10 是合法的：会话覆盖与链预算共用 0..99 的 sanity bound，不再另设 9。
  h.chip.model.setRetryText('s1', 'b/m', '10')
  await h.chip.model.commitRetry('s1', 'b/m')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: { 'b/m': 10 } })
  // 超过 99：不写、上屏错误，已存的值保持原样。
  h.chip.model.setRetryText('s1', 'b/m', '100')
  await h.chip.model.commitRetry('s1', 'b/m')
  assert.match(h.chip.model.view('s1').error, /sessionRetryInvalid/)
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: { 'b/m': 10 } },
    '100 must not be clamped to 99 and saved')
  assert.equal(h.chip.model.view('s1').retryDraft['b/m'], '100', 'the user can fix what he typed')
  // 0 是合法值：这条路由不重试。
  h.chip.model.setRetryText('s1', 'b/m', '0')
  await h.chip.model.commitRetry('s1', 'b/m')
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: { 'b/m': 0 } })
})

test('the popover lists one retry row per candidate of the chain this session uses', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  const menu = renderChip(h)
  const block = menu.props.children.find((node) => node.props?.className === 'dsh-router-session-chip-retries')
  assert.notEqual(block, undefined, 'the retry block is rendered inside the popover')
  const rows = block.props.children.filter(Array.isArray).flat()
  // 未绑定时走默认链，所以只列默认链的候选：给用不上的路由配次数只会写进死键。
  assert.deepEqual(rows.map((row) => row.props.children[0].props.children), ['a/m'])
  const input = rows[0].props.children[1]
  assert.equal(input.props.inputMode, 'numeric')
  assert.equal(input.props.placeholder, 'sessionRetryFollow', 'an empty box means "follow the chain"')
})

test('an outside close commits the pending retry draft; Escape cancels it', async () => {
  const h = await mount({ value: chipConfig() })
  await h.chip.model.open('s1')
  // Render once with the popover open and run the chip's effects, so the
  // Escape listener the component installs is live. (The harness runs effects
  // by hand; the model's own load effect settles before we type.)
  pendingEffects.length = 0
  const keydowns = []
  globalThis.window.addEventListener = (type, fn) => { if (type === 'keydown') keydowns.push(fn) }
  globalThis.window.removeEventListener = () => {}
  const menu = renderChip(h)
  for (const effect of pendingEffects) effect()
  await flush()
  assert.equal(keydowns.length, 1, 'the chip listens for Escape while it is open')

  // Escape is cancel: close, and storage keeps whatever it had.
  h.chip.model.setRetryText('s1', 'a/m', '5')
  keydowns[0]({ key: 'Escape' })
  menu.props.onClose()
  await flush()
  assert.equal(h.chip.model.view('s1').open, false)
  assert.equal(h.chip.bindings.get('s1'), undefined, 'Escape must not write the draft')

  // Menu closes on pointerdown, before the input can blur; the close callback
  // is therefore the seam that has to commit the draft.
  await h.chip.model.open('s1')
  h.chip.model.setRetryText('s1', 'a/m', '5')
  menu.props.onClose()
  await flush()
  assert.deepEqual(h.chip.bindings.get('s1'), { chain: null, retries: { 'a/m': 5 } })
  assert.deepEqual(h.chip.model.view('s1').retries, { 'a/m': 5 })
  assert.equal(h.chip.model.view('s1').open, false, 'the popover closes after the write landed')
})

test('an outside close with a rejected write stays open and keeps the error visible', async () => {
  const h = await mount({ value: chipConfig(), remote: rejectingWrite('disk is full') })
  await h.chip.model.open('s1')
  h.chip.model.setRetryText('s1', 'a/m', '5')
  const view = await h.chip.model.dismiss('s1')
  assert.equal(view.open, true, 'a rejected write must not pretend the value landed')
  assert.match(view.error, /disk is full/)
  assert.equal(h.chip.bindings.get('s1'), undefined)
  assert.equal(view.retryDraft['a/m'], '5', 'the user can retry or fix what he typed')
})


// ---- 更新日志：只在版本变化/首次运行时弹一次 ----

test('a release change opens the embedded notes once, and dismissing remembers it', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: chipConfig(), seenVersion: '0.0.0' })
  assert.equal(h.state().ui.notesOpen, true, 'a different acknowledged version opens the dialog')
  const tree = render(createEl(RouterPage, propsFor(h)))
  // The notes go through DSH MarkdownText as a `text` prop; assert that exact
  // payload instead of scraping a substring out of the painted tree.
  const notes = find(tree, (node) => node.type === 'MarkdownText')
  assert.notEqual(notes, null, 'the dialog renders the notes as Markdown, not a raw <pre>')
  assert.equal(notes.props.text, RELEASE_NOTES,
    'the dialog shows the notes embedded in this build, not a hand-copied note')
  h.actions.onCloseNotes()
  assert.equal(h.state().ui.notesOpen, false)
  assert.equal(h.seenVersion(), RELEASE_VERSION, 'dismissing records the running release')
  const next = await mount({ value: chipConfig() })
  assert.equal(next.state().ui.notesOpen, false, 'the acknowledged release does not nag on the next load')
})

test('the page always offers the update check, even after the notes dialog was acknowledged', async () => {
  const { RouterPage } = loadClient()
  const h = await mount({ value: chipConfig() })
  assert.equal(h.state().ui.notesOpen, false)
  h.actions.onOpenNotes()
  assert.equal(h.state().ui.notesOpen, true, 'the post-update notes still open on demand')
  const tree = render(createEl(RouterPage, propsFor(h)))
  const text = collectText(tree).join('\n')
  assert.ok(text.includes('updateCheckButton'), 'the head keeps a permanent entry point')
  assert.ok(text.includes('whatsNewTitle'), 'the post-update dialog names the running release')
})

await Promise.all(pending)
console.log(`${passed} client-controller test(s) passed`)

