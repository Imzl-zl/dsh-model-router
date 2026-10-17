/**
 * Route identity: one rule, four consumers.
 *
 * The host walks chains and probes routes; the browser half lists the same
 * routes for its connectivity check, its probe run, and the health workspace.
 * When each side builds the key itself, "which routes does this config name"
 * and "what does a route string look like" become two facts that drift — and a
 * drifted key silently splits one channel into two records.
 *
 * Everything here is pure and shared: `src/index.ts` (host) and
 * `src/client/*` (browser half) import the same functions.
 *
 * Note: 为何拼键与拆键必须各只有一个表达式（曾 40 处手抄）—— 见
 * .agents/notes/implemented/2026-10-17-finish-the-shared-modules.md
 */

/** The route key DSH's own notices and this plugin's records use: `provider/model`. */
export function routeKeyOf(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * The inverse of `routeKeyOf`: split a stored route key back into its halves.
 *
 * The split stops at the FIRST slash. A provider name never contains one (DSH
 * provider names are identifiers), while a model id can (a gateway's own model
 * path) — so the first slash is the only unambiguous cut, and this is the one
 * place that rule is written down.
 *
 * A key with no slash at all is not a route key. Folding one must not throw —
 * a malformed record must not take the fold down — so it comes back as
 * `{ provider: key, model: '' }` and the caller's own emptiness guard drops it
 * (the health workspace's `ensure` does exactly that).
 */
export function routeParts(key: string): { provider: string; model: string } {
  const slash = key.indexOf('/')
  return slash < 0 ? { provider: key, model: '' } : { provider: key.slice(0, slash), model: key.slice(slash + 1) }
}

/** One candidate as the chain walkers see it: a physical route plus its knobs. */
export interface RoutableCandidate {
  readonly provider: string
  readonly model: string
}

/**
 * Every physical route a config names, deduplicated, in chain order: profiles
 * first, then the default pool. Deduplication is what keeps a route that
 * appears in three profiles from being probed or checked three times.
 */
export function configuredRoutes(
  profiles: readonly { candidates: readonly RoutableCandidate[] }[],
  fallback: { candidates: readonly RoutableCandidate[] },
): string[] {
  const seen = new Set<string>()
  const routes: string[] = []
  const collect = (candidates: readonly RoutableCandidate[]): void => {
    for (const candidate of candidates) {
      const key = routeKeyOf(candidate.provider, candidate.model)
      if (seen.has(key)) continue
      seen.add(key)
      routes.push(key)
    }
  }
  for (const profile of profiles) collect(profile.candidates)
  collect(fallback.candidates)
  return routes
}

/**
 * The route label DSH's own notices use: the bare model inside one provider,
 * `provider/model` across providers — so a chain that stays on one gateway
 * reads as model names, and a cross-gateway switch says which gateway.
 */
export function routeLabel(provider: string, model: string, otherProvider: string): string {
  return provider === otherProvider ? model : routeKeyOf(provider, model)
}
