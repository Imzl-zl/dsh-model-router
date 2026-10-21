/** Config defaults, legacy normalization, draft-shape checks, and the browser rendering of the shared cross-field rules. */

import { clone } from './format.ts'
import {
  DEFAULT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_BREAKER_SCOPE,
  DEFAULT_FIRST_HOP_MAX_RETRIES,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_SECONDS,
  DEFAULT_STICKY_TURNS,
  DEFAULT_STRATEGY,
  DEFAULT_SWITCH_ON,
  DEFAULT_TIMELINE_BUCKET_SECONDS,
  MAX_RETRIES,
} from '../defaults.ts'
import { structuralViolations } from '../rules.ts'


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

/** A chain with no fallbacks: what a fresh draft, and a legacy record, start from. */
export function defaultChainValue() {
  return {
    candidates: [],
    switchOn: defaultSwitchOn(),
    stickyTurns: DEFAULT_STICKY_TURNS,
    strategy: DEFAULT_STRATEGY,
    firstHopMaxRetries: DEFAULT_FIRST_HOP_MAX_RETRIES,
  }
}

export function normalizeChain(value) {
  var chain = clone(value ?? defaultChainValue())
  if (!Array.isArray(chain.candidates)) chain.candidates = []
  if (typeof chain.stickyTurns !== 'number' || chain.stickyTurns < 0) chain.stickyTurns = DEFAULT_STICKY_TURNS
  // effectiveChain already speaks retries; this only covers a draft built by hand
  // (a new row, a fixture), where a missing field would render as NaN in the stepper.
  chain.candidates = chain.candidates.map(function (candidate) {
    return typeof candidate.maxRetries === 'number'
      ? candidate
      : Object.assign({}, candidate, { maxRetries: DEFAULT_MAX_RETRIES })
  })
  if (typeof chain.firstHopMaxRetries !== 'number') chain.firstHopMaxRetries = DEFAULT_FIRST_HOP_MAX_RETRIES
  return chain
}


export function validate(draft) {
  var problems = []
  // 跨字段规则与 host 同源（../rules.ts 的 structuralViolations）：host 抛第一条、
  // 这里收全部，key + vars 进字典渲染。此前两份规则靠三句「与 host 的 assertStructural
  // 同步」的注释对齐，且已经漂移——重复渠道 host 从第一天就拒、浏览器漏检，用户存得下
  // 一个加载即被 host 拒绝的配置，吃的还是一句英文错误。
  structuralViolations({ chain: draft.chain, health: draft.health }).forEach(function (violation) {
    problems.push({ key: violation.key, vars: violation.vars })
  })
  // 草稿态检查：host 故意不做单字段边界（schema 拥有它们，assertStructural 的
  // docstring 划了这条线），浏览器要在保存前挡住，否则用户吃到的是 host 的英文拒绝。
  draft.chain.candidates.forEach(function (candidate, index) {
    if (!candidate.provider || !candidate.model) problems.push({ key: 'problemEmptyRoute', vars: { index: index + 1 } })
    if (!(candidate.maxRetries >= 0 && candidate.maxRetries <= MAX_RETRIES)) problems.push({ key: 'problemBadMaxRetries', vars: { index: index + 1 } })
  })
  if (!(draft.chain.firstHopMaxRetries >= 0 && draft.chain.firstHopMaxRetries <= MAX_RETRIES)) problems.push({ key: 'problemBadFirstHopRetries', vars: {} })
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
