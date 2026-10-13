/**
 * Channel Health Monitoring and Proactive Probing for dsh-model-router.
 *
 * Implements a dual-engine health system:
 *
 * 1. Passive zero-cost observation:
 *    Chat requests passing through DSH naturally reflect channel health.
 *    Successes mark the candidate healthy and update latency; failures
 *    from `assistant/attempt` and `agent/request-error` mark the candidate
 *    degraded (RATE_LIMIT) or unhealthy (SERVER, TIMEOUT, TRANSPORT).
 *    Zero extra tokens or API costs are incurred.
 *
 * 2. Active minimal-token probe:
 *    On-demand or scheduled pinging using `ctx.llm.stream()` with `maxTokens: 1`.
 *    The probe aborts immediately upon receiving the first token (TTFT),
 *    verifying network connectivity, credentials, and upstream health
 *    without generating full responses. Customizable prompt avoids
 *    provider content filter/banned word rejections.
 *
 * Follows the project military rule:
 * "不将 provider 重试、跨渠道 failover 和跨请求健康状态混成同一个次数或状态。"
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

export type ChannelHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

export const MAX_TIMELINE_POINTS = 24

export interface ChannelTimelinePoint {
  time: number
  status: ChannelHealthStatus
  latencyMs?: number
  throughputTps?: number
  error?: string
}

export interface ChannelHealthRecord {
  route: string
  provider: string
  model: string
  status: ChannelHealthStatus
  latencyMs?: number
  throughputTps?: number
  availabilityPct?: number
  lastError?: string
  lastCheckedAt: number
  source: 'passive' | 'active'
  timeline?: ChannelTimelinePoint[]
}

/** Route string formatted as `provider/model`. */
export function routeKeyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** Classify failure code to health status. */
export function classifyHealth(code: string): 'degraded' | 'unhealthy' {
  if (code === 'RATE_LIMIT') return 'degraded'
  return 'unhealthy'
}

/** Helper to append timeline point and recalculate availability. */
export function pushTimelinePoint(
  existingTimeline: readonly ChannelTimelinePoint[] | undefined,
  point: ChannelTimelinePoint,
): { timeline: ChannelTimelinePoint[]; availabilityPct: number } {
  const current = existingTimeline ? existingTimeline.slice() : []
  current.push(point)
  const sliced = current.length > MAX_TIMELINE_POINTS ? current.slice(-MAX_TIMELINE_POINTS) : current
  const healthyCount = sliced.filter(p => p.status === 'healthy').length
  const pct = sliced.length > 0 ? Math.round((healthyCount / sliced.length) * 10000) / 100 : 100
  return { timeline: sliced, availabilityPct: pct }
}

/**
 * Health monitor managing in-memory channel records and active probe execution.
 */
export class HealthMonitor {
  private records = new Map<string, ChannelHealthRecord>()
  private ctx: Context
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  noteSuccess(provider: string, model: string, latencyMs?: number, throughputTps?: number): void {
    const route = routeKeyOf(provider, model)
    const existing = this.records.get(route)
    const point: ChannelTimelinePoint = {
      time: Date.now(),
      status: 'healthy',
      latencyMs,
      throughputTps,
    }
    const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, point)
    this.records.set(route, {
      route,
      provider,
      model,
      status: 'healthy',
      latencyMs: latencyMs ?? existing?.latencyMs,
      throughputTps: throughputTps ?? existing?.throughputTps,
      availabilityPct,
      lastCheckedAt: Date.now(),
      source: 'passive',
      timeline,
    })
  }

  noteFailure(provider: string, model: string, code: string, latencyMs?: number): void {
    const route = routeKeyOf(provider, model)
    const existing = this.records.get(route)
    const status = classifyHealth(code)
    const point: ChannelTimelinePoint = {
      time: Date.now(),
      status,
      latencyMs,
      error: code,
    }
    const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, point)
    this.records.set(route, {
      route,
      provider,
      model,
      status,
      latencyMs: latencyMs ?? existing?.latencyMs,
      throughputTps: existing?.throughputTps,
      availabilityPct,
      lastError: code,
      lastCheckedAt: Date.now(),
      source: 'passive',
      timeline,
    })
  }

  getRecord(provider: string, model: string): ChannelHealthRecord | undefined {
    return this.records.get(routeKeyOf(provider, model))
  }

  getSnapshot(): Record<string, ChannelHealthRecord> {
    const snapshot: Record<string, ChannelHealthRecord> = {}
    for (const [key, value] of this.records) {
      snapshot[key] = { ...value, timeline: value.timeline ? value.timeline.slice() : [] }
    }
    return snapshot
  }

  /**
   * Probe a single candidate with minimal token footprint.
   * Hard limits to maxTokens: 1 and aborts upon the first chunk.
   */
  async probeCandidate(
    candidate: { provider: string; model: string },
    prompt = 'hi',
    timeoutSeconds = 8,
  ): Promise<ChannelHealthRecord> {
    const route = routeKeyOf(candidate.provider, candidate.model)
    const controller = new AbortController()
    const timeoutTimer = setTimeout(() => {
      controller.abort()
    }, Math.max(1, timeoutSeconds) * 1000)

    const t0 = performance.now()
    let firstChunkSeen = false

    try {
      const stream = this.ctx.llm.stream({
        provider: candidate.provider,
        model: candidate.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: 1,
        signal: controller.signal,
      })

      for await (const chunk of stream) {
        if (
          chunk.type === 'text-delta'
          || chunk.type === 'reasoning-delta'
          || chunk.type === 'block-start'
          || chunk.type === 'block-end'
        ) {
          firstChunkSeen = true
          // Abort generation immediately after first token to save all further output tokens!
          controller.abort()
          break
        }
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error' || (chunk.reason.kind === 'aborted' && !firstChunkSeen)) {
            const failure = chunk.reason.failure
            const code = failure?.code ?? 'ERROR'
            throw new Error(code)
          }
          firstChunkSeen = true
          break
        }
      }

      clearTimeout(timeoutTimer)
      const latencyMs = Math.max(1, Math.round(performance.now() - t0))
      const existing = this.records.get(route)
      const point: ChannelTimelinePoint = {
        time: Date.now(),
        status: 'healthy',
        latencyMs,
      }
      const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, point)
      const record: ChannelHealthRecord = {
        route,
        provider: candidate.provider,
        model: candidate.model,
        status: 'healthy',
        latencyMs,
        throughputTps: existing?.throughputTps,
        availabilityPct,
        lastCheckedAt: Date.now(),
        source: 'active',
        timeline,
      }
      this.records.set(route, record)
      return record
    } catch (err: unknown) {
      clearTimeout(timeoutTimer)
      const latencyMs = Math.max(1, Math.round(performance.now() - t0))
      const isTimeout = controller.signal.aborted && !firstChunkSeen
      const rawCode = isTimeout ? 'TIMEOUT' : (err instanceof Error ? err.message : String(err))
      const code = rawCode.startsWith('Error: ') ? rawCode.slice(7) : rawCode
      const existing = this.records.get(route)
      const point: ChannelTimelinePoint = {
        time: Date.now(),
        status: classifyHealth(code),
        latencyMs,
        error: code,
      }
      const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, point)
      const record: ChannelHealthRecord = {
        route,
        provider: candidate.provider,
        model: candidate.model,
        status: classifyHealth(code),
        latencyMs,
        throughputTps: existing?.throughputTps,
        availabilityPct,
        lastError: code,
        lastCheckedAt: Date.now(),
        source: 'active',
        timeline,
      }
      this.records.set(route, record)
      return record
    }
  }

  /**
   * Probe all unique candidates across profiles.
   */
  async probeAll(
    candidates: readonly { provider: string; model: string }[],
    prompt = 'hi',
    timeoutSeconds = 8,
  ): Promise<Record<string, ChannelHealthRecord>> {
    const seen = new Set<string>()
    const unique: { provider: string; model: string }[] = []
    for (const c of candidates) {
      const key = routeKeyOf(c.provider, c.model)
      if (!seen.has(key)) {
        seen.add(key)
        unique.push({ provider: c.provider, model: c.model })
      }
    }

    await Promise.allSettled(
      unique.map(c => this.probeCandidate(c, prompt, timeoutSeconds)),
    )
    return this.getSnapshot()
  }

  /**
   * Update the background periodic probe interval.
   */
  updateInterval(
    getCandidates: () => readonly { provider: string; model: string }[],
    intervalMinutes: number,
    prompt: string,
    timeoutSeconds: number,
  ): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (intervalMinutes > 0) {
      const ms = intervalMinutes * 60 * 1000
      this.timer = setInterval(() => {
        const candidates = getCandidates()
        if (candidates.length > 0) {
          void this.probeAll(candidates, prompt, timeoutSeconds).catch(() => {})
        }
      }, ms)
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.records.clear()
  }
}

/**
 * Host Typert Remote service exposing health snapshots and on-demand probing.
 * Registered on Typert Gateway with namespace `routerHealth`.
 */
export class RouterHealthService extends TypertRemoteService {
  private monitor: HealthMonitor
  private configGetter: () => {
    prompt: string
    timeoutSeconds: number
    getCandidates: () => readonly { provider: string; model: string }[]
  }

  constructor(
    ctx: Context,
    monitor: HealthMonitor,
    configGetter: () => {
      prompt: string
      timeoutSeconds: number
      getCandidates: () => readonly { provider: string; model: string }[]
    },
  ) {
    super(ctx, 'routerHealth', { namespace: 'routerHealth' })
    this.monitor = monitor
    this.configGetter = configGetter
  }

  async getSnapshot(): Promise<Record<string, ChannelHealthRecord>> {
    return this.monitor.getSnapshot()
  }

  async probeAll(payload?: {
    prompt?: string
    timeoutSeconds?: number
    candidates?: { provider: string; model: string }[]
  }): Promise<Record<string, ChannelHealthRecord>> {
    const cfg = this.configGetter()
    const prompt = payload?.prompt ?? cfg.prompt
    const timeoutSeconds = payload?.timeoutSeconds ?? cfg.timeoutSeconds
    const candidates = payload?.candidates ?? cfg.getCandidates()
    return this.monitor.probeAll(candidates, prompt, timeoutSeconds)
  }
}

// Attach remote method markers to RouterHealthService prototype without Stage 3 syntax
// so Node 24 strip-types compiles without syntax errors.
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
Object.defineProperty(RouterHealthService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      { method: 'getSnapshot', invocation: Object.freeze({ kind: 'direct' as const }) },
      { method: 'probeAll', invocation: Object.freeze({ kind: 'direct' as const }) },
    ]),
  }),
})

// ---------------- Session Projection ----------------

export const CHANNEL_HEALTH_KEY = 'router/channel-health'

const timelinePointSchema = z.object({
  time: z.number(),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  latencyMs: z.number().optional(),
  throughputTps: z.number().optional(),
  error: z.string().optional(),
})

const healthRecordSchema = z.object({
  route: z.string(),
  provider: z.string(),
  model: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  latencyMs: z.number().optional(),
  throughputTps: z.number().optional(),
  availabilityPct: z.number().optional(),
  lastError: z.string().optional(),
  lastCheckedAt: z.number(),
  source: z.enum(['passive', 'active']),
  timeline: z.array(timelinePointSchema).optional(),
})

const projectionStateSchema = z.object({
  records: z.record(z.string(), healthRecordSchema),
  currentRoute: z.string().optional(),
  lastStart: z.number().optional(),
}).strict()

interface ChannelHealthProjectionState {
  records: Record<string, ChannelHealthRecord>
  currentRoute?: string
  lastStart?: number
}

/**
 * Session projection accumulating passive health records across conversation steps.
 */
export const channelHealthProjection = {
  key: CHANNEL_HEALTH_KEY,
  stateVersion: 1,
  stateSchema: projectionStateSchema,
  init: (): ChannelHealthProjectionState => ({ records: {} }),
  apply(state: ChannelHealthProjectionState, event: SessionEvent): ChannelHealthProjectionState {
    switch (event.type) {
      case 'request/header': {
        const config = event.data.header.config
        const provider = config?.provider ?? ''
        const model = config?.model ?? ''
        const route = routeKeyOf(provider, model)
        return {
          ...state,
          currentRoute: route,
          lastStart: event.time,
        }
      }
      case 'assistant/attempt': {
        if (!state.currentRoute) return state
        // Check if finished with error
        let failureCode: string | undefined
        for (let i = event.data.stream.length - 1; i >= 0; i -= 1) {
          const r = event.data.stream[i]!
          if (r.type === 'chunk' && r.chunk.type === 'finish') {
            const reason = r.chunk.reason as { failure?: { code: string } }
            failureCode = reason.failure?.code
            break
          }
        }
        if (!failureCode) return state
        const [provider, model] = state.currentRoute.split('/')
        const existing = state.records[state.currentRoute]
        const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, {
          time: event.time,
          status: classifyHealth(failureCode),
          error: failureCode,
        })
        const record: ChannelHealthRecord = {
          route: state.currentRoute,
          provider: provider ?? '',
          model: model ?? '',
          status: classifyHealth(failureCode),
          latencyMs: existing?.latencyMs,
          throughputTps: existing?.throughputTps,
          availabilityPct,
          lastError: failureCode,
          lastCheckedAt: event.time,
          source: 'passive',
          timeline,
        }
        return {
          ...state,
          records: { ...state.records, [state.currentRoute]: record },
        }
      }
      case 'assistant/message': {
        if (!state.currentRoute) return state
        const [provider, model] = state.currentRoute.split('/')
        const latencyMs = state.lastStart ? Math.max(1, event.time - state.lastStart) : undefined
        let throughputTps: number | undefined
        const usage = (event.data as unknown as { message?: { usage?: { outputTokens?: number } } })?.message?.usage
        if (usage && typeof usage.outputTokens === 'number' && latencyMs && latencyMs > 0) {
          throughputTps = Math.round((usage.outputTokens / (latencyMs / 1000)) * 10) / 10
        }
        const existing = state.records[state.currentRoute]
        const { timeline, availabilityPct } = pushTimelinePoint(existing?.timeline, {
          time: event.time,
          status: 'healthy',
          latencyMs,
          throughputTps,
        })
        const record: ChannelHealthRecord = {
          route: state.currentRoute,
          provider: provider ?? '',
          model: model ?? '',
          status: 'healthy',
          latencyMs,
          throughputTps: throughputTps ?? existing?.throughputTps,
          availabilityPct,
          lastCheckedAt: event.time,
          source: 'passive',
          timeline,
        }
        return {
          ...state,
          records: { ...state.records, [state.currentRoute]: record },
        }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: z.record(z.string(), healthRecordSchema),
    view: (state: ChannelHealthProjectionState) => state.records,
  },
}
