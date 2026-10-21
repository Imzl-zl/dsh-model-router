/**
 * Per-session routing bindings, stored where DSH says host state belongs.
 *
 * DSH has session-scoped UI slots but no session-scoped config and no
 * session-level KV; the sanctioned sidecar for "durable host-side state that
 * must not enter the session log" is `ctx.storageDomain`
 * (packages/storage/storage-domain/README.md:28-58). So the binding for
 * "which chain this session routes on, and how many times each route retries"
 * is one schema-validated domain, and the routing path reads it synchronously.
 *
 * Three boundaries this module owns:
 *
 * - **The domain is optional.** `ctx.storageDomain` is read through `ctx.get`
 *   (packages/AGENTS.md: "Optional services use `ctx.get(name)`"), because a
 *   composition without the storage family must still route. Without it the
 *   same reads and writes go to process memory: identical behavior, no
 *   durability — the browser is told which one it got (`persistent`).
 * - **Writes are the only path to a binding**, and they are durable before they
 *   resolve (`Domain.put` awaits the backend before it mutates memory), so a
 *   failure reaches the caller unchanged. There is no "looks saved" fallback:
 *   the chip must not claim a write that did not land.
 * - **0..9 is a wire bound, not a policy.** `retries[route] = 0` means "do not
 *   retry this route in this session" and must stay distinguishable from an
 *   absent key, which means "use the candidate's own count".
 *
 * Note: 为何用 storageDomain 侧车、记录形状、0..9 边界与内存回退 —— 见
 * .agents/notes/implemented/2026-10-21-per-session-bindings.md
 * Note: 为何关闭后的域要按"实例已死"回答、为何 already-open 要重试 —— 见
 * .agents/notes/implemented/2026-10-21-raw-config-shape-and-domain-lifecycle.md
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { MAX_SESSION_RETRIES } from './defaults.ts'
import { routeParts } from './routes.ts'
import type { SessionBinding } from './types.ts'

/** The storage domain name. `UNIT_NAME_RE` allows lowercase letters, digits and `_` only. */
export const SESSION_BINDINGS_DOMAIN = 'model_router_sessions'

/**
 * The stored record's schema, annotated with the wire type.
 *
 * The interface in ./types.ts is hand-written (this project has no inferred
 * types), so this annotation is what turns a shape drift into a compile error
 * instead of a runtime `invalid-record` on the next open.
 */
const bindingSchema: z.ZodType<SessionBinding> = z.object({
  chain: z.string().nullable(),
  retries: z.record(z.string(), z.number().int().min(0).max(MAX_SESSION_RETRIES)),
})

/** The one domain this plugin declares; opened through `ctx.storageDomain`. */
export const sessionBindingsDomain = defineDomain({
  name: SESSION_BINDINGS_DOMAIN,
  version: 1,
  tables: { bindings: domainTable(bindingSchema) },
})

/** A session with no binding at all: follow the default chain, override nothing. */
export function emptyBinding(): SessionBinding {
  return { chain: null, retries: {} }
}

/**
 * The slice of `ctx` this module uses. Structurally typed on purpose: the
 * storage facility is optional, and a face narrow enough to stand in for a
 * test keeps the storage and memory paths on one code path.
 */
export interface BindingContext {
  get(name: string): unknown
  logger: { error(message: string): void }
  effect(execute: () => () => void, label?: string): void
}

/** The `bindings` table as this module uses it (`storage-domain/src/domain.ts:42-90`). */
interface BindingTable {
  get(key: string): SessionBinding | undefined
  put(key: string, value: SessionBinding): Promise<void>
}

/** An open domain handle: one table plus the caller-owned lifetime. */
interface OpenDomain {
  table(name: string): BindingTable
  close(): Promise<void>
}

/** `ctx.storageDomain` — the optional facility, typed by what this module calls. */
interface StorageDomainFace {
  open(spec: unknown): Promise<OpenDomain>
}

/**
 * The binding store: one synchronous read for the routing path, one durable
 * write for the browser, and the memory fallback in between.
 *
 * A fiber that is unloading closes its domain, and the closed handle throws on
 * every call (`DomainError: 'closed'`). Two kinds of caller still arrive after
 * that: a Remote invocation the browser issued while the plugin was restarting
 * (a config save restarts this fiber), and a promise that was already in flight.
 * So the store tracks `closed` and treats it as "this instance is gone": reads
 * answer "no binding" (the UI re-reads from the new instance), writes fail with a
 * plain message instead of another package's error code.
 */
export class SessionBindings {
  /** The fallback store, and the only store when the composition has no storage domain. */
  private readonly memory = new Map<string, SessionBinding>()
  // Assigned explicitly rather than as a parameter property: the headless
  // composition loads this file from source through Node's strip-only type
  // removal, which rejects parameter properties outright (same reason
  // index.ts declares its own fields).
  private readonly ctx: BindingContext
  private readonly opening: Promise<void>
  private table: BindingTable | undefined
  /** The domain was closed with this fiber: this instance serves nothing durable any more. */
  private closed = false

  constructor(ctx: BindingContext) {
    this.ctx = ctx
    this.opening = this.open()
  }

  /** Whether a write survives a restart. False = process memory only. */
  get persistent(): boolean {
    return this.table !== undefined && !this.closed
  }

  /** One session's binding, or undefined when it has none. Synchronous by contract. */
  read(sessionId: string): SessionBinding | undefined {
    if (this.closed) return undefined
    try {
      return this.table?.get(sessionId) ?? this.memory.get(sessionId)
    } catch (error) {
      if (!this.gone(error)) throw error
      return undefined
    }
  }

  /**
   * Store one session's binding.
   *
   * Durable first, then memory: a rejected backend write must leave reads
   * showing the previous state and must reach the caller unchanged, or the UI
   * would refresh a chip for a binding that does not exist.
   */
  async write(sessionId: string, binding: SessionBinding): Promise<void> {
    assertBinding(binding)
    await this.opening
    if (this.closed) throw reloadedError()
    if (this.table !== undefined) {
      try {
        await this.table.put(sessionId, binding)
      } catch (error) {
        if (!this.gone(error)) throw error
        // 明确失败，不写进一个马上被丢弃的内存表：那会让浏览器收到"保存成功"而配置已经没了。
        throw reloadedError()
      }
      return
    }
    this.memory.set(sessionId, binding)
  }

  /**
   * Fold a closed-domain refusal into "this instance is gone".
   *
   * The refusal is `DomainError('closed')` from `storage-domain` — a narrow,
   * typed signal from another package, not a blanket catch: any other failure is
   * rethrown unchanged.
   */
  private gone(error: unknown): boolean {
    if ((error as { code?: unknown }).code !== 'closed') return false
    this.closed = true
    this.table = undefined
    return true
  }

  private async open(): Promise<void> {
    const facility = this.ctx.get('storageDomain') as StorageDomainFace | undefined
    if (facility === undefined) return
    try {
      const domain = await this.openDomain(facility)
      this.ctx.effect(() => () => this.closeDomain(domain), 'router: session bindings domain')
      this.table = domain.table('bindings')
    } catch (error) {
      // 打不开不等于"没有存储"：磁盘上可能还有用户写过的绑定，读不出来必须说出来，
      // 否则他会在下一次打开会话时以为自己的选择被清空了。入口保留——退回内存后行为
      // 与无 storage 的实例完全一致（这正是内存那条路的既有语义）。
      this.ctx.logger.error(
        `model-router: the ${SESSION_BINDINGS_DOMAIN} storage domain could not open; `
        + `session bindings fall back to process memory and will not survive a restart: ${String(error)}`,
      )
    }
  }

  /**
   * Open the domain, riding out the one transient refusal: a fiber restart closes
   * the old domain and opens the new one in quick succession, and the facility
   * refuses a name that is "open or still closing" with `already-open`
   * (storage-domain/src/index.ts:104-106). Without this retry a config save would
   * silently leave the NEW instance memory-only until the next restart.
   */
  private async openDomain(facility: StorageDomainFace): Promise<OpenDomain> {
    let lastError: unknown
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await facility.open(sessionBindingsDomain)
      } catch (error) {
        lastError = error
        if ((error as { code?: unknown }).code !== 'already-open') throw error
        await new Promise<void>(resolve => setTimeout(resolve, 50))
      }
    }
    throw lastError
  }

  private closeDomain(domain: OpenDomain): void {
    this.closed = true
    this.table = undefined
    void domain.close()
  }
}

/** The message a write gets when the instance it reached is already on its way out. */
function reloadedError(): Error {
  return new Error('model-router: the router was just restarted, so this binding did not land; retry in a moment')
}

/**
 * Reject a binding the wire should not have produced.
 *
 * Both checks are about silent no-ops: a route key nobody matches and a count
 * outside 0..9 would each look saved and then quietly do nothing, which is the
 * failure mode this project treats as worse than a loud error.
 */
function assertBinding(binding: SessionBinding): void {
  for (const [route, retries] of Object.entries(binding.retries)) {
    const parts = routeParts(route)
    if (parts.provider === '' || parts.model === '') {
      throw new Error(`model-router: session binding retries key '${route}' is not a provider/model route`)
    }
    if (!Number.isInteger(retries) || retries < 0 || retries > MAX_SESSION_RETRIES) {
      throw new Error(
        `model-router: session binding retries for ${route} must be an integer in 0..${MAX_SESSION_RETRIES}, got ${String(retries)}`,
      )
    }
  }
}
