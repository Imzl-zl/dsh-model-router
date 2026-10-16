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
 */

/** The route key DSH's own notices and this plugin's records use: `provider/model`. */
export function routeKeyOf(provider: string, model: string): string {
  return `${provider}/${model}`
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
