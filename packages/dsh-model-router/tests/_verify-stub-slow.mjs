/**
 * TEMPORARY slow-backoff copy of stub-adapter.mjs for finding I1 — not part of
 * the suite. Identical except the backoff is 3000ms so llm-retry's wait is
 * measurable instead of the 1ms the suite uses to keep wall time down.
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
export const lastRequestByRoute = new Map()

export function realCallCount() {
  let total = 0
  for (const count of callsByRoute.values()) total += count
  return total
}

const DEFAULT_RETRYABLE = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']
const policy = script.policy?.mode === 'always'
  ? resolveRetryPolicy(
    { mode: 'always', backoff: { initialDelayMs: 3000, maxDelayMs: 3000, jitterRatio: 0 } },
    'stub-adapter.retryPolicy',
  )
  : resolveRetryPolicy(
    {
      mode: 'normal',
      maxRetries: script.policy?.maxRetries ?? 5,
      retryableCodes: script.policy?.retryableCodes ?? DEFAULT_RETRYABLE,
      backoff: { initialDelayMs: 3000, maxDelayMs: 3000, jitterRatio: 0 },
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

export const name = 'stub-adapter'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter(['stub-primary', 'stub-backup', 'stub-third'], new StubAdapter())
}
