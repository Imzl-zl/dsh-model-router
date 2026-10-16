/**
 * Browser entry for dsh-model-router: the sidebar entry and its quick dialog.
 *
 * TypeScript modules bundled by tsdown into the client module system's
 * lazy-CJS factory format (`window.__ModuleLoader__.load({ id, factory })`,
 * externals resolved through the injected require). The plugin registers into
 * `sidebar.footer.action`, and that entry's dialog renders the whole workbench —
 * there is no second carrier on DSH's Plugins page.
 *
 * The config holds arrays, nested objects and booleans, which the flat
 * text-staging `SettingsFormModel` cannot express, so a controller holds the
 * draft and saves through whole-section `scope.mutate` path ops (the
 * ui-settings-subagent precedent); `SettingsForm` still provides the frame.
 *
 * Note: 客户端半包拆模块与构建复刻的取舍 —— 见
 * .agents/notes/implemented/2026-10-15-client-half-module-split.md
 * Note: 控制台视觉质感重构、信息架构分层与文案产品化修复 —— 见
 * .agents/notes/implemented/2026-10-15-ui-ux-design-overhaul-and-copy-cleanup.md
 * Note: 单一载体（删页面、只留侧栏弹窗）、高度容器链、语义色单源与 Tab 圈禁 —— 见
 * .agents/notes/implemented/2026-10-16-single-surface-dialog-and-tone-system.md
 */

export { name, inject, apply } from './apply.ts'
export { RouterPage } from './page.ts'
export { routeStatus } from './format.ts'
