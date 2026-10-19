/** Config defaults, legacy normalization, draft-shape checks, and the browser rendering of the shared cross-field rules. */

import { clone } from './format.ts'
import {
  DEFAULT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_BREAKER_SCOPE,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_POOL_MAX_TOTAL_ATTEMPTS,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_SECONDS,
  DEFAULT_STICKY_TURNS,
  DEFAULT_SWITCH_ON,
  DEFAULT_TIMELINE_BUCKET_SECONDS,
} from '../defaults.ts'
import { structuralViolations } from '../rules.ts'

export var STRATEGY_OPTIONS = ['order', 'weight', 'round-robin']


// 熔断码预设：秒数是数据，descKey 是字典键——文案一律进 locales.ts（中英各一份），
// 模块里不留手写中文（I9 的教训：在飞改动把字典键换成硬编码中文，英文用户永远看不到）。
export var BREAKER_CODE_PRESETS = [
  { code: 'RATE_LIMIT', descKey: 'breakerPresetRateLimit', seconds: 60 },
  { code: 'SERVER', descKey: 'breakerPresetServer', seconds: 300 },
  { code: 'TIMEOUT', descKey: 'breakerPresetTimeout', seconds: 300 },
  { code: 'TRANSPORT', descKey: 'breakerPresetTransport', seconds: 300 },
  { code: 'AUTH', descKey: 'breakerPresetAuth', seconds: 3600 },
  { code: 'QUOTA', descKey: 'breakerPresetQuota', seconds: 7200 },
]


export function defaultSwitchOn() {
  // 与 host 的 switchOnSchema 默认值同源（../defaults.ts 的 DEFAULT_SWITCH_ON）：
  // 两边各写一份就会漂移，而漂移的表现是"UI 说开着、host 说关着"。
  return Object.assign({}, DEFAULT_SWITCH_ON)
}

export function defaultProfileValue() {
  return { enabled: false, candidates: [], switchOn: defaultSwitchOn(), maxTotalAttempts: DEFAULT_POOL_MAX_TOTAL_ATTEMPTS, stickyTurns: DEFAULT_STICKY_TURNS }
}

export function normalizeProfiles(value) {
  return clone(value ?? []).map(function (profile) {
    if (!Array.isArray(profile.candidates)) profile.candidates = []
    if (typeof profile.stickyTurns !== 'number' || profile.stickyTurns < 0) profile.stickyTurns = DEFAULT_STICKY_TURNS
    return profile
  })
}

/**
 * 主模型标记的归一化：非字符串（旧配置没有这个字段）按"空 = 第一条"处理。
 * 指向已删规则的悬空值这里**不**修正——UI 与宿主都用同一条回落规则读它，
 * 在这里偷偷改掉会让两边对"谁是主"各说一套。
 */
export function normalizePrimaryProfileId(value) {
  return typeof value === 'string' ? value : ''
}

export function normalizeDefault(value) {
  var pool = clone(value ?? defaultProfileValue())
  if (!Array.isArray(pool.candidates)) pool.candidates = []
  if (typeof pool.stickyTurns !== 'number' || pool.stickyTurns < 0) pool.stickyTurns = DEFAULT_STICKY_TURNS
  return pool
}


export function validate(draft) {
  var problems = []
  // 跨字段规则与 host 同源（../rules.ts 的 structuralViolations）：host 抛第一条、
  // 这里收全部，key + vars 进字典渲染。此前两份规则靠三句「与 host 的 assertStructural
  // 同步」的注释对齐，且已经漂移——默认兜底池的重复渠道这里漏检，用户存得下一个
  // 加载即被 host 拒绝的配置，吃的还是一句英文错误。
  structuralViolations(draft).forEach(function (violation) {
    problems.push({ key: violation.key, vars: violation.vars })
  })
  // 草稿态检查：host 故意不做单字段边界（schema 拥有它们，assertStructural 的
  // docstring 划了这条线），浏览器要在保存前挡住，否则用户吃到的是 host 的英文拒绝。
  draft.profiles.forEach(function (profile) {
    profile.candidates.forEach(function (candidate, index) {
      if (!candidate.provider || !candidate.model) problems.push({ key: 'problemEmptyRoute', vars: { id: profile.id, index: index + 1 } })
      if (!(candidate.maxAttempts >= 1 && candidate.maxAttempts <= 5)) problems.push({ key: 'problemBadMaxAttempts', vars: { id: profile.id, index: index + 1 } })
    })
    if (!(profile.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadTotal', vars: { id: profile.id } })
    if (!(profile.stickyTurns >= 0)) problems.push({ key: 'problemBadSticky', vars: { id: profile.id } })
  })
  if (!(draft.default.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadDefaultTotal', vars: {} })
  if (!(draft.default.stickyTurns >= 0)) problems.push({ key: 'problemBadDefaultSticky', vars: {} })
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
    : legacyMinutes !== undefined ? legacyMinutes * 60 : DEFAULT_INTERVAL_SECONDS
  var probeSeconds = typeof probe.intervalSeconds === 'number'
    ? probe.intervalSeconds
    : legacyMinutes !== undefined ? legacyMinutes * 60 : DEFAULT_INTERVAL_SECONDS
  // 时间轴桶长：旧配置没有这个字段，取默认值（../defaults.ts 与 host schema 同源）。
  var bucketSeconds = typeof health.timelineBucketSeconds === 'number'
    ? health.timelineBucketSeconds
    : DEFAULT_TIMELINE_BUCKET_SECONDS
  return {
    passive: health.passive !== false,
    discover: {
      enabled: discover.enabled === true,
      intervalSeconds: discoverSeconds,
    },
    probe: {
      enabled: probe.enabled === true,
      intervalSeconds: probeSeconds,
      prompt: typeof probe.prompt === 'string' && probe.prompt ? probe.prompt : DEFAULT_PROBE_PROMPT,
      prompts: Array.isArray(probe.prompts) ? probe.prompts.slice() : [],
      timeoutSeconds: typeof probe.timeoutSeconds === 'number' ? probe.timeoutSeconds : DEFAULT_PROBE_TIMEOUT_SECONDS,
    },
    breaker: {
      enabled: breaker.enabled === true,
      rules: Array.isArray(breaker.rules) ? breaker.rules.map(function (rule) {
        return {
          code: typeof rule.code === 'string' ? rule.code : '',
          message: typeof rule.message === 'string' ? rule.message : '',
          cooldownSeconds: typeof rule.cooldownSeconds === 'number' ? rule.cooldownSeconds : DEFAULT_BREAKER_COOLDOWN_SECONDS,
          // 旧配置没有这一字段；host schema 的默认值是 route，这里必须填成同一个，
          // 否则 UI 显示与 host 执行会是两个意思。
          scope: rule.scope === 'channel' ? 'channel' : DEFAULT_BREAKER_SCOPE,
        }
      }) : [],
    },
    timelineBucketSeconds: bucketSeconds,
  }
}
