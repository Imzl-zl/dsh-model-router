/** The sidebar entry button registered into sidebar.footer.action. */

import { Fragment, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { accentBadge, fill, healthToneBadge, isMacPlatform, saveShortcutKeyKey } from './format.ts'
import { routeKeyOf } from '../routes.ts'
import { RouterPage } from './page.ts'
import { Icon, ModelRouterIcon, ICON_CHECK, ICON_CLOSE, ICON_REFRESH, ICON_SAVE, ICON_SPINNER, ICON_UNDO } from './icons.ts'
import { Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * 接管开关旁边的那一行：主模型是什么、新会话默认模型是否还指向它。
 *
 * 它读的是宿主状态而不是草稿——DSH 每次手动换模型都会把默认模型存成新的
 * （commands.ts:177），所以"开关开着但默认已经变了"只有宿主知道。没有这一行，
 * 用户看到的就是"开关明明开着，新会话却没走我配的模型"，且无从判断原因。
 */
function DefaultModelSyncLine(props) {
  var t = props.t
  var status = props.status
  if (!status) return null
  if (!status.enabled) {
    return h('span', { style: S.syncLineMuted }, t('takeoverOffHint'))
  }
  if (status.primary === null) {
    return h('span', { style: S.syncLineMuted }, t('defaultModelNoPrimary'))
  }
  var label = routeKeyOf(status.primary.provider, status.primary.model)
  if (status.current === null) {
    return h('span', { style: S.syncLineMuted }, t('defaultModelNoService'))
  }
  if (status.synced) {
    return h('span', { style: Object.assign({}, S.syncLine, healthToneBadge('healthy')) },
      h('span', { style: Object.assign({}, S.toneDot, { background: 'var(--dsh-router-tone-ok)' }) }),
      fill(t('defaultModelSynced'), { model: label }))
  }
  if (status.lastError !== null) {
    return h('span', { style: Object.assign({}, S.syncLine, healthToneBadge('unhealthy')) },
      h('span', { style: Object.assign({}, S.toneDot, { background: 'var(--dsh-router-tone-bad)' }) }),
      h('span', { style: { minWidth: 0 } }, fill(t('defaultModelSyncFailed'), { model: label })),
      h('button', {
        type: 'button',
        className: 'dsh-router-sync-btn',
        style: S.syncRetryBtn,
        disabled: props.loading,
        title: t('defaultModelRetryHint'),
        onClick: props.onResync,
      }, h(Icon, { d: ICON_REFRESH, size: 11 }), t('defaultModelRetry')))
  }
  return h('span', { style: Object.assign({}, S.syncLine, healthToneBadge('degraded')) },
    h('span', { style: Object.assign({}, S.toneDot, { background: 'var(--dsh-router-tone-warn)' }) }),
    h('span', { style: { minWidth: 0 } }, fill(t('defaultModelDrift'), { model: label })),
    h('button', {
      type: 'button',
      className: 'dsh-router-sync-btn',
      style: S.syncRetryBtn,
      disabled: props.loading,
      title: t('defaultModelResyncHint'),
      onClick: props.onResync,
    }, h(Icon, { d: ICON_REFRESH, size: 11 }), t('defaultModelResync')))
}

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
  var primaryProfileId = state.draft.primaryProfileId

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
        h(ModelRouterIcon, { size: 24, color: 'var(--dsh-router-accent)' }),
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: S.modalTopTitle }, t('quickModalTitle')),
            h('span', {
              style: enabled ? Object.assign({}, S.badgeRunning, healthToneBadge('healthy')) : S.badgePaused,
            }, enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
            dirty ? h('span', { style: Object.assign({}, S.badgeDirty, healthToneBadge('degraded')) }, '● ' + t('unsavedChangesBadge')) : null,
            state.failed ? h('span', { style: Object.assign({}, S.saveFailedBadge, healthToneBadge('unhealthy')) }, t('formSaveFailed')) : null)),
          // 接管开关：`enabled` 从此有控件。此前 apply.ts 的 onEnabled 从没被渲染过，
          // 顶栏这枚徽标因此只是状态展示——用户装了插件、建好规则，请求立刻被接管，
          // 而界面上没有任何地方能关掉它。
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 } },
            h(Switch, {
              checked: enabled,
              label: t('takeoverSwitchLabel'),
              disabled: !state.writable || state.saving,
              onChange: function (next) { props.onEnabled(next) },
            }),
            h(DefaultModelSyncLine, {
              t: t,
              status: state.ui.defaultModel,
              loading: state.ui.defaultModelLoading,
              onResync: props.onSyncDefaultModel,
            }))),
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
          dirty ? h('kbd', { style: S.kbdTag }, t(saveShortcutKeyKey(isMacPlatform()))) : null),
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
        h(ModelRouterIcon, { size: isWide ? 17 : 19, color: enabled ? 'var(--dsh-router-accent)' : 'var(--dsw-alias-label-tertiary, #888)' }),
        isWide ? h('span', { style: S.sidebarLabel }, t('sidebarActionLabel')) : null),
      isWide
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
            dirty ? h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--dsh-router-tone-warn)', flexShrink: 0 }, title: t('unsavedChangesBadge') }) : null,
            h('span', { style: S.sidebarCountBadge }, String(profileCount)))
        : (dirty ? h('span', { style: S.railDirtyDot }) : null)),
    modalElement
  )
}
