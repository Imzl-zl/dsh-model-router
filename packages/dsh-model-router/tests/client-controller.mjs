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
 * @param options.remote - overrides merged over the default remote stubs.
 */
async function mount({ value, writable = true, mutate, remote } = {}) {
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
  const shortcutRegistrations = []
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
      register: (options) => { registrations.push(options); return () => {} },
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
  const registration = registrations.find((entry) => entry.name === 'plugins.bundle.config')
  const injected = registration.inject()
  const store = injected.hooks.routerPage
  return {
    actions: injected,
    store,
    state: () => store.getSnapshot(),
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
  h.actions.onRemove(null, 0, true)
  assert.deepEqual(h.state().draft.default.candidates.map(routeOf), ['a/x'], 'the first pool candidate removes')
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

/** Remote stubs that make one provider discoverable, with a controllable answer. */
function discoverStubs(answer) {
  const calls = { discoverModels: 0 }
  return {
    calls,
    remote: {
      llm: {
        listConfigurableProviders: () => Promise.resolve({
          ok: true,
          value: [{ provider: 'deepseek', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'deepseek'] }],
        }),
        discoverModels: () => { calls.discoverModels += 1; return answer() },
      },
      settings: {
        describe: () => Promise.resolve({
          ok: true,
          value: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: { deepseek: {} } } }] },
        }),
      },
    },
  }
}

test('a single-route check shows busy on that route only, then lands the verdict', async () => {
  const stubs = discoverStubs(() => Promise.resolve({ ok: true, value: [{ id: 'm' }] }))
  const h = await mount({ value: config(), remote: stubs.remote })
  const pending = h.actions.onCheckRoute('deepseek', 'm')
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], true, 'the route shows busy while the check crosses the wire')
  assert.equal(h.state().ui.checking, false, 'a single check does not busy the global checker')
  await pending
  await flush()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], undefined, 'busy clears once the verdict lands')
  assert.deepEqual(h.state().ui.discover['deepseek/m'], { kind: 'reachable' }, 'the verdict is folded into the route map')
  assert.equal(stubs.calls.discoverModels, 1)
})

test('a second check for the same route while one is in flight is ignored', async () => {
  let release
  const stubs = discoverStubs(() => new Promise((resolve) => { release = resolve }))
  const h = await mount({ value: config(), remote: stubs.remote })
  h.actions.onCheckRoute('deepseek', 'm')
  await flush()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], true, 'the first check is still in flight')
  const second = h.actions.onCheckRoute('deepseek', 'm')
  assert.equal(second, undefined, 'the duplicate call is dropped, not queued')
  release({ ok: true, value: [{ id: 'm' }] })
  await flush()
  assert.equal(stubs.calls.discoverModels, 1, 'only one wire call was made')
})

test('a failed single check clears the busy state instead of spinning forever', async () => {
  const stubs = discoverStubs(() => Promise.reject(new Error('wire down')))
  const h = await mount({ value: config(), remote: stubs.remote })
  await h.actions.onCheckRoute('deepseek', 'm')
  await flush()
  assert.equal(h.state().ui.checkingRoutes['deepseek/m'], undefined, 'busy clears on failure too')
  assert.deepEqual(h.state().ui.discover['deepseek/m'], { kind: 'unreachable', reason: 'wire down' })
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
      llm: {
        listConfigurableProviders: () => Promise.resolve({ ok: true, value: [
          { provider: 'deepseek', settingsNs: 'ns-a', settingsPath: [] },
          { provider: 'other', settingsNs: 'ns-b', settingsPath: [] },
          { provider: 'third', settingsNs: 'ns-c', settingsPath: [] },
        ] }),
        discoverModels: (_ns, request) => {
          asked.push(request.provider)
          // 每个渠道广告不同的模型 id，让三种判定各出现一次：在清单里 / 不在清单里。
          var advertised = { deepseek: ['m'], other: ['not-this-one'], third: ['m3'] }
          return Promise.resolve({ ok: true, value: (advertised[request.provider] ?? []).map((id) => ({ id })) })
        },
      },
      settings: { describe: () => Promise.resolve({ ok: true, value: { namespaces: [
        { ns: 'ns-a', value: { baseURL: 'https://a.example' } },
        { ns: 'ns-b', value: { baseURL: 'https://b.example' } },
        { ns: 'ns-c', value: { baseURL: 'https://c.example' } },
      ] } }) },
    },
  })
  h.actions.onCheckAll()
  await new Promise((resolve) => setTimeout(resolve, 60))
  // 三条渠道各问一次（去重后），verdict 按 `provider/model` 落库。
  assert.deepEqual(asked.sort(), ['deepseek', 'other', 'third'])
  const discover = h.state().ui.discover
  assert.equal(discover['deepseek/m']?.kind, 'reachable')
  assert.equal(discover['other/m2']?.kind, 'notAdvertised', 'the endpoint answered but does not list this model')
  assert.equal(discover['third/m3']?.kind, 'reachable')
  assert.equal(h.state().ui.checking, false, 'the run settles')
  assert.ok(h.state().ui.checkSummary, 'the summary line is what the user sees after a run')
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

await Promise.all(pending)
console.log(`${passed} client-controller test(s) passed`)
