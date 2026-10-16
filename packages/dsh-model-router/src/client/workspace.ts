/** Global channel health & telemetry workspace, aggregated per physical route. */

import { useEffect, useMemo, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, formatLatency, healthToneStyle, routeStatus } from './format.ts'
import { ChannelMetricsDashboard } from './health-ui.ts'
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
  // the scroll; entering through the nav entry clears it (null).
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

  // Collect all physical channels across configuration and history
  var allChannels = useMemo(function () {
    var map = {}
    var ensure = function (provider, model) {
      if (!provider || !model) return null
      var key = provider + '/' + model
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

    if (draft && draft.profiles) {
      draft.profiles.forEach(function (p) {
        (p.candidates || []).forEach(function (c, idx) {
          var ch = ensure(c.provider, c.model)
          if (ch) ch.usages.push({
            name: p.when.model,
            label: (idx === 0 ? '👑 ' : '') + p.when.model,
          })
        })
      })
    }

    if (draft && draft.default && draft.default.candidates) {
      draft.default.candidates.forEach(function (c, idx) {
        var ch = ensure(c.provider, c.model)
        if (ch) ch.usages.push({
          name: '__default__',
          label: t('channelUsedInDefault') + ' #' + (idx + 1),
        })
      })
    }

    if (passive) {
      Object.keys(passive).forEach(function (key) {
        var slash = key.indexOf('/')
        if (slash > 0) ensure(key.slice(0, slash), key.slice(slash + 1))
      })
    }

    if (discover) {
      Object.keys(discover).forEach(function (key) {
        var slash = key.indexOf('/')
        if (slash > 0) ensure(key.slice(0, slash), key.slice(slash + 1))
      })
    }

    if (probe) {
      Object.keys(probe).forEach(function (key) {
        var slash = key.indexOf('/')
        if (slash > 0) ensure(key.slice(0, slash), key.slice(slash + 1))
      })
    }

    return Object.values(map)
  }, [draft, passive, discover, probe, t])

  // Filtered channels
  var filteredChannels = allChannels.filter(function (ch) {
    var status = routeStatus(passive, discover, probe, ch.route)

    if (filter === 'healthy' && status !== 'healthy') return false
    if (filter === 'issue' && status !== 'degraded' && status !== 'unhealthy') return false
    if (filter === 'idle' && status !== 'unknown') return false

    if (search.trim()) {
      var q = search.trim().toLowerCase()
      return ch.route.toLowerCase().indexOf(q) !== -1 || ch.model.toLowerCase().indexOf(q) !== -1 || ch.provider.toLowerCase().indexOf(q) !== -1
    }
    return true
  })

  return h('div', { style: S.detailWorkspace },
    // Workspace Header Card with Global Diagnostic Tools
    h('section', { style: S.workspaceHeaderCard },
      h('div', { style: S.workspaceHeaderLeft },
        h('div', { style: Object.assign({}, S.workspaceAvatar, { background: 'linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(59,130,246,0.15) 100%)', color: '#06B6D4' }) },
          h(Icon, { d: ICON_CHART, size: 18 })),
        h('div', { style: S.workspaceTitles },
          h('div', { style: S.workspaceTitleRow },
            h('h2', { style: S.workspaceModelName }, t('globalHealthTitle')),
            h('span', { style: S.countBadge }, fill(t('navHealthCount'), { n: allChannels.length }))),
          h('p', { style: S.workspaceDesc }, t('globalHealthSubtitle')))),
      h('div', { style: S.channelActionGroup },
        h('button', {
          type: 'button',
          className: 'dsh-router-tool-btn',
          style: Object.assign({}, S.toolBtn, checking ? { opacity: 0.6, cursor: 'wait' } : null),
          disabled: props.disabled || checking,
          title: t('toolCheckAllTooltip'),
          onClick: props.onCheckAll,
        }, h(Icon, { d: checking ? ICON_SPINNER : ICON_BOLT, size: 13, spin: checking }), checking ? t('checkingText') : t('toolCheckAllConnectivity')),
        h('button', {
          type: 'button',
          className: 'dsh-router-tool-btn',
          style: Object.assign({}, S.toolBtn, probing ? { opacity: 0.6, cursor: 'wait' } : null),
          disabled: props.disabled || probing,
          title: t('toolProbeAllTooltip'),
          onClick: props.onProbeAll,
        }, h(Icon, { d: probing ? ICON_SPINNER : ICON_BOLT, size: 13, spin: probing }), probing ? t('probingText') : t('toolProbeAll')),
        h('button', {
          type: 'button',
          className: 'dsh-router-tool-btn',
          style: S.toolBtn,
          disabled: props.disabled,
          title: t('healthConfigBtn'),
          onClick: props.onOpenHealthModal,
        }, h(Icon, { d: ICON_GEAR, size: 13 }), t('toolHealthConfig')),
        h('button', {
          type: 'button',
          className: 'dsh-router-tool-btn',
          style: S.toolBtn,
          title: t('failoverHistoryButton'),
          onClick: props.onOpenDrawer,
        }, h(Icon, { d: ICON_CLOCK, size: 13 }), t('toolHistory')))),
      // What the last run found. Kept on screen until the next run: a run whose
      // results match what was already there changes nothing visible, so the
      // counts are what tell the user the click did something.
      (checking || probing || (props.checkSummary && props.checkSummary.total > 0) || (props.probeSummary && props.probeSummary.total > 0))
        ? h('div', { style: S.healthRunSummary },
            checking ? h('span', { style: S.healthRunSummaryItem }, t('checkingText')) : null,
            props.checkSummary && props.checkSummary.total > 0 && !checking
              ? h('span', { style: S.healthRunSummaryItem }, fill(t('checkSummaryLine'), { text: props.checkSummary.text }))
              : null,
            probing ? h('span', { style: S.healthRunSummaryItem }, t('probingText')) : null,
            props.probeSummary && props.probeSummary.total > 0 && !probing
              ? h('span', { style: S.healthRunSummaryItem }, fill(t('probeSummaryLine'), { text: props.probeSummary.text }))
              : null,
            h('span', { style: S.healthRunSummaryHint }, t('perRouteProbeHint')))
        : null,

    // Filter and Search Bar
    h('div', { style: S.healthFilterBar },
      h('div', { style: S.healthFilterPills },
        ['all', 'healthy', 'issue', 'idle'].map(function (key) {
          var count = 0
          allChannels.forEach(function (ch) {
            var st = routeStatus(passive, discover, probe, ch.route)
            if (key === 'all') count++
            else if (key === 'healthy' && st === 'healthy') count++
            else if (key === 'issue' && (st === 'degraded' || st === 'unhealthy')) count++
            else if (key === 'idle' && st === 'unknown') count++
          })
          var labelMap = {
            all: t('filterAll'),
            healthy: t('filterHealthy'),
            issue: t('filterUnhealthy'),
            idle: t('filterIdle'),
          }
          var isCurrent = filter === key
          return h('button', {
            key: key,
            type: 'button',
            className: 'dsh-router-filter-pill' + (isCurrent ? ' active' : ''),
            style: Object.assign({}, S.filterPill, isCurrent ? S.filterPillActive : null),
            onClick: function () { setFilter(key) },
          }, labelMap[key] + ' (' + count + ')')
        })),
      h('div', { style: Object.assign({}, S.searchBox, { maxWidth: 260 }) },
        h(Icon, { d: ICON_SEARCH, size: 12, style: S.searchIcon }),
        h('input', {
          type: 'text',
          placeholder: t('searchChannelPlaceholder'),
          'aria-label': t('searchChannelPlaceholder'),
          value: search,
          onChange: function (e) { setSearch(e.target.value) },
          style: Object.assign({}, S.searchInput, { height: 28, fontSize: 11.5 }),
        }))),

    // Channel Cards List — the workspace's only scrolling region, so the header
    // and the filter bar above stay where they are.
    h('div', { style: S.channelList },
      filteredChannels.length === 0
        ? h('div', { style: S.telemetryEmptyBox }, allChannels.length === 0 ? t('noChannelsConfigured') : t('noChannelsFound'))
        : filteredChannels.map(function (ch) {
            var record = passive[ch.route] || null
          var disc = discover[ch.route] || null
          var probeVerdict = probe[ch.route] || null
          var isFocused = focusRouteKey === ch.route
          var isCheckingThis = Boolean(checkingRoutes[ch.route])
          var isProbingThis = Boolean(probingRoutes[ch.route])
          var status = routeStatus(passive, discover, probe, ch.route)

          // Availability rate calculation from timeline
          var timeline = record && Array.isArray(record.timeline) ? record.timeline : []
          var availRate = '—'
          if (timeline.length > 0) {
            var healthyCount = timeline.filter(function (p) { return p.status === 'healthy' }).length
            availRate = (healthyCount / timeline.length * 100).toFixed(1) + '%'
          }

          return h('div', {
            key: ch.route,
            id: 'channel-' + ch.route.replace(/[^a-zA-Z0-9_-]/g, '_'),
            style: Object.assign({}, S.channelCard, isFocused ? S.channelCardFocused : null),
          },
            // Card Top Row
            h('div', { style: S.channelCardTopRow },
              h('div', { style: S.channelRouteGroup },
                h('span', { style: Object.assign({}, S.channelStatusDot, healthToneStyle(status)) }),
                h('span', { style: S.providerBadge }, ch.provider),
                h('span', { style: S.channelModelName }, ch.model),
                h('span', { style: Object.assign({}, S.channelStatusPill, healthToneStyle(status)) },
                  status === 'healthy' ? t('healthStatusHealthy') : status === 'degraded' ? t('healthStatusDegraded') : status === 'unhealthy' ? t('healthStatusUnhealthy') : t('compactHealthIdle'),
                  availRate !== '—' ? ' · ' + t('availabilityRate') + ' ' + availRate : ''),
                // The probe verdict, on the card. It used to live only in the
                // button's tooltip, so a user who clicked 测速 and did not hover
                // saw nothing change — which reads as a dead button.
                isProbingThis
                  ? h('span', { style: Object.assign({}, S.probeVerdictBadge, S.probeVerdictBusy) }, t('probingText'))
                  : probeVerdict
                    ? h('span', {
                        style: Object.assign({}, S.probeVerdictBadge, probeVerdict.kind === 'reachable' ? S.probeVerdictOk : probeVerdict.kind === 'unreachable' ? S.probeVerdictBad : S.probeVerdictUnknown),
                        title: probeVerdictTitle(t, probeVerdict),
                      }, probeVerdictText(t, probeVerdict))
                    : null,
                ch.usages.length === 0
                  ? h('span', { style: S.channelUsageBadge }, t('channelNotUsed'))
                  : ch.usages.map(function (u, i) {
                      return h('span', { key: i, style: S.channelUsageBadge, title: u.name }, u.label)
                    })),

              h('div', { style: S.channelActionGroup },
                // Inline Action 1: 0 Token Connectivity Check
                h('button', {
                  type: 'button',
                  className: 'dsh-router-btn-action',
                  style: Object.assign({}, S.btnActionSmall, isCheckingThis ? { opacity: 0.6, cursor: 'wait' } : null),
                  disabled: isCheckingThis || props.disabled,
                  title: disc
                    ? (disc.kind === 'reachable' ? t('connectivityReachable')
                      : disc.kind === 'notAdvertised' ? t('connectivityNotAdvertised') + '（' + t('connectivityAdvertisedCount') + ' ' + (disc.advertised ?? 0) + '）'
                        : disc.kind === 'unavailable' ? (disc.reason === 'notConfigurable' ? t('connectivityNotConfigurable') : t('connectivityUnavailable'))
                          : t('connectivityUnreachable'))
                    : t('connectivityNotRun'),
                  onClick: function () { props.onCheckRoute(ch.provider, ch.model) },
                },
                  h(Icon, { d: isCheckingThis ? ICON_SPINNER : ICON_BOLT, size: 11, spin: isCheckingThis }),
                  t('checkRouteBtn') + ' (' + t('checkRouteCost') + ')'),

                // Inline Action 2: the 1-token end-to-end probe. It answers what
                // the connectivity check cannot: whether a completion can
                // actually be produced on this route. The cost is stated on the
                // button because it is real — one generated token, cut at the
                // first content byte.
                h('button', {
                  type: 'button',
                  className: 'dsh-router-btn-action',
                  style: Object.assign({}, S.btnActionSmall, isProbingThis ? { opacity: 0.6, cursor: 'wait' } : null),
                  disabled: isProbingThis || props.disabled,
                  title: probeVerdictTitle(t, probeVerdict),
                  onClick: function () { props.onProbeRoute(ch.provider, ch.model) },
                },
                  h(Icon, { d: isProbingThis ? ICON_SPINNER : ICON_BOLT, size: 11, spin: isProbingThis }),
                  t('probeBtn') + ' (' + t('probeCost') + ')'))),

            // Metrics & 24-point Sparkline
            h(ChannelMetricsDashboard, { t: t, record: record }))
          })))
}
