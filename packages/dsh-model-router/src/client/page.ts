/** The whole config page (master-detail workbench) served on DSH's Plugins page. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, healthToneStyle, routeStatus } from './format.ts'
import { ChainView } from './chain.ts'
import { AddCandidateModal, HealthSettingsModal, NewProfileModal } from './modals.ts'
import { FailoverDrawer } from './pipeline.ts'
import { GlobalHealthWorkspace } from './workspace.ts'
import { Icon, ModelRouterIcon, ICON_BOLT, ICON_CHART, ICON_CHECK, ICON_GLOBE, ICON_PLUS, ICON_SAVE, ICON_SEARCH, ICON_SPINNER, ICON_UNDO } from './icons.ts'
import { RiskConfirmation, SettingsForm, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export function RouterPage(props) {
  var t = props.t
  var state = props.useRouterPage(function (snapshot) { return snapshot })
  if (props.view === 'summary') return t('pluginDesc')
  var draft = state.draft
  var disabled = !state.writable || state.saving
  var isHealthMode = state.ui.activeId === '__health__'
  var isDefaultMode = state.ui.activeId === '__default__'
  var activeProfile = null
  if (!isHealthMode && !isDefaultMode) {
    activeProfile = draft.profiles.find(function (profile) { return profile.id === state.ui.activeId }) ?? (draft.profiles.length > 0 ? draft.profiles[0] : null)
  }
  var modal = state.ui.modal
  var routableProviders = state.ui.catalog?.routableProviders ?? []
  var isModalView = Boolean(props.isModalView)

  var searchQueryState = useState('')
  var searchQuery = searchQueryState[0]
  var setSearchQuery = searchQueryState[1]

  var focusRouteState = useState(null)
  var focusRoute = focusRouteState[0]
  var setFocusRoute = focusRouteState[1]

  var handleJumpHealth = useCallback(function (routeKey) {
    // A fresh object per jump: the same route clicked twice re-arms the
    // scroll-and-highlight in the health workspace.
    setFocusRoute({ route: routeKey, at: Date.now() })
    props.onActive('__health__')
  }, [props.onActive])

  var filteredProfiles = draft.profiles.filter(function (profile) {
    if (!searchQuery.trim()) return true
    var q = searchQuery.toLowerCase().trim()
    return (profile.when.model && profile.when.model.toLowerCase().indexOf(q) !== -1)
      || (profile.when.provider && profile.when.provider.toLowerCase().indexOf(q) !== -1)
  })

  // All unique physical routes across profiles, default pool, and history
  var allPhysicalRoutes = useMemo(function () {
    var set = new Set()
    draft.profiles.forEach(function (p) {
      (p.candidates || []).forEach(function (c) {
        if (c.provider && c.model) set.add(c.provider + '/' + c.model)
      })
    })
    if (draft.default && draft.default.candidates) {
      draft.default.candidates.forEach(function (c) {
        if (c.provider && c.model) set.add(c.provider + '/' + c.model)
      })
    }
    if (state.ui.passive) {
      Object.keys(state.ui.passive).forEach(function (r) { set.add(r) })
    }
    if (state.ui.discover) {
      Object.keys(state.ui.discover).forEach(function (r) { set.add(r) })
    }
    return Array.from(set)
  }, [draft, state.ui.passive, state.ui.discover])

  var faultedCount = 0
  var degradedCount = 0
  allPhysicalRoutes.forEach(function (route) {
    var st = routeStatus(state.ui.passive, state.ui.discover, state.ui.probe, route)
    if (st === 'unhealthy') faultedCount++
    else if (st === 'degraded') degradedCount++
  })

  // Shortcut: Ctrl+S / Cmd+S save
  useEffect(function () {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (state.dirty && state.writable && !state.saving && !state.invalid) {
          props.onSave()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return function () { window.removeEventListener('keydown', onKeyDown) }
  }, [state.dirty, state.writable, state.saving, state.invalid, props.onSave])

  return h('div', { className: 'dsh-router-page', style: isModalView ? S.pageModal : S.page },
    // Enhanced Sticky Action Header (Decoupled: Only configuration lifecycle actions)
    !isModalView ? h('header', { style: S.stickyHeader },
      h('div', { style: S.headerLeft },
        h(ModelRouterIcon, { size: 30, color: 'var(--dsw-alias-brand-primary, #4A65E8)' }),
        h('div', { style: S.headerTitles },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('h1', { style: S.titleRow }, t('pluginTitle')),
            h('span', { style: draft.enabled ? S.badgeRunning : S.badgePaused },
              draft.enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
            state.dirty ? h('span', { style: S.badgeDirty }, '● ' + t('unsavedChangesBadge')) : null),
          h('p', { style: S.desc }, t('pluginDesc')))),
      h('div', { style: S.headerActions },
        h('div', { style: S.switchWrap },
          h('span', { style: S.switchLabel }, t('globalSwitchLabel')),
          h(Switch, {
            checked: draft.enabled,
            label: t('globalSwitchLabel'),
            disabled: disabled,
            title: t('globalSwitchDesc'),
            onChange: function (next) { props.onEnabled(next) },
          })),
        state.dirty ? h('button', {
          type: 'button',
          className: 'dsh-router-discard-btn',
          style: S.discardBtnHeader,
          disabled: disabled,
          onClick: props.onDiscard,
        }, h(Icon, { d: ICON_UNDO, size: 13 }), t('formDiscard')) : null,
        h('button', {
          type: 'button',
          className: 'dsh-router-save-btn',
          style: Object.assign({}, S.saveBtn,
            (state.dirty && state.writable && !state.saving && !state.invalid ? S.saveBtnHighlight : S.saveBtnDisabled)),
          disabled: !state.dirty || disabled || state.invalid,
          title: state.dirty ? t('saveShortcutHint') : t('savedStateTip'),
          onClick: props.onSave,
        },
          state.saving ? h(Icon, { d: ICON_SPINNER, size: 14, spin: true }) : (state.dirty ? h(Icon, { d: ICON_SAVE, size: 14 }) : h(Icon, { d: ICON_CHECK, size: 14 })),
          state.saving ? t('formSaving') : t('formSave'),
          state.dirty ? h('kbd', { style: S.kbdTag }, t('saveShortcutKey')) : null))) : null,

    // Top validation problems alert (if any)
    state.problems.length > 0 ? h('div', { style: S.problemsBox, role: 'alert' },
      h('strong', null, t('problemsTitle')),
      h('ul', { style: { margin: '4px 0 0', paddingLeft: 18 } },
        state.problems.map(function (problem, index) {
          return h('li', { key: index }, fill(t(problem.key), problem.vars))
        }))) : null,

    state.failed ? h('div', { style: S.problemsBox, role: 'alert' },
      h('strong', null, t('formSaveFailed'))) : null,

    // SettingsForm container (preserves lifecycle and bottom save contract).
    // Its own footer is suppressed by structure below — see .dsh-router-form-body.
    h(SettingsForm, {
      labels: {
        unavailable: t('formUnavailable'),
        readOnly: t('formReadOnly'),
        saveFailed: t('formSaveFailed'),
        save: t('formSave'),
        saving: t('formSaving'),
      },
      state: {
        available: state.available,
        writable: state.writable,
        dirty: state.dirty,
        invalid: state.invalid,
        saving: state.saving,
        failed: state.failed,
      },
      onSave: props.onSave,
      onDiscard: props.onDiscard,
    },
      // One wrapper around everything the page contributes: the SettingsForm
      // footer is the element right after it, so the suppression rule needs no
      // DSH class name.
      h('div', { className: 'dsh-router-form-body' },
        h('div', { className: 'dsh-router-workbench', style: S.workbench },
          h('aside', { className: 'dsh-router-master-sidebar', style: S.masterSidebar },
            h('div', { style: S.sidebarHeader },
              h('div', { style: S.searchBox },
                h(Icon, { d: ICON_SEARCH, size: 13, style: S.searchIcon }),
                h('input', {
                  type: 'text',
                  placeholder: t('searchProfilePlaceholder'),
                  'aria-label': t('searchProfilePlaceholder'),
                  value: searchQuery,
                  onChange: function (e) { setSearchQuery(e.target.value) },
                  style: S.searchInput,
                })),
              h('button', {
                type: 'button',
                className: 'dsh-router-add-profile-btn',
                style: S.sidebarAddBtn,
                disabled: disabled,
                title: t('addProfile'),
                onClick: function () { props.onOpenNewProfile() },
              }, h(Icon, { d: ICON_PLUS, size: 12 }))),

            h('div', { className: 'dsh-router-master-list', style: S.masterList },
              // 1. Global Default Fallback Pool (Pinned at top)
              h('div', {
                role: 'button',
                tabIndex: 0,
                className: 'dsh-router-nav-item' + (!isHealthMode && activeProfile === null ? ' active' : ''),
                style: Object.assign({}, S.navItem, S.navItemDefault, (!isHealthMode && activeProfile === null) ? S.navItemActive : null),
                onClick: function () { props.onActive('__default__') },
                onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onActive('__default__') } },
              },
                h('div', { style: S.navItemLeft },
                  h('div', { style: S.navDefaultIconWrap },
                    h(Icon, { d: ICON_GLOBE, size: 14 })),
                  h('div', { style: S.navItemTextWrap },
                    h('div', { style: S.navItemTitleRow },
                      h('span', { style: S.navItemTitle }, t('defaultProfileTab')),
                      h('span', {
                        style: draft.default.enabled ? S.navStatusActive : S.navStatusInactive,
                      }, draft.default.enabled ? t('defaultPoolActiveBadge') : t('defaultPoolInactiveBadge'))),
                    h('div', { style: S.navItemSubText },
                      draft.default.enabled ? fill(t('candidateCountTag'), { n: draft.default.candidates.length }) : t('defaultProfileNotActive'))))),

              h('div', { style: S.navDivider }),

              // 2. Profiles Section
              h('div', { style: S.navSectionHeader },
                h('span', { style: S.navSectionTitle }, t('profilesTitle')),
                h('span', { style: S.countBadge }, String(filteredProfiles.length))),

              filteredProfiles.length === 0
                ? h('div', { style: S.navEmptyHint }, searchQuery ? t('noMatchingProfiles') : t('noProfilesConfigured'))
                : filteredProfiles.map(function (profile) {
                    var isActive = !isHealthMode && activeProfile !== null && activeProfile.id === profile.id
                    var hasImages = profile.candidates.some(function (c) { return c.needs && c.needs.images !== undefined })
                    var worstCandStatus = 'unknown'
                    profile.candidates.forEach(function (c) {
                      var st = routeStatus(state.ui.passive, state.ui.discover, state.ui.probe, c.provider + '/' + c.model)
                      if (st === 'unhealthy') worstCandStatus = 'unhealthy'
                      else if (st === 'degraded' && worstCandStatus !== 'unhealthy') worstCandStatus = 'degraded'
                      else if (st === 'healthy' && worstCandStatus === 'unknown') worstCandStatus = 'healthy'
                    })
                    return h('div', {
                      key: profile.id,
                      role: 'button',
                      tabIndex: 0,
                      className: 'dsh-router-nav-item' + (isActive ? ' active' : ''),
                      style: Object.assign({}, S.navItem, isActive ? S.navItemActive : null),
                      onClick: function () { props.onActive(profile.id) },
                      onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onActive(profile.id) } },
                    },
                      h('div', { style: S.navItemLeft },
                        h('div', { style: Object.assign({}, S.navModelIconWrap, isActive ? S.navModelIconActive : null) },
                          h(Icon, { d: ICON_BOLT, size: 13 })),
                        h('div', { style: S.navItemTextWrap },
                          h('div', { style: S.navItemTitleRow },
                            h('span', { style: S.navItemTitle, title: profile.when.model }, profile.when.model),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                              worstCandStatus !== 'unknown'
                                ? h('span', {
                                    style: Object.assign({}, S.navMicroDot, healthToneStyle(worstCandStatus)),
                                    title: t('healthStatus' + worstCandStatus[0].toUpperCase() + worstCandStatus.slice(1)),
                                  })
                                : null,
                              h('span', { style: S.navCandidateBadge }, fill(t('candidateCountTag'), { n: profile.candidates.length })))),
                          h('div', { style: S.navItemTagsRow },
                            h('span', { style: S.navProviderTag }, profile.when.provider),
                            hasImages ? h('span', { style: S.navImageTag, title: t('needImagesTitle') }, '🖼️') : null))))
                  })),

            // 3. Global Channel Health Navigation Entry (Fixed at sidebar bottom)
            h('div', { className: 'dsh-router-sidebar-footer', style: S.sidebarFooter },
              h('div', { style: S.navFooterHeader },
                h('span', { style: S.navSectionTitle }, t('navSystemSectionTitle'))),
              h('div', {
                role: 'button',
                tabIndex: 0,
                className: 'dsh-router-nav-item' + (isHealthMode ? ' active' : ''),
                style: Object.assign({}, S.navItem, S.navItemHealthFooter, isHealthMode ? S.navItemActive : null),
                onClick: function () { setFocusRoute(null); props.onActive('__health__') },
                onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusRoute(null); props.onActive('__health__') } },
              },
                h('div', { style: S.navItemLeft },
                  h('div', { style: Object.assign({}, S.navHealthIconWrap, isHealthMode ? S.navModelIconActive : null) },
                    h(Icon, { d: ICON_CHART, size: 14 })),
                  h('div', { style: S.navItemTextWrap },
                    h('div', { style: S.navItemTitleRow },
                      h('span', { style: S.navItemTitle }, t('navHealthTitle')),
                      faultedCount > 0
                        ? h('span', { style: S.navStatusFaulted }, fill(t('navHealthUnhealthy'), { n: faultedCount }))
                        : degradedCount > 0
                          ? h('span', { style: S.navStatusDegraded }, fill(t('navHealthDegraded'), { n: degradedCount }))
                          : h('span', { style: S.navStatusActive }, t('navHealthAllHealthy'))),
                    h('div', { style: S.navItemSubText },
                       fill(t('navHealthCount'), { n: allPhysicalRoutes.length }) + ' · ' + t('navHealthFooterSub'))))))),

          // Right Workspace: Switch between GlobalHealthWorkspace and ChainView
          isHealthMode
            ? h('div', {
                style: { flex: 1, minWidth: 0 },
                id: 'panel-global-health',
              },
                h(GlobalHealthWorkspace, {
                  t: t,
                  draft: draft,
                  passive: state.ui.passive,
                  discover: state.ui.discover,
                  checking: state.ui.checking,
                  checkingRoutes: state.ui.checkingRoutes,
                  probe: state.ui.probe,
                  probing: state.ui.probing,
                  probingRoutes: state.ui.probingRoutes,
                  focusRoute: focusRoute,
                  disabled: disabled,
                  onCheckAll: props.onCheckAll,
                  onProbeAll: props.onProbeAll,
                  onOpenHealthModal: props.onOpenHealthModal,
                  onOpenDrawer: props.onOpenDrawer,
                  onCheckRoute: props.onCheckRoute,
                  onProbeRoute: props.onProbeRoute,
                }))
            : h('div', {
                style: { flex: 1, minWidth: 0 },
                id: activeProfile === null ? 'panel-default' : 'panel-' + activeProfile.id,
              },
                h(ChainView, Object.assign({
                  key: activeProfile === null ? 'default' : activeProfile.id,
                  t: t,
                  chain: activeProfile === null ? draft.default : activeProfile,
                  isDefault: activeProfile === null,
                  disabled: disabled,
                  catalog: state.ui.catalog,
                  passive: state.ui.passive,
                  discover: state.ui.discover,
                  onStrategy: props.onStrategy,
                  onWeight: props.onWeight,
                  onMaxAttempts: props.onMaxAttempts,
                  onMove: props.onMove,
                  onRemove: props.onRemove,
                  onMaxTotal: props.onMaxTotal,
                  onStickyTurns: props.onStickyTurns,
                  onToggleSwitchOn: props.onToggleSwitchOn,
                  onNeeds: props.onNeeds,
                  onOpenAddCandidate: props.onOpenAddCandidate,
                  onCheckAll: props.onCheckAll,
                  onOpenHealthModal: props.onOpenHealthModal,
                  onDefaultEnabled: props.onDefaultEnabled,
                  onDeleteProfile: props.onDeleteProfile,
                  onJumpHealth: handleJumpHealth,
                })))))),

    modal !== null && modal.kind === 'health' ? h(HealthSettingsModal, {
      t: t,
      health: draft.health,
      onClose: props.onCloseModal,
      onUpdateHealth: props.onUpdateHealth,
    }) : null,
    modal !== null && modal.kind === 'new-profile' ? h(NewProfileModal, {
      t: t,
      catalog: state.ui.catalog,
      catalogLoading: state.ui.catalogLoading,
      profiles: draft.profiles,
      configured: draft.profiles.map(function (profile) { return profile.when.provider + '/' + profile.when.model }),
      onClose: props.onCloseModal,
      onCreate: props.onCreateProfile,
    }) : null,
    modal !== null && modal.kind === 'add-candidate' ? h(AddCandidateModal, {
      t: t,
      catalog: state.ui.catalog,
      routableProviders: routableProviders,
      onClose: props.onCloseModal,
      onAdd: function (entries) { props.onAddCandidates(modal.profileId, entries, modal.isDefault) },
    }) : null,
    modal !== null && modal.kind === 'delete' ? h(RiskConfirmation, {
      open: true,
      title: t('riskConfirmTitle'),
      description: t('riskConfirmDesc'),
      acknowledgeLabel: t('riskConfirmCheckbox'),
      cancelLabel: t('cancel'),
      closeLabel: t('close'),
      confirmLabel: t('confirmDeleteBtn'),
      acknowledged: state.ui.riskAck,
      onAcknowledgedChange: props.onRiskAck,
      onCancel: props.onCloseModal,
      onConfirm: function () { props.onConfirmDelete(modal.profileId) },
    }) : null,
    state.ui.drawerOpen ? h(FailoverDrawer, {
      key: 'drawer',
      t: t,
      state: state,
      onClose: props.onCloseDrawer,
      onReload: props.onOpenDrawer,
    }) : null)
}
