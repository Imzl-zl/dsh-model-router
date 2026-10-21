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
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import remote from 'dsh-model-router/remote'
import { createSessionChip, SessionChainChip } from './chip.ts'
import { createController } from './controller.ts'
import { ModelRouterPanel, ModelRouterPanelIcon } from './panel.ts'
import { CONFIG_NS, NS, en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = NS + '/client'

/** The id shared by the sidebar panel row and the main panel it opens. */
export const PANEL_ID = 'model-router' as MainPanelId

// `remote` is the Remote namespace this package's own `./remote` contribution
// mounts into, and `remote.session` carries the catalog and the passive fold.
// `remote.routerHealth` is deliberately NOT in this top-level list: it is this
// package's own contribution, mounted by `$mount` inside `applyInner` below, so
// declaring it here asks for a service that only this very apply can provide
// (measured: the entry then never activates — "waiting for service:
// remote.routerHealth"). The UI fiber declares it in its own `inject` below,
// which runs after the mount.
// The browser half also no longer needs DSH's own `remote.llm` /
// `remote.settings` — the connectivity check moved to the Host so its
// classification can see the `LlmError` code (see ../../connectivity.ts).
// `shortcuts` 走 Cordis fiber inject——不是 dsh.client.inject：按 DSH 源码
// （client/modules/src/client/manifest.ts 与 ui-workspace/src/client/index.ts:88-98 的
// 注释），dsh.client.inject 只是加载/预取元数据，"never apply sequencing"。顺序由依赖
// 表达：fiber inject 让本插件等 shortcuts 服务就绪才激活。ui-workspace 同款注入。
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'shortcuts']

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
  return await applyInner(ctx)
}

async function applyInner(ctx: Context): Promise<() => Promise<void>> {
  // Labels come from this plugin's own dictionaries, bound by namespace —
  // never from the Config schema's `.description()`.
  var t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'router: dictionaries')
  ctx.effect(ensureStyles, 'router: global styles')

  var unmountRemote = await ctx.remote.$mount(remote)
  // child 的 inject 是显式清单、不从父继承（Cordis 语义；ui-workspace 的 apply 注释
  // 同样声明"要依赖哪个服务就列哪个"）。`shortcuts` 必须出现在这里，因为
  // registerUi 在这个 child 上注册保存命令——漏列它会在激活时抛
  // "cannot get required service shortcuts in inactive context"。
  var ui = ctx.inject(['remote.routerHealth', 'slots', 'locale', 'configForms', 'remote', 'remote.session', 'shortcuts'], function (child) {
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
 * Register the sidebar entry, the quick dialog behind it, and the controller
 * both of them read.
 *
 * There is exactly one surface: the sidebar entry opens a dialog that renders
 * the whole workbench. This plugin used to also register a `plugins.bundle.config`
 * page, which put the same workbench on DSH's Plugins page — inside that page's
 * own header, its component list, and a 960px settings column. Two carriers for
 * one editor meant two sets of layout constants (the page's sticky header, its
 * `margin: 0 -20px` bleed, its 768px media query and its `100vh - 292px` caps),
 * and every one of them was wrong for the dialog. Measured in the browser
 * before the removal: the page overflowed its settings column by 222px at a
 * 768px viewport because its min-content floor came from the sticky header's
 * nowrap row. The dialog is the surface users actually open, so the page is
 * gone and its layout debt went with it.
 *
 * Note: 载体取舍与被否方案（为何删页面而非修页面）—— 见
 * .agents/notes/implemented/2026-10-16-single-surface-dialog-and-tone-system.md
 *
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
  // 会话内 chip 的控制器：一个会话一份绑定状态（写失败留在弹层里，成功才刷新）。
  var sessionChip = createSessionChip(ctx, t)

  // 保存快捷键走 DSH 原生的 shortcuts 服务（ui-settings-general/src/client/index.ts:179
  // 同款）：可重绑定、出现在快捷键设置页、并按模态归属仲裁。`modals: ['model-router']`
  // 与侧栏弹窗 Modal 的 shortcutModal 对应——弹窗开着时这个键仍归我们，别的模态开着时
  // 原生层挡掉。resolve 只回答"现在该不该我接"：能不能存由 controller.save() 自己判
  // （saving/writable/invalid 与草稿校验都在那里）。
  ctx.effect(() => ctx.shortcuts.register({
    id: 'model-router.save' as ShortcutCommandId,
    label: () => t('saveShortcutLabel'),
    aliases: ['model-router save', '模型路由保存'],
    // 默认绑定按平台分开，依据是 DSH 的 isWebBindingAllowed（shortcuts/src/binding.ts:
    // 96-111）：Windows/macOS 的 Web 放行"两键含 primary+alt/shift"，**Linux 的 Web 只
    // 认 Slash/Comma+shift/Period+shift 三组**。所以 Web 统一用 Comma+primary+shift
    // （DSH 自己的 settings.open 在 Web 也是 primary+alt+Comma 的两键形态）；桌面用裸
    // primary+S。写错组合会在注册时抛 Unsupported Web shortcut，整个插件激活失败。
    defaults: {
      'desktop:macos': { code: 'KeyS', modifiers: ['primary'] },
      'desktop:windows': { code: 'KeyS', modifiers: ['primary'] },
      'desktop:linux': { code: 'KeyS', modifiers: ['primary'] },
      'web:macos': { code: 'Comma', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'Comma', modifiers: ['primary', 'shift'] },
      'web:linux': { code: 'Comma', modifiers: ['primary', 'shift'] },
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
    onSelectChain: function (id) { controller.selectChain(id) },
    onAddChain: function () { controller.addChain() },
    onRenameChain: function (id, value) { controller.renameChain(id, value) },
    onSetDefaultChain: function (id) { controller.setDefaultChain(id) },
    onRemoveChain: function (id) { controller.removeChain(id) },
    onLoadSessions: function () { controller.loadSessions() },
    onSetSessionChain: function (sessionId, chainId) { controller.setSessionChain(sessionId, chainId) },
    onSetSessionRetry: function (sessionId, route, raw) { controller.setSessionRetry(sessionId, route, raw) },
    onClearSessionBinding: function (sessionId) { controller.clearSessionBinding(sessionId) },
    onActive: function (id) { controller.setActive(id) },
    onMaxRetries: function (index, value) { controller.setMaxRetries(index, value) },
    onNeeds: function (index, patch) { controller.setNeeds(index, patch) },
    onMove: function (index, direction) { controller.moveCandidate(index, direction) },
    onReorder: function (fromIndex, toIndex) { controller.reorderCandidates(fromIndex, toIndex) },
    onRemove: function (index) { controller.removeCandidate(index) },
    onStickyTurns: function (value) { controller.setStickyTurns(value) },
    onToggleSwitchOn: function (key) { controller.toggleSwitchOn(key) },
    onStrategy: function (value) { controller.setStrategy(value) },
    onFirstHopMaxRetries: function (value) { controller.setFirstHopMaxRetries(value) },
    onWeight: function (index, value) { controller.setWeight(index, value) },
    onOpenAddCandidate: function () { controller.openModal({ kind: 'add-candidate' }) },
    onCloseModal: function () { controller.closeModal() },
    onAddCandidates: function (entries) { controller.addCandidates(entries) },
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

  // 一个载体：侧栏面板列表里的一行 → 主列面板。点那行由 DSH 自己接管
  // （SidebarRoot.tsx:63-69 的 PanelRow），它调 `layout.selectPanel(id)`，而
  // 那个调用对没有 `main` 注册的 id 会抛（ui-layout service.ts:72-78）——所以
  // `main` 与 `sidebar.panellist` 必须成对注册，用同一个 id。
  // 位置：面板列表在「新会话」下面、工作区上面，正是用户要的地方；它也避开
  // `sidebar.footer.action` 那个多插件共享一行、没有分宽规则的槽位。
  ctx.effect(() => {
    const unregisterPanel = ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => Object.assign({ hooks: { routerPage: controller.store } }, actions),
    }, ModelRouterPanel))

    // 不写死 order：读当前已注册的面板行、排到他们后面。写死一个数等于假设
    // 别人不会用同一个数——两个插件选同一个数时先后只能靠注册顺序定，而注册
    // 顺序跨插件不确定。重复 register 同一个 id 不会更新既有一条（list 按 cell
    // 取第一个 live entry），所以这里只能算一次。
    const peers = ctx.slots.entriesOfSlot('sidebar.panellist')
    const highestOrder = peers.reduce((max, entry) => Math.max(max, entry.options.order ?? 0), 0)
    const unregisterRow = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: highestOrder + 1,
      label: () => t('sidebarActionLabel'),
      locale: NS,
    }, ModelRouterPanelIcon))

    // 会话内 chip：`conversation.input.left` 是 composer 工具行的会话级 list 槽——
    // 渲染顺序是 permission → Plan → left → right/模型选择器（InputBar.tsx:464-479），
    // 所以它落在「只读」之后、模型选择器之前。会话身份是槽位标准 prop，组件不猜前台
    // 会话（ui-session/src/client/index.ts:166-175）。注册要先等槽位声明
    // （ui-slots/src/index.ts:1207-1210），`inject` 就是那个等待。
    // 不写 `order`：它只在 .left 这个 list 内部排序，而本插件是唯一占用者——默认值就是
    // 0，写死一个数只会让下一个人以为这里需要和别人协商。
    const unregisterChip = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'model-router-session',
      locale: NS,
      inject: () => ({ sessionChip: sessionChip }),
    }, SessionChainChip))

    return () => {
      unregisterPanel()
      unregisterRow()
      unregisterChip()
      // 控制器自己的定时器与在飞检查是裸的（裸 setInterval、裸远程调用），不归
      // Cordis 管：fiber 卸载时必须自己收。修复前 dispose 根本没有被接线——
      // 巡检 interval 对着已卸载的 fiber 空转、继续打端点，而在飞的远程回调
      // 还会经 publish 把它复活（M11）。
      controller.dispose()
    }
  }, 'router: sidebar entry')
}
