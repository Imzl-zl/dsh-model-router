/**
 * Cordis plugin face and slot registration for the browser half.
 *
 * The page itself reads its own settings scope (the bundle patch row id is the
 * namespace, not the package name) and saves through whole-section `scope.mutate`
 * path ops; `SettingsForm` only provides the frame. Labels come from this
 * plugin's own dictionaries.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts'
import remote from 'dsh-model-router/remote'
import { createController } from './controller.ts'
import { ModelRouterFooterAction } from './footer.ts'
import { RouterPage } from './page.ts'
import { CONFIG_NS, NS, en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = NS + '/client'

// `remote.llm` carries the connectivity check (DSH's own model discovery) and
// `remote.settings` carries the endpoint facts it needs. `remote` is the Remote
// namespace this package's own `./remote` contribution mounts into, which is
// what the 1-token probe endpoint is reached through.
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'remote.llm', 'remote.settings', 'shortcuts']

/**
 * Mount the config page for this bundle.
 *
 * The half also mounts this package's own generated Remote (`./remote`) before
 * the UI registers: the probe endpoint lives on the Host, and the client reaches
 * it through the generated contribution. That is the pattern DSH's own
 * cot-translation client uses
 * (packages/experimental/client-ui-cot-translation/src/client/mount.ts:120-128):
 * `$mount` first, then `ctx.inject(['remote.<ns>', ...])` so the UI fiber has
 * the service active.
 *
 * Note: 探测档、定时归属与挂载形态的取舍 —— 见
 * .agents/notes/implemented/2026-10-15-plugin-remote-probe.md
 * @param ctx - browser plugin context.
 * @returns disposer that withdraws the UI and the Remote contribution together.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // Labels come from this plugin's own dictionaries, bound by namespace —
  // never from the Config schema's `.description()`.
  var t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'router: dictionaries')
  ctx.effect(ensureStyles, 'router: global styles')

  var unmountRemote = await ctx.remote.$mount(remote)
  var ui = ctx.inject(['remote.routerHealth', 'slots', 'locale', 'configForms', 'remote', 'remote.session', 'remote.llm', 'remote.settings'], function (child) {
    registerUi(child, t)
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async function () {
    await ui.dispose()
    await unmountRemote()
  }
}

/**
 * Register the page, the sidebar entry, and the controller behind them.
 * @param ctx - child context carrying the mounted probe Remote.
 * @param t - the bound dictionary.
 */
function registerUi(ctx: Context, t: (key: string) => string): void {
  // 定时器随插件半包的生命周期一起销毁，不在设置改动后留下孤儿轮询。
  // 它声明在 createController 里，所以由控制器交回 disposer，而不是在这里
  // 直接够那个变量——function 作用域够不到，只会在每次卸载时抛 ReferenceError。
  ctx.effect(function () {
    return function () { controller.dispose() }
  }, 'router: discover timer')

  var scope = ctx.configForms.get(CONFIG_NS)
  var controller = createController(ctx, scope, t)

  // 保存快捷键走 DSH 原生的 shortcuts 服务（@deepseek-ai/dsh-client-shortcuts，
  // ui-settings-general/src/client/index.ts:179 同款）：可重绑定、出现在快捷键设置页、
  // 并按模态归属仲裁。`modals: ['model-router']` 与侧栏弹窗 Modal 的 shortcutModal
  // 对应——弹窗开着时这个键仍归我们，别的模态开着时原生层挡掉。
  // resolve 只回答"现在该不该我接"：真正能不能存由 controller.save() 自己判
  // （saving/writable/invalid 与草稿校验都在那里）。
  ctx.effect(() => ctx.shortcuts.register({
    id: 'model-router.save' as ShortcutCommandId,
    label: () => t('saveShortcutLabel'),
    aliases: ['model-router save', '模型路由保存'],
    defaults: {
      'desktop:macos': { code: 'KeyS', modifiers: ['primary'] },
      'desktop:windows': { code: 'KeyS', modifiers: ['primary'] },
      'desktop:linux': { code: 'KeyS', modifiers: ['primary'] },
      'web:macos': { code: 'KeyS', modifiers: ['primary'] },
      'web:windows': { code: 'KeyS', modifiers: ['primary'] },
      'web:linux': { code: 'KeyS', modifiers: ['primary'] },
    },
    regions: ['page', 'editable', 'terminal'],
    modals: ['model-router'],
    resolve: () => (controller.surfaceActive()
      ? { status: 'handled' as const, run: () => { controller.save() } }
      : { status: 'pass' as const }),
  }), 'router: save command')

  var actions = {
    onSave: function () { controller.save() },
    onDiscard: function () { controller.discard() },
    onEnabled: function (value) { controller.setEnabled(value) },
    onActive: function (id) { controller.setActive(id) },
    onDefaultEnabled: function (value) { controller.setDefaultEnabled(value) },
    onMaxAttempts: function (profileId, index, value, isDefault) { controller.setMaxAttempts(profileId, index, value, isDefault) },
    onNeeds: function (profileId, index, patch, isDefault) { controller.setNeeds(profileId, index, patch, isDefault) },
    onMove: function (profileId, index, direction, isDefault) { controller.moveCandidate(profileId, index, direction, isDefault) },
    onRemove: function (profileId, index, isDefault) { controller.removeCandidate(profileId, index, isDefault) },
    onMaxTotal: function (profileId, value, isDefault) { controller.setMaxTotalAttempts(profileId, value, isDefault) },
    onStickyTurns: function (profileId, value, isDefault) { controller.setStickyTurns(profileId, value, isDefault) },
    onToggleSwitchOn: function (profileId, key, isDefault) { controller.toggleSwitchOn(profileId, key, isDefault) },
    onStrategy: function (profileId, value, isDefault) { controller.setStrategy(profileId, value, isDefault) },
    onWeight: function (profileId, index, value, isDefault) { controller.setWeight(profileId, index, value, isDefault) },
    onOpenNewProfile: function () { controller.openModal({ kind: 'new-profile' }) },
    onOpenAddCandidate: function (profileId, isDefault) { controller.openModal({ kind: 'add-candidate', profileId: profileId, isDefault: isDefault }) },
    onCloseModal: function () { controller.closeModal() },
    onCreateProfile: function (when, templateId) { controller.addProfile(when, templateId) },
    onAddCandidates: function (profileId, entries, isDefault) { controller.addCandidates(profileId, entries, isDefault) },
    onDeleteProfile: function (profileId) { controller.openModal({ kind: 'delete', profileId: profileId }) },
    onConfirmDelete: function (profileId) { controller.deleteProfile(profileId) },
    onRiskAck: function (value) { controller.setRiskAck(value) },
    onOpenDrawer: function () { controller.openDrawer() },
    onCloseDrawer: function () { controller.closeDrawer() },
    onCheckAll: function () { controller.checkAll() },
    onCheckRoute: function (provider, model) { controller.checkRouteSingle(provider, model) },
    onProbeRoute: function (provider, model) { controller.probeRouteSingle(provider, model) },
    onProbeAll: function () { controller.probeAll() },
    onOpenHealthModal: function () { controller.openHealthModal() },
    onUpdateHealth: function (patch) { controller.updateHealth(patch) },
    retainSurface: function () { controller.retainSurface() },
    releaseSurface: function () { controller.releaseSurface() },
  }

  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-model-router',
    locale: NS,
    inject: () => Object.assign({ hooks: { routerPage: controller.store } }, actions),
  }, RouterPage)), 'router: config page')

  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'model-router',
    order: 120,
    locale: NS,
    inject: () => Object.assign({ hooks: { routerPage: controller.store } }, actions),
  }, ModelRouterFooterAction)), 'router: sidebar entry')
}
