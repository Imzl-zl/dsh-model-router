/**
 * The router workbench page: one page-level scroller, one 960px column.
 *
 * Layout contract, taken from DSH's own panel pages and adjusted for a form:
 * - the page itself is the scroller and owns the horizontal padding, the way
 *   `PluginManagerPage.module.css` `.page` does; every direct row is the same
 *   960px column, so the head, the view switch, the content and the save bar
 *   share one left edge by construction instead of by four copies of the same
 *   padding. A separately padded row cannot line up with the scroller it sits
 *   next to: the scrollbar takes 9px out of the scroller's client width only,
 *   which moves the centred column by half of it.
 * - the head and the view switch travel in one sticky wrapper and the save bar
 *   is sticky to the bottom, so both stay reachable while a long chain scrolls
 *   without becoming rows that own their own geometry;
 * - the save/discard pair lives in one footer bar that is ALWAYS present: a
 *   clean draft shows a disabled save plus "all changes saved", so the action
 *   has a stable place instead of appearing only after the first edit.
 *
 * Note: 布局契约与原生出处 —— 见 docs/design/ui-layout-redesign.md
 * Note: 为什么列宽必须单源、固定行不许自带 padding —— 见
 * .agents/notes/implemented/2026-10-20-page-owns-the-column.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { h } from './dom.ts'
import { Button, SegmentedTabs, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { fill, routeStatus } from './format.ts'
import { configuredRouteList, routeKeyOf } from '../routes.ts'
import { ChainView } from './chain.ts'
import { AddCandidateModal, HealthSettingsModal, WhatsNewModal } from './modals.ts'
import { RELEASE_NOTES, RELEASE_VERSION } from './release.generated.ts'
import { FailoverHistoryModal } from './pipeline.ts'
import { GlobalHealthWorkspace } from './workspace.ts'
import { Icon, ICON_SAVE, ICON_UNDO } from './icons.ts'

/** The two views the page has. */
const VIEW_CHAIN = 'chain'
const VIEW_HEALTH = 'health'

export function RouterPage(props) {
  var t = props.t
  var state = props.useRouterPage(function (snapshot) { return snapshot })
  var draft = state.draft
  var disabled = !state.writable || state.saving
  var view = state.ui.activeId === '__health__' ? VIEW_HEALTH : VIEW_CHAIN
  var modal = state.ui.modal

  var focusRouteState = useState(null)
  var focusRoute = focusRouteState[0]
  var setFocusRoute = focusRouteState[1]

  var handleJumpHealth = useCallback(function (routeKey) {
    // A fresh object per jump: the same route clicked twice re-arms the
    // scroll-and-highlight in the health workspace.
    setFocusRoute({ route: routeKey, at: Date.now() })
    props.onActive('__health__')
  }, [props.onActive])

  // Every physical route the health view can show: the configured fallbacks
  // plus anything already observed. The first hop is absent until observed —
  // it is whatever the user picked in DSH, which the plugin only learns when a
  // request arrives.
  var allPhysicalRoutes = useMemo(function () {
    var set = new Set()
    draft.chain.candidates.forEach(function (candidate) {
      if (candidate.provider && candidate.model) set.add(routeKeyOf(candidate.provider, candidate.model))
    })
    if (state.ui.passive) Object.keys(state.ui.passive).forEach(function (route) { set.add(route) })
    if (state.ui.discover) Object.keys(state.ui.discover).forEach(function (route) { set.add(route) })
    return Array.from(set)
  }, [draft.chain.candidates, state.ui.passive, state.ui.discover])

  // The save command's gate: this page is mounted while the workbench is.
  useEffect(function () {
    props.retainSurface()
    return function () { props.releaseSurface() }
  }, [])

  var viewTabs = [
    { value: VIEW_CHAIN, label: t('viewChainTab'), id: 'model-router-tab-chain', panelId: 'model-router-panel-chain' },
    { value: VIEW_HEALTH, label: t('viewHealthTab'), id: 'model-router-tab-health', panelId: 'model-router-panel-health' },
  ]

  var footer = state.available
    ? h('footer', { className: 'dsh-router-footer' },
        h('div', { className: 'dsh-router-footer-inner' },
        h('span', {
          className: 'dsh-router-footer-text',
          role: state.failed ? 'alert' : 'status',
        },
          state.failed ? t('formSaveFailed')
            : state.saving ? t('formSaving')
              : state.dirty ? t('dirtyBarText')
                : t('allSavedText')),
        h('div', { className: 'dsh-router-footer-actions' },
          h(Button, {
            variant: 'outline',
            icon: h(Icon, { d: ICON_UNDO, size: 12 }),
            disabled: !state.dirty || !state.writable || state.saving,
            onClick: props.onDiscard,
          }, t('formDiscard')),
          h(Button, {
            variant: 'primary',
            icon: h(Icon, { d: ICON_SAVE, size: 12 }),
            disabled: !state.dirty || !state.writable || state.saving || state.invalid,
            onClick: props.onSave,
          }, state.saving ? t('formSaving') : t('formSave')))))
    : null

  return h('div', { className: 'dsh-router-page' },
    h('div', { className: 'dsh-router-top' },
      h('header', { className: 'dsh-router-head' },
        h('div', { className: 'dsh-router-head-main' },
          h('h1', { className: 'dsh-router-title' }, t('pageTitle')),
          h('div', { className: 'dsh-router-status-row' },
            draft.enabled
              ? h(Tag, { tone: 'success' }, t('statusRunningBadge'))
              : h(Tag, { tone: 'outline' }, t('statusDisabledBadge')),
            state.dirty ? h(Tag, { tone: 'warning' }, t('unsavedChangesBadge')) : null,
            state.failed ? h(Tag, { tone: 'danger' }, t('formSaveFailed')) : null)),
        h('div', { className: 'dsh-router-head-actions' },
          h(Button, {
            variant: 'ghost',
            size: 'sm',
            title: fill(t('whatsNewButtonTitle'), { version: RELEASE_VERSION }),
            onClick: props.onOpenNotes,
          }, t('whatsNewButton')),
          h('span', { className: 'dsh-router-head-switch-label' }, t('takeoverSwitchLabel')),
          h(Switch, {
            checked: draft.enabled,
            label: t('takeoverSwitchLabel'),
            disabled,
            onChange: function (next) { props.onEnabled(next) },
          }))),
      state.available
        ? h('div', { className: 'dsh-router-tabs' },
            h(SegmentedTabs, {
              items: viewTabs,
              value: view,
              label: t('viewTabsLabel'),
              onChange: function (next) { props.onActive(next === VIEW_HEALTH ? '__health__' : '__chain__') },
            }))
        : null),
    h('div', { className: 'dsh-router-content' },
      state.problems.length > 0
        ? h('div', { className: 'dsh-router-notice dsh-router-notice-error', role: 'alert' },
            h('strong', null, t('problemsTitle')),
            h('ul', { className: 'dsh-router-problem-list' },
              state.problems.map(function (problem, index) {
                return h('li', { key: index }, fill(t(problem.key), problem.vars))
              })))
        : null,
      !state.available
        ? h('p', { className: 'dsh-router-notice', role: 'status' }, t('formUnavailable'))
        : !state.writable
          ? h('p', { className: 'dsh-router-notice', role: 'status' }, t('formReadOnly'))
          : null,
      state.available
        ? h('div', {
            id: view === VIEW_HEALTH ? 'model-router-panel-health' : 'model-router-panel-chain',
            role: 'tabpanel',
            'aria-labelledby': view === VIEW_HEALTH ? 'model-router-tab-health' : 'model-router-tab-chain',
            className: 'dsh-router-view',
          },
            view === VIEW_HEALTH
              ? h(GlobalHealthWorkspace, {
                  t: t,
                  draft: draft,
                  passive: state.ui.passive,
                  discover: state.ui.discover,
                  checking: state.ui.checking,
                  checkingRoutes: state.ui.checkingRoutes,
                  probe: state.ui.probe,
                  probing: state.ui.probing,
                  probingRoutes: state.ui.probingRoutes,
                  checkSummary: state.ui.checkSummary,
                  probeSummary: state.ui.probeSummary,
                  passiveError: state.ui.passiveError,
                  focusRoute: focusRoute,
                  disabled: disabled,
                  bucketSeconds: draft.health.timelineBucketSeconds,
                  onCheckAll: props.onCheckAll,
                  onProbeAll: props.onProbeAll,
                  onOpenHealthModal: props.onOpenHealthModal,
                  onOpenDrawer: props.onOpenDrawer,
                  onCheckRoute: props.onCheckRoute,
                  onProbeRoute: props.onProbeRoute,
                })
              : h(ChainView, {
                  t: t,
                  chain: draft.chain,
                  chains: draft.chains,
                  defaultChainId: draft.defaultChainId,
                  disabled: disabled,
                  catalog: state.ui.catalog,
                  passive: state.ui.passive,
                  discover: state.ui.discover,
                  probe: state.ui.probe,
                  onStrategy: props.onStrategy,
                  onFirstHopMaxRetries: props.onFirstHopMaxRetries,
                  onWeight: props.onWeight,
                  onMaxRetries: props.onMaxRetries,
                  onMove: props.onMove,
                  onReorder: props.onReorder,
                  onRemove: props.onRemove,
                  onStickyTurns: props.onStickyTurns,
                  onToggleSwitchOn: props.onToggleSwitchOn,
                  onNeeds: props.onNeeds,
                  onOpenAddCandidate: props.onOpenAddCandidate,
                  onJumpHealth: handleJumpHealth,
                  onSelectChain: props.onSelectChain,
                  onRenameChain: props.onRenameChain,
                  onSetDefaultChain: props.onSetDefaultChain,
                  onRemoveChain: props.onRemoveChain,
                  onCopyChain: props.onCopyChain,
                  onAddChain: props.onAddChain,
                }))
        : null),
    modal !== null && modal.kind === 'health' ? h(HealthSettingsModal, {
      t: t,
      health: draft.health,
      routes: configuredRouteList(draft),
      disabled: disabled,
      onClose: props.onCloseModal,
      onUpdateHealth: props.onUpdateHealth,
    }) : null,
    modal !== null && modal.kind === 'add-candidate' ? h(AddCandidateModal, {
      t: t,
      catalog: state.ui.catalog,
      onClose: props.onCloseModal,
      onAdd: function (entries) { props.onAddCandidates(entries) },
    }) : null,
    state.ui.drawerOpen ? h(FailoverHistoryModal, {
      key: 'history',
      t: t,
      state: state,
      onClose: props.onCloseDrawer,
      onReload: props.onOpenDrawer,
    }) : null,
    state.ui.notesOpen ? h(WhatsNewModal, {
      key: 'notes',
      t: t,
      version: RELEASE_VERSION,
      notes: RELEASE_NOTES,
      onClose: props.onCloseNotes,
    }) : null,
    footer)
}
