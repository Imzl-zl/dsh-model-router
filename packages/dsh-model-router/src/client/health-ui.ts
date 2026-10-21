/** One route's telemetry: the 24-bar window and the two figures that must not be blended. */

import { h } from './dom.ts'
import { fill, formatLatency, formatThroughput, formatTime, formatWindowHours, healthToneStyle } from './format.ts'
import { bucketTimeline, bucketTone, DEFAULT_TIMELINE_BUCKET_SECONDS, windowSuccessRate } from '../timeline.ts'

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
  var height = rate === undefined ? 6 : Math.max(4, Math.round(rate * props.maxHeight))
  var style = { height: height }
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
    className: 'dsh-router-timeline-bar dsh-timeline-bar',
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

  // 行内只放数据：窗口、成功率、时间轴、延迟、吞吐。解释文字收进 tooltip——
  // 每行都重复一遍图例和指标说明，会把数据淹掉（用户："信息密度全是说明了"）。
  return h('div', { className: 'dsh-router-metrics' },
    h('div', { className: 'dsh-router-metrics-status' },
      h('div', { className: 'dsh-router-metrics-header' },
        h('span', { className: 'dsh-router-metrics-label' }, fill(t('timelineWindowLabel'), { window: formatWindowHours(bucketSeconds) })),
        // 观测条数只说明"窗口里发生了多少次调用"；窗口本身由标签上的时长说，
        // 不再写一个看起来像上限的 /24。
        h('span', { className: 'dsh-router-metrics-value' },
          windowRate === null ? t('timelineNoData') : Math.round(windowRate * 1000) / 10 + '%')),
      h('div', { className: 'dsh-router-timeline', title: t('timelineLegend') }, barElements)),
    h('div', { className: 'dsh-router-metrics-col', title: t('healthMetricLatencyHint') },
      h('span', { className: 'dsh-router-metrics-label' }, t('healthMetricLatency')),
      h('span', { className: 'dsh-router-metrics-number' }, formatLatency(record ? record.latencyMs : undefined))),
    h('div', {
      className: 'dsh-router-metrics-col',
      title: hasRealOutput ? t('healthMetricThroughputHint') : t('healthMetricThroughputNone'),
    },
      h('span', { className: 'dsh-router-metrics-label' }, t('healthMetricThroughput')),
      h('span', { className: 'dsh-router-metrics-number' }, hasRealOutput ? formatThroughput(record.throughputTps) : '—')))
}
