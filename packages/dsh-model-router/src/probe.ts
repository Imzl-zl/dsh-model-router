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
 */

import type { GenerateOptions, LlmCallConfig, PreparedLlmCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ProbeRoute, ProbeRouteResult } from './types.ts'

/** The llm face the probe needs: prepare once, stream once, read the head. */
export interface ProbeLlm {
  prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>
}

/** Timeout code stamped on the probe's deadline, read back through `timeoutOf`. */
export const PROBE_TIMEOUT_CODE = 'router/probe-timeout'

/** A failure the probe could not even start: the route is not callable here. */
function unavailable(route: ProbeRoute, now: number, reason: string): ProbeRouteResult {
  return { provider: route.provider, model: route.model, kind: 'unavailable', error: reason, at: now }
}

/**
 * Probe one route: send the minimal message, stop at the first content byte.
 *
 * @param llm - the Host llm service (injected so unit tests can supply a fake).
 * @param route - the physical route to measure.
 * @param prompt - the message text; the user owns it because gateways filter content.
 * @param timeoutMs - hard cap per route; the deadline fires even without a first byte.
 * @param signal - the caller's cancellation, fused into the deadline.
 * @returns the route's outcome; an adapter error becomes `unreachable` carrying
 *   its provider-neutral code, a timeout becomes `unreachable` with
 *   {@link PROBE_TIMEOUT_CODE}, and a call that could not be assembled becomes
 *   `unavailable` — which the UI must not read as a fault.
 */
export async function probeRoute(
  llm: ProbeLlm,
  route: ProbeRoute,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProbeRouteResult> {
  const now = Date.now()
  const started = now
  // Cancellation and timeout are fused by hand rather than with the disposable
  // `deadline()` primitive: `using` is syntax the source-mode loader cannot
  // parse, and this module must load from source in the headless composition.
  const controller = new AbortController()
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onUpstreamAbort = (): void => { abort(signal?.reason) }
  if (signal !== undefined) {
    if (signal.aborted) abort(signal.reason)
    else signal.addEventListener('abort', onUpstreamAbort, { once: true })
  }
  const timer = setTimeout(() => { abort(new TimeoutError(PROBE_TIMEOUT_CODE, timeoutMs * 1000)) }, timeoutMs * 1000)
  try {
    const call = await llm.prepareCall({
      provider: route.provider,
      model: route.model,
      maxTokens: 1,
    }, controller.signal)
    const options: GenerateOptions = {
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 1,
      signal: controller.signal,
    }
    for await (const chunk of call.stream(options)) {
      // The first content byte is the measurement: TTFT. The stream is
      // abandoned here — that abandonment is what keeps the cost at one token.
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        return { provider: route.provider, model: route.model, kind: 'reachable', latencyMs: Date.now() - started, at: now }
      }
      if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
        return { provider: route.provider, model: route.model, kind: 'unreachable', error: chunk.reason.failure.code, at: now }
      }
    }
    // The stream ended without content and without an error finish: nothing to
    // measure, and nothing that says the channel is sick either.
    return unavailable(route, now, 'empty stream')
  } catch (error) {
    // The timeout is classified apart from the caller's abort: one is a fact
    // about the channel, the other is the caller hanging up.
    if (controller.signal.aborted && controller.signal.reason instanceof TimeoutError) {
      return { provider: route.provider, model: route.model, kind: 'unreachable', error: 'TIMEOUT', at: now }
    }
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      return { provider: route.provider, model: route.model, kind: 'unreachable', error: code, at: now }
    }
    if (signal?.aborted === true) return unavailable(route, now, 'cancelled')
    return unavailable(route, now, error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onUpstreamAbort)
  }
}

/** The probe's own timeout reason, so a timeout reads apart from a caller abort. */
class TimeoutError extends Error {
  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`probe timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

/** The prompt one route is probed with: its own override, else the shared default. */
export function probePromptFor(
  route: ProbeRoute,
  fallback: string,
  overrides: readonly { route: string; prompt: string }[],
): string {
  const key = `${route.provider}/${route.model}`
  const own = overrides.find(entry => entry.route === key)
  return own?.prompt ?? fallback
}
