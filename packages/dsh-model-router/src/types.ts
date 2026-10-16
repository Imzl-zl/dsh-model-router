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

/** One physical route the probe measures. Identity is DSH's own provider/model. */
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
