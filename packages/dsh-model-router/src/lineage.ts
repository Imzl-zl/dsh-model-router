/**
 * The failover-history projection: a durable, bounded ledger of route switches.
 *
 * DSH records every route change as a `request/header` with `reason: 'change'`
 * and every failed attempt as an `assistant/attempt` carrying the terminal
 * failure — but no event says "these attempts were one request's fallback
 * chain". This unit folds those core events into that ledger: the route before
 * the switch, the failure code that triggered it, and whether the new route
 * went on to complete. A user-initiated model switch (a 'change' header with no
 * preceding failure) is deliberately not an entry.
 *
 * Constraints from the projection contract (docs/subsystems/session-projection):
 * `apply` is synchronous and pure; the state is plain JSON (the persisted-cache
 * precondition); the wire view returns a reference held in the state so an
 * unchanged state publishes nothing; and every tail page carries every
 * client-visible key, so the view stays UI-scale — the last
 * {@link MAX_ENTRIES} entries, nothing more.
 */

import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { routeKeyOf } from './routes.ts'

/** One failover: the route that failed, why, where the chain went, and its outcome. */
export interface FailoverEntry {
  /** Commit time of the `request/header` that recorded the switch. */
  time: number
  turn: number
  step: number
  /** `provider/model` of the route that failed. */
  from: string
  /** `provider/model` of the route the chain moved to. */
  to: string
  /** The failure code that triggered the switch. */
  code: string
  /** Whether the new route went on to produce an assistant message. */
  settled: boolean
}

/** The projection key. Namespaced: a colliding key with another stateVersion throws. */
export const FAILOVER_HISTORY_KEY = 'router/failover-history'

/** UI-scale bound: every history tail page carries this view. */
export const MAX_ENTRIES = 20

const entrySchema = z.object({
  time: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  from: z.string(),
  to: z.string(),
  code: z.string(),
  settled: z.boolean(),
})

const stateSchema = z.object({
  entries: z.array(entrySchema),
  /** Route of the latest `request/header`, for the next switch's `from`. */
  lastRoute: z.string().optional(),
  /**
   * The latest failed attempt, with the (turn, step) it belongs to. A header in a
   * later turn is a user-initiated switch (or another request entirely), not this
   * failure's failover — that is what keeps manual model changes out of the ledger.
   */
  lastFailure: z.object({
    code: z.string(),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
  }).optional(),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
}).strict()

interface LineageState {
  entries: FailoverEntry[]
  lastRoute: string | undefined
  lastFailure: { code: string; turn: number; step: number } | undefined
  turn: number
  step: number
}

/**
 * The failure code of one attempt event's terminal finish chunk, or undefined
 * when the attempt did not end in failure. Shared with the router's notice
 * path so both readers agree on what a failed attempt is.
 */
export function failureCodeOfStream(stream: readonly AssistantStreamRecord[]): string | undefined {
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record = stream[i]!
    if (record.type !== 'chunk' || record.chunk.type !== 'finish') continue
    const reason = record.chunk.reason as { failure?: { code: string } }
    return reason.failure?.code
  }
  return undefined
}

export const failoverHistoryProjection = {
  key: FAILOVER_HISTORY_KEY,
  stateVersion: 1,
  stateSchema,
  init: (): LineageState => ({ entries: [], lastRoute: undefined, lastFailure: undefined, turn: 0, step: 0 }),
  apply(state: LineageState, event: SessionEvent): LineageState {
    switch (event.type) {
      case 'turn/start':
        // A new turn starts with no pending failure: a route change later in this
        // turn is the user's own switch, and must not inherit an older failure.
        return state.turn === event.data.turn
          ? state
          : { ...state, turn: event.data.turn, lastFailure: undefined }
      case 'step/start':
        return state.step === event.data.step ? state : { ...state, step: event.data.step }
      case 'request/header': {
        const route = routeKeyOf(event.data.header.config.provider ?? '', event.data.header.config.model ?? '')
        // Every header clears the pending failure: a failure older than the
        // previous header belongs to an earlier request.
        const next: LineageState = { ...state, lastRoute: route, lastFailure: undefined }
        if (event.data.reason !== 'change') return next
        if (state.lastRoute === undefined || state.lastRoute === route) return next
        // A 'change' with no preceding failure is a user-initiated switch, not
        // a failover; the ledger records the plugin's chain, not the user's choice.
        // The failure must also belong to THIS step: the router switches inside the
        // step that failed, so a same-turn/later-turn failure cannot be the cause.
        const failure = state.lastFailure
        if (failure === undefined) return next
        if (failure.turn !== state.turn || failure.step !== state.step) return next
        const entry: FailoverEntry = {
          time: event.time,
          turn: state.turn,
          step: state.step,
          from: state.lastRoute,
          to: route,
          code: failure.code,
          settled: false,
        }
        return { ...next, entries: [...state.entries, entry].slice(-MAX_ENTRIES) }
      }
      case 'assistant/attempt': {
        const code = failureCodeOfStream(event.data.stream)
        if (code === undefined) return state
        return { ...state, lastFailure: { code, turn: state.turn, step: state.step } }
      }
      case 'assistant/message': {
        const last = state.entries[state.entries.length - 1]
        // Only the turn that owns the switch can settle it: a success in a later
        // turn says nothing about whether this failover worked.
        if (last === undefined || last.settled || last.turn !== state.turn) return state
        const entries = state.entries.slice()
        entries[entries.length - 1] = { ...last, settled: true }
        return { ...state, entries }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: z.array(entrySchema),
    // A reference held in the state: an unchanged state re-publishes nothing.
    view: (state: LineageState) => state.entries,
  },
}
