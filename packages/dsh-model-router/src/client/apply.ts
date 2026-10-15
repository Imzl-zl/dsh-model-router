/**
 * Cordis plugin face and slot registration for the browser half.
 *
 * The page itself reads its own settings scope (the bundle patch row id is the
 * namespace, not the package name) and saves through whole-section `scope.mutate`
 * path ops; `SettingsForm` only provides the frame. Labels come from this
 * plugin's own dictionaries.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createController } from './controller.ts'
import { ModelRouterFooterAction } from './footer.ts'
import { RouterPage } from './page.ts'
import { CONFIG_NS, NS, en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = NS + '/client'

// `remote.llm` carries the connectivity check (DSH's own model discovery) and
// `remote.settings` carries the endpoint facts it needs. Both are native DSH
// remotes; this plugin contributes no remote of its own — the Typert host-face
// artifact it now builds (lib/typert.host.js) carries its reflected `Profile`
// schema, and a plugin-owned Remote service is part of the probe feature
// (docs/design/build-pipeline-and-plugin-remote.md).
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'remote.llm', 'remote.settings']

/**
 * Mount the config page for this bundle.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  // Labels come from this plugin's own dictionaries, bound by namespace —
  // never from the Config schema's `.description()`.
  var t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'router: dictionaries')
  ctx.effect(ensureStyles, 'router: global styles')
  // 定时器随插件半包的生命周期一起销毁，不在设置改动后留下孤儿轮询。
  // 它声明在 createController 里，所以由控制器交回 disposer，而不是在这里
  // 直接够那个变量——function 作用域够不到，只会在每次卸载时抛 ReferenceError。
  ctx.effect(function () {
    return function () { controller.dispose() }
  }, 'router: discover timer')

  var scope = ctx.configForms.get(CONFIG_NS)
  var controller = createController(ctx, scope, t)

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
    onOpenHealthModal: function () { controller.openHealthModal() },
    onUpdateHealth: function (patch) { controller.updateHealth(patch) },
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
