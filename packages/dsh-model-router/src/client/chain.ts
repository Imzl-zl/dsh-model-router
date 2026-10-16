/** One chain's view: pipeline and policies sub-tabs, shared by profiles and the default pool. */

import { useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { fill, healthToneBadge } from './format.ts'
import { Icon, ICON_CLOSE, ICON_GLOBE, ICON_PLUS, ICON_ROUTE, ICON_SHIELD, ICON_WARN } from './icons.ts'
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

  return h('div', { style: S.detailWorkspace },
    h('section', { style: S.workspaceHeaderCard },
      h('div', { style: S.workspaceHeaderLeft },
        isDefault
          ? h('div', { style: S.workspaceAvatar }, h(Icon, { d: ICON_GLOBE, size: 18 }))
          : h('div', { style: S.workspaceAvatar }, (chain.when?.model || 'M').slice(0, 2).toUpperCase()),
        h('div', { style: S.workspaceTitles },
          h('div', { style: S.workspaceTitleRow },
            h('h2', { style: S.workspaceModelName }, isDefault ? t('defaultProfileTab') : chain.when.model),
            isDefault
              ? h('span', {
                  style: chain.enabled ? Object.assign({}, S.workspaceActivePill, healthToneBadge('healthy')) : S.navStatusInactive,
                }, chain.enabled ? '● ' + t('defaultPoolActiveBadge') : '○ ' + t('defaultPoolInactiveBadge'))
              : h('span', { style: Object.assign({}, S.workspaceActivePill, healthToneBadge('healthy')) }, '● ' + t('activeBadge')),
            !isDefault && chain.when?.provider ? h('span', { style: S.providerBadge }, chain.when.provider) : null,
            h('span', { style: S.countBadge }, fill(t('candidateCountTag'), { n: chain.candidates.length }))),
          h('p', { style: S.workspaceDesc }, isDefault ? t('workspaceDefaultHint') : t('workspacePrimaryHint')))),
      isDefault
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
            h('span', { style: { fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, t('defaultProfileSwitchLabel')),
            h(Switch, {
              checked: chain.enabled,
              label: t('defaultProfileSwitchLabel'),
              disabled: props.disabled,
              onChange: function (next) { props.onDefaultEnabled(next) },
            }))
        : h('button', {
            type: 'button',
            className: 'dsh-router-danger-btn',
            style: S.dangerBtn,
            onClick: function () { props.onDeleteProfile(chainId) },
          }, h(Icon, { d: ICON_CLOSE, size: 12 }), t('deleteProfileBtn'))),

    isDefault && !chain.enabled ? h('div', { style: S.introBox },
      h(Icon, { d: ICON_WARN, size: 20 }),
      h('div', null,
        h('h3', { style: S.introTitle }, t('defaultProfileIntroTitle')),
        h('p', { style: S.introDesc }, t('defaultProfileIntroDesc')))) : null,

    // One wrapper around everything the page contributes below the subnav. It
    // is the workspace's scrolling region, so the rule editor's height never
    // pushes the dialog's body into scrolling — the same containment the health
    // workspace gets from S.workspaceScroll.
    !isDefault || chain.enabled ? h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 } },
      h('div', { className: 'dsh-router-subnav-bar', style: S.subNavBar },
        h(SegmentedTabs, {
          items: subTabs,
          value: subTab,
          onChange: function (val) { setSubTab(val) },
          label: t('subTabsLabel'),
        })),

      h('div', { style: S.workspaceScroll },
        subTab === 'pipeline' ? h('section', {
          id: panelId('pipeline'),
          role: 'tabpanel',
          'aria-labelledby': tabId('pipeline'),
          style: S.card,
        },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h(isDefault ? 'h3' : 'h2', { style: Object.assign({}, S.sectionTitle, isDefault ? { fontSize: 13.5 } : null) },
                isDefault ? t('defaultPoolTitle') : t('pipelineTitle')),
              h('p', { style: S.sectionSubtitle }, isDefault ? t('defaultPoolSubtitle') : t('pipelineSubtitle')))),
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
            onRemove: function (index) { props.onRemove(chainId, index, isDefault) },
            onNeeds: function (index, patch) { props.onNeeds(chainId, index, patch, isDefault) },
            onWeight: function (index, value) { props.onWeight(chainId, index, value, isDefault) },
          }),
          isDefault ? null : h('div', { style: S.guideBox },
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
          guideOpen ? h('p', { style: S.guideContent }, t('visionWorkflowText')) : null),
        h('div', { style: S.addBar },
          h('button', {
            type: 'button',
            className: 'dsh-router-catalog-btn',
            style: Object.assign({}, S.catalogBtn, { height: 36, padding: '0 18px', fontSize: 13, gap: 8 }),
            disabled: props.disabled,
            onClick: function () { props.onOpenAddCandidate(chainId, isDefault) },
          }, h(Icon, { d: ICON_PLUS, size: 13 }), t('addCandidateBtn')))) : null,

      subTab === 'policies' ? h('div', {
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
            stickyTurns: chain.stickyTurns,
            disabled: props.disabled,
            onMaxTotal: function (value) { props.onMaxTotal(chainId, value, isDefault) },
            onStickyTurns: function (value) { props.onStickyTurns(chainId, value, isDefault) },
          }))) : null),
      ) : null)
}
