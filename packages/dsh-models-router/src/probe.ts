/**
 * The active end-to-end probe: one minimal message per physical route, cut at
 * the first content byte.
 *
 * This is the tier the connectivity check cannot replace. `discoverModels`
 * proves the endpoint answers and lists the model; it proves nothing about
 * whether a completion can actually be produced — a gateway can serve a model
 * list and still fail every generation. So the probe sends the user's prompt
 * with `maxTokens: 1` and stops at the first content byte: the measurement is
 * time-to-first-token, and the token cost is bounded by that stop.
 *
 * The execution follows DSH's own auxiliary-call pattern
 * (packages/session/session-title-llm/src/index.ts:230-285): `deadline()` fuses
 * the caller's cancellation with the per-route timeout, and the streamed
 * options spread the prepared call config — a hand-assembled request fails
 * `INVALID_PREPARED_CALL` because adapter-materialized fields would mismatch.
 *
 * The probe never runs on a schedule by itself: the interval is user config and
 * defaults to 0 (off). That is deliberate — a probe spends tokens on every tick,
 * and how often that is acceptable is the user's call, not the plugin's.
 *
 * Note: 取舍与被否方案（为何 TTFT 即停、为何不测算吞吐、定时器归属、为何不进
 * 会话投影）—— 见 .agents/notes/implemented/2026-10-15-plugin-remote-probe.md
 * Note: finish 分支为何必须放开 aborted、分类为何按"谁按的"—— 见
 * .agents/notes/implemented/2026-10-17-failure-classification-tiers.md
 */

import type { GenerateOptions, LlmCallConfig, PreparedLlmCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ProbeRoute, ProbeRouteResult } from './types.ts'
import { fuseDeadline } from './deadline.ts'
import { routeKeyOf } from './routes.ts'

/** The llm face the probe needs: prepare once, stream once, read the head. */
export interface ProbeLlm {
  prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>
}

/** A failure the probe could not even start: the route is not callable here. */
function unavailable(route: ProbeRoute, now: number, reason: string): ProbeRouteResult {
  return { provider: route.provider, model: route.model, kind: 'unavailable', error: reason, at: now }
}

/**
 * DSH failure codes that mean the Host could not place a call at all.
 *
 * None of these is an endpoint refusing a request — no request exists:
 *
 * - `NO_ADAPTER`: no adapter is registered for the provider, so
 *   `prepareCall` refuses before anything is assembled
 *   (`packages/llm/llm/src/index.ts:995`).
 * - `MISSING_CREDENTIAL`: the route resolves no credential, raised while the
 *   adapter builds auth, before the request is sent
 *   (`llm-deepseek-api-key/src/index.ts:30`, `llm-pi-ai/src/index.ts:200`).
 * - `INVALID_CREDENTIAL`: the stored credential is present but unusable —
 *   blank, or carrying characters no HTTP header can — raised by
 *   `assertUsableApiKey` before the header is built
 *   (`llm/src/index.ts:151`). `llm-pi-ai/src/discovery.ts:240` states the
 *   reason outright: without it, "the `fetch` below would throw ... blaming
 *   the network for a local, deterministic fault".
 *
 * `types.ts` reserves `unreachable` for "the call was made and the endpoint,
 * the credential, or the model refused it", so all three belong to
 * `unavailable`. `classifyHealth` in ./health.ts already agrees from the other
 * side: each returns `undefined` there, i.e. none of them indicts the channel.
 *
 * The set is deliberately closed. A code that names a request-shape problem
 * (`UNSUPPORTED_REASONING_EFFORT`, `INVALID_PREPARED_CALL`) is a fact about the
 * plugin's own assembly rather than about the channel and is left for its own
 * round; folding one in here would start reporting a real fault as "could not
 * measure", which is the same lie in the other direction.
 *
 * Note: 划线与被否方案 —— 见
 * .agents/notes/implemented/2026-10-16-probe-unavailable-means-never-called.md
 */
const NEVER_CALLED_CODES: ReadonlySet<string> = new Set([
  'NO_ADAPTER',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
])

/**
 * Probe one route: send the minimal message, stop at the first content byte.
 *
 * @param llm - the Host llm service (injected so unit tests can supply a fake).
 * @param route - the physical route to measure.
 * @param prompt - the message text; the user owns it because gateways filter content.
 * @param timeoutSeconds - hard cap per route; the deadline fires even without a first byte.
 * @param signal - the caller's cancellation, fused into the deadline.
 * @returns the route's outcome; an adapter error becomes `unreachable` carrying
 *   its provider-neutral code — unless the code says the call could not be
 *   placed at all (see {@link NEVER_CALLED_CODES}), which is `unavailable` — a
 *   timeout becomes `unreachable` with the provider-neutral `TIMEOUT` code, and a call
 *   that could not be assembled becomes `unavailable` — which the UI must not
 *   read as a fault.
 */
export async function probeRoute(
  llm: ProbeLlm,
  route: ProbeRoute,
  prompt: string,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<ProbeRouteResult> {
  const now = Date.now()
  const started = now
  // Cancellation and the timeout are fused in one place (./deadline.ts), and the
  // order inside it is the classification this module leans on: our own deadline
  // is a fact about the channel, the caller hanging up is not.
  const deadline = fuseDeadline(signal, timeoutSeconds)
  try {
    const call = await llm.prepareCall({
      provider: route.provider,
      model: route.model,
      maxTokens: 1,
    }, deadline.signal)
    const options: GenerateOptions = {
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 1,
      signal: deadline.signal,
    }
    for await (const chunk of call.stream(options)) {
      // The first content byte is the measurement: TTFT. The stream is
      // abandoned here — that abandonment is what keeps the cost at one token.
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        return { provider: route.provider, model: route.model, kind: 'reachable', latencyMs: Date.now() - started, at: now }
      }
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        // Both delivery shapes land here: `adapterStream` converts an adapter
        // throw into an in-band finish, and an abort produces `kind:'aborted'`
        // — the probe's own deadline or the caller's cancellation, whichever
        // fired (`llm/src/index.ts:1161-1169`). Classifying only
        // `kind:'error'` sent the whole abort family to the "empty stream"
        // branch below, so a hung endpoint read as "could not measure"
        // instead of "did not answer".
        //
        // The order is the same one the catch branch below uses, and for the
        // same reason: one fact must not be classified differently depending
        // on which side of the adapter it arrives from.
        // 1. The probe's own deadline: a fact about the channel.
        if (deadline.expired()) {
          return { provider: route.provider, model: route.model, kind: 'unreachable', error: 'TIMEOUT', at: now }
        }
        // 2. The caller hanging up is not the channel's doing — and the
        //    adapter normalizes a caller abort into the `ABORTED` code, so the
        //    code alone cannot tell the two apart.
        if (signal?.aborted === true) return unavailable(route, now, 'cancelled')
        const code = chunk.reason.failure.code
        if (code === 'ABORTED') return unavailable(route, now, 'cancelled')
        // 3. A failure the adapter hit while *building* the request arrives
        //    here rather than as a throw (llm/src/index.ts:1113,1161). A
        //    missing credential never reaches the wire, so it must not read
        //    as the channel refusing a call.
        if (NEVER_CALLED_CODES.has(code)) return unavailable(route, now, code)
        return { provider: route.provider, model: route.model, kind: 'unreachable', error: code, at: now }
      }
    }
    // The stream ended without content and without an error finish: nothing to
    // measure, and nothing that says the channel is sick either.
    return unavailable(route, now, 'empty stream')
  } catch (error) {
    // The timeout is classified apart from the caller's abort: one is a fact
    // about the channel, the other is the caller hanging up.
    if (deadline.expired()) {
      return { provider: route.provider, model: route.model, kind: 'unreachable', error: 'TIMEOUT', at: now }
    }
    // 调用方取消不是渠道故障——必须在通用 code 之前判：适配器会把调用方 abort
    // 规范化成 `ABORTED` 码（llm-deepseek/src/adapter.ts:64、llm-pi-ai 同款），
    // 走通用分支就会以 unreachable 落进报告，UI 把"没能测"读成"有问题"。
    if (signal?.aborted === true) return unavailable(route, now, 'cancelled')
    const code = (error as { code?: unknown }).code
    if (code === 'ABORTED') return unavailable(route, now, 'cancelled')
    // 同一个边界，从抛出这一侧再过一遍：没注册适配器的 provider 是
    // `prepareCall` 直接拒绝的（llm/src/index.ts:995），报告成 unreachable
    // 就等于说"渠道拒了一次从未发生的调用"。
    if (typeof code === 'string' && NEVER_CALLED_CODES.has(code)) return unavailable(route, now, code)
    if (typeof code === 'string' && code.length > 0) {
      return { provider: route.provider, model: route.model, kind: 'unreachable', error: code, at: now }
    }
    return unavailable(route, now, error instanceof Error ? error.message : String(error))
  } finally {
    deadline.dispose()
  }
}

/** The prompt one route is probed with: its own override, else the shared default. */
export function probePromptFor(
  route: ProbeRoute,
  fallback: string,
  overrides: readonly { route: string; prompt: string }[],
): string {
  const key = routeKeyOf(route.provider, route.model)
  const own = overrides.find(entry => entry.route === key)
  return own?.prompt ?? fallback
}
