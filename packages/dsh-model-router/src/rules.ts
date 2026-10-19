/**
 * The CROSS-FIELD config rules: one expression, two consumers.
 *
 * The host throws the first violation — a config update fails loudly and
 * whole; the browser half formats every violation into its problem list —
 * the user fixes what the form shows, not what a log says. Both sides used
 * to carry their own copy of these rules, stitched together by comments
 * promising they were in sync, and they had already drifted. The rules now
 * exist once, here.
 *
 * Single-field bounds (an empty provider, maxAttempts out of range) are NOT
 * here and never were: the schema owns them on the host, and the browser's
 * draft-shape checks (client/validate.ts) own them pre-save. That boundary
 * is deliberate — see assertStructural's docstring in config.ts.
 *
 * Note: 为何跨字段校验收编到一处、被否的「两边各留 + 对账测试」方案 —— 见
 * .agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md
 */

import type { ChainConfig, HealthConfig } from './config.ts'
import { routeKeyOf } from './routes.ts'

/**
 * One broken cross-field rule. `key`/`vars` feed the browser's dictionary;
 * `message` is the host's load-failure text. The host reads only `message`,
 * the browser only `key`/`vars` — one rule, two renderings.
 */
export interface Violation {
  readonly key: string
  readonly vars: Record<string, string | number>
  readonly message: string
}

/** The config shape both sides validate: a host Config's plain value, or a browser draft. */
export type StructuralInput = {
  chain: ChainConfig
  health?: HealthConfig
}

/**
 * Every cross-field violation, in the order the host used to throw them —
 * so the first-thrown message is unchanged for a config that breaks several
 * rules at once. The browser reports all of them.
 */
export function structuralViolations(config: StructuralInput): Violation[] {
  const violations: Violation[] = []
  const candidates = config.chain.candidates
  // 同一条链上重复的 provider/model 没有意义：它会被各打一遍（各含一次退避等待），
  // 白吃 attempt 预算，而用户看到的是「我配了两条备用」。目录选择和多条目手录都可能
  // 录出重复，所以在结构校验就挡住。
  const seen = new Set<string>()
  candidates.forEach((candidate, index) => {
    const key = routeKeyOf(candidate.provider, candidate.model)
    if (seen.has(key)) {
      violations.push({
        key: 'problemDuplicateRouteInChain',
        vars: { route: key, index: index + 1 },
        message: `model-router: the chain names ${key} more than once `
          + `— a repeated candidate is attempted twice and burns the budget twice`,
      })
    }
    seen.add(key)
  })
  // A weight strategy with no positive weight has nothing to draw from, and the
  // failure would surface as every request silently starting at the same hop.
  if (config.chain.strategy === 'weight'
    && candidates.length > 0
    && candidates.every(candidate => !(candidate.weight > 0))) {
    violations.push({
      key: 'problemWeightNoPositive',
      vars: {},
      message: 'model-router: the chain uses the weight strategy but no candidate has a positive weight',
    })
  }
  // 一条两个字段都空白的规则永远命中不了任何东西，留着只会让人以为配过了。
  // 空规则在任何状态下都是配置错误：breaker.ts 对 code/message 全空的规则命中每一次
  // 失败，「关着开关存下一条空规则」会让所有候选被禁。所以这里不看 enabled——规则
  // 可以留着（再开时不用重填），空白规则不行。
  for (const [index, rule] of (config.health?.breaker?.rules ?? []).entries()) {
    if (!rule.code && !rule.message) {
      violations.push({
        key: 'problemBreakerEmptyRule',
        vars: {},
        message: `model-router: health.breaker rule ${index + 1} matches nothing — fill in a code or a message`,
      })
    }
  }
  return violations
}
