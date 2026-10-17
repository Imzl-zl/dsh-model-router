/**
 * The CROSS-FIELD config rules: one expression, two consumers.
 *
 * The host throws the first violation — a config update fails loudly and
 * whole; the browser half formats every violation into its problem list —
 * the user fixes what the form shows, not what a log says. Both sides used
 * to carry their own copy of these rules, stitched together by comments
 * promising they were in sync, and they had already drifted: the default
 * pool's repeated route was refused by the host and accepted by the form,
 * so a user could save a config that died on the next load with an English
 * error. The rules now exist once, here.
 *
 * Single-field bounds (an empty provider, maxAttempts out of range) are NOT
 * here and never were: the schema owns them on the host, and the browser's
 * draft-shape checks (client/validate.ts) own them pre-save. That boundary
 * is deliberate — see assertStructural's docstring in config.ts.
 *
 * Note: 为何跨字段校验收编到一处、被否的「两边各留 + 对账测试」方案 —— 见
 * .agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md
 */

import type { Candidate, DefaultProfile, HealthConfig, Profile } from './config.ts'
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
  profiles: readonly Profile[]
  default: DefaultProfile
  health?: HealthConfig
}

/**
 * Every cross-field violation, in the order the host used to throw them —
 * so the first-thrown message is unchanged for a config that breaks several
 * rules at once. The browser reports all of them.
 */
export function structuralViolations(config: StructuralInput): Violation[] {
  const violations: Violation[] = []
  const seenIds = new Set<string>()
  for (const profile of config.profiles) {
    if (seenIds.has(profile.id)) {
      violations.push({
        key: 'problemDuplicateId',
        vars: { id: profile.id },
        message: `model-router: duplicate profile id "${profile.id}"`,
      })
    }
    seenIds.add(profile.id)
    if (profile.candidates.length === 0) {
      violations.push({
        key: 'problemEmptyChain',
        vars: { id: profile.id },
        message: `model-router: profile "${profile.id}" has no candidates`,
      })
      // 空链已报；未钉 primary / 重复渠道 / 权重提示都建立在「有候选」上，不叠加。
      continue
    }
    const head = profile.candidates[0]!
    const pinned = routeKeyOf(profile.when.provider, profile.when.model)
    if (head.provider !== profile.when.provider || head.model !== profile.when.model) {
      violations.push({
        key: 'problemUnpinnedPrimary',
        vars: { id: profile.id, route: pinned },
        message: `model-router: profile "${profile.id}" candidates[0] must be the when model `
          + `(${pinned}), got ${routeKeyOf(head.provider, head.model)}`,
      })
    }
    // 同一条链上重复的 provider/model 没有意义：它会被各打一遍（各含一次退避等待），
    // 白吃 attempt 预算，而用户看到的是「我配了两条备用」。目录选择和多条目手录都可能
    // 录出重复，所以在结构校验就挡住，和 ID 重复同级。
    violations.push(...repeatedRouteViolations(profile.candidates, `profile "${profile.id}"`, profile.id))
  }
  violations.push(...repeatedRouteViolations(config.default.candidates, 'default pool', undefined))
  // A weight strategy with no positive weight has nothing to draw from, and the
  // failure would surface as every request silently starting at candidate 0.
  // 空链已经报了 problemEmptyChain，别再叠加一条权重提示；默认兜底池没有「空链」
  // 这一说，所以它那边不设长度闸（与 host 旧的抛出点一致）。
  for (const profile of config.profiles) {
    if (profile.strategy === 'weight'
      && profile.candidates.length > 0
      && profile.candidates.every(candidate => !(candidate.weight > 0))) {
      violations.push({
        key: 'problemProfileWeightNoPositive',
        vars: { id: profile.id },
        message: `model-router: profile "${profile.id}" uses the weight strategy but no candidate has a positive weight`,
      })
    }
  }
  if (config.default.strategy === 'weight'
    && config.default.candidates.every(candidate => !(candidate.weight > 0))) {
    violations.push({
      key: 'problemWeightNoPositive',
      vars: {},
      message: 'model-router: the default pool uses the weight strategy but no candidate has a positive weight',
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

/** Reject one chain naming the same physical route twice — profile or default pool. */
function repeatedRouteViolations(
  candidates: readonly Candidate[],
  where: string,
  profileId: string | undefined,
): Violation[] {
  const seen = new Set<string>()
  const violations: Violation[] = []
  candidates.forEach((candidate, index) => {
    const key = routeKeyOf(candidate.provider, candidate.model)
    if (seen.has(key)) {
      const message = `model-router: ${where} names ${key} more than once `
        + `— a repeated candidate is attempted twice and burns the budget twice`
      violations.push(profileId === undefined
        ? { key: 'problemDuplicateRouteInPool', vars: { route: key, index: index + 1 }, message }
        : { key: 'problemDuplicateRoute', vars: { id: profileId, route: key, index: index + 1 }, message })
    }
    seen.add(key)
  })
  return violations
}
