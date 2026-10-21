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
 * Every physical route the chain names, deduplicated, in chain order.
 *
 * The first hop is the user's current selection and is not in the config, so it
 * is not here either — the probe and the connectivity check cover the fallbacks
 * the user configured.
 */
export function configuredRoutes(chain: { candidates: readonly RoutableCandidate[] }): string[] {
  const seen = new Set<string>()
  const routes: string[] = []
  for (const candidate of chain.candidates) {
    const key = routeKeyOf(candidate.provider, candidate.model)
    if (seen.has(key)) continue
    seen.add(key)
    routes.push(key)
  }
  return routes
}

/**
 * Every configured route across every chain, from a config or a browser draft:
 * the set the host's probe and connectivity runs cover, and the browser's lists
 * show. A draft's fields may be absent (an older record, a half-built form row),
 * so this adapter normalizes them and delegates — the collection rule itself
 * stays {@link configuredRoutes}' alone. Across chains the routes are folded
 * once: two chains naming the same route are two orders of one physical channel,
 * and a probe or a health row is about the channel, not the order.
 */
export function configuredRouteList(config: {
  chains?: readonly { candidates: readonly RoutableCandidate[] }[]
}): string[] {
  return configuredRoutes({ candidates: (config.chains ?? []).flatMap(chain => chain.candidates) })
}

/**
 * The route label DSH's own notices use: the bare model inside one provider,
 * `provider/model` across providers — so a chain that stays on one gateway
 * reads as model names, and a cross-gateway switch says which gateway.
 */
export function routeLabel(provider: string, model: string, otherProvider: string): string {
  return provider === otherProvider ? model : routeKeyOf(provider, model)
}
