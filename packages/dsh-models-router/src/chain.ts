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
  DEFAULT_MAX_TOKEN_AUTO_CONTINUE,
  DEFAULT_MAX_TOKEN_CONTINUES,
  DEFAULT_STICKY_TURNS,
  DEFAULT_STRATEGY,
  DEFAULT_SWITCH_ON,
  POLICY_VERSION,
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
    maxTokens: defaultMaxTokens(),
  }
}

/** 截断策略的默认值：续跑开、每候选 2 次；用完换候选。 */
export function defaultMaxTokens(): ChainConfig['maxTokens'] {
  return { autoContinue: DEFAULT_MAX_TOKEN_AUTO_CONTINUE, continues: DEFAULT_MAX_TOKEN_CONTINUES }
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
 * The stored config as these migrations read it: the RAW value, so that "this key
 * was never written" is observable. `chains`/`default`/`profiles` are `unknown`
 * because an older build's shape is whatever it wrote; the fields it needs are
 * checked instead of trusted. `chain` names the one legacy key it reads by
 * presence, plus `firstHopMaxAttempts` (a call count, superseded by
 * `firstHopMaxRetries`).
 */
export interface LegacyAwareConfig {
  chains?: unknown
  defaultChainId?: unknown
  chain?: Partial<ChainConfig> & { firstHopMaxAttempts?: number }
  default?: unknown
  profiles?: unknown
  /** 策略版本：缺失 = 本次之前写的配置，按"失败默认全切"的一次性迁移处理。 */
  policyVersion?: unknown
}

/** The chain-level fields a legacy record may carry, in either vocabulary. */
interface LegacyChainFields {
  switchOn?: Partial<SwitchOn>
  stickyTurns?: number
  strategy?: Strategy
  firstHopMaxRetries?: number
  firstHopMaxAttempts?: number
  maxTokens?: Partial<ChainConfig['maxTokens']>
}

/**
 * 这次读取是否要按"失败默认全切"改写 `switchOn`。
 *
 * 旧配置里 `emptyResponse` / `invalidRequest` 是 false——那是当时的默认值，
 * 不是用户的选择，读不出区别。所以没有 v2 标记的配置一律按新默认（全 true）读，
 * 用户之后自己取消勾选的码在保存后带着标记落盘，再也不会被覆盖。
 */
function policyIsCurrent(raw: LegacyAwareConfig): boolean {
  return raw.policyVersion === POLICY_VERSION
}

function switchOnOf(over: Partial<SwitchOn> | undefined, policyCurrent: boolean): SwitchOn {
  return policyCurrent ? { ...DEFAULT_SWITCH_ON, ...over } : { ...DEFAULT_SWITCH_ON }
}

function maxTokensOf(over: Partial<ChainConfig['maxTokens']> | undefined): ChainConfig['maxTokens'] {
  return {
    autoContinue: typeof over?.autoContinue === 'boolean'
      ? over.autoContinue
      : DEFAULT_MAX_TOKEN_AUTO_CONTINUE,
    continues: typeof over?.continues === 'number'
      ? Math.max(0, Math.min(9, Math.round(over.continues)))
      : DEFAULT_MAX_TOKEN_CONTINUES,
  }
}

function chainFrom(candidates: LegacyCandidate[], over: LegacyChainFields, policyCurrent: boolean): ChainConfig {
  return {
    candidates: candidates.map(candidate => normalizeCandidate(candidate, policyCurrent)),
    switchOn: switchOnOf(over.switchOn, policyCurrent),
    stickyTurns: typeof over.stickyTurns === 'number' ? over.stickyTurns : DEFAULT_STICKY_TURNS,
    strategy: over.strategy === 'weight' || over.strategy === 'round-robin' ? over.strategy : DEFAULT_STRATEGY,
    firstHopMaxRetries: firstHopRetriesOf(over, policyCurrent),
    maxTokens: maxTokensOf(over.maxTokens),
  }
}

/**
 * Retries after the first hop's first call, from either vocabulary.
 *
 * Same rule as the candidates: the legacy key wins by presence. A config saved
 * before 2026-10-20 has `firstHopMaxAttempts` (calls); the schema then stamps
 * the new `firstHopMaxRetries: 0` default beside it.
 */
function firstHopRetriesOf(
  over: { firstHopMaxRetries?: number; firstHopMaxAttempts?: number },
  policyCurrent: boolean,
): number {
  if (typeof over.firstHopMaxAttempts === 'number') return Math.max(0, over.firstHopMaxAttempts - 1)
  if (typeof over.firstHopMaxRetries !== 'number') return DEFAULT_FIRST_HOP_MAX_RETRIES
  // 旧默认是 0（一失败就换），它是当时的默认值而不是用户的选择：没有 v2 标记的配置
  // 里出现的 0 与"用户刻意关掉重试"读不出区别，按新默认改写一次。保存后带标记落盘。
  if (!policyCurrent && over.firstHopMaxRetries === 0) return DEFAULT_FIRST_HOP_MAX_RETRIES
  return over.firstHopMaxRetries
}

/** One candidate in the config's vocabulary: retries, not total calls. */
function normalizeCandidate(candidate: LegacyCandidate, policyCurrent: boolean): Candidate {
  const maxRetries = typeof candidate.maxAttempts === 'number'
    ? Math.max(0, candidate.maxAttempts - 1)
    : typeof candidate.maxRetries === 'number'
      // 同上：旧默认 0 一次性改写成新默认。
      ? (policyCurrent || candidate.maxRetries !== 0 ? candidate.maxRetries : DEFAULT_MAX_RETRIES)
      : DEFAULT_MAX_RETRIES
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
  const policyCurrent = policyIsCurrent(raw)
  const chain = raw.chain
  if (chain !== undefined) {
    return {
      chain: chainFrom(chain.candidates ?? [], chain, policyCurrent),
      source: 'chain',
      ignoredProfiles: 0,
    }
  }

  // A profile is the more specific intent: it was pinned to the model the user had
  // selected (`when`), and its remaining candidates are exactly the fallbacks that
  // model used. The old fallback pool only ran when NO profile matched the
  // selection, so it is the right answer only when there is no profile at all —
  // reading it first would route a user who configured both onto the pool and
  // silently drop the chain he actually built.
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
      }, policyCurrent),
      source: 'profile',
      ignoredProfiles: Math.max(0, profiles.length - 1),
    }
  }

  const legacyDefault = isLegacyDefault(raw.default) ? raw.default : undefined
  if (legacyDefault !== undefined && legacyDefault.candidates !== undefined && legacyDefault.candidates.length > 0) {
    return {
      chain: chainFrom(legacyDefault.candidates, legacyDefault, policyCurrent),
      source: 'default',
      ignoredProfiles: 0,
    }
  }

  return { chain: emptyChain(), source: 'empty', ignoredProfiles: 0 }
}

/**
 * The chain set the Host and the browser must agree on.
 *
 * Which shape wins is decided by which KEY EXISTS in the stored config, in this
 * order: `chains` (named chains) → `chain` (the single chain of 2026-10-19) →
 * `profiles` (per-model rules) → `default` (the old fallback pool). Presence is
 * read from the RAW config, never from the schema-validated value: schemastery
 * stamps a default onto every declared field (`chain` becomes an empty chain,
 * any array becomes `[]`), so a validated object cannot tell "the user wrote
 * nothing" from "the user wrote an empty one".
 *
 * That distinction is what made the first version of this migration dead on
 * arrival: a config with only `profiles` was read as the stamped empty `chain`,
 * so the plugin stopped taking over after an upgrade. The Host feeds this
 * function `ctx.fiber._config` (the raw config, cordis `fiber.d.ts:107-108`).
 *
 * Note: 为何旧配置一直没被认领（校验后的值分不出"没写过"）、为何 profiles 先于兜底池 —— 见
 * .agents/notes/implemented/2026-10-21-raw-config-shape-and-domain-lifecycle.md
 */
export function effectiveChains(raw: LegacyAwareConfig): EffectiveChains {
  const policyCurrent = policyIsCurrent(raw)
  if (raw.chains !== undefined) {
    const stored = Array.isArray(raw.chains) ? raw.chains : []
    return {
      chains: stored.length > 0
        ? stored.map((value, index) => namedChainFrom(value, index, policyCurrent))
        // 一条链都没有与"一条空链"行为完全相同（插件不接管），但只有后者是可编辑的对象。
        : [{ id: defaultChainIdOf(raw), name: '', ...emptyChain() }],
      defaultChainId: defaultChainIdOf(raw),
      source: 'chains',
      ignoredProfiles: 0,
    }
  }
  if (raw.chain !== undefined) {
    return {
      chains: [{ id: DEFAULT_CHAIN_ID, name: '', ...chainFrom(raw.chain.candidates ?? [], raw.chain, policyCurrent) }],
      defaultChainId: DEFAULT_CHAIN_ID,
      source: 'chain',
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
function namedChainFrom(value: unknown, index: number, policyCurrent: boolean): NamedChain {
  const record = isRecord(value) ? value : {}
  const candidates = Array.isArray(record.candidates) ? record.candidates.filter(isLegacyCandidate) : []
  const id = typeof record.id === 'string' && record.id !== '' ? record.id : `${DEFAULT_CHAIN_ID}-${index + 1}`
  const name = typeof record.name === 'string' ? record.name : ''
  return { id, name, ...chainFrom(candidates, record, policyCurrent) }
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
