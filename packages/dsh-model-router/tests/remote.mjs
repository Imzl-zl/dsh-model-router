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
 * Usage: node packages/dsh-model-router/tests/remote.mjs
 * Requires `npm run bundle` in the package directory first.
 */

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
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
const PKG = `${ROOT}packages/dsh-model-router`
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
        profiles: []
        default:
          enabled: false
          candidates:
            - { provider: stub-primary, model: stub-model, maxAttempts: 1 }
            - { provider: stub-third, model: stub-model, maxAttempts: 1 }
          switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
          maxTotalAttempts: 3
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
      - dsh-model-router
`
writeFileSync(`${HERE}remote-overlay.yml`, overlay)

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
  assert.equal(artifact.TYPERT.package, 'dsh-model-router')
  validateTypertManifest('dsh-model-router', artifact.TYPERT)
  const ids = artifact.TYPERT.invocations.map(invocation => invocation.id)
  assert.deepEqual(ids, [
    'dsh-model-router#routerHealth/checkConnectivity',
    'dsh-model-router#routerHealth/probeAll',
    'dsh-model-router#routerHealth/probeReport',
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
  assert.equal(contribution.package, 'dsh-model-router')
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
