/**
 * The takeover switch's other half: keeping DSH's default model pointed at the
 * plugin's primary model.
 *
 * Why this exists at all: the router only ever rewrites the provider/model of a
 * request that is already being made. It cannot make a NEW session start on the
 * model the user configured — that choice belongs to DSH's `agentDefaultModel`,
 * which is read exactly when a session has no request header and no pending
 * pick (`packages/api/session-controller/src/agent.ts:299-304`). Writing it is
 * therefore the only way "turn takeover on and new sessions start on the primary
 * model" can be true, and it is true by DSH's own rules: a running session keeps
 * the route its last request header names, so nothing in flight moves.
 *
 * The cost, stated plainly: DSH saves every manual model pick as the new default
 * (`packages/api/session-controller/src/commands.ts:177`), so one manual pick
 * overrides what this module wrote. That is why the browser is told whether the
 * default still matches the primary, and why re-syncing is an explicit action
 * rather than something the plugin keeps re-asserting on every request —
 * re-asserting would fight the user's own choice.
 *
 * Turning takeover OFF does not undo the write. Restoring a model the user has
 * since changed by hand would be this module overwriting a newer decision with
 * an older one.
 */

import type { Profile } from './config.ts'
import { routeKeyOf } from './routes.ts'

/** The one route the plugin treats as primary: provider plus model, no effort. */
export interface PrimaryRoute {
  provider: string
  model: string
}

/**
 * The slice of DSH's `agentDefaultModel` this module needs.
 *
 * Injected rather than reached for so the decision can be exercised without a
 * Cordis context; the Host passes `ctx.get('agentDefaultModel')`, which is
 * `undefined` in a composition that does not mount the service (the optional
 * service rule) — and that is an answer, not a crash.
 */
export interface DefaultModelFace {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
  saveSelection(next: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
}

/** What a sync attempt concluded. `synced` false with `error` null means "nothing to do". */
export interface DefaultModelSyncOutcome {
  synced: boolean
  error: string | null
}

/** Why the Host could not be asked at all. */
export const NO_DEFAULT_MODEL_SERVICE = 'no-default-model-service'

/**
 * The profile whose pinned model new sessions should start on: the one marked
 * primary, else the first.
 *
 * A marker naming a profile that no longer exists falls back to the first rather
 * than failing — the marker is only ever written from a profile the UI has just
 * rendered, so a dangling one means that profile was deleted, and silently
 * syncing nothing would look identical to "takeover is broken".
 */
export function resolvePrimaryProfile(
  profiles: readonly Profile[],
  primaryProfileId: string,
): Profile | undefined {
  if (profiles.length === 0) return undefined
  const marked = profiles.find(profile => profile.id === primaryProfileId)
  return marked ?? profiles[0]
}

/** The primary profile's pinned model, or `null` when there is no profile to sync. */
export function primaryRouteOf(
  profiles: readonly Profile[],
  primaryProfileId: string,
): PrimaryRoute | null {
  const primary = resolvePrimaryProfile(profiles, primaryProfileId)
  if (primary === undefined) return null
  return { provider: primary.when.provider, model: primary.when.model }
}

/** Two selections name the same route when provider and model agree; the effort is not part of the route. */
export function sameRoute(
  left: { provider: string; model: string } | null | undefined,
  right: { provider: string; model: string } | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false
  return left.provider === right.provider && left.model === right.model
}

/**
 * Point DSH's default model at `primary`, unless it already is.
 *
 * The configured reasoning effort is carried over from the current selection:
 * the user chose the model, not the effort, and dropping it would silently
 * change how every new session runs.
 *
 * A refused save is reported, never swallowed: `configEditor.edit` refuses when
 * the row is overridden by a home patch or a command-line overlay
 * (`packages/boot/config-editor/src/index.ts:139-140`), and a takeover the user
 * turned on that cannot take effect must be visible as such.
 *
 * @param face - the Host's default-model service, or `undefined` when unmounted.
 * @param primary - the route to sync to, or `null` when no profile exists.
 * @param warn - where a refused save is reported.
 */
export async function syncDefaultModel(
  face: DefaultModelFace | undefined,
  primary: PrimaryRoute | null,
  warn: (message: string) => void,
): Promise<DefaultModelSyncOutcome> {
  if (primary === null) return { synced: false, error: null }
  if (face === undefined) return { synced: false, error: NO_DEFAULT_MODEL_SERVICE }
  const current = face.currentSelection()
  if (sameRoute(current, primary)) return { synced: true, error: null }
  try {
    await face.saveSelection({ ...current, provider: primary.provider, model: primary.model })
    return { synced: true, error: null }
  } catch (error) {
    warn(`model-router: could not point new sessions at the primary model ${routeKeyOf(primary.provider, primary.model)}: ${String(error)}`)
    return { synced: false, error: String(error) }
  }
}
