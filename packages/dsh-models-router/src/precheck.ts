/**
 * Which tier a capability pre-check failure belongs to.
 *
 * `ctx.llm.resolveCallConfig` (llm/src/index.ts:871-872) is the same call the
 * Agent loop's `prepareCall` makes, so its rejections are the authoritative
 * "this candidate cannot serve this request" signal. It throws several
 * distinguishable things, and the user's next action is different for each —
 * which is why one catch-all notice was a lie: it named the wrong place to
 * look.
 *
 * - `request-shape`: the REQUEST does not fit the model
 *   (`UNSUPPORTED_REASONING_EFFORT`, llm/src/index.ts:897). The user asked for
 *   something this model cannot do.
 * - `route-missing`: the ROUTE does not exist here (`NO_ADAPTER` from
 *   llm/src/index.ts:995, `INVALID_CONFIG` / `UNKNOWN_MODEL` from
 *   llm-pi-ai/src/adapter.ts:268,271). The provider is not registered or the
 *   model is not in its catalog, so the fix is on the Models page — nothing
 *   in this chain is wrong.
 * - `adapter-defect`: the ADAPTER broke its own contract (the
 *   `normalizeModelInfo` family, llm/src/index.ts:760-823). Nothing the user
 *   configured can cause it, and reporting it as "this candidate does not
 *   support your request" sends them to edit a chain that was never wrong.
 *
 * A code in none of the three sets keeps the generic notice: the plugin
 * cannot know who can fix it, and inventing a tier would be the same lie in
 * new wording.
 *
 * Note: 三档的定案依据、被否方案（为何不 rethrow、为何不是两档）—— 见
 * .agents/notes/implemented/2026-10-17-failure-classification-tiers.md
 */

/** Who has to act before this candidate can serve a request again. */
export type PrecheckTier = 'request-shape' | 'route-missing' | 'adapter-defect'

const REQUEST_SHAPE_CODES: ReadonlySet<string> = new Set([
  'UNSUPPORTED_REASONING_EFFORT',
])

const ROUTE_MISSING_CODES: ReadonlySet<string> = new Set([
  'NO_ADAPTER',
  'INVALID_CONFIG',
  'UNKNOWN_MODEL',
])

/**
 * The whole `normalizeModelInfo` family: all four are raised by that one
 * validator, for adapter-returned exact-model metadata that fails its shape
 * check (llm/src/index.ts:766,773,801,819).
 */
const ADAPTER_DEFECT_CODES: ReadonlySet<string> = new Set([
  'INVALID_MODEL_INFO',
  'INVALID_MODEL_CONTEXT',
  'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING',
])

/** The tier one pre-check failure code belongs to; `undefined` = no named tier. */
export function precheckTierOf(code: string): PrecheckTier | undefined {
  if (REQUEST_SHAPE_CODES.has(code)) return 'request-shape'
  if (ROUTE_MISSING_CODES.has(code)) return 'route-missing'
  if (ADAPTER_DEFECT_CODES.has(code)) return 'adapter-defect'
  return undefined
}
