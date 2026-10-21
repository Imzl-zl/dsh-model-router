#!/usr/bin/env node
/**
 * Remote dispatch tests for the plugin's own Typert service (the probe).
 *
 * These boot the REAL shipped headless profile in-process — the same
 * `@deepseek-ai/dsh-app-boot` composition DSH's own loader-smoke tests use
 * (packages/test-support/loader-smoke/tests/fixtures/production-profile.ts) —
 * with the stub adapter and the built plugin inserted by overlay. That is what
 * makes the assertions below mean something: the generated `./typert` artifact
 * is registered by the real typert-loader, the gateway resolves the live
 * service, the strict codecs validate the wire values, and the probe runs
 * against the real llm runtime with the stub adapter behind it.
 *
 * The subprocess composition tests (tests/run.mjs) cannot reach this: they
 * spawn `dsh headless` and read the durable log, so nothing there can invoke a
 * Remote. The browser sweep covers the client half against the real gateway.
 *
 * Usage: node packages/dsh-models-router/tests/remote.mjs
 * Requires `npm run bundle` in the package directory first.
 */

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  boot,
  createRuntimeResolution,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PKG = `${ROOT}packages/dsh-models-router`
/** The package's own name (package.json), never re-typed: a rename must not drift. */
const PACKAGE_NAME = JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8')).name
const DSH_INSTALL = `${ROOT}node_modules/@deepseek-ai/dsh/package.json`
const STUB = `${HERE}stub-adapter.mjs`.replaceAll('\\', '/')
const STUB_DISCOVERY = `${HERE}stub-discovery.mjs`.replaceAll('\\', '/')
const HOME = `${HERE}.dshhome-remote`

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

// ---------- the composition ----------

// The stub consumes one script entry per real (non-auxiliary) call, so the
// probe's own generation is what these outcomes answer: one route answers, the
// other refuses.
writeFileSync(`${HERE}stub-script.json`, JSON.stringify({
  policy: { retryableCodes: ['RATE_LIMIT'], maxRetries: 0 },
  'stub-primary': { outcomes: ['ok'] },
  'stub-third': { outcomes: ['fail:RATE_LIMIT'] },
}, null, 2))

const overlay = `- insert:
    - id: stub-adapter
      name: '${STUB}'
    - id: stub-discovery
      name: '${STUB_DISCOVERY}'
    - id: model-router
      # The built entry by file path: an ESM import cannot resolve a bare
      # directory, and a bare name needs the package inside node_modules.
      name: '${PKG.replaceAll('\\', '/')}/lib/index.js'
      config:
        enabled: true
        # 一条全局降级链：候选就是降级候选，第一跳是用户选中的模型（隐式）。
        chain:
          candidates:
            - { provider: stub-primary, model: stub-model, maxRetries: 0 }
            - { provider: stub-third, model: stub-model, maxRetries: 0 }
          switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
        health:
          probe:
            # The schedule is on here so the timer itself is exercised: the
            # report must appear without any manual call.
            enabled: true
            intervalSeconds: 1
            timeoutSeconds: 8
            prompt: 'shared prompt'
            prompts:
              - { route: 'stub-primary/stub-model', prompt: 'override prompt' }
- id: '@deepseek-ai/dsh-typert-loader'
  # Explicit artifact registration for a package whose entry the overlay mounts
  # by file path: the loader's entry name is then a file:// URL, which resolves
  # to no package, so the typert-loader's own entry scan would skip it. Its
  # \`packages\` list registers the artifact by package name instead
  # (packages/typert/loader — config.packages), which is what puts the strict
  # descriptors into ctx.typert.local and makes the gateway dispatch in strict
  # mode rather than falling back to SRC prototype markers.
  config:
    packages:
      - ${PACKAGE_NAME}
`
writeFileSync(`${HERE}remote-overlay.yml`, overlay)

// 每次跑都从干净的家开始：同步会真的把 agent-default-model 写进 profile patch，
// 留着上一次的产物会让"默认本来就不是主模型"这个前提在第二次运行时就不成立——
// 测试因此开始依赖自己的历史，那正是它该钉住的反面。
rmSync(HOME, { recursive: true, force: true })
mkdirSync(HOME, { recursive: true })
process.env.DSH_HOME = HOME

const profile = loadProfile('router-remote-test', 'headless', DSH_INSTALL, undefined, { userLayer: false })
writeFileSync(fileURLToPath(new URL('./cordis.yml', `file:///${profile.dir.replaceAll('\\', '/')}/`)), '[]\n')
const overlays = [loadOverlayPatches('router-remote-test', `${HERE}remote-overlay.yml`)]
// One synthetic module layer for the plugin PACKAGE. The overlay inserts the
// plugin's built entry by file path (an ESM import cannot resolve a bare
// directory), but the typert-loader discovers a package's generated ./typert
// artifact by walking loader entries and resolving each entry's NAME to a
// package (packages/typert/loader — `resolveArtifact` → `pluginPackages.packageOf`).
// The entry name is the config-tree row id, so the layer must be named exactly
// that; its directory is the real package, whose manifest name the artifact
// validation then matches. The layer contributes no Cordis rows
// (`patches: []`), so the plugin still mounts exactly once, from the overlay row.
const moduleLayers = [{
  packageName: 'model-router',
  packageDir: PKG,
  patchPaths: [`${HERE}remote-overlay.yml`],
  patches: [],
}]
const resolution = await createRuntimeResolution({
  installAnchor: DSH_INSTALL,
  profile: { ...profile, layers: [...profile.layers, ...moduleLayers] },
})

/** @type {import('@deepseek-ai/cordis').Context} */
let ctx
try {
  ctx = await boot(
    'router-remote-test',
    fileURLToPath(new URL('./cordis.yml', `file:///${profile.dir.replaceAll('\\', '/')}/`)),
    [
      ...profile.layers.flatMap(layer => layer.patches),
      ...overlays.flat(),
    ],
    async (composing) => {
      // Launcher facts, not config: the headless profile's startup provider
      // injects `cmdlineArgs` (packages/boot/cmdline — provided by the launcher
      // before any tree entry mounts). Empty inner arguments mean no task, so
      // the runner idles while this test drives the Remote directly; an exit
      // request (a --help path) is recorded instead of ending this process.
      const exits = []
      provideCmdline(composing, { args: [], exit: (code) => { exits.push(code) } })
      composing.provide('profileContext', {
        name: 'headless', dir: profile.dir, patchPath: profile.patchPath, installAnchor: DSH_INSTALL,
        cwd: process.cwd(), home: HOME,
        startedBundles: profile.layers.map(layer => layer.packageName),
        overlays: overlays.flat(), telemetryDisabledEnv: undefined,
      })
      await composing.plugin(PluginPackages, { resolution })
    },
  )
} catch (error) {
  console.log(`boot failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
}

const invoke = (method, args) => ctx.typertGateway.invoke({ namespace: 'routerHealth', method, args })

// ---------- assertions ----------

test('the generated artifact passes the loader’s own registration validator', async () => {
  // The typert-loader runs exactly this function on every package artifact
  // before registering it (packages/typert/loader — validateTypertManifest):
  // manifest ownership, face, schema factories, invocation shape, and strict
  // codecs with the cancellation parameter named. An artifact it rejects would
  // fail a real install's boot, so this is the registration gate, run directly.
  const artifact = await import(pathToFileURL(`${PKG}/lib/typert.host.js`).href)
  assert.equal(artifact.TYPERT.package, PACKAGE_NAME)
  validateTypertManifest(PACKAGE_NAME, artifact.TYPERT)
  const ids = artifact.TYPERT.invocations.map(invocation => invocation.id)
  assert.deepEqual(ids, [
    `${PACKAGE_NAME}#routerHealth/checkConnectivity`,
    `${PACKAGE_NAME}#routerHealth/probeAll`,
    `${PACKAGE_NAME}#routerHealth/probeReport`,
    `${PACKAGE_NAME}#routerHealth/sessionBinding`,
    `${PACKAGE_NAME}#routerHealth/setSessionBinding`,
  ])
})

test('the gateway dispatches the probe endpoints', async () => {
  // This composition mounts the plugin by overlay file path, so the loader
  // entry's name is a file:// URL and the gateway dispatches through SRC
  // prototype markers rather than the strict descriptors (a real install names
  // the package, which registers them). The dispatch itself is what is asserted
  // here; the strict codecs are exercised on the client side by the generated
  // ./remote artifact and in the browser sweep.
  const report = await invoke('probeReport', {})
  assert.deepEqual(report, { at: 0, routes: [] })
})

test('the generated strict codec refuses a malformed probe request', async () => {
  // The generated ./remote artifact carries the strict codec the Client and the
  // Host both run; this exercises the real one from the built file, not a
  // re-typed shape.
  const client = await import(pathToFileURL(`${PKG}/lib/typert.remote-client.js`).href)
  const contribution = client.default
  assert.equal(contribution.package, PACKAGE_NAME)
  const probeAll = Object.values(contribution.descriptors)
    .find(descriptor => descriptor.method === 'probeAll')
  assert.notEqual(probeAll, undefined, 'the remote client carries a probeAll descriptor')
  const codec = probeAll.parameters[0].codec
  assert.equal(codec.mode, 'strict')
  assert.equal(probeAll.parameters[0].source, 'json')
  const schema = codec.create()
  assert.throws(() => schema.parse({ routes: 'not-an-array' }))
  assert.deepEqual(schema.parse({ routes: [{ provider: 'p', model: 'm' }] }),
    { routes: [{ provider: 'p', model: 'm' }] })
})

test('the generated strict codec refuses a malformed session-binding write', async () => {
  // 写入的线形状：sessionId + chain（null 或 id）+ retries（对象）。0..9 不在线
  // 形状里——那是宿主的业务边界（bindings.ts），所以这里只钉"形状不对"。
  const client = await import(pathToFileURL(`${PKG}/lib/typert.remote-client.js`).href)
  const descriptor = Object.values(client.default.descriptors)
    .find(entry => entry.method === 'setSessionBinding')
  assert.notEqual(descriptor, undefined, 'the remote client carries a setSessionBinding descriptor')
  const schema = descriptor.parameters[0].codec.create()
  assert.throws(() => schema.parse({ sessionId: 's', chain: null, retries: 'not-an-object' }))
  assert.throws(() => schema.parse({ sessionId: 's', retries: {} }), 'a missing chain is not a binding')
  assert.deepEqual(schema.parse({ sessionId: 's', chain: null, retries: { 'p/m': 5 } }),
    { sessionId: 's', chain: null, retries: { 'p/m': 5 } })
  assert.deepEqual(schema.parse({ sessionId: 's', chain: 'coding', retries: {} }),
    { sessionId: 's', chain: 'coding', retries: {} })
})

// ---- 会话绑定：两个 Remote 走真网关 ----

test('sessionBinding reads a session that never wrote one as "follow the default chain"', async () => {
  // 没有绑定是一种状态，不是失败：读回默认值，并如实说明它存在哪。
  const view = await invoke('sessionBinding', { sessionId: 'session-never-written' })
  assert.deepEqual(view, { chain: null, retries: {}, persistent: true })
})

test('setSessionBinding writes durably, answers what it stored, and reads back', async () => {
  // 这份 overlay 是旧形状的单链，迁移后它的 id 是 'default'——绑定只能指向真实存在的链。
  const request = { sessionId: 'session-remote-test', chain: 'default', retries: { 'stub-primary/stub-model': 5 } }
  const stored = await invoke('setSessionBinding', { request })
  assert.deepEqual(stored, { chain: 'default', retries: { 'stub-primary/stub-model': 5 }, persistent: true })
  const readBack = await invoke('sessionBinding', { sessionId: 'session-remote-test' })
  assert.deepEqual(readBack, { chain: 'default', retries: { 'stub-primary/stub-model': 5 }, persistent: true })
  // "落盘成功才算成功"：真 json 后端把它写进了 home 的 storage 树，重启读的是这份。
  const file = JSON.parse(readFileSync(`${HOME}/storages/model_router_sessions.json`, 'utf8'))
  assert.deepEqual(file.tables.bindings['session-remote-test'],
    { chain: 'default', retries: { 'stub-primary/stub-model': 5 } })
})

test('a zero override is stored as zero, not as "unset"', async () => {
  const request = { sessionId: 'session-remote-zero', chain: null, retries: { 'stub-primary/stub-model': 0 } }
  await invoke('setSessionBinding', { request })
  const readBack = await invoke('sessionBinding', { sessionId: 'session-remote-zero' })
  assert.deepEqual(readBack.retries, { 'stub-primary/stub-model': 0 })
  assert.equal(Object.hasOwn(readBack.retries, 'stub-primary/stub-model'), true)
})

test('setSessionBinding refuses an out-of-range count instead of clamping it', async () => {
  // 静默夹到 9 会让用户以为他写的 10 生效了。原样拒绝。
  await assert.rejects(
    () => invoke('setSessionBinding', {
      request: { sessionId: 'session-remote-bad', chain: null, retries: { 'stub-primary/stub-model': 10 } },
    }),
    /0\.\.9/,
  )
  assert.equal((await invoke('sessionBinding', { sessionId: 'session-remote-bad' })).retries['stub-primary/stub-model'], undefined)
})

test('setSessionBinding accepts a chain the config defines and refuses one it does not', async () => {
  // 这份 overlay 写的是旧形状的单链，迁移后它的 id 是 'default'——所以这条同时钉住
  // "迁移出的链能按 id 绑定"。
  const stored = await invoke('setSessionBinding', { request: { sessionId: 'session-chain', chain: 'default', retries: {} } })
  assert.equal(stored.chain, 'default')
  // 指向不存在的链：路由时会当陈旧绑定处理并改走默认链，所以写入阶段就拒绝，
  // 而不是存下一个永远不生效的选择。
  await assert.rejects(
    () => invoke('setSessionBinding', { request: { sessionId: 'session-chain', chain: 'writing', retries: {} } }),
    /defines no chain 'writing'/,
  )
  assert.equal((await invoke('sessionBinding', { sessionId: 'session-chain' })).chain, 'default',
    'a refused write leaves the previous binding in place')
})

test('probeAll measures a live route: reachable with a TTFT number', async () => {
  const report = await invoke('probeAll', { request: { routes: [{ provider: 'stub-primary', model: 'stub-model' }] } })
  assert.equal(report.routes.length, 1)
  const [route] = report.routes
  assert.equal(route.provider, 'stub-primary')
  assert.equal(route.kind, 'reachable')
  assert.equal(typeof route.latencyMs, 'number')
  assert.ok(route.latencyMs >= 0, `latency ${route.latencyMs} is not a duration`)
  assert.equal(route.error, undefined)
  assert.ok(report.at > 0, 'the report carries its run time')
})

test('probeAll reports a refusing route as unreachable with its code', async () => {
  const report = await invoke('probeAll', { request: { routes: [{ provider: 'stub-third', model: 'stub-model' }] } })
  const [route] = report.routes
  assert.equal(route.kind, 'unreachable')
  assert.equal(route.error, 'RATE_LIMIT')
  assert.equal(route.latencyMs, undefined, 'a route that never answered has no TTFT')
})

test('a scheduled probe runs on its interval and leaves its report readable', async () => {
  // The overlay boots with the probe enabled on a one-second interval, so the
  // Host's own timer must produce a report with no manual call at all — that is
  // the whole point of a scheduled check.
  await new Promise((resolve) => setTimeout(resolve, 2600))
  const report = await invoke('probeReport', {})
  assert.ok(report.routes.length > 0, `the scheduled probe produced no routes (at=${report.at})`)
  const kinds = report.routes.map(route => route.kind)
  assert.ok(kinds.includes('reachable'), `the scheduled probe measured nothing reachable: ${JSON.stringify(report.routes)}`)
  assert.ok(report.at > 0, 'the report carries its run time')
})

test('a manual run leaves its report readable through probeReport', async () => {
  await invoke('probeAll', { request: { routes: [{ provider: 'stub-primary', model: 'stub-model' }] } })
  const report = await invoke('probeReport', {})
  assert.equal(report.routes.length, 1)
  assert.equal(report.routes[0].kind, 'reachable')
})

// ---- the connectivity check, against the real llm runtime ----

test('checkConnectivity reports a route whose discovery lists the model as reachable', async () => {
  const verdicts = await invoke('checkConnectivity', {
    request: { routes: [{ provider: 'stub-answer', model: 'stub-model' }] },
  })
  assert.equal(verdicts.length, 1)
  assert.deepEqual(verdicts[0], { provider: 'stub-answer', model: 'stub-model', kind: 'reachable' })
})

test('checkConnectivity reports an answered endpoint that does not list the model as notAdvertised', async () => {
  const [verdict] = await invoke('checkConnectivity', {
    request: { routes: [{ provider: 'stub-answer', model: 'not-on-the-list' }] },
  })
  assert.equal(verdict.kind, 'notAdvertised')
  assert.equal(verdict.advertised, 2, 'the count is what the endpoint actually advertised')
})

test('checkConnectivity reads a configurable provider with no registered discovery as unavailable', async () => {
  // The real NO_DISCOVERY path, from the real registry: the provider is in the
  // directory, so it is configurable and usable, and `discoverModels` still
  // refuses because nothing registered a discovery for its namespace
  // (packages/llm/llm/src/index.ts:596). Reporting that as "the endpoint did
  // not answer" accuses an endpoint that was never contacted — which is exactly
  // what `deepseek-official` used to show on the isolated home.
  const [verdict] = await invoke('checkConnectivity', {
    request: { routes: [{ provider: 'stub-no-discovery', model: 'stub-model' }] },
  })
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'noDiscovery')
  assert.equal(verdict.error, 'NO_DISCOVERY')
  assert.equal(verdict.advertised, undefined)
})

test('checkConnectivity reads a provider with no directory entry as unavailable', async () => {
  // `stub-primary` has an adapter and no configurable-provider declaration, so
  // there is no settings namespace to interrogate and no discovery is asked.
  const [verdict] = await invoke('checkConnectivity', {
    request: { routes: [{ provider: 'stub-primary', model: 'stub-model' }] },
  })
  assert.equal(verdict.kind, 'unavailable')
  assert.equal(verdict.reason, 'notConfigurable')
})

test('checkConnectivity keeps a discovery that really ran and refused unreachable', async () => {
  // The reverse boundary, on the real registry: this discovery was invoked and
  // raised `AUTH`. It is the channel's own answer about this route, so it stays
  // a fault — the closed set is per code, not a blanket downgrade.
  const [verdict] = await invoke('checkConnectivity', {
    request: { routes: [{ provider: 'stub-refuse', model: 'stub-model' }] },
  })
  assert.equal(verdict.kind, 'unreachable')
  assert.equal(verdict.error, 'AUTH')
})

test('checkConnectivity answers every requested route in one call', async () => {
  const verdicts = await invoke('checkConnectivity', {
    request: { routes: [
      { provider: 'stub-answer', model: 'stub-model' },
      { provider: 'stub-refuse', model: 'stub-model' },
      { provider: 'stub-no-discovery', model: 'stub-model' },
      { provider: 'stub-primary', model: 'stub-model' },
    ] },
  })
  assert.deepEqual(verdicts.map(verdict => verdict.kind),
    ['reachable', 'unreachable', 'unavailable', 'unavailable'])
  // One verdict per requested route, keyed the way the browser half keys them.
  assert.deepEqual(verdicts.map(verdict => `${verdict.provider}/${verdict.model}`),
    ['stub-answer/stub-model', 'stub-refuse/stub-model', 'stub-no-discovery/stub-model', 'stub-primary/stub-model'])
})

test('a per-route probe prompt override reaches the wire, and the shared prompt covers the rest', async () => {
  // The overlay configures one override; this asserts the Host actually used it
  // — a config field nobody reads is the same as a field that does not exist.
  await invoke('probeAll', { request: { routes: [
    { provider: 'stub-primary', model: 'stub-model' },
    { provider: 'stub-third', model: 'stub-model' },
  ] } })
  const stub = await import(pathToFileURL(`${HERE}stub-adapter.mjs`).href)
  const overridden = stub.lastRequestByRoute.get('stub-primary')
  const shared = stub.lastRequestByRoute.get('stub-third')
  assert.equal(overridden?.text, 'override prompt', 'the override prompt was sent for its route')
  assert.equal(shared?.text, 'shared prompt', 'the route without an override got the shared prompt')
  assert.equal(overridden?.maxTokens, 1, 'the probe asks for one token, so the cost stays bounded')
})

// ---- 接管不再碰 DSH 的默认模型 ----
// 2026-10-19 之前，开启接管会把新会话默认模型写成"主模型"（走 agentDefaultModel.
// saveSelection）。产品形态改成"一条全局降级链"之后没有主模型了，插件也因此不再
// 写 DSH 的全局配置。这条钉住那个反向事实：默认模型是用户自己的选择，插件只影响
// 失败之后走哪，不影响新会话从哪个模型开始。

test('takeover leaves DSH own default model alone', async () => {
  const face = ctx.get('agentDefaultModel')
  const before = face.currentSelection()
  // 这个组合没有 patch agent-default-model，所以它是 bundle 的默认值；这里不断言
  // 具体是哪一条，只断言插件没有改它。
  const routes = (await invoke('probeAll', { request: { routes: [{ provider: 'stub-primary', model: 'stub-model' }] } })).routes
  assert.equal(routes[0].kind, 'reachable', 'the plugin is loaded and serving its Remote')
  assert.deepEqual(face.currentSelection(), before,
    'routing must not rewrite the user default model — that choice belongs to the user')
})

await Promise.all(pending)
console.log(`\n${passed} remote test(s) passed`)

// DSH 包规则的硬要求："注册贡献须证明可 Dispose"（HMR 测试）。放在所有用例 settle
// 之后：这些用例共享一个 boot 好的 ctx，中途 dispose 会把别人的 gateway 抽掉。
// 断言宿主侧最可观测的那条——定时探测周期到点会自己跑（上面已验证），fiber 卸载后
// 必须停：否则配置保存（fiber 整体重启）会叠加定时器，旧周期继续花用户的 token。
// 判据是 stub 的真实调用计数：卸载前后各跨过一个周期，计数只允许在卸载前增长。
{
  const stub = await import(pathToFileURL(`${HERE}stub-adapter.mjs`).href)
  const before = stub.realCallCount()
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.ok(stub.realCallCount() > before, 'the scheduled timer keeps probing while the plugin is loaded')
  await ctx.fiber.dispose()
  const atDispose = stub.realCallCount()
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(stub.realCallCount(), atDispose, 'no probe runs after the fiber unloaded')
  console.log('    ok  unloading the plugin stops its scheduled probe timer')
  passed += 1
}

