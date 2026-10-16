/**
 * Deterministic provider adapter for the router composition tests.
 *
 * Behavior is driven by `stub-script.json` next to this file, which the runner
 * rewrites per scenario:
 *
 *   {
 *     "policy": { "retryableCodes": ["RATE_LIMIT"], "maxRetries": 5 },
 *     "stub-primary":  { "outcomes": ["fail:RATE_LIMIT", "ok"], "model": { "reasoning": { "efforts": [{ "id": "high", "name": "高" }] } } },
 *     "stub-backup":   { "outcomes": ["ok"] }
 *   }
 *
 * `outcomes` is consumed one entry per real (non-auxiliary) call; the last entry
 * repeats. Two spike lessons are baked in: auxiliary calls (`options.purpose`
 * set — session title, compaction) never consume the script, and the retry
 * policy uses 1ms backoff so llm-retry's waits do not dominate wall time.
 */

import { readFileSync } from 'node:fs'
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'

const SCRIPT_URL = new URL('./stub-script.json', import.meta.url)

function readScript() {
  try {
    return JSON.parse(readFileSync(SCRIPT_URL, 'utf8'))
  } catch {
    return {}
  }
}

const script = readScript()
const callsByRoute = new Map()
/** The last request each route received, so tests can assert what was actually sent. */
export const lastRequestByRoute = new Map()

/**
 * Real (non-auxiliary) calls each route has served. The HMR test reads it to prove
 * the host's scheduled probe timer stops when the plugin fiber unloads.
 * @returns total real calls across every registered stub route.
 */
export function realCallCount() {
  let total = 0
  for (const count of callsByRoute.values()) total += count
  return total
}

const DEFAULT_RETRYABLE = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']
// `mode` comes from the script so scenarios can declare the `always` policy the
// plugin must reject at load (llm/src/retry-policy.ts: always has no retry cap).
const policy = script.policy?.mode === 'always'
  ? resolveRetryPolicy(
    { mode: 'always', backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } },
    'stub-adapter.retryPolicy',
  )
  : resolveRetryPolicy(
    {
      mode: 'normal',
      maxRetries: script.policy?.maxRetries ?? 5,
      retryableCodes: script.policy?.retryableCodes ?? DEFAULT_RETRYABLE,
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    },
    'stub-adapter.retryPolicy',
  )

class StubAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider }
  }

  providerRetryPolicy() {
    return policy
  }

  async listModels(provider) {
    return [{ provider, id: 'stub-model', name: 'Stub Model' }]
  }

  resolveModel(provider, model) {
    const meta = script[provider]?.model ?? {}
    return Promise.resolve({ provider, id: model, name: model, ...meta })
  }

  async *stream(options) {
    const route = options.provider
    const promptText = (options.messages ?? [])
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    lastRequestByRoute.set(route, { text: promptText, maxTokens: options.maxTokens })
    if (options.purpose !== undefined) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'STUB_AUX_OK' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'STUB_AUX_OK' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const outcomes = script[route]?.outcomes ?? ['ok']
    const attempt = (callsByRoute.get(route) ?? 0) + 1
    callsByRoute.set(route, attempt)
    const outcome = outcomes[Math.min(attempt - 1, outcomes.length - 1)]
    if (outcome.startsWith('fail:')) {
      throw new LlmError(`stub ${route} failure ${attempt}`, outcome.slice(5))
    }
    const text = `STUB_OK:${route}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin name. */
export const name = 'stub-adapter'
/** Required LLM registry service. */
export const inject = ['llm']

/**
 * Register the stub on every route the scenarios use.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the LLM service.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['stub-primary', 'stub-backup', 'stub-third'], new StubAdapter())
}
