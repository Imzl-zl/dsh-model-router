/**
 * Browser entry for dsh-model-router: the config page on DSH's Plugins page.
 *
 * TypeScript modules bundled by tsdown into the client module system's
 * lazy-CJS factory format (`window.__ModuleLoader__.load({ id, factory })`,
 * externals resolved through the injected require). The plugin registers into
 * `plugins.bundle.config` (keyed by package name) rendering `view: 'page'`, and
 * into `sidebar.footer.action` for the sidebar entry.
 *
 * The config holds arrays, nested objects and booleans, which the flat
 * text-staging `SettingsFormModel` cannot express, so a controller holds the
 * draft and saves through whole-section `scope.mutate` path ops (the
 * ui-settings-subagent precedent); `SettingsForm` still provides the frame.
 *
 * Note: 客户端半包拆模块与构建复刻的取舍 —— 见
 * .agents/notes/implemented/2026-10-16-client-half-module-split.md
 * Note: 控制台视觉质感重构、信息架构分层与文案产品化修复 —— 见
 * .agents/notes/implemented/2026-10-15-ui-ux-design-overhaul-and-copy-cleanup.md
 */

export { name, inject, apply } from './apply.ts'
export { RouterPage } from './page.ts'
export { routeStatus } from './format.ts'
