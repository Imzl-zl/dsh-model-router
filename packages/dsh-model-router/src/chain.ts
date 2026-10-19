/**
 * The one global fallback chain, and the one-time migration that gets a legacy
 * config into it.
 *
 * Product shape (decided 2026-10-19): there is no per-model rule and no primary
 * model. Whatever the user selects is the first hop, and it is the only hop the
 * plugin does not own — a failure moves on to the configured fallbacks. That is
 * the same shape the old "default pool" had, promoted to the whole product.
 *
 * The migration exists because an older build stored the chain as one entry per
 * selected model (`profiles[]`, each with a pinned `when` model as
 * `candidates[0]`). A profile's first candidate IS the selected model, which is
 * now the implicit first hop — so it is dropped, and the rest become fallbacks.
 * More than one legacy profile cannot be represented any more; the first one is
 * adopted and the rest are reported so the Host can say so out loud instead of
 * silently discarding a chain the user configured.
 */

import type { ChainConfig } from './config.ts'
import type { Strategy } from './config.ts'
import type { Candidate, SwitchOn } from './config.ts'
import { DEFAULT_POOL_MAX_TOTAL_ATTEMPTS, DEFAULT_STICKY_TURNS, DEFAULT_STRATEGY, DEFAULT_SWITCH_ON } from './defaults.ts'

/** Where the effective chain came from, for a one-time log line. */
export type ChainSource = 'chain' | 'default' | 'profile' | 'empty'

/** What {@link effectiveChain} concluded. */
export interface EffectiveChain {
  chain: ChainConfig
  source: ChainSource
  /** Legacy profiles that could not be represented; the Host warns when > 0. */
  ignoredProfiles: number
}

/** A chain with no fallbacks: the plugin stays out of the request path. */
export function emptyChain(): ChainConfig {
  return {
    candidates: [],
    switchOn: { ...DEFAULT_SWITCH_ON },
    maxTotalAttempts: DEFAULT_POOL_MAX_TOTAL_ATTEMPTS,
    stickyTurns: DEFAULT_STICKY_TURNS,
    strategy: DEFAULT_STRATEGY,
  }
}

/** The shape of the old `profiles[]` entry, read only for migration. */
interface LegacyProfile {
  id?: string
  when?: { provider: string; model: string }
  candidates?: Candidate[]
  switchOn?: Partial<SwitchOn>
  maxTotalAttempts?: number
  stickyTurns?: number
  strategy?: Strategy
}

/** The shape of the old `default` pool, read only for migration. */
interface LegacyDefault {
  candidates?: Candidate[]
  switchOn?: Partial<SwitchOn>
  maxTotalAttempts?: number
  stickyTurns?: number
  strategy?: Strategy
}

/**
 * The raw validated config plus whatever legacy keys schemastery passed through.
 *
 * `default`/`profiles` are `unknown` on purpose: they are not in the schema, so
 * their shape is whatever an older build wrote. {@link effectiveChain} checks
 * the shape it needs instead of trusting a cast.
 */
export interface LegacyAwareConfig {
  chain?: Partial<ChainConfig>
  default?: unknown
  profiles?: unknown
}

function chainFrom(
  candidates: Candidate[],
  over: { switchOn?: Partial<SwitchOn>; maxTotalAttempts?: number; stickyTurns?: number; strategy?: Strategy },
): ChainConfig {
  return {
    candidates,
    switchOn: { ...DEFAULT_SWITCH_ON, ...over.switchOn },
    maxTotalAttempts: typeof over.maxTotalAttempts === 'number' ? over.maxTotalAttempts : DEFAULT_POOL_MAX_TOTAL_ATTEMPTS,
    stickyTurns: typeof over.stickyTurns === 'number' ? over.stickyTurns : DEFAULT_STICKY_TURNS,
    strategy: over.strategy === 'weight' || over.strategy === 'round-robin' ? over.strategy : DEFAULT_STRATEGY,
  }
}

/**
 * The chain the Host and the browser must agree on.
 *
 * A `chain` key that exists wins outright, even with no fallbacks: "an empty
 * chain" is a real configuration (the plugin then stays out of the request
 * path), and treating it as "not configured" would silently re-adopt the
 * legacy shape and overwrite the user's switchOn/budget with old values.
 * Only a config with no `chain` at all gets the legacy look.
 */
export function effectiveChain(raw: LegacyAwareConfig): EffectiveChain {
  const chain = raw.chain
  if (chain !== undefined) {
    return {
      chain: chainFrom(chain.candidates ?? [], chain),
      source: 'chain',
      ignoredProfiles: 0,
    }
  }

  const legacyDefault = isLegacyDefault(raw.default) ? raw.default : undefined
  if (legacyDefault !== undefined && legacyDefault.candidates !== undefined && legacyDefault.candidates.length > 0) {
    return {
      chain: chainFrom(legacyDefault.candidates, legacyDefault),
      source: 'default',
      ignoredProfiles: 0,
    }
  }

  const profiles = Array.isArray(raw.profiles) ? raw.profiles.filter(isLegacyProfile) : []
  if (profiles.length > 0) {
    const adopted = profiles[0]!
    // candidates[0] is the pinned `when` model — it is the implicit first hop now.
    const fallbacks = (adopted.candidates ?? []).slice(1)
    return {
      chain: chainFrom(fallbacks, adopted),
      source: 'profile',
      ignoredProfiles: Math.max(0, profiles.length - 1),
    }
  }

  return { chain: emptyChain(), source: 'empty', ignoredProfiles: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLegacyDefault(value: unknown): value is LegacyDefault {
  return isRecord(value) && (value.candidates === undefined || Array.isArray(value.candidates))
}

function isLegacyProfile(value: unknown): value is LegacyProfile {
  return isRecord(value) && (value.candidates === undefined || Array.isArray(value.candidates))
}
