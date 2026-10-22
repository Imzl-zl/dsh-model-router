/**
 * The chain editor's sections and the failover-history dialog.
 *
 * Layout follows DSH's own pages: each section is a title row plus content,
 * rows are flat list items separated by a hairline (ui-plugin-manager `.row`),
 * and controls are the primitives (Button / Checkbox / Input / SegmentedControl
 * / Tag). There is no card inside a card: the page already owns the surface.
 *
 * Note: 分区/行/弹窗的布局契约与原生出处 —— 见 docs/design/ui-layout-redesign.md
 */

import { useMemo, useState } from 'react'
import { Button, Checkbox, Input, Modal, SegmentedControl, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { h } from './dom.ts'
import { fill, routeStatus } from './format.ts'
import { routeNames } from './naming.ts'
import { Icon, ICON_BOLT, ICON_DOWN, ICON_GRIP, ICON_MINUS, ICON_PLUS, ICON_TRASH, ICON_UP } from './icons.ts'
import { routeKeyOf, routeParts } from '../routes.ts'
import { DEFAULT_FIRST_HOP_MAX_RETRIES, MAX_RETRIES, STRATEGIES, SWITCH_ON_CODES } from '../defaults.ts'

/** The status text one route's health tag carries. */
function statusLabel(t, status) {
  if (status === 'healthy') return t('healthStatusHealthy')
  if (status === 'degraded') return t('healthStatusDegraded')
  if (status === 'unhealthy') return t('healthStatusUnhealthy')
  return t('compactHealthIdle')
}

/** The tag tone one health status uses. */
function statusTone(status) {
  if (status === 'healthy') return 'success'
  if (status === 'degraded') return 'warning'
  if (status === 'unhealthy') return 'danger'
  return 'outline'
}

/** The dictionary label for one failure code, falling back to the raw code. */
export function codeLabel(t, code) {
  var entry = SWITCH_ON_CODES.find(function (candidate) { return candidate.code === code })
  return entry === undefined ? code : t(entry.labelKey + 'Name')
}

/**
 * A compact numeric stepper: one button per direction, a text field between
 * them. The field stays controlled so the draft is the only source of truth.
 */
function Stepper(props) {
  var t = props.t
  var value = props.value
  var min = props.min ?? 1
  var max = props.max
  var atMin = value <= min
  var atMax = max !== undefined && value >= max
  return h('span', { className: 'dsh-router-stepper' },
    h('button', {
      type: 'button',
      className: 'dsh-router-stepper-btn',
      disabled: props.disabled || atMin,
      title: t('stepMinus'),
      'aria-label': t('stepMinus'),
      onClick: function () { props.onChange(Math.max(min, value - 1)) },
    }, h(Icon, { d: ICON_MINUS, size: 10 })),
    h('input', {
      className: 'dsh-router-stepper-input',
      type: 'text',
      inputMode: 'numeric',
      value: String(value),
      disabled: props.disabled,
      'aria-label': props.label,
      onChange: function (event) {
        var parsed = Number(event.target.value)
        if (!Number.isFinite(parsed)) return
        var next = Math.max(min, Math.round(parsed))
        if (max !== undefined) next = Math.min(max, next)
        props.onChange(next)
      },
    }),
    h('button', {
      type: 'button',
      className: 'dsh-router-stepper-btn',
      disabled: props.disabled || atMax,
      title: t('stepPlus'),
      'aria-label': t('stepPlus'),
      onClick: function () { props.onChange(max === undefined ? value + 1 : Math.min(max, value + 1)) },
    }, h(Icon, { d: ICON_PLUS, size: 10 })))
}

/**
 * The first hop: the model the user selected in DSH. It is not configured here
 * because it is not a constant — only its retry budget is.
 */
export function FirstHopSection(props) {
  var t = props.t
  var retries = Math.max(0, Math.min(MAX_RETRIES, Number(props.maxRetries) || DEFAULT_FIRST_HOP_MAX_RETRIES))
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('firstHopSectionTitle')),
      h('span', { className: 'dsh-router-section-hint' }, t('firstHopSectionHint'))),
    h('div', { className: 'dsh-router-row dsh-router-row-firsthop' },
      h('div', { className: 'dsh-router-row-line' },
        h('span', { className: 'dsh-router-icon' }, h(Icon, { d: ICON_BOLT, size: 16 })),
        h('div', { className: 'dsh-router-row-main' },
          h('div', { className: 'dsh-router-row-title' },
            t('firstHopTitle'),
            h(Tag, { tone: 'info' }, t('firstHopBadge'))),
          h('div', { className: 'dsh-router-row-sub' }, t('firstHopDesc'))),
        h('div', { className: 'dsh-router-row-end' },
          h('span', { className: 'dsh-router-muted' }, t('retryLimit')),
          h(Stepper, {
            t: t,
            value: retries,
            min: 0,
            max: MAX_RETRIES,
            disabled: props.disabled,
            label: t('retryLimit'),
            onChange: function (next) { if (props.onMaxRetries) props.onMaxRetries(next) },
          }),
          h('span', { className: 'dsh-router-muted' }, t('timesUnit')))),
    h('p', { className: 'dsh-router-note' },
      fill(t('firstHopRetriesNote'), { n: retries }))))
}

/** The conditions panel under one candidate row. */
function ConditionsPanel(props) {
  var t = props.t
  var candidate = props.candidate
  var index = props.index
  var images = candidate.needs?.images
  var imagesMode = images === true ? 'require' : images === false ? 'forbid' : 'any'
  var minContext = candidate.needs?.minContextTokens
  return h('div', { className: 'dsh-router-conditions' },
    h('div', { className: 'dsh-router-field' },
      h('span', { className: 'dsh-router-label' }, t('needImagesTitle')),
      h(SegmentedControl, {
        id: 'needs-images-' + index,
        value: imagesMode,
        label: t('needImagesTitle'),
        disabled: props.disabled,
        options: [
          { value: 'any', label: t('needImagesAnyLabel') },
          { value: 'require', label: t('needImagesRequireLabel') },
          { value: 'forbid', label: t('needImagesForbidLabel') },
        ],
        onChange: function (next) {
          if (next === 'any') props.onNeeds({ imagesMode: 'any' })
          else if (next === 'require') props.onNeeds({ imagesMode: 'require' })
          else props.onNeeds({ imagesMode: 'forbid' })
        },
      }),
      h('span', { className: 'dsh-router-hint' }, t('needImagesHint'))),
    h('div', { className: 'dsh-router-field' },
      h('label', { className: 'dsh-router-label', htmlFor: 'needs-context-' + index }, t('needContextTitle')),
      h(Input, {
        id: 'needs-context-' + index,
        type: 'text',
        inputMode: 'numeric',
        value: minContext === undefined ? '' : String(minContext),
        placeholder: '0',
        disabled: props.disabled,
        onChange: function (event) {
          var parsed = Number(event.target.value)
          props.onNeeds({ minContextTokens: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0 })
        },
      }),
      h('span', { className: 'dsh-router-hint' }, t('needContextHint'))))
}

/** One fallback candidate as a flat row: identity, health, and its controls. */
function CandidateRow(props) {
  var t = props.t
  var candidate = props.candidate
  var index = props.index
  var names = props.names
  var route = routeKeyOf(candidate.provider, candidate.model)
  var status = routeStatus(props.passive, props.discover, props.probe, route)
  var needs = candidate.needs
  var hasConditions = needs !== undefined && (needs.images !== undefined || (needs.minContextTokens ?? 0) > 0)
  var dragActive = props.dragSource === index
  return h('li', {
    className: 'dsh-router-row' + (dragActive ? ' dsh-router-row-dragging' : ''),
    draggable: !props.disabled,
    onDragStart: function (event) {
      if (props.disabled) { event.preventDefault(); return }
      // 只允许从卡面本身发起拖拽：按钮/输入框上的按下不是重排手势。边界收窄到
      // 本行（row.contains），外层同角色的包裹层不再把整行判成"在交互元素里"。
      var hit = event.target
      if (hit && typeof hit.closest === 'function') {
        var interactive = hit.closest('button, input, select, textarea, a, [role="tab"]')
        if (interactive && event.currentTarget.contains(interactive)) { event.preventDefault(); return }
      }
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      props.onDragStart(index)
    },
    onDragOver: function (event) {
      if (props.dragSource === null) return
      // The row under the pointer is the drop target; the browser needs the
      // default prevented or it refuses the drop entirely.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onDrop: function (event) {
      event.preventDefault()
      props.onDrop(index)
    },
    onDragEnd: function () { props.onDragEnd() },
  },
    h('div', { className: 'dsh-router-row-line' },
      h('span', { className: 'dsh-router-row-grip', title: t('dragReorderHint'), 'aria-hidden': 'true' },
        h(Icon, { d: ICON_GRIP, size: 12 })),
      h('span', { className: 'dsh-router-order' }, String(index + 1)),
      h('div', { className: 'dsh-router-row-main' },
        // 标题用目录里的显示名（用户在「模型」页映射的名字），原始 `provider/model`
        // 留在 title 里——名字要好看，但排查时必须还能读到真实渠道。
        // Note: 为何显示名来自目录、缺名回落原始 id —— 见
        // .agents/notes/implemented/2026-10-22-catalog-names-on-every-surface.md
        h('div', { className: 'dsh-router-row-title', title: route },
          h('span', { className: 'dsh-router-provider' }, names.provider(candidate.provider)),
          h('span', { className: 'dsh-router-row-meta' }, names.model(candidate.provider, candidate.model))),
        h('div', { className: 'dsh-router-row-sub' },
          h('button', {
            type: 'button',
            className: 'dsh-router-tag-btn',
            title: t('jumpToHealth'),
            onClick: function () { if (props.onJumpHealth) props.onJumpHealth(route) },
          }, h(Tag, { tone: statusTone(status), className: 'dsh-router-health-tag' }, statusLabel(t, status))),
          hasConditions
            ? h(Tag, { tone: 'info' },
                needs.images === true ? t('needImagesRequireBadge')
                  : needs.images === false ? t('needImagesForbidBadge')
                    : fill(t('needContextBadge'), { n: needs.minContextTokens }))
            : null,
          props.strategy === 'weight' && (candidate.weight ?? 0) > 0
            ? h(Tag, { tone: 'quiet' }, t('weightLabel') + ' ' + candidate.weight)
            : null)),
      h('div', { className: 'dsh-router-row-end' },
        props.strategy === 'weight'
          ? h('span', { className: 'dsh-router-inline-field' },
              h('span', { className: 'dsh-router-muted' }, t('weightLabel')),
              h('input', {
                className: 'dsh-router-inline-input',
                type: 'text',
                inputMode: 'numeric',
                value: String(candidate.weight ?? 0),
                disabled: props.disabled,
                'aria-label': t('weightLabel'),
                onChange: function (event) {
                  var parsed = Number(event.target.value)
                  if (Number.isFinite(parsed)) props.onWeight(index, Math.max(0, Math.min(100, Math.round(parsed))))
                },
              }))
          : null,
        h('span', { className: 'dsh-router-inline-field' },
          h('span', { className: 'dsh-router-muted' }, t('retryLimit')),
          h(Stepper, {
            t: t,
            value: candidate.maxRetries,
            min: 0,
            max: MAX_RETRIES,
            disabled: props.disabled,
            label: t('retryLimit'),
            onChange: function (next) { props.onMaxRetries(index, next) },
          })),
        h('button', {
          type: 'button',
          className: 'dsh-router-link-btn',
          'aria-expanded': props.open,
          onClick: function () { props.onToggleConditions(index) },
        }, t('toggleNeedsBtn') + (props.open ? ' ▴' : ' ▾')),
        h('button', {
          type: 'button',
          className: 'dsh-router-icon-btn',
          title: t('moveUp'),
          'aria-label': t('moveUp'),
          disabled: props.disabled || index === 0,
          onClick: function () { props.onMove(index, -1) },
        }, h(Icon, { d: ICON_UP, size: 12 })),
        h('button', {
          type: 'button',
          className: 'dsh-router-icon-btn',
          title: t('moveDown'),
          'aria-label': t('moveDown'),
          disabled: props.disabled || index === props.total - 1,
          onClick: function () { props.onMove(index, 1) },
        }, h(Icon, { d: ICON_DOWN, size: 12 })),
        h('button', {
          type: 'button',
          className: 'dsh-router-icon-btn dsh-router-icon-btn-danger',
          title: t('removeNode'),
          'aria-label': t('removeNode'),
          disabled: props.disabled,
          onClick: function () { props.onRemove(index) },
        }, h(Icon, { d: ICON_TRASH, size: 12 })))),
    props.open
      ? h(ConditionsPanel, {
          t: t,
          candidate: candidate,
          index: index,
          disabled: props.disabled,
          onNeeds: function (patch) { props.onNeeds(index, patch) },
        })
      : null)
}

/** The fallback candidates: one flat list, one add action, one empty state. */
export function CandidatesSection(props) {
  var t = props.t
  var [openIndex, setOpenIndex] = useState(-1)
  var [dragSource, setDragSource] = useState(null)
  // 目录可能有几百个模型：一次渲染查一次表，不按行重建。
  var names = useMemo(function () { return routeNames(props.catalog) }, [props.catalog])
  var candidates = props.candidates
  var imageIndex = -1
  candidates.forEach(function (candidate, index) {
    if (imageIndex === -1 && candidate.needs && candidate.needs.images !== undefined) imageIndex = index
  })
  var toggleConditions = function (index) { setOpenIndex(openIndex === index ? -1 : index) }
  var handleDrop = function (index) {
    if (dragSource !== null) props.onReorder(dragSource, index)
    setDragSource(null)
  }
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('fallbackChainSection')),
      h('span', { className: 'dsh-router-section-count' }, String(candidates.length)),
      imageIndex >= 0
        ? h('button', {
            type: 'button',
            className: 'dsh-router-link-btn',
            title: t('imageRouteBadgeHint'),
            onClick: function () { setOpenIndex(imageIndex) },
          }, '🖼️ ' + t('imageRouteBadge'))
        : null,
      h('span', { className: 'dsh-router-section-spacer' }),
      h(Button, {
        variant: 'primary',
        icon: h(Icon, { d: ICON_PLUS, size: 14 }),
        disabled: props.disabled,
        onClick: props.onOpenAddCandidate,
      }, t('addCandidateBtn'))),
    candidates.length === 0
      ? h('p', { className: 'dsh-router-empty' }, t('fallbackEmptyTitle') + ' — ' + t('fallbackEmptyDesc'))
      : h('ul', { className: 'dsh-router-list' },
          candidates.map(function (candidate, index) {
            return h(CandidateRow, {
              key: routeKeyOf(candidate.provider, candidate.model) + ':' + index,
              t: t,
              candidate: candidate,
              names: names,
              index: index,
              total: candidates.length,
              strategy: props.strategy,
              disabled: props.disabled,
              passive: props.passive,
              discover: props.discover,
              probe: props.probe,
              open: openIndex === index,
              onToggleConditions: toggleConditions,
              onMaxRetries: props.onMaxRetries,
              onWeight: props.onWeight,
              onMove: props.onMove,
              onNeeds: props.onNeeds,
              onRemove: props.onRemove,
              onJumpHealth: props.onJumpHealth,
              dragSource: dragSource,
              onDragStart: function (index) { setDragSource(index) },
              onDrop: handleDrop,
              onDragEnd: function () { setDragSource(null) },
            })
          })))
}

/** Which failures move the chain forward: one checkbox per code. */
export function SwitchOnSection(props) {
  var t = props.t
  var checked = SWITCH_ON_CODES.filter(function (entry) { return Boolean(props.value[entry.key]) }).length
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('switchOnTitle')),
      h('span', { className: 'dsh-router-section-hint' },
        fill(t('triggerSummaryLine'), { n: checked, total: SWITCH_ON_CODES.length }))),
    h('div', { className: 'dsh-router-check-grid' },
      SWITCH_ON_CODES.map(function (entry) {
        return h(Checkbox, {
          key: entry.key,
          className: 'dsh-router-check',
          checked: Boolean(props.value[entry.key]),
          disabled: props.disabled,
          label: t(entry.labelKey + 'Name') + ' · ' + entry.code,
          title: t(entry.labelKey + 'Desc'),
          onChange: function () { props.onToggle(entry.key) },
        })
      })))
}

/** One field in the two-column form: label, control, hint. */
function FieldCol(props) {
  return h('div', { className: 'dsh-router-field-col' },
    h('span', { className: 'dsh-router-label' }, props.label),
    props.children,
    props.hint === undefined ? null : h('span', { className: 'dsh-router-hint' }, props.hint))
}

/**
 * The start strategy is the first decision a user makes — it decides which
 * FALLBACK a request starts from after the first hop fails — so it is the first
 * section, not a field buried under the budget. The first hop itself is always
 * tried first and never participates in the draw.
 */
export function StrategySection(props) {
  var t = props.t
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('strategySectionTitle')),
      h('span', { className: 'dsh-router-section-hint' }, t('strategySectionHint'))),
    h('div', { className: 'dsh-router-field-grid' },
      h(FieldCol, { label: t('strategyLabel'), hint: t('strategyDetail' + props.strategy) },
        h(SegmentedControl, {
          id: 'router-strategy',
          value: props.strategy,
          label: t('strategyLabel'),
          disabled: props.disabled,
          options: STRATEGIES.map(function (value) {
            return { value: value, label: t('strategy' + value) }
          }),
          onChange: function (next) { props.onStrategy(next) },
        }))))
}

/**
 * What one model call can cost, and the one turn-scoped setting next to it.
 *
 * This used to be a "budget" section with a third number (a request-wide hard
 * cap). That number could only ever cut a request short — it never switched,
 * never added a call — and it made every user do the arithmetic themselves.
 * Removed 2026-10-20: the retry numbers per candidate are the budget, and the
 * line below is read-only so nobody has to add `+1` in their head.
 */
export function RetrySection(props) {
  var t = props.t
  var first = Math.max(0, Number(props.firstHopMaxRetries) || 0)
  var candidates = props.candidates ?? []
  var retries = candidates.reduce(function (sum, candidate) {
    return sum + Math.max(0, Number(candidate.maxRetries) || 0)
  }, 0)
  var calls = first + retries + 1 + candidates.length
  var formula = candidates.length === 0
    ? fill(t('retryFormulaFirstOnly'), { calls: calls })
    : fill(t('retryFormula'), { first: first, candidates: retries, calls: calls })
  var stickyOptions = [0, 1, 2, 3, 5]
  var current = Math.max(0, Math.min(99, Number(props.stickyTurns) || 0))
  if (stickyOptions.indexOf(current) === -1) stickyOptions.push(current)
  stickyOptions.sort(function (left, right) { return left - right })
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('retrySectionTitle')),
      h('span', { className: 'dsh-router-section-hint' }, t('retrySectionHint'))),
    h('div', { className: 'dsh-router-field-grid' },
      h(FieldCol, { label: t('stickyTurns'), hint: t('stickyTurnsHint') },
        h(SegmentedControl, {
          id: 'router-sticky-turns',
          value: String(current),
          label: t('stickyTurns'),
          disabled: props.disabled,
          options: stickyOptions.map(function (turns) {
            return { value: String(turns), label: turns === 0 ? t('stickyTurnsOff') : String(turns) }
          }),
          onChange: function (next) { props.onStickyTurns(Number(next)) },
        }))),
    h('p', { className: 'dsh-router-formula' }, formula),
    h('p', { className: 'dsh-router-note' }, t('retryHierarchyNote')))
}

/**
 * The failover ledger as a centred dialog — the same `Modal` every other DSH
 * secondary view uses. It replaced a self-built right-edge drawer whose close
 * button sat next to the desktop window's own close control.
 */
export function FailoverHistoryModal(props) {
  var t = props.t
  var ui = props.state.ui
  var rows = ui.drawerRows
  // 账本里存的是 `provider/model` 原始键（lineage.ts）。显示名来自目录，缺名回落
  // 到键本身——历史里出现一条已经不在目录里的路由时，仍然要读得出它是哪条。
  var names = useMemo(function () { return routeNames(ui.catalog) }, [ui.catalog])
  var body
  if (ui.drawerLoading) body = h('p', { className: 'dsh-router-muted' }, t('failoverHistoryLoading'))
  else if (ui.drawerError) {
    body = h('div', null,
      h('p', { className: 'dsh-router-muted' }, t('failoverHistoryError')),
      h(Button, { variant: 'outline', size: 'sm', onClick: props.onReload }, t('failoverHistoryRetry')))
  } else if (rows.length === 0) body = h('p', { className: 'dsh-router-muted' }, t('failoverHistoryEmpty'))
  else {
    body = h('div', { className: 'dsh-router-history' },
      rows.map(function (row, rowIndex) {
        return h('section', { key: 's' + rowIndex, className: 'dsh-router-history-session' },
          h('h3', { className: 'dsh-router-history-title' },
            t('failoverSessionLabel') + ' ' + String(row.sessionId).slice(0, 8)),
          h('ul', { className: 'dsh-router-list' },
            row.entries.map(function (entry, index) {
              return h('li', { key: 'e' + index, className: 'dsh-router-history-row' },
                h('span', { className: 'dsh-router-history-time' }, new Date(entry.time).toLocaleString()),
                h('span', { className: 'dsh-router-history-text', title: entry.from + ' → ' + entry.to },
                  fill(t('failoverEntryLine'), {
                    from: names.route(routeParts(entry.from).provider, routeParts(entry.from).model),
                    code: codeLabel(t, entry.code),
                    to: names.route(routeParts(entry.to).provider, routeParts(entry.to).model),
                  })),
                h(Tag, { tone: entry.settled ? 'success' : 'warning' },
                  entry.settled ? t('failoverEntrySettled') : t('failoverEntryUnsettled')))
            })))
      }),
      h('p', { className: 'dsh-router-hint' }, t('failoverHistoryHint')))
  }
  return h(Modal, {
    open: true,
    onClose: props.onClose,
    title: t('failoverHistoryDrawerTitle'),
    closeLabel: t('close'),
    className: 'dsh-router-history-modal',
    contentClassName: 'dsh-router-modal-content',
    footer: h(Button, { variant: 'outline', onClick: props.onClose }, t('close')),
  }, body)
}
