/** Pure value helpers and the one route-status derivation every health surface shares. */

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 深度相等，**键序无关**。
 *
 * JSON 串比较会把 `{a:1,b:2}` 与 `{b:2,a:1}` 判成不同：宿主重发布同一份值而键序
 * 不同时，草稿会被错误地重新播种（未保存的编辑被冲掉），或反过来漏判真实变化。
 * 数组仍按序比较——顺序是数组的语义，不是表示法。
 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    return a.every(function (item, index) { return deepEqual(item, b[index]) })
  }
  var keysA = Object.keys(a)
  var keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(function (key) {
    return Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key])
  })
}

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, function (_, key) { return String(vars[key]) })
}

export function formatLatency(latencyMs) {
  if (typeof latencyMs !== 'number' || isNaN(latencyMs)) return '—'
  if (latencyMs >= 1000) return (latencyMs / 1000).toFixed(2) + 's'
  return Math.round(latencyMs) + 'ms'
}

/**
 * What a finished run found, as counts. A run whose results match what was
 * already on screen changes nothing visible, so the counts — not the dots —
 * are the feedback that the click did something.
 *
 * @param verdicts - one verdict per route the run covered.
 * @param kindOf - maps a verdict to the bucket it belongs in.
 * @param buckets - the bucket order, with the label each count is printed under.
 */
export function summarize(verdicts, kindOf, buckets) {
  const counts = {}
  for (const verdict of verdicts) {
    const bucket = kindOf(verdict)
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  const parts = buckets
    .filter(bucket => (counts[bucket.key] ?? 0) > 0)
    .map(bucket => `${bucket.label} ${counts[bucket.key]}`)
  return { total: verdicts.length, counts, text: parts.join(' · ') }
}

/** mac 用 ⌘，其余平台用 Ctrl：DSH 的快捷键服务按平台注册，chip 上的按键标签不能写死。 */
export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent || '')
}

/** 保存快捷键的字典键：随平台二选一（两个语系各有两个键）。 */
export function saveShortcutKeyKey(isMac) {
  return isMac ? 'saveShortcutKeyMac' : 'saveShortcutKeyOther'
}

export function formatThroughput(tps) {
  if (typeof tps !== 'number' || isNaN(tps) || tps <= 0) return '—'
  return tps.toFixed(1) + 't/s'
}

export function formatTime(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  var hh = String(d.getHours()).padStart(2, '0')
  var mm = String(d.getMinutes()).padStart(2, '0')
  var ss = String(d.getSeconds()).padStart(2, '0')
  return hh + ':' + mm + ':' + ss
}


/**
 * The one mapping from a health tone to its colour. The colour itself lives in
 * CSS (`--dsh-router-tone-*`, resolved per theme in ROUTER_CSS) because DSH has
 * no alias pair that reads in both themes; this function is what keeps every
 * surface — dots, timeline bars, status pills, probe badges — on the same three
 * values instead of each re-deriving them.
 *
 * Note: 语义色单源与 AA 取舍（为何文字永远不是色调色）—— 见
 * .agents/notes/implemented/2026-10-16-single-surface-dialog-and-tone-system.md
 *
 * @param tone - `healthy` | `degraded` | `unhealthy`, anything else reads idle.
 * @returns the CSS colour for that tone.
 */
export function healthToneColor(tone) {
  if (tone === 'healthy') return 'var(--dsh-router-tone-ok)'
  if (tone === 'degraded') return 'var(--dsh-router-tone-warn)'
  if (tone === 'unhealthy') return 'var(--dsh-router-tone-bad)'
  return 'var(--dsw-alias-label-tertiary)'
}

/** Dots and timeline bars: colour only, no text to keep readable. */
export function healthToneStyle(tone) {
  return { background: healthToneColor(tone) }
}

/**
 * A semantic badge: tinted surface, hairline tone border, and text in
 * `label-primary`. The text is deliberately NOT the tone colour — DSH's
 * `state-*` tokens are mid-tone in one theme or the other, so tone-coloured
 * text measured 1.00:1 (dark, error) and 1.37:1 (light, error) and 2.09:1
 * (light, success) against AA's 4.5:1. `label-primary` on the tone's own 12%
 * tint is a matched pair in both themes, and the dot plus border still carry
 * the colour at a glance.
 *
 * @param tone - the health tone the badge reports.
 */
export function healthToneBadge(tone) {
  var color = healthToneColor(tone)
  return {
    background: 'color-mix(in srgb, ' + color + ' 12%, var(--dsw-alias-bg-layer-2))',
    color: 'var(--dsw-alias-label-primary)',
    border: '0.5px solid color-mix(in srgb, ' + color + ' 40%, transparent)',
  }
}


/**
 * The status one route's card shows. A real conversation outcome outranks a
 * synthetic check — the probe measures one generated token, the passive fold
 * measures what the model actually did — and a check that could not run at all
 * reads as unknown rather than as a fault.
 *
 * @param passive - the host projection's records, keyed by route.
 * @param discover - the last connectivity-check verdicts, keyed by route.
 * @param probe - the last end-to-end probe verdicts, keyed by route.
 * @param route - `provider/model`.
 */
export function routeStatus(passive, discover, probe, route) {
  var record = passive && passive[route]
  if (record) return record.status
  var verdict = probe && probe[route]
  if (verdict) {
    if (verdict.kind === 'reachable') return 'healthy'
    if (verdict.kind === 'unreachable') return 'unhealthy'
  }
  var connectivity = discover && discover[route]
  if (!connectivity) return 'unknown'
  if (connectivity.kind === 'reachable') return 'healthy'
  if (connectivity.kind === 'notAdvertised') return 'degraded'
  if (connectivity.kind === 'unreachable') return 'unhealthy'
  return 'unknown'
}
