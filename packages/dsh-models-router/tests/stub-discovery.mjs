/**
 * A discovery-only provider plugin for the Remote dispatch tests.
 *
 * The router's own stub adapter registers adapters and nothing else, so it can
 * exercise `NO_DISCOVERY` (a configurable provider whose namespace has no
 * registered discovery — the whole DeepSeek family's shape,
 * packages/llm/llm-deepseek/src/host.ts:55) but not the reverse boundary: a
 * discovery that really ran and refused. That needs a namespace with a
 * registered discovery, so it lives here rather than in the shared adapter
 * stub — the Loader composition suite mounts that one and must stay untouched.
 *
 * Three shapes, all real DSH registry entries:
 *   - `stub-answering` / `stub-answer`: a discovery that lists a model.
 *   - `stub-refusing` / `stub-refuse`: a discovery that raises `LlmError('AUTH')`
 *     after the runtime invoked it.
 *   - `stub-no-discovery` / (no discovery): in the directory, no discovery
 *     registered, so `discoverModels` raises `NO_DISCOVERY`.
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name. */
export const name = 'stub-discovery'
/** Required LLM registry service. */
export const inject = ['llm']

/**
 * Register the three shapes against the live llm runtime.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the LLM service.
 */
export function apply(ctx) {
  ctx.llm.registerConfigurableProviders([
    { provider: 'stub-answer', displayName: 'Answering', settingsNs: 'stub-answer', settingsPath: [] },
    { provider: 'stub-refuse', displayName: 'Refusing', settingsNs: 'stub-refuse', settingsPath: [] },
    { provider: 'stub-no-discovery', displayName: 'No Discovery', settingsNs: 'stub-no-discovery', settingsPath: [] },
  ])
  ctx.llm.registerModelDiscovery('stub-answer', () => Promise.resolve([
    { id: 'stub-model', name: 'Stub Model' },
    { id: 'stub-other', name: 'Stub Other' },
  ]))
  ctx.llm.registerModelDiscovery('stub-refuse', () => {
    throw new LlmError('stub discovery refused the listing', 'AUTH')
  })
  // `stub-no-discovery` deliberately has none: `LlmRuntime.discoverModels`
  // raises NO_DISCOVERY for it (packages/llm/llm/src/index.ts:596).
}
