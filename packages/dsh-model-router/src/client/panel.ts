/**
 * The main-column panel the sidebar's panel-list row opens.
 *
 * Position: the panel list sits directly under New Session and above the
 * workspace region (ui-sidebar SidebarRoot.tsx:279-302), which is where the user
 * asked for this entry to live. It used to be a `sidebar.footer.action` — a row
 * DSH shares between every plugin that registers one, with no rule for dividing
 * the width (both DSH's own ui-cordis and third-party occupants style themselves
 * `width: 100%`), so two occupants squeeze each other by min-content. The panel
 * list has one cell per id, so there is nothing to share.
 *
 * A panel row is not a free-standing button: DSH owns the row and its click, and
 * `layout.selectPanel` throws for an id with no `main` registration
 * (ui-layout/src/client/service.ts:72-78). So this package registers both — the
 * `main` entry rendering this page, and the `sidebar.panellist` entry rendering
 * only the glyph — with the same id.
 */

import { h } from './dom.ts'
import { S } from './styles.ts'
import { healthToneBadge, isMacPlatform, saveShortcutKeyKey } from './format.ts'
import { RouterPage } from './page.ts'
import { Icon, ModelRouterIcon, ICON_ARROW_LEFT, ICON_CHECK, ICON_SAVE, ICON_SPINNER, ICON_UNDO } from './icons.ts'
export function ModelRouterPanel(props) {
  var t = props.t
  var state = props.useRouterPage(function (s) { return s })
  var enabled = state.draft.enabled
  var dirty = state.dirty

  return h('div', { className: 'dsh-router-panel', style: S.panelRoot },
    h('div', { style: S.panelHeader },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
        h(ModelRouterIcon, { size: 22, color: 'var(--dsh-router-accent)' }),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: S.panelTitle }, t('quickModalTitle')),
            h('span', {
              style: enabled ? Object.assign({}, S.badgeRunning, healthToneBadge('healthy')) : S.badgePaused,
            }, enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
            dirty ? h('span', { style: Object.assign({}, S.badgeDirty, healthToneBadge('degraded')) }, '● ' + t('unsavedChangesBadge')) : null,
            state.failed ? h('span', { style: Object.assign({}, S.saveFailedBadge, healthToneBadge('unhealthy')) }, t('formSaveFailed')) : null))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
        // 回到会话：面板是主列的一个 seat，`selectPanel(null)` 是 DSH 自己的回退
        // 路径（ui-workspace/src/client/navigation.ts:496 同款）。
        h('button', {
          type: 'button',
          className: 'dsh-router-panel-back',
          style: S.panelBackBtn,
          title: t('backToConversation'),
          onClick: props.onClose,
        }, h(Icon, { d: ICON_ARROW_LEFT, size: 14 }), t('backToConversation')),
        dirty ? h('button', {
          type: 'button',
          className: 'dsh-router-discard-btn',
          style: S.discardBtnHeader,
          disabled: !state.writable || state.saving,
          onClick: props.onDiscard,
        }, h(Icon, { d: ICON_UNDO, size: 13 }), t('formDiscard')) : null,
        h('button', {
          type: 'button',
          className: 'dsh-router-save-btn',
          style: Object.assign({}, S.saveBtn, (!dirty || !state.writable || state.saving || state.invalid) ? S.saveBtnDisabled : S.saveBtnHighlight),
          disabled: !dirty || !state.writable || state.saving || state.invalid,
          title: dirty ? t('saveShortcutHint') : t('savedStateTip'),
          onClick: props.onSave,
        },
          state.saving ? h(Icon, { d: ICON_SPINNER, size: 14, spin: true }) : (dirty ? h(Icon, { d: ICON_SAVE, size: 14 }) : h(Icon, { d: ICON_CHECK, size: 14 })),
          state.saving ? t('formSaving') : t('formSave'),
          dirty ? h('kbd', { style: S.kbdTag }, t(saveShortcutKeyKey(isMacPlatform()))) : null))),
    h('div', { style: S.panelBody },
      h(RouterPage, props)))
}

/**
 * The glyph the sidebar's panel row renders. DSH owns the row, its label and its
 * click; this occupant owns only the mark (SidebarRoot.tsx:70-72 hands it `size`
 * and `active`).
 */
export function ModelRouterPanelIcon(props) {
  return h(ModelRouterIcon, {
    size: props.size ?? 16,
    color: props.active ? 'var(--dsh-router-accent)' : 'currentColor',
  })
}
