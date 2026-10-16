/**
 * Build pipeline for dsh-model-router.
 *
 * DSH's shared client-bundle preset lives in packages/client/tsdown.client.ts,
 * which is not part of any published package, so a package outside that
 * repository reproduces the build itself
 * (docs/cookbook/adding-a-settings-card.md:60 — "a package outside this
 * repository reproduces that build itself"). The preset is also absent the
 * Typert generator: clientLibraryConfig carries no plugins
 * (packages/client/tsdown.client.ts:220-248), so the plugin is added here
 * explicitly, in `package` mode, which emits only this package's host face
 * (packages/typert/generator/src/tsdown-plugin.ts:43,72-93).
 *
 * Two artifacts, one build:
 *   - lib/index.js — the Node half, bundled from src/index.ts. Production and
 *     peer dependencies stay imports so the running host resolves the same
 *     module instances it mounted (the same externality rule as
 *     packages/client/tsdown.client.ts:237-245).
 *   - lib/client.js — the browser half, bundled from src/client/index.ts into
 *     the client module system's lazy-CJS factory format: the banner registers
 *     the package name with `window.__ModuleLoader__`, the footer returns
 *     module.exports, and every platform module stays a `require` the loader's
 *     module table answers (the baseline is packages/client/web/src/platform.ts:8-14;
 *     `dsh.client.external` would add package-specific rows, and this package
 *     declares none).
 *   - lib/typert.host.js (+ .d.ts) — the generated host-face contribution the
 *     typert loader registers from exports["./typert"]
 *     (packages/typert/loader/src/index.ts:40).
 *
 * Declarations are emitted by `tsc -p tsconfig.json` in scripts.bundle, before
 * tsdown runs; dts stays off here for the same reason DSH keeps it off
 * (packages/client/tsdown.client.ts:234).
 *
 * Note: 构建取舍（单段式、自复刻 clientBundle、package 模式 typert、根
 * tsconfig.host.json 作 workspace 标记、@typert 表面取舍）—— 见
 * .agents/notes/implemented/2026-10-15-out-of-tree-build-pipeline.md
 * Note: 客户端半包拆模块与客户端构建复刻 —— 见
 * .agents/notes/implemented/2026-10-15-client-half-module-split.md
 */

import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { defineConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Plugin id: the package name, stamped onto the loader row and the client bundle. */
const id = 'dsh-model-router'

interface PluginManifest {
  readonly name: string
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as PluginManifest

/**
 * Specifiers the Node half keeps as imports: this package's own production
 * sections, subpaths included. Everything else inlines, exactly as
 * clientLibraryConfig states both halves
 * (packages/client/tsdown.client.ts:237-245).
 */
const externals = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
])

/**
 * The browser half's module-table baseline: the shell seeds these specifiers,
 * so a client bundle keeps them as `require` calls instead of inlining a second
 * copy of React or a UI library (packages/client/web/src/platform.ts:8-14).
 * `dsh.client.external` adds package-specific rows; this package declares none.
 */
const clientModules = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

export default defineConfig([
  {
    name: id,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    // DSH's own root tsdown target; the host half uses `using` with the
    // disposable deadline, which es2024 carries natively on Node 24.
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => isBuiltin(specifier) || externals.has(specifier),
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !externals.has(specifier),
    },
    plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
  },
  {
    name: `${id}/client`,
    entry: { client: 'src/client/index.ts' },
    // The browser bundle lands next to the node half; entryFileNames pins it to
    // exactly lib/client.js, which is what exports["./client"] serves
    // (packages/client/tsdown.client.ts:478-484). clean stays off — a default
    // clean would wipe the node-half output written above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => clientModules.has(specifier),
      // Anything not in the module table inlines; a require() the table cannot
      // answer is a guaranteed runtime throw (packages/client/tsdown.client.ts:490-498).
      alwaysBundle: (specifier: string) => !clientModules.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      // The factory registration the client module system expects: one script
      // that registers the package name and its factory(require)
      // (packages/client/modules/README.md, "Lazy-CJS model").
      banner: (chunk) => {
        const registration = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`
        return registration
      },
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
