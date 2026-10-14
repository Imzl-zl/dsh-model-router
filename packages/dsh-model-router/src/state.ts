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
import type { Candidate, Strategy, SwitchOn } from './config.ts'

/** The candidate chain snapshot for one step, frozen at the step's first request. */
export interface StepChain {
  readonly candidates: readonly Candidate[]
  /**
   * 每条候选在用户列表里的原始下标，与 `candidates` 平行。
   *
   * 策略决定起点后链会被旋转，`index` 指的是旋转后的位置；界面和通知要说的
   * "第几条"必须是用户自己排的那一套，否则用户会看到对不上的编号。
   */
  readonly order: readonly number[]
  readonly switchOn: SwitchOn
  readonly maxTotalAttempts: number
  readonly strategy: Strategy
}

/** Mutable per-step cursor. Owned by the router; never shared across Agents. */
export interface StepState {
  turn: number
  step: number
  chain: StepChain
  /** The request-shape conditions gathered once per step, frozen at step start. */
  conditions: StepConditions
  /** Index into `chain.candidates` of the route the next attempt uses. */
  index: number
  /** `agent/request` fires on the current candidate; the cap advances the index. */
  attemptsOnCandidate: number
  /** `agent/request` fires in this step across all candidates. */
  totalAttempts: number
  /** Set when the last candidate hit its cap: only a terminal decision remains. */
  exhausted: boolean
}

/**
 * The request-shape conditions a `needs` gate reads, gathered once per step:
 * `agent/pre-step` sees the step's admitted user messages, and the
 * context-pressure projection answers for the next request. Both run before
 * route selection and are not re-run on retries, so the conditions are stable
 * across a step's attempts — "what this step's request looks like" is fixed.
 */
export interface StepConditions {
  /** An image block is present in the step's admitted user messages. */
  hasImages: boolean
  /**
   * The context-pressure projection's estimate for the next request. Absent
   * before the first usage sample and when token-meter is not loaded; a
   * `minContextTokens` gate treats absence as "not met" — an unmeasured
   * request is not a measured-large one.
   */
  projectedTokens: number | undefined
}

/** The default conditions when `agent/pre-step` has not been observed for the step. */
export function emptyConditions(): StepConditions {
  return { hasImages: false, projectedTokens: undefined }
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
  private readonly conditions = new WeakMap<Agent, StepConditions & { turn: number; step: number }>()
  /**
   * 轮询游标，按会话各自计数：同时开几个聊天窗口时互不干扰，也天然随会话结束重置。
   * 进程重启归零——轮询是分配手段，不是需要记住的状态。
   */
  private readonly cursors = new WeakMap<Session, number>()

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

  /** Record the request-shape conditions observed at `agent/pre-step`. */
  noteConditions(agent: Agent, turn: number, step: number, conditions: StepConditions): void {
    this.conditions.set(agent, { ...conditions, turn, step })
  }

  /** The conditions for this step, or the defaults when pre-step was not observed. */
  conditionsFor(agent: Agent, turn: number, step: number): StepConditions {
    const note = this.conditions.get(agent)
    if (note === undefined || note.turn !== turn || note.step !== step) return emptyConditions()
    return { hasImages: note.hasImages, projectedTokens: note.projectedTokens }
  }

  /**
   * 取本会话的下一个轮询游标并前进一位。只有「轮询」策略会读它；其他策略下
   * 它照样计数，代价是一次 Map 读写，换来的是切换策略时不必解释计数从哪开始。
   */
  nextCursor(session: Session, size: number): number {
    if (size <= 0) return 0
    const current = this.cursors.get(session) ?? 0
    this.cursors.set(session, current + 1)
    return current % size
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
