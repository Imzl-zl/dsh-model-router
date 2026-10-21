/** Global channel health & telemetry, aggregated per physical route. */

import { useEffect, useMemo, useState } from 'react'
import { Button, Input, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { h } from './dom.ts'
import { routeKeyOf, routeParts } from '../routes.ts'
import { fill, formatLatency, formatWindowHours, healthToneStyle, routeStatus, shortModelName } from './format.ts'
import { ChannelMetricsDashboard } from './health-ui.ts'
import { bucketTimeline, windowSuccessRate } from '../timeline.ts'
import { Icon, ICON_BOLT, ICON_CHART, ICON_CLOCK, ICON_GEAR, ICON_SEARCH, ICON_SPINNER } from './icons.ts'

/** What one route's last probe says, as the button's tooltip. */
function probeVerdictTitle(t, verdict) {
  if (!verdict) return t('probeNotRun')
  if (verdict.kind === 'reachable') {
    return t('probeReachable') + (typeof verdict.latencyMs === 'number' ? '（' + formatLatency(verdict.latencyMs) + '）' : '')
  }
  if (verdict.kind === 'unreachable') return t('probeUnreachable') + (verdict.error ? '（' + verdict.error + '）' : '')
  return t('probeUnavailable') + (verdict.error ? '（' + verdict.error + '）' : '')
}

/** The same verdict as the card's short badge text. */
function probeVerdictText(t, verdict) {
  if (verdict.kind === 'reachable') {
    return t('probeBadgeOk') + (typeof verdict.latencyMs === 'number' ? ' ' + formatLatency(verdict.latencyMs) : '')
  }
  if (verdict.kind === 'unreachable') return t('probeBadgeBad') + (verdict.error ? ' · ' + verdict.error : '')
  return t('probeBadgeUnknown')
}

/**
 * Why a connectivity check could not run at all, as the button's tooltip.
 *
 * The reasons are the plugin's own tokens and each names a different thing the
 * user can act on: the route is not a configurable provider (nothing to ask),
 * DSH registers no model discovery for it (use the 1-token probe instead), or
 * the plugin's own Host face did not answer (nothing ran). The DSH code rides
 * along when there is one, so a future member of the family stays legible
 * instead of being flattened into the generic sentence.
 *
 * Note: 为何这个按钮保持可点、为何每个 reason 都要有自己的句子 —— 见
 * .agents/notes/implemented/2026-10-16-connectivity-no-discovery-is-not-a-refusal.md
 */
function connectivityUnavailableTitle(t, verdict) {
  if (verdict.reason === 'notConfigurable') return t('connectivityNotConfigurable')
  if (verdict.reason === 'noDiscovery') {
    return t('connectivityNoDiscovery') + (verdict.error ? '（' + verdict.error + '）' : '')
  }
  if (verdict.reason === 'hostUnavailable') return t('connectivityHostUnavailable')
  return t('connectivityUnavailable')
}

/** The tag tone one health status uses. */
function statusTone(status) {
  if (status === 'healthy') return 'success'
  if (status === 'degraded') return 'warning'
  if (status === 'unhealthy') return 'danger'
  return 'outline'
}

/** The tag text one health status carries. */
function statusLabel(t, status) {
  if (status === 'healthy') return t('healthStatusHealthy')
  if (status === 'degraded') return t('healthStatusDegraded')
  if (status === 'unhealthy') return t('healthStatusUnhealthy')
  return t('compactHealthIdle')
}

/** The probe verdict's tag tone. */
function probeTone(verdict) {
  if (verdict.kind === 'reachable') return 'success'
  if (verdict.kind === 'unreachable') return 'danger'
  return 'outline'
}

export function GlobalHealthWorkspace(props) {
  var t = props.t
  var draft = props.draft
  var passive = props.passive || {}
  var discover = props.discover || {}
  var probe = props.probe || {}
  var checking = props.checking === true
  var checkingRoutes = props.checkingRoutes || {}
  var probing = props.probing === true
  var probingRoutes = props.probingRoutes || {}
  // The jump target is an object, so clicking the same route twice re-arms
  // the scroll; entering through the tab clears it (null).
  var focusRouteKey = props.focusRoute ? props.focusRoute.route : null

  var filterState = useState('all')
  var filter = filterState[0]
  var setFilter = filterState[1]

  var searchState = useState('')
  var search = searchState[0]
  var setSearch = searchState[1]

  useEffect(function () {
    if (!props.focusRoute) return
    var el = document.getElementById('channel-' + props.focusRoute.route.replace(/[^a-zA-Z0-9_-]/g, '_'))
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [props.focusRoute])

  // Collect all physical channels across configuration and history.
  //
  // What "all" means, in one place: the chain's configured fallbacks (so a
  // candidate you just added but never used is still listed — otherwise there is
  // nothing to probe or check), plus every route that has actually been observed
  // (passive fold), discovered, or probed. The first hop is deliberately absent
  // from the configured half: it is whatever model the user picked in DSH, which
  // the plugin does not know until a request arrives, so it can only appear once
  // it has been observed.
  var allChannels = useMemo(function () {
    var map = {}
    var ensure = function (provider, model) {
      if (!provider || !model) return null
      var key = routeKeyOf(provider, model)
      if (!map[key]) {
        map[key] = {
          route: key,
          provider: provider,
          model: model,
          usages: [],
        }
      }
      return map[key]
    }

    if (draft && draft.chain && draft.chain.candidates) {
      draft.chain.candidates.forEach(function (candidate, index) {
        var channel = ensure(candidate.provider, candidate.model)
        // 单链之下没有"哪条规则"可跳：所有候选都属于同一条链。所以 usage 只说明
        // 它在这条链里的位次，不再做按规则的跳转。
        if (channel) channel.usages.push({
          name: '__chain__',
          label: t('channelUsedInChain') + ' #' + (index + 1),
        })
      })
    }

    if (passive) Object.keys(passive).forEach(function (key) { var parts = routeParts(key); ensure(parts.provider, parts.model) })
    if (discover) Object.keys(discover).forEach(function (key) { var parts = routeParts(key); ensure(parts.provider, parts.model) })
    if (probe) Object.keys(probe).forEach(function (key) { var parts = routeParts(key); ensure(parts.provider, parts.model) })

    return Object.values(map)
  }, [draft, passive, discover, probe, t])

  var filteredChannels = allChannels.filter(function (channel) {
    var status = routeStatus(passive, discover, probe, channel.route)
    if (filter === 'healthy' && status !== 'healthy') return false
    if (filter === 'issue' && status !== 'degraded' && status !== 'unhealthy') return false
    if (filter === 'idle' && status !== 'unknown') return false
    if (search.trim()) {
      var query = search.trim().toLowerCase()
      return channel.route.toLowerCase().indexOf(query) !== -1
        || channel.model.toLowerCase().indexOf(query) !== -1
        || channel.provider.toLowerCase().indexOf(query) !== -1
    }
    return true
  })

  return h('div', { className: 'dsh-router-health' },
    h('section', { className: 'dsh-router-section' },
      h('div', { className: 'dsh-router-section-head' },
        h('h2', { className: 'dsh-router-section-title' }, t('globalHealthTitle')),
        h('span', { className: 'dsh-router-section-count' }, fill(t('navHealthCount'), { n: allChannels.length })),
        h('span', { className: 'dsh-router-section-spacer' }),
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(Icon, { d: checking ? ICON_SPINNER : ICON_BOLT, size: 13, spin: checking }),
          disabled: props.disabled || checking,
          title: t('toolCheckAllTooltip'),
          onClick: props.onCheckAll,
        }, checking ? t('checkingText') : t('toolCheckAllConnectivity')),
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(Icon, { d: probing ? ICON_SPINNER : ICON_BOLT, size: 13, spin: probing }),
          disabled: props.disabled || probing,
          title: t('toolProbeAllTooltip'),
          onClick: props.onProbeAll,
        }, probing ? t('probingText') : t('toolProbeAll')),
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(Icon, { d: ICON_GEAR, size: 13 }),
          disabled: props.disabled,
          title: t('healthConfigBtn'),
          onClick: props.onOpenHealthModal,
        }, t('toolHealthConfig')),
        h(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: h(Icon, { d: ICON_CLOCK, size: 13 }),
          title: t('failoverHistoryButton'),
          onClick: props.onOpenDrawer,
        }, t('toolHistory'))),
      // 时间轴怎么读：一格多长时间、看多远、高度与颜色各是什么。一行说完，细节进
      // tooltip——这一行每张卡片上都看得见，写长了就是噪声。
      h('div', { className: 'dsh-router-scope-line', title: t('timelineLegend') },
        h(Icon, { d: ICON_CHART, size: 12 }),
        h('span', null, fill(t('timelineScopeLine'), {
          bucket: props.bucketSeconds ?? 600,
          window: formatWindowHours(props.bucketSeconds ?? 600),
        }))),
      // A history that could not be read is not an empty history. The dot
      // carries the tone (text is never the tone colour), and the line stays
      // until a read succeeds, because the empty rows it produces look exactly
      // like channels that never ran.
      props.passiveError
        ? h('div', { className: 'dsh-router-health-warning', role: 'status' },
            h('span', { className: 'dsh-router-health-warning-dot', style: healthToneStyle('degraded') }),
            h('span', null, props.passiveError))
        : null,
      // What the last run found. Kept on screen until the next run: a run whose
      // results match what was already there changes nothing visible, so the
      // counts are what tell the user the click did something.
      (checking || probing || (props.checkSummary && props.checkSummary.total > 0) || (props.probeSummary && props.probeSummary.total > 0))
        ? h('div', { className: 'dsh-router-run-summary' },
            checking ? h('span', null, t('checkingText')) : null,
            props.checkSummary && props.checkSummary.total > 0 && !checking
              ? h('span', null, fill(t('checkSummaryLine'), { text: props.checkSummary.text }))
              : null,
            probing ? h('span', null, t('probingText')) : null,
            props.probeSummary && props.probeSummary.total > 0 && !probing
              ? h('span', null, fill(t('probeSummaryLine'), { text: props.probeSummary.text }))
              : null,
            null)
        : null),

    h('div', { className: 'dsh-router-filter-bar' },
      h(SegmentedControl, {
        id: 'health-filter',
        value: filter,
        label: t('filterAll'),
        options: ['all', 'healthy', 'issue', 'idle'].map(function (key) {
          var count = 0
          allChannels.forEach(function (channel) {
            var status = routeStatus(passive, discover, probe, channel.route)
            if (key === 'all') count++
            else if (key === 'healthy' && status === 'healthy') count++
            else if (key === 'issue' && (status === 'degraded' || status === 'unhealthy')) count++
            else if (key === 'idle' && status === 'unknown') count++
          })
          var labelMap = {
            all: t('filterAll'),
            healthy: t('filterHealthy'),
            issue: t('filterUnhealthy'),
            idle: t('filterIdle'),
          }
          return { value: key, label: labelMap[key] + ' (' + count + ')' }
        }),
        onChange: function (next) { setFilter(next) },
      }),
      h(Input, {
        type: 'search',
        className: 'dsh-router-search',
        icon: h(Icon, { d: ICON_SEARCH, size: 12 }),
        placeholder: t('searchChannelPlaceholder'),
        'aria-label': t('searchChannelPlaceholder'),
        value: search,
        onChange: function (event) { setSearch(event.target.value) },
      })),

    h('ul', { className: 'dsh-router-list dsh-router-channel-list' },
      filteredChannels.length === 0
        ? h('li', { className: 'dsh-router-empty' }, allChannels.length === 0 ? t('noChannelsConfigured') : t('noChannelsFound'))
        : filteredChannels.map(function (channel) {
            var record = passive[channel.route] || null
            var disc = discover[channel.route] || null
            var probeVerdict = probe[channel.route] || null
            var isFocused = focusRouteKey === channel.route
            var isCheckingThis = Boolean(checkingRoutes[channel.route])
            var isProbingThis = Boolean(probingRoutes[channel.route])
            var status = routeStatus(passive, discover, probe, channel.route)
            var bucketSeconds = props.bucketSeconds ?? 600
            var timeline = record && Array.isArray(record.timeline) ? record.timeline : []
            var bars = bucketTimeline(timeline, bucketSeconds, Date.now())
            var availRateRaw = windowSuccessRate(bars)
            var availRate = availRateRaw === null ? null : Math.round(availRateRaw * 1000) / 10

            return h('li', {
              key: channel.route,
              id: 'channel-' + channel.route.replace(/[^a-zA-Z0-9_-]/g, '_'),
              className: 'dsh-router-row dsh-router-channel-row' + (isFocused ? ' dsh-router-channel-row-focus' : ''),
            },
              h('div', { className: 'dsh-router-row-line' },
                h('span', { className: 'dsh-router-dot', style: healthToneStyle(status) }),
                h('div', { className: 'dsh-router-row-main' },
                  h('div', { className: 'dsh-router-row-title' },
                    h('span', { className: 'dsh-router-provider' }, channel.provider),
                    h('span', { className: 'dsh-router-row-meta', title: channel.model }, shortModelName(channel.model)),
                    h(Tag, { tone: statusTone(status) },
                      statusLabel(t, status) + (availRate === null ? '' : ' · ' + t('availabilityRate') + ' ' + availRate + '%')),
                    isProbingThis
                      ? h(Tag, { tone: 'warning' }, t('probingText'))
                      : probeVerdict
                        ? h(Tag, { tone: probeTone(probeVerdict), title: probeVerdictTitle(t, probeVerdict) }, probeVerdictText(t, probeVerdict))
                        : null),
                  h('div', { className: 'dsh-router-row-sub' },
                    channel.usages.length === 0
                      ? h(Tag, { tone: 'quiet' }, t('channelNotUsed'))
                      : channel.usages.map(function (usage, index) {
                          return h(Tag, { key: index, tone: 'neutral', title: t('channelUsedInChainTip') }, usage.label)
                        }))),
                h('div', { className: 'dsh-router-row-end' },
                  h(Button, {
                    variant: 'ghost',
                    size: 'sm',
                    icon: h(Icon, { d: isCheckingThis ? ICON_SPINNER : ICON_BOLT, size: 12, spin: isCheckingThis }),
                    disabled: isCheckingThis || props.disabled,
                    title: disc
                      ? (disc.kind === 'reachable' ? t('connectivityReachable')
                        : disc.kind === 'notAdvertised' ? t('connectivityNotAdvertised') + '（' + t('connectivityAdvertisedCount') + ' ' + (disc.advertised ?? 0) + '）'
                          : disc.kind === 'unavailable' ? connectivityUnavailableTitle(t, disc)
                            : t('connectivityUnreachable') + (disc.error ? '（' + disc.error + '）' : ''))
                      : t('connectivityNotRun'),
                    onClick: function () { props.onCheckRoute(channel.provider, channel.model) },
                  }, isCheckingThis ? t('checkingText') : t('checkRouteBtn') + ' (' + t('checkRouteCost') + ')'),
                  h(Button, {
                    variant: 'ghost',
                    size: 'sm',
                    icon: h(Icon, { d: isProbingThis ? ICON_SPINNER : ICON_BOLT, size: 12, spin: isProbingThis }),
                    disabled: isProbingThis || props.disabled,
                    title: probeVerdictTitle(t, probeVerdict),
                    onClick: function () { props.onProbeRoute(channel.provider, channel.model) },
                  }, isProbingThis ? t('probingText') : t('probeBtn') + ' (' + t('probeCost') + ')'))),
              h(ChannelMetricsDashboard, { t: t, record: record, bucketSeconds: bucketSeconds }))
          })))
}
