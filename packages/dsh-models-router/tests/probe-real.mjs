/**
 * Probe every model in the local real-provider credentials file with one tiny
 * chat-completions call, and classify the outcome: ok / http-error / timeout /
 * connection-error. Read-only reconnaissance for the real-provider failover
 * test — the credentials file is gitignored, this script carries no secrets.
 *
 *   node packages/dsh-models-router/tests/probe-real.mjs [timeoutMs] [--ua]
 *
 * `--ua` sends a browser User-Agent: the gateway rejects some requests without
 * one, so the two runs answer different questions — what a bare client sees
 * (DSH's posture) versus what a browser-like client sees.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const credPath = path.join(here, 'real-providers.local.json')
const args = process.argv.slice(2)
const withUA = args.includes('--ua')
const timeoutMs = Number(args.find(a => /^\d+$/.test(a)) ?? 20_000)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...withUA === true ? { 'user-agent': UA } : {},
      },
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
  console.log(`\n== ${channel.id}  ${channel.baseURL}  (${withUA === true ? 'with browser UA' : 'no UA'})`)
  for (const model of channel.models) {
    const result = await probeOne(channel.baseURL, channel.apiKey, model)
    console.log(`  ${model.padEnd(28)} ${result.verdict.padEnd(18)} ${String(result.ms).padStart(6)}ms  ${result.detail}`)
  }
}
