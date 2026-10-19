/** The router workbench, served by the sidebar dialog (the plugin's only surface). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { accentBadge, fill, healthToneBadge, healthToneStyle, routeStatus } from './format.ts'
import { configuredRouteList, routeKeyOf } from '../routes.ts'
import { ChainView } from './chain.ts'
import { AddCandidateModal, HealthSettingsModal } from './modals.ts'
import { FailoverDrawer } from './pipeline.ts'
import { GlobalHealthWorkspace } from './workspace.ts'
import { Icon, ICON_BOLT, ICON_CHART, ICON_PLUS } from './icons.ts'
import { RiskConfirmation, SettingsForm, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export function RouterPage(props) {
  var t = props.t
  var state = props.useRouterPage(function (snapshot) { return snapshot })
  var draft = state.draft
  var disabled = !state.writable || state.saving
  // 只有两个视图：降级链与渠道健康。旧版左侧是"默认池 + 每条规则一个 tab"，
  // 现在只有一条链，侧栏也就不再需要列表与搜索。
  var isHealthMode = state.ui.activeId === '__health__'
  var modal = state.ui.modal
  var routableProviders = state.ui.catalog?.routableProviders ?? []

  var focusRouteState = useState(null)
  var focusRoute = focusRouteState[0]
  var setFocusRoute = focusRouteState[1]

  var handleJumpHealth = useCallback(function (routeKey) {
    // A fresh object per jump: the same route clicked twice re-arms the
    // scroll-and-highlight in the health workspace.
    setFocusRoute({ route: routeKey, at: Date.now() })
    props.onActive('__health__')
  }, [props.onActive])

  // All unique physical routes across the chain and history
  var allPhysicalRoutes = useMemo(function () {
    var set = new Set()
    draft.chain.candidates.forEach(function (c) {
      if (c.provider && c.model) set.add(routeKeyOf(c.provider, c.model))
    })
    if (state.ui.passive) {
      Object.keys(state.ui.passive).forEach(function (r) { set.add(r) })
    }
    if (state.ui.discover) {
      Object.keys(state.ui.discover).forEach(function (r) { set.add(r) })
    }
    return Array.from(set)
  }, [draft.chain.candidates, state.ui.passive, state.ui.discover])

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

  // The dialog's own top bar (footer.ts) carries the title, the takeover switch,
  // save, discard and close.

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
  // Two conditions, two answers: a wrapper that is ABSENT means DSH rendered no
  // children — the namespace is not served yet (SettingsForm.tsx:55 returns the
  // unavailable line and nothing else), which is the loading frame a user can
  // open this dialog in, so there is nothing to suppress and nothing is wrong.
  // Only a wrapper that EXISTS with no footer sibling is the seam moving.
  //
  // Note: Tab 圈禁根因与修法 —— 见
  // .agents/notes/implemented/2026-10-16-single-surface-dialog-and-tone-system.md
  // Note: 为何"wrapper 不在"与"footer 兄弟不在"是两种回答 —— 见
  // .agents/notes/implemented/2026-10-17-mount-time-gates.md
  var formBodyRef = useRef(null)
  useEffect(function () {
    var wrap = formBodyRef.current
    if (!wrap) return
    var footer = wrap.nextElementSibling
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
              h('span', { style: S.sidebarSectionTitle }, t('navSystemSectionTitle'))),

            h('div', { className: 'dsh-router-master-list', style: S.masterList },
              // 1. 降级链
              h('div', {
                role: 'button',
                tabIndex: 0,
                className: 'dsh-router-nav-item' + (isHealthMode ? '' : ' active'),
                style: Object.assign({}, S.navItem, isHealthMode ? null : S.navItemActive),
                onClick: function () { props.onActive('__chain__') },
                onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onActive('__chain__') } },
              },
                h('div', { style: S.navItemLeft },
                  h('div', { style: Object.assign({}, S.navModelIconWrap, isHealthMode ? null : S.navModelIconActive) },
                    h(Icon, { d: ICON_BOLT, size: 13 })),
                  h('div', { style: S.navItemTextWrap },
                    h('div', { style: S.navItemTitleRow },
                      h('span', { style: S.navItemTitle }, t('chainNavTitle')),
                      draft.enabled
                        ? h('span', { style: Object.assign({}, S.navStatusActive, accentBadge()) }, '● ' + t('statusRunningBadge'))
                        : h('span', { style: S.navStatusInactive }, '○ ' + t('statusDisabledBadge'))),
                    h('div', { style: S.navItemSubText }, fill(t('candidateCountTag'), { n: draft.chain.candidates.length }))))),

              h('div', { style: S.navDivider }),

              // 2. 渠道健康
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

          // Right Workspace: chain editor or health monitor
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
                  bucketSeconds: draft.health.timelineBucketSeconds,
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
                id: 'panel-chain',
              },
                h(ChainView, {
                  t: t,
                  chain: draft.chain,
                  disabled: disabled,
                  enabled: draft.enabled,
                  onEnabled: props.onEnabled,
                  catalog: state.ui.catalog,
                  passive: state.ui.passive,
                  discover: state.ui.discover,
                  probe: state.ui.probe,
                  onStrategy: props.onStrategy,
                  onWeight: props.onWeight,
                  onMaxAttempts: props.onMaxAttempts,
                  onMove: props.onMove,
                  onReorder: props.onReorder,
                  onRemove: props.onRemove,
                  onMaxTotal: props.onMaxTotal,
                  onStickyTurns: props.onStickyTurns,
                  onToggleSwitchOn: props.onToggleSwitchOn,
                  onNeeds: props.onNeeds,
                  onOpenAddCandidate: props.onOpenAddCandidate,
                  onCheckAll: props.onCheckAll,
                  onOpenHealthModal: props.onOpenHealthModal,
                  onJumpHealth: handleJumpHealth,
                  // 保存条复用的是顶栏那一对动作，不新增状态源。
                  dirty: state.dirty,
                  saving: state.saving,
                  writable: state.writable,
                  invalid: state.invalid,
                  onSave: props.onSave,
                  onDiscard: props.onDiscard,
                }))))),

    modal !== null && modal.kind === 'health' ? h(HealthSettingsModal, {
      t: t,
      health: draft.health,
      // The configured routes, so the per-route probe prompt editor can offer
      // them instead of asking the user to type provider/model by hand.
      routes: configuredRouteList(draft),
      // 保存中/只读时弹窗内的控件一并禁用——不传这个 prop，熔断作用域的
      // SegmentedControl 在保存期间仍然可点，与其余控件不一致。
      disabled: disabled,
      onClose: props.onCloseModal,
      onUpdateHealth: props.onUpdateHealth,
    }) : null,
    modal !== null && modal.kind === 'add-candidate' ? h(AddCandidateModal, {
      t: t,
      catalog: state.ui.catalog,
      routableProviders: routableProviders,
      onClose: props.onCloseModal,
      onAdd: function (entries) { props.onAddCandidates(entries) },
    }) : null,
    state.ui.drawerOpen ? h(FailoverDrawer, {
      key: 'drawer',
      t: t,
      state: state,
      onClose: props.onCloseDrawer,
      onReload: props.onOpenDrawer,
    }) : null)
}
