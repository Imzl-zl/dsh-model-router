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

import type { PrimaryRoute } from './default-model.ts'

/**
 * What the browser is told about the takeover switch's default-model sync.
 *
 * `current` is what DSH would start a brand-new session on right now. `synced`
 * says whether that is still the plugin's primary model — DSH saves every manual
 * pick as the new default (`packages/api/session-controller/src/commands.ts:177`),
 * so a manual pick moves `current` away from `primary` and this is the only
 * place the user can see it happened.
 */
export interface DefaultModelStatus {
  /** The takeover switch's saved state: the feature this status belongs to. */
  enabled: boolean
  /** The primary model new sessions would be pointed at, or null without a profile. */
  primary: PrimaryRoute | null
  /** DSH's current default selection, or null when the Host carries no such service. */
  current: { provider: string; model: string; reasoningEffort?: string } | null
  /** Whether `current` and `primary` are the same route. */
  synced: boolean
  /** Why the last sync attempt did not land, or null when it did or never ran. */
  lastError: string | null
}

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
