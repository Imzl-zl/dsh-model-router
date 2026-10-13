/**
 * Probe every model in the local real-provider credentials file with one tiny
 * chat-completions call, and classify the outcome: ok / http-error / timeout /
 * connection-error. Read-only reconnaissance for the real-provider failover
 * test — the credentials file is gitignored, this script carries no secrets.
 *
 *   node packages/dsh-model-router/tests/probe-real.mjs [timeoutMs]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const credPath = path.join(here, 'real-providers.local.json')
const timeoutMs = Number(process.argv[2] ?? 20_000)

let creds
try {
  creds = JSON.parse(readFileSync(credPath, 'utf8'))
} catch {
  console.error(`no credentials at ${credPath} — create it first (gitignored)`)
  process.exit(2)
}

async function probeOne(baseURL, apiKey, model) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'reply with the single word OK' }], max_tokens: 16, stream: false }),
      signal: controller.signal,
    })
    const ms = Date.now() - started
    const text = await response.text()
    if (!response.ok) {
      let detail = text.slice(0, 160)
      try {
        const parsed = JSON.parse(text)
        detail = String(parsed.error?.message ?? parsed.message ?? detail).slice(0, 160)
      } catch { /* non-JSON error body */ }
      return { verdict: `http-${response.status}`, ms, detail }
    }
    let content = ''
    try {
      content = String(JSON.parse(text).choices?.[0]?.message?.content ?? '').slice(0, 60)
    } catch { /* non-JSON success body */ }
    return { verdict: 'ok', ms, detail: content }
  } catch (error) {
    const ms = Date.now() - started
    if (error instanceof Error && error.name === 'AbortError') return { verdict: 'timeout', ms, detail: `no response in ${timeoutMs}ms` }
    return { verdict: 'connection-error', ms, detail: String(error?.cause?.code ?? error?.message ?? error).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

for (const channel of creds.channels) {
  console.log(`\n== ${channel.id}  ${channel.baseURL}`)
  for (const model of channel.models) {
    const result = await probeOne(channel.baseURL, channel.apiKey, model)
    console.log(`  ${model.padEnd(28)} ${result.verdict.padEnd(18)} ${String(result.ms).padStart(6)}ms  ${result.detail}`)
  }
}
