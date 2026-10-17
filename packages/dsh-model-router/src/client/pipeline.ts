/** The fallback pipeline editor: candidate nodes, connectors, switch-on grid, budget row and the failover drawer. */

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, healthToneBadge, routeOf } from './format.ts'
import { HealthSignalDot, reasoningLabelOf } from './health-ui.ts'
import { Icon, ICON_ARROW_DOWN, ICON_BOLT, ICON_CLOSE, ICON_DOWN, ICON_GRIP, ICON_MINUS, ICON_PLUS, ICON_ROUTE, ICON_SHIELD, ICON_TRASH, ICON_UP, ICON_WARN } from './icons.ts'
import { SegmentedTabs, Tag, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { STRATEGY_OPTIONS, SWITCH_ON_CODES } from './validate.ts'

export function CandidateNode(props) {
  var t = props.t
  var candidate = props.candidate
  var index = props.index
  var isPrimary = index === 0 && !props.isDefault
  var expandedState = useState(false)
  var expanded = expandedState[0]
  var setExpanded = expandedState[1]
  var needs = candidate.needs ?? {}
  var hasActiveNeeds = (needs.images !== undefined) || (needs.minContextTokens > 0)
  var imagesMode = needs.images === true ? 'require' : needs.images === false ? 'forbid' : 'any'
  var reasoning = reasoningLabelOf(props.catalog, candidate.provider, candidate.model)

  var minMoveIndex = props.isDefault ? 0 : 1
  var canMoveUp = !isPrimary && index > minMoveIndex && !props.disabled
  var canMoveDown = (!isPrimary || props.isDefault) && index < props.total - 1 && !props.disabled
  var canDrag = (!isPrimary || props.isDefault) && props.total > 1 && !props.disabled

  return h('div', { style: S.node },
    h('div', {
      style: Object.assign(
        {},
        S.nodeCard,
        isPrimary ? S.nodeCardPrimary : null,
        props.isDragging ? S.nodeCardDragging : null,
        props.isDragTarget && !props.isDragging ? S.nodeCardDragOver : null,
      ),
      onDragOver: function (e) { if (props.onDragOver) props.onDragOver(e, index) },
      onDrop: function (e) { if (props.onDrop) props.onDrop(e, index) },
      onDragEnd: function (e) { if (props.onDragEnd) props.onDragEnd(e) },
    },
      h('div', { style: S.nodeMainRow },
        !isPrimary ? h('div', {
          className: 'dsh-router-grip-handle',
          style: Object.assign({}, S.gripHandle, !canDrag ? S.gripHandleDisabled : null),
          title: t('dragReorderHint'),
          draggable: canDrag,
          onDragStart: function (e) {
            if (canDrag && props.onDragStart) props.onDragStart(e, index)
          },
        }, h(Icon, { d: ICON_GRIP, size: 14 })) : null,
        h('div', { style: Object.assign({}, S.rankBadge, isPrimary ? S.rankBadgePrimary : null) },
          isPrimary ? '★' : String(props.isDefault ? index + 1 : index).padStart(2, '0')),
        h('div', { style: S.nodeContent },
          h('div', { style: S.modelInfo },
            h('div', { style: S.modelNameRow },
              h('span', { style: S.modelName, title: candidate.model }, candidate.model || '—'),
              h('span', { style: S.providerBadge }, candidate.provider),
              isPrimary ? h('span', { style: Object.assign({}, S.primaryBadge, healthToneBadge('healthy')) }, '👑 ' + t('primaryModelBadge')) : null,
              h(HealthSignalDot, {
                t: t,
                route: routeOf(candidate),
                record: props.passive ? props.passive[routeOf(candidate)] : null,
                passive: props.passive,
                discover: props.discover,
                probe: props.probe,
                onJumpHealth: props.onJumpHealth,
              }),
              reasoning === undefined ? null : h('span', { style: S.reasoningBadge }, t('reasoningBadge') + ': ' + reasoning),
              h('button', {
                type: 'button',
                className: 'dsh-router-needs-btn',
                style: Object.assign({}, S.needsBtn, hasActiveNeeds ? S.needsBtnActive : null),
                'aria-expanded': expanded,
                onClick: function () { setExpanded(!expanded) },
              }, hasActiveNeeds ? '⚙️ ● ' + t('toggleNeedsBtn') : '⚙️ ' + t('toggleNeedsBtn'))),
            h('span', { style: S.modelPath }, routeOf(candidate))),
          h('div', { style: S.nodeControls },
            h('div', { style: S.nodeTuning },
              h('div', { style: S.attemptPicker, title: t('attemptLimitHint') },
                h('span', { style: { whiteSpace: 'nowrap' } }, t('singleAttemptLimit')),
                h('button', {
                  type: 'button',
                  className: 'dsh-router-stepper-btn',
                  style: Object.assign({}, S.stepperBtn, (props.disabled || candidate.maxAttempts <= 1) ? { opacity: 0.35, cursor: 'not-allowed' } : null),
                  disabled: props.disabled || candidate.maxAttempts <= 1,
                  title: t('stepMinus'),
                  onClick: function () { props.onMaxAttempts(index, Math.max(1, candidate.maxAttempts - 1)) },
                }, h(Icon, { d: ICON_MINUS, size: 10 })),
                h('input', {
                  style: S.attemptInput,
                  type: 'text',
                  inputMode: 'numeric',
                  maxLength: 2,
                  'aria-label': t('singleAttemptLimit') + ' (' + t('attemptRangeHint') + ')',
                  value: String(candidate.maxAttempts),
                  disabled: props.disabled,
                  onChange: function (event) { props.onMaxAttempts(index, event.target.value) },
                }),
                h('button', {
                  type: 'button',
                  className: 'dsh-router-stepper-btn',
                  style: Object.assign({}, S.stepperBtn, (props.disabled || candidate.maxAttempts >= 5) ? { opacity: 0.35, cursor: 'not-allowed' } : null),
                  disabled: props.disabled || candidate.maxAttempts >= 5,
                  title: t('stepPlus'),
                  onClick: function () { props.onMaxAttempts(index, Math.min(5, candidate.maxAttempts + 1)) },
                }, h(Icon, { d: ICON_PLUS, size: 10 })),
                h('span', { style: { whiteSpace: 'nowrap' } }, t('timesUnit'))),
              props.showWeight ? h('div', { style: S.attemptPicker, title: t('weightHint') },
                h('span', { style: { whiteSpace: 'nowrap' } }, t('weightLabel')),
                h('input', {
                  style: S.attemptInput,
                  type: 'text',
                  inputMode: 'numeric',
                  maxLength: 3,
                  'aria-label': t('weightLabel'),
                  value: String(candidate.weight || 0),
                  disabled: props.disabled,
                  onChange: function (event) { props.onWeight(index, event.target.value) },
                }),
                h('span', { style: { whiteSpace: 'nowrap' } }, props.weightShare + '%')) : null),
            h('div', { style: S.nodeActions },
              isPrimary
                ? h('span', { style: S.primaryLockedBadge, title: t('primaryPinnedHint') },
                    h(Icon, { d: ICON_SHIELD, size: 11 }),
                    t('primaryLockedBadge'))
                : [
                    h('button', {
                      key: 'up',
                      type: 'button',
                      className: 'dsh-router-action-btn',
                      style: Object.assign({}, S.actionBtn, !canMoveUp ? S.actionBtnDisabled : null),
                      disabled: !canMoveUp,
                      title: t('moveUp'),
                      onClick: function () { props.onMove(index, -1) },
                    }, h(Icon, { d: ICON_UP, size: 13 })),
                    h('button', {
                      key: 'down',
                      type: 'button',
                      className: 'dsh-router-action-btn',
                      style: Object.assign({}, S.actionBtn, !canMoveDown ? S.actionBtnDisabled : null),
                      disabled: !canMoveDown,
                      title: t('moveDown'),
                      onClick: function () { props.onMove(index, 1) },
                    }, h(Icon, { d: ICON_DOWN, size: 13 })),
                    h('button', {
                      key: 'del',
                      type: 'button',
                      className: 'dsh-router-action-btn dsh-router-action-btn-danger',
                      style: Object.assign({}, S.actionBtn, S.actionBtnDanger),
                      disabled: props.disabled,
                      title: t('removeNode'),
                      onClick: function () { props.onRemove(index) },
                    }, h(Icon, { d: ICON_TRASH, size: 12 })),
                  ])))),
      expanded ? h('div', { style: S.needsPanel },
        h('div', { style: S.needsGrid },
          h('div', { style: S.needCard, id: 'images-' + imagesMode + '-panel-' + index, role: 'tabpanel', 'aria-labelledby': 'images-' + imagesMode + '-' + index },
            h('div', { style: S.needHeader },
              h('span', { style: S.needCardTitle }, t('needImagesTitle')),
              h('span', { style: imagesMode === 'any' ? S.needStatusBadgeMuted : S.needStatusBadgeActive },
                imagesMode === 'require' ? t('needImagesRequireBadge') : imagesMode === 'forbid' ? t('needImagesForbidBadge') : t('needImagesAnyBadge'))),
            h('div', { className: 'dsh-router-need-control', style: S.needControlRow },
              h(SegmentedTabs, {
                items: [
                  { value: 'any', label: t('needImagesAnyLabel'), id: 'images-any-' + index, panelId: 'images-any-panel-' + index },
                  { value: 'require', label: t('needImagesRequireLabel'), id: 'images-require-' + index, panelId: 'images-require-panel-' + index },
                  { value: 'forbid', label: t('needImagesForbidLabel'), id: 'images-forbid-' + index, panelId: 'images-forbid-panel-' + index },
                ],
                value: imagesMode,
                onChange: function (value) { props.onNeeds(index, { imagesMode: value }) },
              })),
            h('span', { style: S.needHint }, t('needImagesHint'))),
          h('div', { style: S.needCard },
            h('div', { style: S.needHeader },
              h('span', { style: S.needCardTitle }, t('needContextTitle')),
              h('span', { style: (needs.minContextTokens ?? 0) > 0 ? S.needStatusBadgeActive : S.needStatusBadgeMuted },
                (needs.minContextTokens ?? 0) > 0 ? fill(t('needContextBadge'), { n: needs.minContextTokens }) : t('needContextAnyBadge'))),
            h('div', { style: S.needControlRow },
              h('input', {
                style: S.needInput,
                type: 'text',
                inputMode: 'numeric',
                placeholder: '0',
                'aria-label': t('needContextTitle'),
                value: String(needs.minContextTokens ?? 0),
                disabled: props.disabled,
                onChange: function (event) {
                  var parsed = Number(event.target.value)
                  props.onNeeds(index, { minContextTokens: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0 })
                },
              })),
            h('span', { style: S.needHint }, t('needContextHint'))))) : null))
}


/**
 * 历史抽屉里的失败码文案。字典只覆盖 switchOn 能配的六码 + 终态三码；缺键时 DSH 的
 * locale 会回退成键本身（"codeABORTED"），所以这里显式回退成原始码——用户看到码
 * 比看到内部键名好。宿主 notice.ts 另有一份中文标签，两边各管各的显示面。
 */
export function codeLabel(t, code) {
  var label = t('code' + code)
  return label === 'code' + code ? code : label
}


export function FailoverDrawer(props) {
  var t = props.t
  var ui = props.state.ui
  var rows = ui.drawerRows
  var panelRef = useRef(null)
  // 抽屉是自建的 body-portal 层。接入官方的 modal 层栈：Escape 先关它而不是
  // 关它下面的快捷控制中心，焦点也圈在抽屉里；z-index 抬到 Modal 之上，
  // 从控制中心里打开时才真的看得见。
  useModalLayer(panelRef, ui.drawerOpen, props.onClose)
  var body = []
  if (ui.drawerLoading) body.push(h('p', { key: 'loading', style: S.drawerHint }, t('failoverHistoryLoading')))
  else if (ui.drawerError) {
    body.push(h('p', { key: 'error', style: S.drawerHint }, t('failoverHistoryError')))
    body.push(h('button', { key: 'retry', type: 'button', style: S.manualBtn, onClick: props.onReload }, t('failoverHistoryRetry')))
  } else if (rows.length === 0) body.push(h('p', { key: 'empty', style: S.drawerHint }, t('failoverHistoryEmpty')))
  else {
    rows.forEach(function (row, rowIndex) {
      if (rowIndex > 0) body.push(h('div', { key: 'sep' + rowIndex, style: { height: 1, background: 'var(--dsw-alias-border-l2)', margin: '12px 0' } }))
      body.push(h('div', { key: 's' + rowIndex, style: S.drawerSession }, t('failoverSessionLabel') + ' ' + String(row.sessionId).slice(0, 8)))
      row.entries.forEach(function (entry, index) {
        body.push(h('div', { key: 'e' + rowIndex + '_' + index, style: S.drawerEntry },
          h('div', { style: S.drawerEntryTime }, new Date(entry.time).toLocaleString()),
          h('div', { style: S.drawerEntryText },
            fill(t('failoverEntryLine'), { from: entry.from, code: codeLabel(t, entry.code), to: entry.to }),
            h('span', { style: Object.assign({}, S.failoverTag, entry.settled ? null : { color: 'var(--dsw-alias-state-warn-primary)' }) },
              entry.settled ? t('failoverEntrySettled') : t('failoverEntryUnsettled')))))
      })
    })
  }
  return createPortal(
    h('div', {
      style: S.drawerOverlay,
      onClick: function (e) {
        if (e.target === e.currentTarget) props.onClose()
      },
    },
      h('div', { ref: panelRef, style: S.drawerPanel, role: 'dialog', 'aria-modal': true, 'aria-label': t('failoverHistoryDrawerTitle') },
        h('div', { style: S.drawerHeader },
          h('h3', { style: { fontSize: 15, fontWeight: 600, margin: 0 } }, t('failoverHistoryDrawerTitle')),
          h('button', { type: 'button', style: S.iconBtn, 'aria-label': t('close'), onClick: props.onClose }, h(Icon, { d: ICON_CLOSE }))),
        h('div', { style: S.drawerBody },
          h('p', { style: S.drawerHint }, t('failoverHistoryHint')),
          body))),
    document.body,
  )
}


export function Connector(props) {
  var t = props.t
  return h('div', { style: S.connector },
    h('div', { style: S.connectorLine }),
    h('span', { style: S.failoverTag },
      h(Icon, { d: ICON_ARROW_DOWN, size: 10 }),
      '顺延 #' + String(props.toIndex)),
    h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, '前序重试耗尽后自动切换至此候选'))
}


export function PipelineEditor(props) {
  var t = props.t
  var candidates = props.candidates
  var strategy = props.strategy === 'weight' || props.strategy === 'round-robin' ? props.strategy : 'order'
  var weightTotal = candidates.reduce(function (sum, c) { return sum + Math.max(0, c.weight || 0) }, 0)

  var dragSourceIndexState = useState(null)
  var dragSourceIndex = dragSourceIndexState[0]
  var setDragSourceIndex = dragSourceIndexState[1]

  var dragTargetIndexState = useState(null)
  var dragTargetIndex = dragTargetIndexState[0]
  var setDragTargetIndex = dragTargetIndexState[1]

  var handleDragStart = function (e, index) {
    setDragSourceIndex(index)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
    }
  }

  var handleDragOver = function (e, index) {
    var minIndex = props.isDefault ? 0 : 1
    if (index < minIndex) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (dragTargetIndex !== index) {
      setDragTargetIndex(index)
    }
  }

  var handleDrop = function (e, toIndex) {
    e.preventDefault()
    var minIndex = props.isDefault ? 0 : 1
    var from = dragSourceIndex
    setDragSourceIndex(null)
    setDragTargetIndex(null)
    if (from !== null && from !== toIndex && from >= minIndex && toIndex >= minIndex) {
      if (props.onReorder) {
        props.onReorder(from, toIndex)
      }
    }
  }

  var handleDragEnd = function () {
    setDragSourceIndex(null)
    setDragTargetIndex(null)
  }

  var nodes = []
  if (!props.isDefault && candidates.length > 0) {
    // 1. Primary Model Block
    nodes.push(h('div', { key: 'primary-wrapper', style: S.primaryCardContainer },
      h('div', { style: S.primaryCardHeader },
        h('span', { style: S.primaryCardTitle },
          h(Icon, { d: ICON_BOLT, size: 14 }),
          t('primaryTargetSection')),
        h('span', { style: S.primaryCardHint }, t('primaryTargetHint'))),
      h(CandidateNode, {
        key: 'primary-node',
        t: t,
        candidate: candidates[0],
        index: 0,
        total: candidates.length,
        isDefault: false,
        disabled: props.disabled,
        catalog: props.catalog,
        passive: props.passive,
        discover: props.discover,
        probe: props.probe,
        onJumpHealth: props.onJumpHealth,
        showWeight: strategy === 'weight',
        weightShare: strategy === 'weight' && weightTotal > 0 ? Math.round((Math.max(0, candidates[0].weight || 0) / weightTotal) * 100) : 0,
        isDragging: false,
        isDragTarget: false,
        onDragStart: handleDragStart,
        onDragOver: handleDragOver,
        onDrop: handleDrop,
        onDragEnd: handleDragEnd,
        onMaxAttempts: props.onMaxAttempts,
        onWeight: props.onWeight,
        onMove: props.onMove,
        onRemove: props.onRemove,
        onNeeds: props.onNeeds,
      })))

    // 2. Flow transition indicator
    nodes.push(h('div', { key: 'flow-indicator', style: S.flowConnector },
      h('div', { style: S.flowConnectorPill },
        h(Icon, { d: ICON_ARROW_DOWN, size: 12 }),
        t('flowIndicatorText'))))

    // 3. Fallback Section Header
    nodes.push(h('div', { key: 'fallback-header', style: S.fallbackSectionHeader },
      h('span', { style: S.fallbackSectionTitle },
        h(Icon, { d: ICON_ROUTE, size: 14 }),
        t('fallbackChainSection'),
        h('span', { style: S.countBadge }, String(Math.max(0, candidates.length - 1)))),
      h('span', { style: S.primaryCardHint }, t('fallbackChainHint'))))

    if (candidates.length <= 1) {
      nodes.push(h('div', { key: 'fallback-empty', style: S.fallbackEmptyCard },
        h(Icon, { d: ICON_ROUTE, size: 28, style: { opacity: 0.35, color: 'var(--dsh-router-accent, #4A65E8)' } }),
        h('h4', { style: S.fallbackEmptyTitle }, t('fallbackEmptyTitle')),
        h('p', { style: S.fallbackEmptyDesc }, t('fallbackEmptyDesc')),
        h('button', {
          type: 'button',
          className: 'dsh-router-catalog-btn',
          style: Object.assign({}, S.catalogBtn, { height: 32, padding: '0 14px', fontSize: 12.5, gap: 6 }),
          disabled: props.disabled,
          onClick: props.onOpenAddCandidate,
        }, h(Icon, { d: ICON_PLUS, size: 12 }), t('addCandidateBtn'))))
    } else {
      candidates.slice(1).forEach(function (candidate, offset) {
        var index = offset + 1
        if (offset > 0) {
          nodes.push(h(Connector, { key: 'c' + index, t: t, toIndex: offset + 1 }))
        }
        nodes.push(h(CandidateNode, {
          key: 'n' + index,
          t: t,
          candidate: candidate,
          index: index,
          total: candidates.length,
          isDefault: false,
          disabled: props.disabled,
          catalog: props.catalog,
          passive: props.passive,
          discover: props.discover,
          probe: props.probe,
          onJumpHealth: props.onJumpHealth,
          showWeight: strategy === 'weight',
          weightShare: strategy === 'weight' && weightTotal > 0 ? Math.round((Math.max(0, candidate.weight || 0) / weightTotal) * 100) : 0,
          isDragging: dragSourceIndex === index,
          isDragTarget: dragTargetIndex === index,
          onDragStart: handleDragStart,
          onDragOver: handleDragOver,
          onDrop: handleDrop,
          onDragEnd: handleDragEnd,
          onMaxAttempts: props.onMaxAttempts,
          onWeight: props.onWeight,
          onMove: props.onMove,
          onRemove: props.onRemove,
          onNeeds: props.onNeeds,
        }))
      })
    }
  } else {
    // Default pool mode: all candidates in one pool
    candidates.forEach(function (candidate, index) {
      if (index > 0) nodes.push(h(Connector, { key: 'c' + index, t: t, toIndex: index + 1 }))
      nodes.push(h(CandidateNode, {
        key: 'n' + index,
        t: t,
        candidate: candidate,
        index: index,
        total: candidates.length,
        isDefault: true,
        disabled: props.disabled,
        catalog: props.catalog,
        passive: props.passive,
        discover: props.discover,
        probe: props.probe,
        onJumpHealth: props.onJumpHealth,
        showWeight: strategy === 'weight',
        weightShare: strategy === 'weight' && weightTotal > 0 ? Math.round((Math.max(0, candidate.weight || 0) / weightTotal) * 100) : 0,
        isDragging: dragSourceIndex === index,
        isDragTarget: dragTargetIndex === index,
        onDragStart: handleDragStart,
        onDragOver: handleDragOver,
        onDrop: handleDrop,
        onDragEnd: handleDragEnd,
        onMaxAttempts: props.onMaxAttempts,
        onWeight: props.onWeight,
        onMove: props.onMove,
        onRemove: props.onRemove,
        onNeeds: props.onNeeds,
      }))
    })
  }

  if (props.onJumpPolicies) {
    nodes.push(h('div', { key: 'policy-summary', style: S.policySummaryCard },
      h('div', { style: S.policySummaryText },
        h(Icon, { d: ICON_SHIELD, size: 14, style: { color: 'var(--dsh-router-accent, #4A65E8)' } }),
        fill(t('policySummaryPrefix'), { n: props.maxTotalAttempts || 6 })),
      h('button', {
        type: 'button',
        className: 'dsh-router-policy-summary-btn',
        style: S.policySummaryBtn,
        onClick: props.onJumpPolicies,
      }, t('policySummaryBtn'))))
  }
  return h('div', null,
    h('div', { style: S.strategyRow },
      h('span', { style: S.formLabel }, t('strategyLabel')),
      h(SegmentedTabs, {
        items: STRATEGY_OPTIONS.map(function (entry) {
          return { value: entry, label: t('strategy' + entry), id: 'strategy-' + entry, panelId: 'strategy-panel-' + entry }
        }),
        value: strategy,
        onChange: function (value) { if (props.onStrategy) props.onStrategy(value) },
      }),
      h('span', { style: S.strategyHintTag }, t('strategyHint' + strategy))),
    // 三个策略共用同一个面板：id 跟着选中项走，aria-controls 才指向真实节点。
    h('div', {
      id: 'strategy-panel-' + strategy,
      role: 'tabpanel',
      'aria-labelledby': 'strategy-' + strategy,
    }, nodes))
}


export function SwitchOnGrid(props) {
  var t = props.t
  return h('div', null,
    h('div', { style: S.triggerGrid },
      SWITCH_ON_CODES.map(function (entry) {
        var on = Boolean(props.value[entry.key])
        return h('label', {
          key: entry.key,
          className: 'dsh-router-trigger-card',
          style: Object.assign({}, S.triggerCard, on ? S.triggerCardChecked : null),
        },
          h('input', {
            type: 'checkbox',
            style: S.triggerChk,
            checked: on,
            disabled: props.disabled,
            onChange: function () { props.onToggle(entry.key) },
          }),
          h('div', { style: { flex: 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: S.triggerName }, t(entry.labelKey + 'Name')),
              h('span', { style: S.triggerCode }, entry.code)),
            h('div', { style: S.triggerDesc }, t(entry.labelKey + 'Desc'))))
      })),
    h('div', { style: S.safetyBox },
      h(Icon, { d: ICON_WARN, size: 16 }),
      h('div', null,
        h('strong', null, t('safetyNoticeTitle')),
        ' ' + t('safetyNoticeText'))))
}


export function BudgetRow(props) {
  var t = props.t
  return h('div', { style: S.budgetGrid },
    h('div', { style: S.budgetItem },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('span', { style: S.budgetTitle }, t('maxTotalAttempts')),
        h('span', { style: S.budgetHint }, t('maxTotalAttemptsHint'))),
      h('div', { style: S.budgetInput },
        h('input', {
          style: S.budgetInputField,
          type: 'text',
          inputMode: 'numeric',
          maxLength: 2,
          'aria-label': t('maxTotalAttempts'),
          value: String(props.maxTotalAttempts),
          disabled: props.disabled,
          onChange: function (event) { props.onMaxTotal(event.target.value) },
        }),
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('timesUnit')))),
    props.stickyTurns === undefined ? null : h('div', { style: S.budgetItem },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('span', { style: S.budgetTitle }, t('stickyTurns')),
        h('span', { style: S.budgetHint }, t('stickyTurnsHint'))),
      h('div', { style: S.budgetInput },
        h('input', {
          style: S.budgetInputField,
          type: 'text',
          inputMode: 'numeric',
          maxLength: 2,
          'aria-label': t('stickyTurns'),
          value: String(props.stickyTurns),
          disabled: props.disabled,
          onChange: function (event) { props.onStickyTurns(event.target.value) },
        }),
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('turnsUnit')))),
    h('div', { style: S.budgetItem },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('span', { style: S.budgetTitle }, t('backoffTitle')),
        h('span', { style: S.budgetHint }, t('backoffHint'))),
      h(Tag, { tone: 'neutral' }, t('backoffBadge'))))
}
