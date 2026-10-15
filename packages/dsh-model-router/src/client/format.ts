/** Pure value helpers and the one route-status derivation every health surface shares. */

import { S } from './styles.ts'

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function routeOf(candidate) {
  return candidate.provider + '/' + candidate.model
}

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, function (_, key) { return String(vars[key]) })
}

export function formatLatency(latencyMs) {
  if (typeof latencyMs !== 'number' || isNaN(latencyMs)) return '—'
  if (latencyMs >= 1000) return (latencyMs / 1000).toFixed(2) + 's'
  return Math.round(latencyMs) + 'ms'
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


export function healthToneStyle(tone) {
  if (tone === 'healthy') return S.dotHealthy
  if (tone === 'degraded') return S.dotDegraded
  if (tone === 'unhealthy') return S.dotUnhealthy
  return S.dotUnknown
}


export function routeStatus(passive, discover, route) {
  var record = passive && passive[route]
  if (record) return record.status
  var verdict = discover && discover[route]
  if (!verdict) return 'unknown'
  if (verdict.kind === 'reachable') return 'healthy'
  if (verdict.kind === 'notAdvertised') return 'degraded'
  if (verdict.kind === 'unreachable') return 'unhealthy'
  return 'unknown'
}
