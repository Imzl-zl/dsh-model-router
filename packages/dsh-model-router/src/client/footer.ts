/** The sidebar entry button registered into sidebar.footer.action. */

import { Fragment, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { healthToneBadge } from './format.ts'
import { RouterPage } from './page.ts'
import { Icon, ModelRouterIcon, ICON_CHECK, ICON_CLOSE, ICON_SAVE, ICON_SPINNER, ICON_UNDO } from './icons.ts'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

export function ModelRouterFooterAction(props) {
  var t = props.t
  var state = props.useRouterPage(function (s) { return s })
  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var isWide = Boolean(props.wide)
  var enabled = state.draft.enabled
  var dirty = state.dirty
  var profileCount = state.draft.profiles.length

  var buttonProps = {
    type: 'button',
    className: 'dsh-router-footer-action' + (isWide ? ' wide' : ' rail'),
    style: isWide ? S.sidebarActionWide : S.sidebarActionRail,
    title: t('sidebarActionTooltip'),
    'aria-label': t('sidebarActionLabel'),
    'aria-expanded': open,
    onClick: function () { setOpen(true) },
  }

  // The official Modal owns the mask, Escape, focus entry/return and the
  // Tab trap; `headless` keeps the plugin's own top bar and content area.
  // `shortcutModal` is the native bridge to DSH's shortcuts service: while this
  // dialog is the top one, commands that list 'model-router' in their `modals`
  // still run (client/shortcuts resolves context.modal from this attribute).
  var modalElement = open ? h(Modal, {
    open: true,
    headless: true,
    title: t('quickModalTitle'),
    className: 'dsh-router-modal-dialog',
    shortcutModal: 'model-router',
    onClose: function () { setOpen(false) },
  },
    h('div', { style: S.modalTopBar },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
        h(ModelRouterIcon, { size: 24, color: 'var(--dsw-alias-brand-primary, #4A65E8)' }),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: S.modalTopTitle }, t('quickModalTitle')),
            h('span', {
              style: enabled ? Object.assign({}, S.badgeRunning, healthToneBadge('healthy')) : S.badgePaused,
            }, enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
            dirty ? h('span', { style: Object.assign({}, S.badgeDirty, healthToneBadge('degraded')) }, '● ' + t('unsavedChangesBadge')) : null,
            state.failed ? h('span', { style: Object.assign({}, S.saveFailedBadge, healthToneBadge('unhealthy')) }, t('formSaveFailed')) : null))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
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
          dirty ? h('kbd', { style: S.kbdTag }, t('saveShortcutKey')) : null),
        h('button', {
          type: 'button',
          className: 'dsh-router-modal-close-btn',
          style: S.modalCloseBtn,
          title: t('close'),
          onClick: function () { setOpen(false) },
        }, h(Icon, { d: ICON_CLOSE, size: 16 })))),
    h('div', { style: S.modalContentArea },
      h(RouterPage, props))
  ) : null

  return h(Fragment, null,
    h('button', buttonProps,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
        h(ModelRouterIcon, { size: isWide ? 17 : 19, color: enabled ? 'var(--dsw-alias-brand-primary, #4A65E8)' : 'var(--dsw-alias-label-tertiary, #888)' }),
        isWide ? h('span', { style: S.sidebarLabel }, t('sidebarActionLabel')) : null),
      isWide
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
            dirty ? h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-state-warn-primary)', flexShrink: 0 }, title: t('unsavedChangesBadge') }) : null,
            h('span', { style: S.sidebarCountBadge }, String(profileCount)))
        : (dirty ? h('span', { style: S.railDirtyDot }) : null)),
    modalElement
  )
}
