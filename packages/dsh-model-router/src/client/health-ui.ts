/** Channel telemetry surfaces: the metrics dashboard and the compact health pill. */

import { h } from './dom.ts'
import { S } from './styles.ts'
import { formatLatency, formatThroughput, formatTime, healthToneStyle } from './format.ts'

export function reasoningLabelOf(catalog, provider, model) {
  var group = (catalog?.groups ?? []).find(function (entry) { return entry.id === provider })
  var entry = (group?.models ?? []).find(function (item) { return item.id === model })
  var efforts = entry?.reasoning?.efforts
  if (!efforts || efforts.length === 0) return undefined
  return efforts.map(function (effort) { return effort.name }).join(' / ')
}


export function ChannelMetricsDashboard(props) {
  var t = props.t
  var record = props.record
  var timeline = (record && Array.isArray(record.timeline)) ? record.timeline : []
  var latencyMs = record ? record.latencyMs : undefined
  var throughputTps = record ? record.throughputTps : undefined

  var slots = []
  var padCount = Math.max(0, 24 - timeline.length)
  for (var i = 0; i < padCount; i++) {
    slots.push({ isIdle: true })
  }
  var recent = timeline.length > 24 ? timeline.slice(-24) : timeline
  for (var j = 0; j < recent.length; j++) {
    slots.push(recent[j])
  }

  var barElements = slots.map(function (item, idx) {
    if (item.isIdle) {
      return h('div', {
        key: 'bar-' + idx,
        className: 'dsh-timeline-pill',
        style: Object.assign({}, S.timelinePill, { background: healthToneStyle('unknown').background }),
        title: t('healthBarIdle'),
      })
    }
    // DSH's own state tokens, so the bars follow the active theme instead
    // of hard-coded hex that only looks right on one of them.
    var barBg = healthToneStyle(item.status).background
    var statusLabel = t('healthStatusHealthy')
    if (item.status === 'degraded') {
      statusLabel = t('healthStatusDegraded')
    } else if (item.status === 'unhealthy') {
      statusLabel = t('healthStatusUnhealthy')
    }
    var tip = '[' + formatTime(item.time) + '] ' + statusLabel
    if (typeof item.latencyMs === 'number') tip += ' · ' + formatLatency(item.latencyMs)
    if (typeof item.throughputTps === 'number' && item.throughputTps > 0) tip += ' · ' + formatThroughput(item.throughputTps)
    if (item.error) tip += ' (' + item.error + ')'

    return h('div', {
      key: 'bar-' + idx,
      className: 'dsh-timeline-pill',
      style: Object.assign({}, S.timelinePill, { background: barBg }),
      title: tip,
    })
  })

  return h('div', { style: S.channelMetricsCard },
    h('div', { style: S.metricsColStatus },
      h('div', { style: S.metricsStatusHeader },
        h('span', { style: S.metricsLabel }, t('healthMetricHistory')),
        // 时间线是跨会话并集，条数只表示"窗口里累计了多少次观测"；柱子画最近
        // 24 个（下面 slice(-24)），所以这里不再写 /24——那个上限是单会话投影
        // 的，合并后不适用。
        h('span', { style: S.metricsStatusValue }, String(timeline.length))),
      h('div', { style: S.timelineBarContainer }, barElements)),
    h('div', { style: S.metricsColValue },
      h('span', { style: S.metricsLabel }, t('healthMetricLatency')),
      h('span', { style: S.metricsValNumber }, formatLatency(latencyMs))),
    h('div', { style: S.metricsColValue },
      h('span', { style: S.metricsLabel }, t('healthMetricThroughput')),
      h('span', { style: S.metricsValNumber }, formatThroughput(throughputTps))))
}


export function HealthSignalDot(props) {
  var t = props.t
  var record = props.record
  var status = record ? record.status : 'unknown'
  var latency = record && typeof record.latencyMs === 'number' ? formatLatency(record.latencyMs) : null
  var throughput = record && typeof record.throughputTps === 'number' && record.throughputTps > 0 ? formatThroughput(record.throughputTps) : null
  var statusText = t(status === 'healthy' ? 'healthStatusHealthy' : status === 'degraded' ? 'healthStatusDegraded' : status === 'unhealthy' ? 'healthStatusUnhealthy' : 'compactHealthIdle')
  var tip = (props.route || '') + ': ' + statusText + (latency ? ' · ' + latency : '') + (throughput ? ' · ' + throughput : '') + ' (' + t('clickToJumpHealth') + ')'
  var label = statusText + (latency ? ' · ' + latency : '')

  return h('button', {
    type: 'button',
    className: 'dsh-router-signal-dot-btn',
    style: S.signalBadgeBtn,
    title: tip,
    onClick: function (e) {
      e.stopPropagation()
      if (props.onJumpHealth) props.onJumpHealth(props.route)
    },
  },
    h('span', { style: Object.assign({}, S.signalDot, healthToneStyle(status)) }),
    h('span', { style: S.signalBadgeText }, label))
}
