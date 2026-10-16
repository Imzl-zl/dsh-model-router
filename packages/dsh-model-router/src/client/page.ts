/** The router workbench, served by the sidebar dialog (the plugin's only surface). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, healthToneBadge, healthToneStyle, routeOf, routeStatus } from './format.ts'
import { configuredRoutes } from '../routes.ts'
import { ChainView } from './chain.ts'
import { AddCandidateModal, HealthSettingsModal, NewProfileModal } from './modals.ts'
import { FailoverDrawer } from './pipeline.ts'
import { GlobalHealthWorkspace } from './workspace.ts'
import { Icon, ICON_BOLT, ICON_CHART, ICON_GLOBE, ICON_PLUS, ICON_SEARCH } from './icons.ts'
import { RiskConfirmation, SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'

/** Every physical route the config names, deduplicated: profiles and the default pool alike. */
function configuredRouteList(draft) {
  return configuredRoutes(draft.profiles ?? [], draft.default ?? { candidates: [] })
}

export function RouterPage(props) {
  var t = props.t
  var state = props.useRouterPage(function (snapshot) { return snapshot })
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

  // 面计数：插件页挂一次。卸载时释放，快捷键命令据此判断该不该接键
  // （见 apply.ts 的 `router: save command`）。
  useEffect(function () {
    props.retainSurface()
    return function () { props.releaseSurface() }
  }, [])

  // 保存快捷键走 DSH 原生的 shortcuts 服务（client/shortcuts，ui-settings-general
  // 同款）：可重绑定、出现在快捷键设置页、并按模态归属仲裁。这里不再自建 window
  // 监听——自建版在插件弹窗打开时也会触发保存，且用户改不了键位。
  // 注册见 apply.ts 的 `router: save command`。

  // The dialog's own top bar (footer.ts) carries the title, the enable switch,
  // save, discard and close. There used to be a second copy of all of that here
  // as a sticky header, for when this workbench was served as a page on DSH's
  // Plugins page — that carrier is gone, and with it the `margin: 0 -20px`
  // bleed and the 768px media query that only ever applied to it.

  // DSH's SettingsForm always renders a footer with its own save button. This
  // dialog anchors save/discard in its top bar, so the footer is suppressed —
  // and it has to be suppressed with `hidden`/`inert`, not only with
  // `display: none`: DSH's modal layer derives its Tab trap from
  // `button:not(:disabled)` minus `[inert], [hidden]`
  // (ui-primitives useModalLayer.ts:73-81), so a footer that is merely
  // display:none still counts as the dialog's LAST focusable element. Tab from
  // the real last control then misses the `atEdge` branch, DSH does not
  // preventDefault, and focus walks out of the dialog (measured: focus lands on
  // <body> for one Tab press). The structural seam is the same one the CSS
  // suppression already relies on: the footer is the sibling right after this
  // wrapper, so an upstream rename fails loudly here instead of silently
  // restoring a second save button.
  //
  // Note: Tab 圈禁根因与修法 —— 见
  // .agents/notes/implemented/2026-10-16-single-surface-dialog-and-tone-system.md
  var formBodyRef = useRef(null)
  useEffect(function () {
    var wrap = formBodyRef.current
    var footer = wrap ? wrap.nextElementSibling : null
    if (!footer) {
      throw new Error('router: the SettingsForm footer is no longer the sibling after .dsh-router-form-body — the suppression seam moved')
    }
    footer.setAttribute('hidden', '')
    footer.setAttribute('inert', '')
    return function () {
      footer.removeAttribute('hidden')
      footer.removeAttribute('inert')
    }
  }, [])

  return h('div', { className: 'dsh-router-page', style: S.modalRoot },
    // Top validation problems alert (if any)
    state.problems.length > 0 ? h('div', { style: S.problemsBox, role: 'alert' },
      h('strong', null, t('problemsTitle')),
      h('ul', { style: { margin: '4px 0 0', paddingLeft: 18 } },
        state.problems.map(function (problem, index) {
          return h('li', { key: index }, fill(t(problem.key), problem.vars))
        }))) : null,

    state.failed ? h('div', { style: S.problemsBox, role: 'alert' },
      h('strong', null, t('formSaveFailed'))) : null,

    // SettingsForm 的"卸载即 discard"是 DSH 给**设置页**的契约
    // （ui-primitives 的 settings-form/SettingsForm.tsx:54：离开页面就丢草稿）。
    // 侧栏弹窗与插件页共用同一个 controller，弹窗关掉 = 它这一侧卸载 = 会把另一面
    // 未保存的编辑静默丢掉。弹窗里这个回调换成 no-op：弹窗的"离开"由顶栏的放弃按钮
    // 显式表达，不该继承页面的隐式契约。底栏照旧被压掉（弹窗顶栏自己接了
    // 保存/放弃/失败徽标），压制方式见上面的 formBodyRef 副作用。
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
      onDiscard: function () {},
    },
      // One wrapper around everything the page contributes: the SettingsForm
      // footer is the element right after it, so the suppression rule needs no
      // DSH class name.
      h('div', { className: 'dsh-router-form-body', ref: formBodyRef },
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
                        style: draft.default.enabled ? Object.assign({}, S.navStatusActive, healthToneBadge('healthy')) : S.navStatusInactive,
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
                        ? h('span', { style: Object.assign({}, S.navStatusFaulted, healthToneBadge('unhealthy')) }, fill(t('navHealthUnhealthy'), { n: faultedCount }))
                        : degradedCount > 0
                          ? h('span', { style: Object.assign({}, S.navStatusDegraded, healthToneBadge('degraded')) }, fill(t('navHealthDegraded'), { n: degradedCount }))
                          : h('span', { style: Object.assign({}, S.navStatusActive, healthToneBadge('healthy')) }, t('navHealthAllHealthy'))),
                    h('div', { style: S.navItemSubText },
                       fill(t('navHealthCount'), { n: allPhysicalRoutes.length }) + ' · ' + t('navHealthFooterSub'))))))),

          // Right Workspace: Switch between GlobalHealthWorkspace and ChainView
          isHealthMode
            ? h('div', {
                // A flex column, not a plain block: this wrapper sits between the
                // workbench row and the view's own root, and a block box here
                // breaks the height chain — `flex: 1` on a child of a block has no
                // definite height to fill, so the column sizes to its content and
                // tall content grows the dialog body instead of scrolling inside
                // the workspace's own region (measured: at a 720px viewport the
                // dialog body scrolled while the workspace region sat idle).
                style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, alignSelf: 'stretch' },
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
                  checkSummary: state.ui.checkSummary,
                  probeSummary: state.ui.probeSummary,
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
                // Same containment as the health wrapper above: without it the
                // chain view's column is content-height and a long candidate
                // chain pushes the dialog body into scrolling.
                style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, alignSelf: 'stretch' },
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
                  probe: state.ui.probe,
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
      // The configured routes, so the per-route probe prompt editor can offer
      // them instead of asking the user to type provider/model by hand.
      routes: configuredRouteList(draft),
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
