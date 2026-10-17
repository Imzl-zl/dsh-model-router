/** Pure value helpers and the one route-status derivation every health surface shares. */

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
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
