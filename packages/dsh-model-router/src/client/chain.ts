/** One chain's view: pipeline and policies sub-tabs, shared by profiles and the default pool. */

import { useEffect, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { accentBadge, fill } from './format.ts'
import { Icon, ICON_CLOSE, ICON_GLOBE, ICON_PLUS, ICON_ROUTE, ICON_SAVE, ICON_SHIELD, ICON_UNDO, ICON_WARN } from './icons.ts'
import { BudgetRow, PipelineEditor, SwitchOnGrid } from './pipeline.ts'
import { SegmentedTabs, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export function ChainView(props) {
  var t = props.t
  var chain = props.chain
  var isDefault = props.isDefault
  var chainId = isDefault ? null : chain.id
  var subTabState = useState('pipeline')
  var subTab = subTabState[0] === 'policies' ? 'policies' : 'pipeline'
  var setSubTab = subTabState[1]

  var guideOpenState = useState(false)
  var guideOpen = guideOpenState[0]
  var setGuideOpen = guideOpenState[1]

  // 识图路由的可见信号：整条能力此前只靠节点上的按钮文本和侧栏 emoji 表达，
  // 配完回来也看不出这条链有识图路由。页头徽标点一下直接展开第一个配了图片
  // 条件的节点 —— 见 docs/design/ui-review.md P0-2。
  // Note: 为何是徽标 + 精准展开，而不是把识图提升成一级页签 —— 见
  // .agents/notes/implemented/2026-10-18-surface-what-users-look-for-first.md
  // 用序号而不是布尔：点第二次要能重新打开（已经展开时再用同一个值不会触发）。
  var firstImageIndex = -1
  ;(chain.candidates || []).forEach(function (candidate, index) {
    if (firstImageIndex === -1 && candidate.needs && candidate.needs.images !== undefined) firstImageIndex = index
  })
  var imageFocusState = useState(-1)
  var imageFocus = imageFocusState[0]
  var setImageFocus = imageFocusState[1]
  // 切到另一条链时清掉上一次的聚焦，否则同序号会在新链上误展开一个节点。
  useEffect(function () { setImageFocus(-1) }, [chainId])

  // 面板 id 的作用域：profile 按 id 区分，默认池全局唯一。
  var tabId = function (name) { return isDefault ? 'default-subtab-' + name : 'subtab-' + name + '-' + chainId }
  var panelId = function (name) { return isDefault ? 'default-subpanel-' + name : 'subpanel-' + name + '-' + chainId }
  var subTabIcon = function (name) {
    if (name === 'pipeline') return ICON_ROUTE
    return ICON_SHIELD
  }
  var subTabs = ['pipeline', 'policies'].map(function (name) {
    return {
      value: name,
      label: h('span', { style: S.subTabLabel },
        h(Icon, { d: subTabIcon(name), size: 12 }),
        t('subTab' + name[0].toUpperCase() + name.slice(1))),
      id: tabId(name),
      panelId: panelId(name),
    }
  })

  // ---- 页头 ----
  // 只留「哪条链 + 几条备用 + 识图路由」这行硬事实；描述句说的事在节点区的
  // primaryTargetHint 与 introBox 里已经说过一遍 —— 见 ui-review.md P2-2。
  var imageBadge = firstImageIndex === -1 ? null : h('button', {
    type: 'button',
    className: 'dsh-router-image-route-badge',
    style: Object.assign({}, S.imageRouteBadge, accentBadge(), imageFocus === firstImageIndex ? S.imageRouteBadgeActive : null),
    title: t('imageRouteBadgeHint'),
    'aria-pressed': imageFocus === firstImageIndex,
    onClick: function () {
      setSubTab('pipeline')
      setImageFocus(imageFocus === firstImageIndex ? -1 : firstImageIndex)
    },
  }, '🖼️ ' + t('imageRouteBadge'))

  var headerCard = h('section', { style: S.workspaceHeaderCard },
    h('div', { style: S.workspaceHeaderLeft },
      isDefault
        ? h('div', { style: S.workspaceAvatar }, h(Icon, { d: ICON_GLOBE, size: 18 }))
        : h('div', { style: S.workspaceAvatar }, (chain.when?.model || 'M').slice(0, 2).toUpperCase()),
      h('div', { style: S.workspaceTitles },
        h('div', { style: S.workspaceTitleRow },
          h('h2', { style: S.workspaceModelName }, isDefault ? t('defaultProfileTab') : chain.when.model),
          isDefault
            ? h('span', {
                style: chain.enabled ? Object.assign({}, S.workspaceStatePill, accentBadge()) : S.navStatusInactive,
              }, chain.enabled ? '● ' + t('defaultPoolActiveBadge') : '○ ' + t('defaultPoolInactiveBadge'))
            : h('span', { style: Object.assign({}, S.workspaceStatePill, accentBadge()) }, '● ' + t('activeBadge')),
          !isDefault && chain.when?.provider ? h('span', { style: S.providerBadge }, chain.when.provider) : null,
          h('span', { style: S.countBadge }, fill(t('candidateCountTag'), { n: isDefault ? chain.candidates.length : Math.max(0, chain.candidates.length - 1) })),
          imageBadge))),
    // 删除不放在页头右端：那是主操作位。它现在在 policies 页签底部 —— 见 P1-2。
    isDefault
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
          h('span', { style: { fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, t('defaultProfileSwitchLabel')),
          h(Switch, {
            checked: chain.enabled,
            label: t('defaultProfileSwitchLabel'),
            disabled: props.disabled,
            onChange: function (next) { props.onDefaultEnabled(next) },
          }))
      : null)

  var introBox = isDefault && !chain.enabled
    ? h('div', { style: S.introBox },
        h(Icon, { d: ICON_WARN, size: 20 }),
        h('div', null,
          h('h3', { style: S.introTitle }, t('defaultProfileIntroTitle')),
          h('p', { style: S.introDesc }, t('defaultProfileIntroDesc'))))
    : null

  // ---- 候选链页签 ----
  var addBar = h('div', { style: S.addBar },
    h('button', {
      type: 'button',
      className: 'dsh-router-catalog-btn',
      style: S.catalogBtnLg,
      disabled: props.disabled,
      onClick: function () { props.onOpenAddCandidate(chainId, isDefault) },
    }, h(Icon, { d: ICON_PLUS, size: 13 }), t('addCandidateBtn')))

  var visionGuide = isDefault
    ? null
    : h('div', { style: S.guideBox },
        h('div', { style: S.guideHeader },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Icon, { d: ICON_WARN, size: 16 }),
            h('strong', null, t('visionWorkflowTitle'))),
          h('button', {
            type: 'button',
            className: 'dsh-router-guide-toggle',
            style: S.guideToggleBtn,
            'aria-expanded': guideOpen,
            onClick: function () { setGuideOpen(!guideOpen) },
          }, guideOpen ? t('visionGuideCollapse') : t('visionGuideExpand'))),
        guideOpen ? h('p', { style: S.guideContent }, t('visionWorkflowText')) : null)

  var pipelinePanel = h('section', {
    id: panelId('pipeline'),
    role: 'tabpanel',
    'aria-labelledby': tabId('pipeline'),
    style: S.card,
  },
    isDefault
      ? h('div', { style: S.sectionHeader },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('h3', { style: Object.assign({}, S.sectionTitle, { fontSize: 13.5 }) }, t('defaultPoolTitle')),
            h('p', { style: S.sectionSubtitle }, t('defaultPoolSubtitle'))))
      : null,
    h(PipelineEditor, {
      t: t,
      candidates: chain.candidates,
      strategy: chain.strategy,
      isDefault: isDefault,
      disabled: props.disabled,
      catalog: props.catalog,
      passive: props.passive,
      discover: props.discover,
      probe: props.probe,
      onStrategy: function (val) { props.onStrategy(chainId, val, isDefault) },
      onJumpHealth: props.onJumpHealth,
      onMaxAttempts: function (index, value) { props.onMaxAttempts(chainId, index, value, isDefault) },
      onMove: function (index, direction) { props.onMove(chainId, index, direction, isDefault) },
      onReorder: function (fromIndex, toIndex) { props.onReorder(chainId, fromIndex, toIndex, isDefault) },
      onRemove: function (index) { props.onRemove(chainId, index, isDefault) },
      onNeeds: function (index, patch) { props.onNeeds(chainId, index, patch, isDefault) },
      onWeight: function (index, value) { props.onWeight(chainId, index, value, isDefault) },
      onOpenAddCandidate: function () { props.onOpenAddCandidate(chainId, isDefault) },
      onJumpPolicies: function () { setSubTab('policies') },
      maxTotalAttempts: chain.maxTotalAttempts,
      // 识图粘滞在节点的高级条件面板里（imagesMode 为「仅带图」时才出现），
      // 不在这里渲染 —— 见 docs/design/ui-review.md P0-1。
      stickyTurns: chain.stickyTurns,
      onStickyTurns: function (value) { props.onStickyTurns(chainId, value, isDefault) },
      imageFocus: imageFocus,
    }),
    visionGuide,
    addBar)

  // ---- 策略页签 ----
  // 删除落在策略页底部：它属于配置生命周期动作，与「切换条件/预算」一样
  // 是一次会话里很少碰的东西，放在这里比摆在页头主操作位更合比例。
  // 二次确认仍由 RiskConfirmation 承担 —— 见 P1-2。
  var dangerZone = isDefault ? null : h('div', { style: S.dangerZone },
    h('div', null,
      h('div', { style: S.dangerZoneTitle }, t('dangerZoneTitle')),
      h('div', { style: S.dangerZoneHint }, t('dangerZoneHint'))),
    h('button', {
      type: 'button',
      className: 'dsh-router-danger-btn',
      style: S.dangerBtn,
      disabled: props.disabled,
      onClick: function () { props.onDeleteProfile(chainId) },
    }, h(Icon, { d: ICON_CLOSE, size: 12 }), t('deleteProfileBtn')))

  var policiesPanel = h('div', {
    id: panelId('policies'),
    role: 'tabpanel',
    'aria-labelledby': tabId('policies'),
  },
    h('section', { style: S.card },
      h('div', { style: S.sectionHeader },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('h2', { style: S.sectionTitle }, t('switchOnTitle')),
          h('p', { style: S.sectionSubtitle }, t('switchOnSubtitle')))),
      h(SwitchOnGrid, {
        t: t,
        value: chain.switchOn,
        disabled: props.disabled,
        onToggle: function (key) { props.onToggleSwitchOn(chainId, key, isDefault) },
      })),
    h('section', { style: S.card },
      h('div', { style: S.sectionHeader },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('h2', { style: S.sectionTitle }, t('budgetTitle')),
          h('p', { style: S.sectionSubtitle }, t('budgetSubtitle')))),
      h(BudgetRow, {
        t: t,
        maxTotalAttempts: chain.maxTotalAttempts,
        disabled: props.disabled,
        onMaxTotal: function (value) { props.onMaxTotal(chainId, value, isDefault) },
      })),
    dangerZone)

  // ---- 工作区主体 ----
  // One wrapper around everything the page contributes below the subnav. It
  // is the workspace's scrolling region, so the rule editor's height never
  // pushes the dialog's body into scrolling — the same containment the health
  // workspace gets from S.workspaceScroll.
  var body = !isDefault || chain.enabled
    ? h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 } },
        h('div', { className: 'dsh-router-subnav-bar', style: S.subNavBar },
          h(SegmentedTabs, {
            items: subTabs,
            value: subTab,
            onChange: function (val) { setSubTab(val) },
            label: t('subTabsLabel'),
          })),
        h('div', { style: S.workspaceScroll },
          subTab === 'pipeline' ? pipelinePanel : null,
          subTab === 'policies' ? policiesPanel : null))
    : null

  // 保存/放弃的唯一入口在弹窗顶栏，而编辑区在几百像素之下。这条只在有改动时
  // 出现的条把同一对动作放到当前视口里，不新增状态源 —— 见 P1-1。
  var dirtyBar = props.dirty && !props.saving
    ? h('div', { style: S.dirtyBar },
        h('span', { style: S.dirtyBarText }, t('dirtyBarText')),
        h('div', { style: S.dirtyBarActions },
          h('button', {
            type: 'button',
            className: 'dsh-router-discard-btn',
            style: S.dirtyBarDiscard,
            disabled: !props.writable,
            onClick: props.onDiscard,
          }, h(Icon, { d: ICON_UNDO, size: 12 }), t('formDiscard')),
          h('button', {
            type: 'button',
            className: 'dsh-router-save-inline-btn',
            style: props.invalid ? S.dirtyBarSaveDisabled : S.dirtyBarSave,
            disabled: !props.writable || props.invalid,
            onClick: props.onSave,
          }, h(Icon, { d: ICON_SAVE, size: 12 }), t('formSave'))))
    : null

  return h('div', { style: S.detailWorkspace },
    headerCard,
    introBox,
    body,
    dirtyBar)
}
