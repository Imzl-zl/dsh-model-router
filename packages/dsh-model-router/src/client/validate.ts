/** Client-side mirror of the host's structural checks, plus config defaults and legacy normalization. */

import { clone } from './format.ts'

export var STRATEGY_OPTIONS = ['order', 'weight', 'round-robin']


export var BREAKER_CODE_PRESETS = [
  { code: 'RATE_LIMIT', desc: '限流，通常几十秒就恢复', seconds: 60 },
  { code: 'SERVER', desc: '上游 5xx，几分钟', seconds: 300 },
  { code: 'TIMEOUT', desc: '超时，几分钟', seconds: 300 },
  { code: 'TRANSPORT', desc: '网络中断，几分钟', seconds: 300 },
  { code: 'AUTH', desc: '密钥或权限被拒（DSH 对 401/403 都用这个码），禁到人改配置为止', seconds: 3600 },
  { code: 'QUOTA', desc: '额度用尽（DSH 的 QUOTA_EXCEEDED_CODE），按账单周期', seconds: 7200 },
]


export var SWITCH_ON_CODES = [
  { key: 'rateLimit', labelKey: 'rateLimit', code: 'RATE_LIMIT' },
  { key: 'server', labelKey: 'serverError', code: 'SERVER' },
  { key: 'timeout', labelKey: 'timeout', code: 'TIMEOUT' },
  { key: 'transport', labelKey: 'transport', code: 'TRANSPORT' },
  { key: 'emptyResponse', labelKey: 'emptyResponse', code: 'EMPTY_RESPONSE' },
  { key: 'invalidRequest', labelKey: 'invalidRequest', code: 'INVALID_REQUEST' },
]


export function defaultSwitchOn() {
  return { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
}

export function defaultProfileValue() {
  return { enabled: false, candidates: [], switchOn: defaultSwitchOn(), maxTotalAttempts: 3, stickyTurns: 0 }
}

export function normalizeProfiles(value) {
  return clone(value ?? []).map(function (profile) {
    if (!Array.isArray(profile.candidates)) profile.candidates = []
    if (typeof profile.stickyTurns !== 'number' || profile.stickyTurns < 0) profile.stickyTurns = 0
    return profile
  })
}

export function normalizeDefault(value) {
  var pool = clone(value ?? defaultProfileValue())
  if (!Array.isArray(pool.candidates)) pool.candidates = []
  if (typeof pool.stickyTurns !== 'number' || pool.stickyTurns < 0) pool.stickyTurns = 0
  return pool
}


export function validate(draft) {
  var problems = []
  var seen = new Set()
  draft.profiles.forEach(function (profile) {
    if (seen.has(profile.id)) problems.push({ key: 'problemDuplicateId', vars: { id: profile.id } })
    seen.add(profile.id)
    if (!profile.candidates.length) {
      problems.push({ key: 'problemEmptyChain', vars: { id: profile.id } })
    } else {
      var head = profile.candidates[0]
      if (head.provider !== profile.when.provider || head.model !== profile.when.model) {
        problems.push({ key: 'problemUnpinnedPrimary', vars: { id: profile.id, route: profile.when.provider + '/' + profile.when.model } })
      }
    }
    profile.candidates.forEach(function (candidate, index) {
      if (!candidate.provider || !candidate.model) problems.push({ key: 'problemEmptyRoute', vars: { id: profile.id, index: index + 1 } })
      if (!(candidate.maxAttempts >= 1 && candidate.maxAttempts <= 5)) problems.push({ key: 'problemBadMaxAttempts', vars: { id: profile.id, index: index + 1 } })
    })
    if (!(profile.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadTotal', vars: { id: profile.id } })
    if (!(profile.stickyTurns >= 0)) problems.push({ key: 'problemBadSticky', vars: { id: profile.id } })
    // 空链已经报了 problemEmptyChain，别再叠加一条权重提示；默认兜底池没有
    // "空链" 这一说，所以它那边不设长度闸（与 host 的抛出点一致）。
    if (profile.strategy === 'weight' && profile.candidates.length > 0
      && profile.candidates.every(function (c) { return !(c.weight > 0) })) {
      problems.push({ key: 'problemProfileWeightNoPositive', vars: { id: profile.id } })
    }
  })
  if (!(draft.default.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadDefaultTotal', vars: {} })
  if (!(draft.default.stickyTurns >= 0)) problems.push({ key: 'problemBadDefaultSticky', vars: {} })
  // 与 host 的 assertStructural 保持同步：这里漏一条，用户就会存一个被 Host
  // 拒绝、且看不到原因的配置。
  if (draft.default.strategy === 'weight' && draft.default.candidates.every(function (c) { return !(c.weight > 0) })) {
    problems.push({ key: 'problemWeightNoPositive', vars: {} })
  }
  var breaker = draft.health && draft.health.breaker
  if (breaker && breaker.enabled) {
    breaker.rules.forEach(function (rule) {
      if (!rule.code && !rule.message) problems.push({ key: 'problemBreakerEmptyRule', vars: {} })
    })
  }
  return problems
}


export function normalizeHealth(value) {
  var health = value || {}
  var discover = health.discover || {}
  var probe = health.probe || {}
  var breaker = health.breaker || {}
  // 旧字段是分钟，新字段是秒；只在没有新字段时采用，避免覆盖已迁移的值。
  var legacyMinutes = typeof health.intervalMinutes === 'number' ? health.intervalMinutes : undefined
  var discoverSeconds = typeof discover.intervalSeconds === 'number'
    ? discover.intervalSeconds
    : legacyMinutes !== undefined ? legacyMinutes * 60 : 0
  var probeSeconds = typeof probe.intervalSeconds === 'number'
    ? probe.intervalSeconds
    : legacyMinutes !== undefined ? legacyMinutes * 60 : 0
  return {
    passive: health.passive !== false,
    discover: {
      enabled: discover.enabled === true,
      intervalSeconds: discoverSeconds,
    },
    probe: {
      enabled: probe.enabled === true,
      intervalSeconds: probeSeconds,
      prompt: typeof probe.prompt === 'string' && probe.prompt ? probe.prompt : '1',
      prompts: Array.isArray(probe.prompts) ? probe.prompts.slice() : [],
      timeoutSeconds: typeof probe.timeoutSeconds === 'number' ? probe.timeoutSeconds : 8,
    },
    breaker: {
      enabled: breaker.enabled === true,
      rules: Array.isArray(breaker.rules) ? breaker.rules.map(function (rule) {
        return {
          code: typeof rule.code === 'string' ? rule.code : '',
          message: typeof rule.message === 'string' ? rule.message : '',
          cooldownSeconds: typeof rule.cooldownSeconds === 'number' ? rule.cooldownSeconds : 300,
          // 旧配置没有这一字段；host schema 的默认值是 route，这里必须填成同一个，
          // 否则 UI 显示与 host 执行会是两个意思。
          scope: rule.scope === 'channel' ? 'channel' : 'route',
        }
      }) : [],
    },
  }
}
