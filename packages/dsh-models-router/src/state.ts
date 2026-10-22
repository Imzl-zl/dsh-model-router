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

/**
 * One candidate as the step core sees it: a CALL budget, not a retry count.
 *
 * The config speaks retries (`maxRetries`); `resolveChain` converts once, so
 * every decision below counts real calls and never has to remember the +1.
 */
export interface StepCandidate {
  provider: string
  model: string
  /** Total real calls allowed on this candidate; always >= 1. */
  maxAttempts: number
  weight: number
  needs?: Candidate['needs']
}

/** The candidate chain snapshot for one step, frozen at the step's first request. */
export interface StepChain {
  readonly candidates: readonly StepCandidate[]
  /**
   * 每条候选在用户列表里的原始下标，与 `candidates` 平行。
   *
   * 策略决定起点后链会被旋转，`index` 指的是旋转后的位置；界面和通知要说的
   * "第几条"必须是用户自己排的那一套，否则用户会看到对不上的编号。
   */
  readonly order: readonly number[]
  readonly switchOn: SwitchOn
  /** No-image turns the image condition holds for after an image turn. */
  readonly stickyTurns: number
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
  /** `agent/request` fires in this step across all candidates (the step's cost). */
  totalAttempts: number
  /**
   * The chain has no servable candidate left for this step. Set by the
   * fall-back path (nothing in the chain can take this request) and by the
   * defensive last-candidate branch in `planFire`; `decideRecovery` reads it as
   * terminal.
   */
  exhausted: boolean
  /**
   * Explicit intent from the recovery layer: `true` = the next fire lands on
   * the next candidate, `false` = stay on the current one because llm-retry
   * still owns the same-route retry. Consumed (and cleared) by `planFire`.
   */
  pendingAdvance?: boolean
}

/**
 * The request-shape conditions a `needs` gate reads.
 *
 * `hasImages` is turn-scoped: `agent/pre-step` sees only the messages newly
 * claimed for the step, and a tool-loop turn's later steps claim nothing — so
 * the flag accumulates across a turn's steps (and picks up images that arrive
 * mid-turn through a tool result). It then extends across turns by the matched
 * chain's `stickyTurns`, which is how a follow-up about an image stays on the
 * image route. `projectedTokens` stays step-scoped: it estimates the next
 * request's size, which each step re-measures.
 *
 * Note: 为什么取数必须覆盖 tool/result 嵌套图片 —— 见
 * .agents/notes/implemented/2026-10-14-image-route-conditions-and-admission-gate-boundary.md
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

/** Per-turn condition state: the accumulated image flag plus this step's token estimate. */
interface TurnNote {
  turn: number
  /** Last step whose pre-step was observed; only that step's estimate is fresh. */
  step: number
  /** Turn-accumulated (sticky-extended) image condition. */
  hasImages: boolean
  /** No-image turns the image condition still holds for. */
  stickyRemaining: number
  projectedTokens: number | undefined
}

/** The last failure code seen for one (session, turn, step), for the notice. */
export interface FailureNote {
  turn: number
  step: number
  code: string
}

/**
 * 本轮最后一条 assistant 消息是怎么结束的。
 *
 * `max-tokens` 不是错误、走不到 `agent/request-error`：DSH 在 `agent-loop` 里直接
 * 把本轮结束掉，界面那条"已达到输出 token 上限 … 发送继续"就是在等用户自己补话。
 * 插件要"别停在这儿"，就必须在 `agent/turn-stopping` 之前知道这次结束是截断。
 * 记 `provider/model` 是因为续跑次数按候选算，换候选时计数要跟着换。
 */
export interface TruncationNote {
  turn: number
  /** 产生这条消息的 step；`turn-stopping` 只认本轮最后一个 step 的记录。 */
  step: number
  provider: string
  model: string
  truncated: boolean
}

/**
 * 跨 step 的落点：本轮在这一步之后要继续、但必须换到哪条候选。
 *
 * `pendingAdvance` 是 step 内的意图，`planFire` 会把它消费掉；而"续满了换候选"
 * 是**跨 step** 的：`agent/turn-stopping` 里决定，下一个 step 的 `agent/request`
 * 才创建新 state。所以这里单独存一份，按路由而不是下标，因为新 step 的链会按
 * 起点策略重新旋转，下标对不上。
 */
export interface TurnCarry {
  turn: number
  /** 落点候选。 */
  provider: string
  model: string
  /** 被截断的那条候选（通知的"从哪儿来"必须是事实，不能就地猜下标）。 */
  fromProvider: string
  fromModel: string
  /** 从它身上已经自动续了几次（通知文案要说清楚）。 */
  continues: number
}

export class RouterState {
  private readonly steps = new WeakMap<Agent, StepState>()
  private readonly failures = new WeakMap<Session, FailureNote>()
  private readonly turns = new WeakMap<Agent, TurnNote>()
  /** The matched chain's `stickyTurns`, recorded when a chain is resolved. */
  private readonly sticky = new WeakMap<Agent, number>()
  /** Skip notices already emitted for one (agent, turn); the tool loop re-decides every step. */
  private readonly conditionSkips = new WeakMap<Agent, { turn: number; keys: Set<string> }>()
  /**
   * 轮询游标，按会话各自计数：同时开几个聊天窗口时互不干扰，也天然随会话结束重置。
   * 进程重启归零——轮询是分配手段，不是需要记住的状态。
   */
  private readonly cursors = new WeakMap<Session, number>()
  /** 本轮最后一条 assistant 消息的结束方式（截断识别）。 */
  private readonly truncations = new WeakMap<Agent, TruncationNote>()
  /** 本轮每条候选上已经自动续跑过几次。 */
  private readonly continues = new WeakMap<Agent, { turn: number; used: Map<string, number> }>()
  /** 下一个 step 必须落到哪条候选（续跑用尽后的跨 step 换候选）。 */
  private readonly carries = new WeakMap<Agent, TurnCarry>()

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

  /** 本轮最近一个 step 的状态（`turn-stopping` 时还不知道 step 号）。 */
  latestOfTurn(agent: Agent, turn: number): StepState | undefined {
    const state = this.steps.get(agent)
    return state !== undefined && state.turn === turn ? state : undefined
  }

  /** 记本轮最后一条 assistant 消息是怎么结束的。 */
  noteTruncation(agent: Agent, note: TruncationNote): void {
    this.truncations.set(agent, note)
  }

  /** 本轮最后一条 assistant 消息的结束方式；换轮即失效。 */
  truncationOf(agent: Agent, turn: number): TruncationNote | undefined {
    const note = this.truncations.get(agent)
    return note !== undefined && note.turn === turn ? note : undefined
  }

  /** 这条候选在本轮已经自动续跑过几次。 */
  continuesUsed(agent: Agent, turn: number, route: string): number {
    const entry = this.continues.get(agent)
    if (entry === undefined || entry.turn !== turn) return 0
    return entry.used.get(route) ?? 0
  }

  /** 记一次自动续跑。 */
  noteContinue(agent: Agent, turn: number, route: string): void {
    const entry = this.continues.get(agent)
    const used = entry !== undefined && entry.turn === turn
      ? entry.used
      : new Map<string, number>()
    used.set(route, (used.get(route) ?? 0) + 1)
    this.continues.set(agent, { turn, used })
  }

  /** 下一个 step 必须落到这条候选（续跑用尽后的换候选）。 */
  carryTo(agent: Agent, carry: TurnCarry): void {
    this.carries.set(agent, carry)
  }

  /** 取出并清掉跨 step 的落点；不属于本轮的一律作废。 */
  takeCarry(agent: Agent, turn: number): TurnCarry | undefined {
    const carry = this.carries.get(agent)
    if (carry === undefined) return undefined
    this.carries.delete(agent)
    return carry.turn === turn ? carry : undefined
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

  /**
   * Record the request-shape conditions observed at `agent/pre-step`.
   *
   * The image flag is turn-scoped: within a turn it only ever turns on (the
   * step's claimed input or a tool result can add an image; nothing removes
   * one mid-turn). A new turn re-evaluates from its own input, extended by the
   * remaining sticky window of the previous one.
   */
  noteConditions(agent: Agent, turn: number, step: number, conditions: StepConditions): void {
    const previous = this.turns.get(agent)
    if (previous !== undefined && previous.turn === turn) {
      this.turns.set(agent, {
        ...previous,
        step,
        projectedTokens: conditions.projectedTokens,
        hasImages: previous.hasImages || conditions.hasImages,
      })
      return
    }
    const remaining = previous?.stickyRemaining ?? 0
    const hasImages = conditions.hasImages || remaining > 0
    this.turns.set(agent, {
      turn,
      step,
      hasImages,
      // 真有图的轮次把窗口补满；被粘滞延长的轮次消耗一格；没粘住的归零。
      stickyRemaining: conditions.hasImages ? this.stickyTurnsOf(agent) : Math.max(0, remaining - 1),
      projectedTokens: conditions.projectedTokens,
    })
  }

  /**
   * Record that one turn's tool result carried an image. The image enters the
   * conversation there, so every later step of the turn — and the sticky
   * window after it — must treat the turn as image-bearing.
   */
  noteToolResult(agent: Agent, turn: number, hasImage: boolean): void {
    if (!hasImage) return
    const note = this.turns.get(agent)
    if (note === undefined || note.turn !== turn) return
    this.turns.set(agent, { ...note, hasImages: true, stickyRemaining: this.stickyTurnsOf(agent) })
  }

  /** The conditions for this step, or the defaults when pre-step was not observed. */
  conditionsFor(agent: Agent, turn: number, step: number): StepConditions {
    const note = this.turns.get(agent)
    if (note === undefined || note.turn !== turn) return emptyConditions()
    return { hasImages: note.hasImages, projectedTokens: note.step === step ? note.projectedTokens : undefined }
  }

  /**
   * Record the matched chain's `stickyTurns` for this agent — and finalize the
   * current turn's window with it.
   *
   * The write happens in `agent/request`, which runs AFTER `agent/pre-step`; the
   * turn note is written by pre-step, so on a session's very first image turn the
   * window would otherwise be recorded as 0 and the following no-image turn would
   * not stick. Fixing the note here (same turn, window still 0) closes that gap
   * without moving chain resolution earlier — resolution needs the resolved route,
   * which does not exist at pre-step time.
   */
  setStickyTurns(agent: Agent, turns: number): void {
    this.sticky.set(agent, Math.max(0, turns))
    const note = this.turns.get(agent)
    if (note !== undefined && note.stickyRemaining === 0 && turns > 0) {
      this.turns.set(agent, { ...note, stickyRemaining: Math.max(0, turns) })
    }
  }

  private stickyTurnsOf(agent: Agent): number {
    return this.sticky.get(agent) ?? 0
  }

  /**
   * Whether the skip notices for this (agent, turn, key) have not been emitted
   * yet. A tool-loop turn re-decides every step and would repeat an identical
   * row per step; the first one carries the information. One gate for all three
   * skip kinds (condition / capability / breaker): the key names the group, so
   * the three paths cannot drift apart again.
   *
   * A turn keeps the SET of keys it already announced, not just the last one:
   * a single fire can skip a condition candidate, a capability candidate and a
   * cooling candidate at once, and each of those must stay deduped on its own.
   */
  shouldNoteSkip(agent: Agent, turn: number, key: string): boolean {
    const note = this.conditionSkips.get(agent)
    if (note === undefined || note.turn !== turn) {
      this.conditionSkips.set(agent, { turn, keys: new Set([key]) })
      return true
    }
    if (note.keys.has(key)) return false
    note.keys.add(key)
    return true
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

/** The candidate config for one attempt: the resolved controls on a swapped route. */
export function candidateConfig(resolved: LlmCallConfig, candidate: StepCandidate): LlmCallConfig {
  return { ...resolved, provider: candidate.provider, model: candidate.model }
}
