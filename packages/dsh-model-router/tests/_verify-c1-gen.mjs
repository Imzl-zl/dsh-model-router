#!/usr/bin/env node
/**
 * TEMPORARY revert experiment for finding C1 — not part of the suite.
 *
 * A copy of tests/unit.mjs whose `neverEnding` fake (unit.mjs:1056-1061) is
 * reshaped to what a REAL adapter does on abort: yield an in-band
 * `{type:'finish', reason:{kind:'aborted', failure:{code:'ABORTED'}}` instead of
 * rejecting. DSH's own spec pins that shape for both adapters
 * (llm-pi-ai/tests/adapter.spec.ts:1052-1067, llm-deepseek/tests/runtime.spec.ts:1564)
 * and `adapterStream` produces it (llm/src/index.ts:1113,1165-1167).
 *
 * If `probeRoute times out as unreachable, never as a silent hang` (unit.mjs:1098)
 * survives the reshape, the fake was hiding the production path. If it goes red,
 * the audit's claim holds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(`${HERE}unit.mjs`, 'utf8')

const original = `const neverEnding = (signal) => (async function* () {
  await new Promise((_resolve, reject) => {
    if (signal?.aborted === true) reject(signal.reason)
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
})()`

const reshaped = `const neverEnding = (signal) => (async function* () {
  await new Promise((resolve) => {
    if (signal?.aborted === true) resolve()
    else signal?.addEventListener('abort', () => resolve(), { once: true })
  })
  // The real adapter's abort shape: adapterStream catches the adapter's
  // ABORTED throw and yields it in band as an "aborted" finish
  // (llm/src/index.ts:1113,1165-1167) — it does NOT propagate a rejection.
  yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } }
})()`

if (!source.includes(original)) throw new Error('fixture drift: neverEnding no longer matches unit.mjs:1056-1061')
writeFileSync(`${HERE}_verify-c1-unit.mjs`, source.replace(original, reshaped), 'utf8')
console.log('wrote _verify-c1-unit.mjs (neverEnding reshaped to the real adapter abort shape)')
