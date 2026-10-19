/** The one chain's view: pipeline and policies sub-tabs. */

import { useEffect, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { accentBadge, fill } from './format.ts'
import { Icon, ICON_BOLT, ICON_PLUS, ICON_ROUTE, ICON_SAVE, ICON_SHIELD, ICON_UNDO, ICON_WARN } from './icons.ts'
import { BudgetRow, PipelineEditor, SwitchOnGrid } from './pipeline.ts'
import { SegmentedTabs, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

export function ChainView(props) {
  var t = props.t
  var chain = props.chain
  var chainId = 'chain'
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

  var tabId = function (name) { return 'subtab-' + name }
  var panelId = function (name) { return 'subpanel-' + name }
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
  // 只留「哪条链 + 几条降级 + 识图路由」这行硬事实，以及接管开关。
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
      h('div', { style: S.workspaceAvatar }, h(Icon, { d: ICON_BOLT, size: 18 })),
      h('div', { style: S.workspaceTitles },
        h('div', { style: S.workspaceTitleRow },
          h('h2', { style: S.workspaceModelName }, t('chainNavTitle')),
          h('span', { style: S.countBadge }, fill(t('candidateCountTag'), { n: chain.candidates.length })),
          imageBadge))),
    // 接管开关做成一行正常的设置行（左标签右开关），不再塞进标题栏：标题栏是单行
    // 定高容器，塞进去只会互相挤。关着时下面那块说明卡说清"现在什么都不做"，
    // 所以这一行只留标签本身——配置不复杂，不需要第二句解释。
    h('div', { style: S.takeoverRow },
      h('span', { style: { fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, t('takeoverSwitchLabel')),
      h('div', { style: { flexShrink: 0 } },
        h(Switch, {
          checked: props.enabled,
          label: t('takeoverSwitchLabel'),
          disabled: props.disabled,
          onChange: function (next) { props.onEnabled(next) },
        }))))

  var introBox = !props.enabled
    ? h('div', { style: S.introBox },
        h(Icon, { d: ICON_WARN, size: 20 }),
        h('div', null,
          h('h3', { style: S.introTitle }, t('takeoverOffTitle')),
          h('p', { style: S.introDesc }, t('takeoverOffDesc'))))
    : null

  // ---- 候选链页签 ----
  var addBar = h('div', { style: S.addBar },
    h('button', {
      type: 'button',
      className: 'dsh-router-catalog-btn',
      style: S.catalogBtnLg,
      disabled: props.disabled,
      onClick: props.onOpenAddCandidate,
    }, h(Icon, { d: ICON_PLUS, size: 13 }), t('addCandidateBtn')))

  var visionGuide = h('div', { style: S.guideBox },
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
    h(PipelineEditor, {
      t: t,
      candidates: chain.candidates,
      strategy: chain.strategy,
      disabled: props.disabled,
      catalog: props.catalog,
      passive: props.passive,
      discover: props.discover,
      probe: props.probe,
      onStrategy: function (val) { props.onStrategy(val) },
      onJumpHealth: props.onJumpHealth,
      onMaxAttempts: function (index, value) { props.onMaxAttempts(index, value) },
      onMove: function (index, direction) { props.onMove(index, direction) },
      onReorder: function (fromIndex, toIndex) { props.onReorder(fromIndex, toIndex) },
      onRemove: function (index) { props.onRemove(index) },
      onNeeds: function (index, patch) { props.onNeeds(index, patch) },
      onWeight: function (index, value) { props.onWeight(index, value) },
      onOpenAddCandidate: function () { props.onOpenAddCandidate() },
      onJumpPolicies: function () { setSubTab('policies') },
      maxTotalAttempts: chain.maxTotalAttempts,
      // 识图粘滞在节点的高级条件面板里（imagesMode 为「仅带图」时才出现），
      // 不在这里渲染 —— 见 docs/design/ui-review.md P0-1。
      stickyTurns: chain.stickyTurns,
      onStickyTurns: function (value) { props.onStickyTurns(value) },
      imageFocus: imageFocus,
    }),
    visionGuide,
    addBar)

  // ---- 策略页签 ----
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
        onToggle: function (key) { props.onToggleSwitchOn(key) },
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
        onMaxTotal: function (value) { props.onMaxTotal(value) },
      })))

  // ---- 工作区主体 ----
  // One wrapper around everything the page contributes below the subnav. It
  // is the workspace's scrolling region, so the rule editor's height never
  // pushes the dialog's body into scrolling — the same containment the health
  // workspace gets from S.workspaceScroll.
  var body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 } },
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
