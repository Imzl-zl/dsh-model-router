/** Channel telemetry surfaces: the metrics dashboard and the compact health pill. */

import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, formatLatency, formatThroughput, formatTime, formatWindowHours, healthToneStyle, routeStatus } from './format.ts'
import { bucketTimeline, bucketTone, DEFAULT_TIMELINE_BUCKET_SECONDS, windowSuccessRate } from '../timeline.ts'

export function reasoningLabelOf(catalog, provider, model) {
  var group = (catalog?.groups ?? []).find(function (entry) { return entry.id === provider })
  var entry = (group?.models ?? []).find(function (item) { return item.id === model })
  var efforts = entry?.reasoning?.efforts
  if (!efforts || efforts.length === 0) return undefined
  return efforts.map(function (effort) { return effort.name }).join(' / ')
}

/**
 * 时间轴的一格：高度是该桶的成功率，颜色按分档，空桶是无数据。
 *
 * 旧画法是"最近 24 次观测、一格一次调用"——柱子之间没有时间含义，24 格可能横跨
 * 几天，用户无法从图上看出一段故障持续了多久。现在每格是一个时长桶（默认 10
 * 分钟），窗口 = 24 × 桶长，高度因此是"这一段时间里成功的比例"。
 *
 * 三种状态在高度里的权重：成功计 1、降级（限流）计 0.5、失败计 0。限流不是成功
 * 也不是故障——渠道是好的，只是此刻被限流；计半次让一次 429 不至于把一条好渠道
 * 涂红，同时在高度上仍然看得见。
 */
function TimelineBar(props) {
  var t = props.t
  var bar = props.bar
  var tone = bucketTone(bar)
  var rate = bar.successRate
  // 空桶不是 0%：没有任何观测时画一条贴底的空槽，让它读作"没数据"而不是"全失败"。
  var height = rate === undefined ? 3 : Math.max(4, Math.round(rate * props.maxHeight))
  var style = Object.assign({}, S.timelineBar, { height: height })
  if (rate === undefined) {
    style.background = 'transparent'
    style.border = '0.5px dashed var(--dsw-alias-border-l3)'
  } else {
    style.background = healthToneStyle(tone).background
  }
  var tip
  if (rate === undefined) {
    tip = '[' + formatTime(bar.start) + '–' + formatTime(bar.end) + '] ' + t('timelineBucketEmpty')
  } else {
    tip = '[' + formatTime(bar.start) + '–' + formatTime(bar.end) + '] '
      + fill(t('timelineBucketTip'), {
        ok: bar.healthy,
        warn: bar.degraded,
        bad: bar.unhealthy,
        rate: Math.round(rate * 100) + '%',
      })
    if (typeof props.averageLatencyMs === 'number') tip += ' · ' + t('healthMetricLatency') + ' ' + formatLatency(props.averageLatencyMs)
    if (props.error) tip += ' · ' + props.error
  }
  return h('div', {
    key: 'bar-' + bar.start,
    className: 'dsh-timeline-bar',
    style: style,
    title: tip,
  })
}

/**
 * One route's metrics: the timeline window, and the two latency figures that
 * must not be blended.
 *
 * The split is the point. A probe measures time-to-first-token on a message the
 * plugin invented and abandoned at the first byte — it has no output, so it has
 * no throughput. A real conversation produces tokens, and its cost includes the
 * first-token wait, so its rate is an end-to-end output rate rather than a
 * decode rate. Showing one number that mixes the two sources is how "161.1t/s"
 * ended up next to "140ms" from two different measurements.
 */
export function ChannelMetricsDashboard(props) {
  var t = props.t
  var record = props.record
  var timeline = (record && Array.isArray(record.timeline)) ? record.timeline : []
  var bucketSeconds = props.bucketSeconds ?? DEFAULT_TIMELINE_BUCKET_SECONDS
  var bars = bucketTimeline(timeline, bucketSeconds, Date.now())
  // 窗口成功率只有一处算法（../timeline.ts）。它曾在这两个界面里各写一遍，而且
  // 两处都多乘了一个 bar.count——healthy 本身就是桶内计数，再乘就是平方，一个
  // 桶十次观测会印出 1000%。收编到单源之后这类错只剩一个能犯的地方。
  var windowRate = windowSuccessRate(bars)

  // 每桶的平均延迟与错误码从原始观测点来（tooltip 用），不进柱子本身。一趟扫完：
  // 柱子是聚合结果，观测点才有延迟和错误码。
  var perBucket = {}
  bars.forEach(function (bar) { perBucket[bar.start] = { sum: 0, count: 0, error: undefined } })
  timeline.forEach(function (point) {
    var bucket = perBucket[point.time - (point.time % (bucketSeconds * 1000))]
    if (bucket === undefined) return
    if (typeof point.latencyMs === 'number') { bucket.sum += point.latencyMs; bucket.count += 1 }
    if (bucket.error === undefined && point.error) bucket.error = point.error
  })
  var latencyOf = {}
  var errorOf = {}
  bars.forEach(function (bar) {
    var bucket = perBucket[bar.start]
    if (bucket.count > 0) latencyOf[bar.start] = Math.round(bucket.sum / bucket.count)
    if (bucket.error !== undefined) errorOf[bar.start] = bucket.error
  })

  var barElements = bars.map(function (bar) {
    return h(TimelineBar, {
      key: bar.start,
      t: t,
      bar: bar,
      maxHeight: 26,
      averageLatencyMs: latencyOf[bar.start],
      error: errorOf[bar.start],
    })
  })

  var hasRealOutput = record && typeof record.throughputTps === 'number' && record.throughputTps > 0

  return h('div', { style: S.channelMetricsCard },
    h('div', { style: S.metricsColStatus },
      h('div', { style: S.metricsStatusHeader },
        h('span', { style: S.metricsLabel }, fill(t('timelineWindowLabel'), { window: formatWindowHours(bucketSeconds) })),
        // 观测条数只说明"窗口里发生了多少次调用"；窗口本身由标签上的时长说，
        // 不再写一个看起来像上限的 /24。
        h('span', { style: S.metricsStatusValue },
          windowRate === null ? t('timelineNoData') : Math.round(windowRate * 1000) / 10 + '%')),
      h('div', { style: S.timelineBarContainer }, barElements),
      h('span', { style: S.timelineLegend }, t('timelineLegend'))),
    h('div', { style: S.metricsColValue },
      h('span', { style: S.metricsLabel }, t('healthMetricLatency')),
      h('span', { style: S.metricsValNumber }, formatLatency(record ? record.latencyMs : undefined)),
      h('span', { style: S.metricsColHint }, t('healthMetricLatencyHint'))),
    h('div', { style: S.metricsColValue },
      h('span', { style: S.metricsLabel }, t('healthMetricThroughput')),
      h('span', { style: S.metricsValNumber }, hasRealOutput ? formatThroughput(record.throughputTps) : '—'),
      h('span', { style: S.metricsColHint }, hasRealOutput ? t('healthMetricThroughputHint') : t('healthMetricThroughputNone'))))
}


export function HealthSignalDot(props) {
  var t = props.t
  var record = props.record
  // 状态走 routeStatus 单源派生（format.ts），和侧栏、健康大盘同一套口径：只看
  // passive 记录会让"探测刚判失败的渠道"在这里显示成未观测，同屏两个颜色。
  var status = routeStatus(props.passive, props.discover, props.probe, props.route)
  // 两套指标分开说：被动的端到端耗时与真实输出速率来自真实对话，探测只有首字
  // 延迟。混在一行会让用户以为 161.1t/s 是探测测出来的（探测不产生输出）。
  var passiveLatency = record && typeof record.latencyMs === 'number' ? formatLatency(record.latencyMs) : null
  var passiveThroughput = record && typeof record.throughputTps === 'number' && record.throughputTps > 0 ? formatThroughput(record.throughputTps) : null
  var verdict = props.probe && props.probe[props.route]
  var probeLatency = verdict && verdict.kind === 'reachable' && typeof verdict.latencyMs === 'number'
    ? formatLatency(verdict.latencyMs)
    : null
  var statusText = t(status === 'healthy' ? 'healthStatusHealthy' : status === 'degraded' ? 'healthStatusDegraded' : status === 'unhealthy' ? 'healthStatusUnhealthy' : 'compactHealthIdle')

  var parts = [statusText]
  if (passiveLatency) parts.push(t('healthMetricLatency') + ' ' + passiveLatency)
  if (passiveThroughput) parts.push(t('healthMetricThroughput') + ' ' + passiveThroughput)
  if (probeLatency) parts.push(t('probeFirstToken') + ' ' + probeLatency)
  var tip = (props.route || '') + ': ' + parts.join(' · ') + ' (' + t('clickToJumpHealth') + ')'
  // 标签行只放状态 + 一个主指标：真实对话的端到耗时优先，没有才落到探测首字。
  var label = statusText + (passiveLatency ? ' · ' + passiveLatency : probeLatency ? ' · ' + t('probeFirstTokenShort') + ' ' + probeLatency : '')

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
