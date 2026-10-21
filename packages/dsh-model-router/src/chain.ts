/**
 * The named chains, the one-time migrations that get a legacy config into them,
 * and the rule that picks a chain for a session.
 *
 * Product shape (decided 2026-10-19, extended 2026-10-21): there is no per-model
 * rule and no primary model. Whatever the user selects is the first hop, and it
 * is the only hop the plugin does not own — a failure moves on to the configured
 * fallbacks. A session may bind itself to one of several named chains; a session
 * with no binding, and a binding naming a chain that no longer exists, both fall
 * back to `defaultChainId`.
 *
 * Migrations exist because an older build stored one chain in two other shapes:
 *
 * - `chain` — a single global chain. It becomes the one named chain with id
 *   `DEFAULT_CHAIN_ID`, keeping every field as it was. This is the "old config =
 *   one chain without a match rule" migration; behavior is identical because the
 *   first hop was never part of the config.
 * - `profiles[]` — one entry per selected model, each with a pinned `when` model
 *   as `candidates[0]`. A profile's first candidate IS the selected model, which
 *   is now the implicit first hop — so it is dropped, and the rest become
 *   fallbacks. More than one legacy profile cannot be represented any more; the
 *   first one is adopted and the rest are reported so the Host can say so out
 *   loud instead of silently discarding a chain the user configured.
 *
 * Note: 为何一条空链是配置、而非"没配" —— 见
 * .agents/notes/implemented/2026-10-19-one-global-fallback-chain.md
 * Note: 为何 `chains` 不能有 schema 默认值、空链列表怎么解释 —— 见
 * .agents/notes/implemented/2026-10-21-named-chains-and-the-session-chip.md
 */

import type { ChainConfig, NamedChain } from './config.ts'
import type { Strategy } from './config.ts'
import type { Candidate, SwitchOn } from './config.ts'
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_FIRST_HOP_MAX_RETRIES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_STICKY_TURNS,
  DEFAULT_STRATEGY,
  DEFAULT_SWITCH_ON,
} from './defaults.ts'

/** Where the effective chains came from, for a one-time log line. */
export type ChainSource = 'chains' | 'chain' | 'default' | 'profile' | 'empty'

/** What {@link effectiveChain} concluded. */
export interface EffectiveChain {
  chain: ChainConfig
  source: ChainSource
  /** Legacy profiles that could not be represented; the Host warns when > 0. */
  ignoredProfiles: number
}

/** What {@link effectiveChains} concluded: the chain set the Host executes. */
export interface EffectiveChains {
  chains: NamedChain[]
  defaultChainId: string
  source: ChainSource
  /** Legacy profiles that could not be represented; the Host warns when > 0. */
  ignoredProfiles: number
}

/** A chain with no fallbacks: the plugin stays out of the request path. */
export function emptyChain(): ChainConfig {
  return {
    candidates: [],
    switchOn: { ...DEFAULT_SWITCH_ON },
    stickyTurns: DEFAULT_STICKY_TURNS,
    strategy: DEFAULT_STRATEGY,
    firstHopMaxRetries: DEFAULT_FIRST_HOP_MAX_RETRIES,
  }
}

/**
 * A candidate as an older build wrote it: a CALL count, not a retry count.
 *
 * `maxAttempts` is the pre-2026-10-20 field. Schemastery preserves unknown keys
 * (verified against the real library), so a legacy record reaches this file with
 * BOTH keys — the schema stamps its `maxRetries` default onto every object it
 * validates. That is why {@link normalizeCandidate} keys the migration on the
 * legacy field's PRESENCE, never on which value "looks configured".
 */
interface LegacyCandidate {
  provider: string
  model: string
  maxRetries?: number
  maxAttempts?: number
  weight?: number
  needs?: Candidate['needs']
}

/** The shape of the old `profiles[]` entry, read only for migration. */
interface LegacyProfile {
  id?: string
  when?: { provider: string; model: string }
  candidates?: LegacyCandidate[]
  switchOn?: Partial<SwitchOn>
  stickyTurns?: number
  strategy?: Strategy
}

/** The shape of the old `default` pool, read only for migration. */
interface LegacyDefault {
  candidates?: LegacyCandidate[]
  switchOn?: Partial<SwitchOn>
  stickyTurns?: number
  strategy?: Strategy
}

/**
 * The raw validated config plus whatever legacy keys schemastery passed through.
 *
 * `chains` is `unknown` on purpose: {@link effectiveChains} reads whatever shape
 * the stored config carries (a browser draft included) and checks what it needs.
 * `default`/`profiles` are `unknown` for the same reason. `chain` names the one
 * legacy key it still reads: `firstHopMaxAttempts` (a call count, superseded by
 * `firstHopMaxRetries`).
 */
export interface LegacyAwareConfig {
  chains?: unknown
  defaultChainId?: unknown
  chain?: Partial<ChainConfig> & { firstHopMaxAttempts?: number }
  default?: unknown
  profiles?: unknown
}

/** The chain-level fields a legacy record may carry, in either vocabulary. */
interface LegacyChainFields {
  switchOn?: Partial<SwitchOn>
  stickyTurns?: number
  strategy?: Strategy
  firstHopMaxRetries?: number
  firstHopMaxAttempts?: number
}

function chainFrom(candidates: LegacyCandidate[], over: LegacyChainFields): ChainConfig {
  return {
    candidates: candidates.map(normalizeCandidate),
    switchOn: { ...DEFAULT_SWITCH_ON, ...over.switchOn },
    stickyTurns: typeof over.stickyTurns === 'number' ? over.stickyTurns : DEFAULT_STICKY_TURNS,
    strategy: over.strategy === 'weight' || over.strategy === 'round-robin' ? over.strategy : DEFAULT_STRATEGY,
    firstHopMaxRetries: firstHopRetriesOf(over),
  }
}

/**
 * Retries after the first hop's first call, from either vocabulary.
 *
 * Same rule as the candidates: the legacy key wins by presence. A config saved
 * before 2026-10-20 has `firstHopMaxAttempts` (calls); the schema then stamps
 * the new `firstHopMaxRetries: 0` default beside it.
 */
function firstHopRetriesOf(over: { firstHopMaxRetries?: number; firstHopMaxAttempts?: number }): number {
  if (typeof over.firstHopMaxAttempts === 'number') return Math.max(0, over.firstHopMaxAttempts - 1)
  return typeof over.firstHopMaxRetries === 'number' ? over.firstHopMaxRetries : DEFAULT_FIRST_HOP_MAX_RETRIES
}

/** One candidate in the config's vocabulary: retries, not total calls. */
function normalizeCandidate(candidate: LegacyCandidate): Candidate {
  const maxRetries = typeof candidate.maxAttempts === 'number'
    ? Math.max(0, candidate.maxAttempts - 1)
    : typeof candidate.maxRetries === 'number' ? candidate.maxRetries : DEFAULT_MAX_RETRIES
  return {
    provider: candidate.provider,
    model: candidate.model,
    maxRetries,
    weight: candidate.weight ?? 0,
    ...(candidate.needs === undefined ? {} : { needs: candidate.needs }),
  }
}

/**
 * The legacy single chain: what an older build stored, and the value
 * {@link effectiveChains} folds into the one named chain.
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
    // Its call count is exactly what the first hop's retry budget means today
    // (calls - 1), so the migration carries it instead of resetting a configured
    // 3-call hop back to the default of no retry.
    const pinned = (adopted.candidates ?? [])[0]
    const fallbacks = (adopted.candidates ?? []).slice(1)
    return {
      chain: chainFrom(fallbacks, {
        ...adopted,
        ...(pinned?.maxAttempts === undefined ? {} : { firstHopMaxAttempts: pinned.maxAttempts }),
      }),
      source: 'profile',
      ignoredProfiles: Math.max(0, profiles.length - 1),
    }
  }

  return { chain: emptyChain(), source: 'empty', ignoredProfiles: 0 }
}

/**
 * The chain set the Host and the browser must agree on.
 *
 * A NON-EMPTY stored `chains` list wins outright. An empty one cannot: schemastery
 * gives every array schema the default `[]`, so "the key was never written" and
 * "the key was written empty" are the same value by the time either half sees it.
 * The legacy look is therefore taken for an empty list — and that is sound in
 * practice because the editor never writes one (a draft always holds at least one
 * chain), so an empty list can only come from a config written by an older build
 * or hand-edited to `chains: []` beside an old `chain:`. In both cases the old
 * chain is the only routing data present, and migrating it cannot lose a choice
 * the user made; treating it as "route nothing" could.
 */
export function effectiveChains(raw: LegacyAwareConfig): EffectiveChains {
  const stored = Array.isArray(raw.chains) ? raw.chains : []
  if (stored.length > 0) {
    return {
      chains: stored.map((value, index) => namedChainFrom(value, index)),
      defaultChainId: defaultChainIdOf(raw),
      source: 'chains',
      ignoredProfiles: 0,
    }
  }
  const legacy = effectiveChain(raw)
  return {
    chains: [{ id: DEFAULT_CHAIN_ID, name: '', ...legacy.chain }],
    defaultChainId: DEFAULT_CHAIN_ID,
    source: legacy.source,
    ignoredProfiles: legacy.ignoredProfiles,
  }
}

/**
 * The chain a session with no binding routes on.
 *
 * A `defaultChainId` naming a chain that does not exist is a structural error the
 * Host refuses at load (`./rules.ts`), so this falls back to the first chain only
 * for the editor, which must render the broken state instead of crashing on it.
 */
export function defaultChainOf(config: { chains: readonly NamedChain[]; defaultChainId: string }): NamedChain | undefined {
  return config.chains.find(chain => chain.id === config.defaultChainId) ?? config.chains[0]
}

/**
 * The chain one session routes on: the chain it bound itself to, otherwise the
 * default one. A binding that names a chain the config no longer has resolves to
 * the DEFAULT chain and reports the missing id, so the caller can say so out loud
 * — silently rerouting would leave the user believing his choice is in force.
 */
export function chainForSession(
  config: { chains: readonly NamedChain[]; defaultChainId: string },
  boundChainId: string | null,
): { chain: NamedChain; missing: string | undefined } {
  const fallback = defaultChainOf(config)
  if (fallback === undefined) {
    // {@link effectiveChains} always yields at least one chain, so reaching this
    // means a caller handed over a config that never went through it. Say so
    // instead of routing on an undefined chain.
    throw new Error('model-router: the config declares no chain to route on')
  }
  if (boundChainId !== null) {
    const bound = config.chains.find(chain => chain.id === boundChainId)
    if (bound !== undefined) return { chain: bound, missing: undefined }
    return { chain: fallback, missing: boundChainId }
  }
  return { chain: fallback, missing: undefined }
}

/** How a chain names itself in a message: its display name, else its id. */
export function chainLabel(chain: { id: string; name: string }): string {
  return chain.name !== '' ? chain.name : chain.id
}

/** One stored chain, read through the same normalizer as every other shape. */
function namedChainFrom(value: unknown, index: number): NamedChain {
  const record = isRecord(value) ? value : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates.filter(isLegacyCandidate) : []
  const id = typeof record.id === 'string' && record.id !== '' ? record.id : `${DEFAULT_CHAIN_ID}-${index + 1}`
  const name = typeof record.name === 'string' ? record.name : ''
  return { id, name, ...chainFrom(candidates, record) }
}

function defaultChainIdOf(raw: LegacyAwareConfig): string {
  return typeof raw.defaultChainId === 'string' && raw.defaultChainId !== '' ? raw.defaultChainId : DEFAULT_CHAIN_ID
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLegacyCandidate(value: unknown): value is LegacyCandidate {
  return isRecord(value) && typeof value.provider === 'string' && typeof value.model === 'string'
}

function isLegacyDefault(value: unknown): value is LegacyDefault {
  return isRecord(value) && (value.candidates === undefined || Array.isArray(value.candidates))
}

function isLegacyProfile(value: unknown): value is LegacyProfile {
  return isRecord(value) && (value.candidates === undefined || Array.isArray(value.candidates))
}
