/**
 * Wire types for this plugin's own Remote (the Typert host-face contribution).
 *
 * They live in their own public subpath because the generator requires every
 * Remote boundary type to be exported from a non-root public export
 * (packages/typert/generator/src/analyzer.ts — `publicRemoteType`); the root
 * export stays reserved for the plugin's own entry. Plain JSON data only: the
 * generator projects each of these into a strict codec, and a construct it
 * cannot represent fails the build instead of being flattened.
 *
 * Note: 插件自有 Remote 的整体设计 —— 见
 * docs/design/build-pipeline-and-plugin-remote.md；落地取舍见
 * .agents/notes/implemented/2026-10-15-plugin-remote-probe.md
 */

/** One physical route a run addresses. Identity is DSH's own provider/model. */
export interface ProbeRoute {
  provider: string
  model: string
}

/** What a probe run covers. An empty `routes` means every configured route. */
export interface ProbeRequest {
  routes: ProbeRoute[]
}

/**
 * One route's probe outcome.
 *
 * `unavailable` means the check could not run at all — the route is not
 * configurable, or the Host has no way to call it. It says nothing about the
 * channel, so the UI must read it as "unknown", never as a fault. `unreachable`
 * means the call was made and the endpoint, the credential, or the model
 * refused it.
 */
export interface ProbeRouteResult {
  provider: string
  model: string
  kind: 'reachable' | 'unreachable' | 'unavailable'
  /** Whole-call cost to the first content byte, when it arrived. */
  latencyMs?: number
  /** Provider-neutral failure code, when the call was made and failed. */
  error?: string
  /** Epoch ms of this measurement. */
  at: number
}

/** One probe run's report: what was measured, and when. */
export interface ProbeReport {
  at: number
  routes: ProbeRouteResult[]
}

/** What a connectivity run covers. An empty `routes` means every configured route. */
export interface ConnectivityRequest {
  routes: ProbeRoute[]
}

/**
 * One route's connectivity-check outcome.
 *
 * `unavailable` / `unreachable` draw the same line {@link ProbeRouteResult}
 * draws, for the tier that asks DSH's own model discovery for a model list
 * instead of generating a token: `unavailable` means the check could not run at
 * all — the route is not a configurable provider, DSH registers no model
 * discovery for its settings namespace, or the Host face did not answer. It
 * says nothing about the channel, so the UI must read it as "unknown", never as
 * a fault. `unreachable` means the discovery ran and the endpoint, the
 * credential, or the listing refused it.
 *
 * `notAdvertised` is this tier's own fourth answer: the endpoint answered and
 * the credential was accepted, but the model is not on its list. That is a fact
 * about the model, not a fault of the channel.
 */
export interface ConnectivityVerdict {
  provider: string
  model: string
  kind: 'reachable' | 'notAdvertised' | 'unreachable' | 'unavailable'
  /** Why the check could not run at all — a plugin-owned token, never a channel fault. */
  reason?: string
  /** Provider-neutral failure code, when the discovery ran and failed. */
  error?: string
  /** How many models the endpoint advertised, when it answered. */
  advertised?: number
}

// ---- per-session routing bindings ----

/**
 * One session's routing binding, as the Host stores it and the browser reads it.
 *
 * `chain` names a chain and `null` means "follow the default chain". `retries`
 * is keyed by route (`provider/model`) and holds retries AFTER the first call —
 * so 0 ("do not retry") and "no entry" ("use the candidate's own count") are
 * two different answers, and the type keeps them apart.
 */
export interface SessionBinding {
  chain: string | null
  retries: Record<string, number>
}

/** A binding plus the one fact the browser cannot know: whether it survives a restart. */
export interface SessionBindingView extends SessionBinding {
  /** False when the Host offers no storage domain: the binding lives in process memory only. */
  persistent: boolean
}

/** What the browser writes: the session plus the whole binding (no partial merge). */
export interface SessionBindingRequest extends SessionBinding {
  sessionId: string
}

// ---- update check ----

/**
 * What one "is there a newer release?" check found.
 *
 * The three failure shapes are kept apart on purpose, because they mean
 * different things to the person reading the dialog:
 *
 * - `error` — the registry could not be reached, so **the version question is
 *   unknown**. It is never "up to date": an unanswered check is not an answer.
 * - `notesError` — the version IS known (a newer one exists), but its release
 *   notes could not be read. The version answer still stands.
 * - neither — the check ran; `newer` says whether the newest published version
 *   is newer than the one this artifact carries.
 *
 * `notes` carries the newest version's release notes. The running version's own
 * notes are not here: they are embedded in the artifact, so the dialog can show
 * them without a network round trip.
 */
export interface UpdateCheck {
  /** The version this artifact carries. */
  current: string
  /** The newest published version, when the registry answered. */
  latest: string | null
  /** Whether `latest` is newer than `current`. */
  newer: boolean
  /** When the newest version was published (ISO 8601), when the release says so. */
  publishedAt: string | null
  /** The newest version's release notes, when they could be read. */
  notes: string | null
  /** Why the check could not run, when it could not. */
  error: string | null
  /** Why the newest version's notes could not be read, when the version could. */
  notesError: string | null
}
