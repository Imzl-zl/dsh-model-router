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
import { CandidatesSection, FirstHopSection, RetrySection, StrategySection, SwitchOnSection } from './pipeline.ts'

export function ChainView(props) {
  var t = props.t
  var chain = props.chain
  return h('div', { className: 'dsh-router-view' },
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
