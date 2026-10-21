/**
 * The chain view: five sections stacked on the page's own surface.
 *
 * Order follows the decisions a user makes: where to start (strategy), which
 * model leads (first hop), what the fallbacks are, when to switch, and how much
 * the request may cost. The page head owns the title, the takeover switch and
 * the save bar, so this file has no header of its own — the duplicate title
 * (panel header + chain header) was one of the layout defects the redesign
 * removes.
 *
 * Note: 分区顺序与"没有第二层卡片"的依据 —— 见 docs/design/ui-layout-redesign.md
 */

import { h } from './dom.ts'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { CandidatesSection, FirstHopSection, RetrySection, StrategySection, SwitchOnSection } from './pipeline.ts'

/**
 * The named chains: pick one to edit, rename it, choose the default, add/remove.
 *
 * It sits FIRST on the page because it decides what the five sections below are
 * editing — putting it last would make the form silently change target. The
 * default chain is marked with a static badge instead of an editable control:
 * exactly one chain is the default, and the badge says which one the current
 * edit target is not.
 *
 * Note: 为何"编辑目标"与"默认链"是两个状态、为何最后一条链不能删 —— 见
 * .agents/notes/implemented/2026-10-21-retry-overrides-and-chain-management.md
 */
export function ChainsSection(props) {
  var t = props.t
  var chains = props.chains
  var rows = chains.map(function (chain) {
    var editing = chain.id === props.editingId
    var isDefault = chain.id === props.defaultChainId
    var label = chain.name !== '' ? chain.name : t('chainDefaultName')
    var pick = h('button', {
      type: 'button',
      className: 'dsh-router-chain-pick',
      'aria-pressed': editing,
      disabled: props.disabled,
      title: label,
      onClick: function () { props.onSelectChain(chain.id) },
    }, editing ? t('chainEditingBadge') : t('chainEditAction'))
    var name = h(Input, {
      value: chain.name,
      placeholder: t('chainNamePlaceholder'),
      'aria-label': t('chainNameLabel'),
      disabled: props.disabled,
      className: 'dsh-router-chain-name',
      onChange: function (event) { props.onRenameChain(chain.id, event.target.value) },
    })
    var defaultMark = isDefault
      ? h('span', { className: 'dsh-router-chain-default' }, t('chainDefaultBadge'))
      : h(Button, { size: 'sm', disabled: props.disabled, onClick: function () { props.onSetDefaultChain(chain.id) } }, t('chainMakeDefault'))
    var remove = h(Button, {
      size: 'sm',
      disabled: props.disabled || chains.length <= 1,
      title: chains.length <= 1 ? t('chainRemoveLastHint') : t('chainRemove'),
      onClick: function () { props.onRemoveChain(chain.id) },
    }, t('chainRemove'))
    return h('div', { key: chain.id, className: 'dsh-router-chain-row' + (editing ? ' is-editing' : '') },
      pick, name, defaultMark, remove)
  })
  var add = h(Button, { size: 'sm', disabled: props.disabled, onClick: props.onAddChain }, t('chainAdd'))
  return h('section', { className: 'dsh-router-section' },
    h('div', { className: 'dsh-router-section-head' },
      h('h2', { className: 'dsh-router-section-title' }, t('chainsSectionTitle')),
      h('span', { className: 'dsh-router-section-count' }, chains.length),
      h('span', { className: 'dsh-router-section-hint' }, t('chainsSectionHint'))),
    h('div', { className: 'dsh-router-chain-list' }, rows),
    h('div', {}, add))
}

export function ChainView(props) {
  var t = props.t
  var chain = props.chain
  return h('div', { className: 'dsh-router-view' },
    h(ChainsSection, {
      t: t,
      chains: props.chains,
      defaultChainId: props.defaultChainId,
      editingId: chain.id,
      disabled: props.disabled,
      onSelectChain: props.onSelectChain,
      onRenameChain: props.onRenameChain,
      onSetDefaultChain: props.onSetDefaultChain,
      onRemoveChain: props.onRemoveChain,
      onAddChain: props.onAddChain,
    }),
    h(StrategySection, {
      t: t,
      strategy: chain.strategy,
      disabled: props.disabled,
      onStrategy: props.onStrategy,
    }),
    h(FirstHopSection, {
      t: t,
      maxRetries: chain.firstHopMaxRetries,
      strategy: chain.strategy,
      disabled: props.disabled,
      onMaxRetries: props.onFirstHopMaxRetries,
    }),
    h(CandidatesSection, {
      t: t,
      candidates: chain.candidates,
      strategy: chain.strategy,
      disabled: props.disabled,
      passive: props.passive,
      discover: props.discover,
      probe: props.probe,
      onMaxRetries: props.onMaxRetries,
      onWeight: props.onWeight,
      onMove: props.onMove,
      onReorder: props.onReorder,
      onRemove: props.onRemove,
      onNeeds: props.onNeeds,
      onOpenAddCandidate: props.onOpenAddCandidate,
      onJumpHealth: props.onJumpHealth,
    }),
    h(SwitchOnSection, {
      t: t,
      value: chain.switchOn,
      disabled: props.disabled,
      onToggle: props.onToggleSwitchOn,
    }),
    h(RetrySection, {
      t: t,
      firstHopMaxRetries: chain.firstHopMaxRetries,
      candidates: chain.candidates,
      stickyTurns: chain.stickyTurns,
      disabled: props.disabled,
      onStickyTurns: props.onStickyTurns,
    }))
}
