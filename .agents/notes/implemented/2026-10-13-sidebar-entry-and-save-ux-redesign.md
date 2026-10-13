# Agent Note: 侧边栏自适应入口接入与保存交互/视觉重构

Status: implemented

## Problem

1. **入口深隐**：Router 原先仅注册 `plugins.bundle.config`，用户需经由 `设置 -> 插件管理 -> 已安装插件 -> dsh-model-router -> 配置` 4 级跳转才能访问，且无法在聊天会话中直达。
2. **保存体验割裂**：配置页面较长时，仅在最底部的 `SettingsForm` 内提供保存按钮，页面未修改时按钮置灰无提示，修改后无法在视线内感知保存位置，用户需反复滚轮翻页寻觅。
3. **插件入口冲突疑虑**：用户存在其他常驻侧边栏插件（如 `dsh-toolbox-ui` 注册于侧栏设置上方），担心新增入口会产生绝对定位抢占或互相覆盖。
4. **视觉质感不统一**：旧版候选节点操作按钮单薄、缺少 Stepper 微调、主模型与故障转移链路视觉区分度弱，未充分利用 DSH 原生 CSS 变量与现代科技感层级。

## Decision

1. **双槽位自适应并存与 CSS 弹性纵向重排**：
   - 保持 `plugins.bundle.config` 原生设置页能力；
   - 新增 `sidebar.footer.action` 注册（id: `'model-router'`, order: 120），放置于 DSH 侧栏设置按钮正上方；
   - **自适应避让与防挤压机制**：DSH 原生 `.footerActions` 默认为水平 row 布局，当 `dsh-toolbox-ui`（order: 100）与 `dsh-model-router`（order: 120）同时启用时，默认会被压缩至半宽并导致按钮文字断行。插件在 `apply(ctx)` 动态注入 `ROUTER_CSS`，将 `div[class*="footerActions"]` 规范化为纵向列排布（`flex-direction: column !important; gap: 4px;`），展开时各自 100% 满宽，收起时（rail）纵向居中对齐（`gap: 6px;`），多插件自适应顺次堆叠，绝不争抢挤占位置；
   - 侧边栏按钮点击后，通过 `ReactDOM.createPortal` 唤起沉浸式【模型路由控制中心】模态视窗（支持 Esc 键与遮罩点击关闭），在不打断会话的前提下瞬时完成配置。
2. **唯一吸顶主保存交互（根治“保存找半天”与“保存上下都有”）**：
   - **吸顶顶栏为唯一保存落点**：页面端常驻 Sticky Header，模态端常驻 Modal Top Bar，保存按钮固定在右上视线焦点；
   - **消除多头保存冲突**：彻底移除悬浮保存条（Floating Save Bar），并针对 `.dsh-router-page` 与 `.dsh-router-modal-dialog` 注入 CSS 规则隐藏内部 `SettingsForm` 重复的底栏保存，杜绝“上下都有保存、中间还浮动一个”的混乱感；
   - **状态与文案防换行**：保存按钮文案固定为“保存配置”/“正在保存...”，`Ctrl+S` 快捷键作为紧凑键盘芯片独立呈现，按钮配置 `white-space: nowrap !important;`，杜绝因文案动态扩展导致的按钮换行；
   - **直观状态指示**：草稿变更时即时点亮 `● 未保存修改` 琥珀色徽标，保存按钮呈现渐变蓝光，保存中展示 CSS 旋转 Spinner 动画，保存失败在顶栏下方呈现警示框；
   - **快捷键直达**：全页面及模态窗内均支持 `Ctrl+S` / `Cmd+S` 快捷保存与 `Esc` 退出。
3. **视觉规范与微交互打磨**：
   - **主备模型链路层级清晰**：主模型节点金色星标与微光卡片（`nodeCardPrimary`），备用候选人节点配以流向箭头与 `#N` 故障转移标签；
   - **重试步进器（Stepper）**：重试上限采用精致的 `[-]`、数字输入框、`[+]` 结构，防非法输入并带有不可用置灰态；
   - **条件指示**：高级路由条件按钮带活跃蓝点指示（`⚙️ ● 高级路由条件`）；
   - **响应式排布**：执行预算与退避卡片采用 `repeat(auto-fit, minmax(280px, 1fr))` 自适应换行，避免分屏窄视口下的内容挤压；
   - **内边距归一化**：模态视窗采用 `pageModal` 样式，消除对话框内部与外层的双重 padding 嵌套。

## Alternatives considered

1. **仅在设置中心注册 `settings.section` 一级导航项**
   - 被否原因：虽然能免去插件管理深层点击，但用户在主界面与会话中依然必须切入设置对话框，无法实现像 `dsh-toolbox-ui` 一样的侧边栏一键秒开。
2. **直接覆盖全局浮层 `shell.overlay`**
   - 被否原因：`shell.overlay` 是悬浮按钮（FAB）形态，容易与页面内的快捷指令/悬浮球抢夺屏幕右下角或底部空间；而侧边栏底部的 `sidebar.footer.action` 是官方标准列表槽位，架构上更优雅。
3. **保留浮动保存条（Floating Save Bar）与底部 SettingsForm 保存按钮**
   - 被否原因：用户反馈长页面滚屏时“页面顶部有保存、底部有保存、中间还浮现保存”，产生严重视觉干扰与冗余；统一将吸顶 Header 作为唯一保存入口是最高效、最符合现代桌面软件规范的设计。

## Consequences

- 收益：
  - 侧边栏入口自适应垂直堆叠在设置上方，与 `dsh-toolbox-ui` 等其他插件完美兼容并存、互不抢占；
  - 保存入口一目了然且唯一，支持 `Ctrl+S` 与即时状态反馈，消除了按钮换行与上下重复；
  - UI 视觉风格完全与 DSH 原生 Design Tokens 对齐，优雅精致。
- 验证：
  - 9/9 组合测试（`tests/run.mjs`）全绿；
  - 12/12 单元测试（`tests/unit.mjs`）全绿；
  - TypeScript 类型检查 0 报错；
  - Node.js AST 语法检查通过。
