/**
 * Per-step routing state.
 *
 * One Agent runs one step at a time (the loop is sequential), so a single slot
 * per Agent keyed by (turn, step) is sufficient; concurrent Agents hold
 * separate WeakMap entries and never share mutable state. The slot is replaced
 * when the (turn, step) pair changes, which is also the cleanup: entries die
 * with their Agent.
 *
 * The same shape is reused for the last-failure record the notice needs: the
 * `session/event` feed is the sanctioned observation channel for session
 * events, and a failed attempt's code is committed before the next
 * `agent/request` fires.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { Candidate, SwitchOn } from './config.ts'

/** The candidate chain snapshot for one step, frozen at the step's first request. */
export interface StepChain {
  readonly candidates: readonly Candidate[]
  readonly switchOn: SwitchOn
  readonly maxTotalAttempts: number
}

/** Mutable per-step cursor. Owned by the router; never shared across Agents. */
export interface StepState {
  turn: number
  step: number
  chain: StepChain
  /** Index into `chain.candidates` of the route the next attempt uses. */
  index: number
  /** `agent/request` fires on the current candidate; the cap advances the index. */
  attemptsOnCandidate: number
  /** `agent/request` fires in this step across all candidates. */
  totalAttempts: number
  /** Set when the last candidate hit its cap: only a terminal decision remains. */
  exhausted: boolean
}

/** The last failure code seen for one (session, turn, step), for the notice. */
export interface FailureNote {
  turn: number
  step: number
  code: string
}

export class RouterState {
  private readonly steps = new WeakMap<Agent, StepState>()
  private readonly failures = new WeakMap<Session, FailureNote>()

  /** The state for this (agent, turn, step), or undefined when the slot moved on. */
  current(agent: Agent, turn: number, step: number): StepState | undefined {
    const state = this.steps.get(agent)
    if (state === undefined || state.turn !== turn || state.step !== step) return undefined
    return state
  }

  /** Install the state for a new step, replacing any stale slot. */
  start(agent: Agent, state: StepState): void {
    this.steps.set(agent, state)
  }

  /** Record the failure code of the most recent attempt, for the next notice. */
  noteFailure(session: Session, turn: number, step: number, code: string): void {
    this.failures.set(session, { turn, step, code })
  }

  /** The failure code behind the switch being made right now, if known. */
  failureCodeOf(session: Session, turn: number, step: number): string | undefined {
    const note = this.failures.get(session)
    return note !== undefined && note.turn === turn && note.step === step ? note.code : undefined
  }
}

/** The route label DSH's own notices use: bare model within one provider. */
export function routeLabel(provider: string, model: string, otherProvider: string): string {
  return provider === otherProvider ? model : `${provider}/${model}`
}

/** The candidate config for one attempt: the resolved controls on a swapped route. */
export function candidateConfig(resolved: LlmCallConfig, candidate: Candidate): LlmCallConfig {
  return { ...resolved, provider: candidate.provider, model: candidate.model }
}
