# 侧栏入口从 footer.action 搬到面板列表（2026-10-19）

## Context

用户看完上一轮的成品后连提两条，第二条带火气："你大爷不还是这样？这肯定有解法，你肯定乱
搞的，这玩意人家设计的时候我不信考虑不到这个"、"还有不是说放到插件的下面工作区上面吗？"

他指的是侧栏底部：我们的入口和另一个插件（`dsh-toolbox-ui` 的"工具箱"）挤在同一行，我们
被压到 88px、标签截成"模."。

我第一反应是去调 flex 值，连改两轮都没修好（`flex-shrink` 从 0 修成 1 之后，两个按钮都
`flex-grow:1` 把行撑满，我们反而更窄）。**那是在猜**。读完 DSH 源码才发现根本不该在这个
槽位里抢宽度。

## Decision

**入口搬到 `sidebar.panellist`，配一个 `main` 面板。** 侧栏那一行变成「新会话 → 插件 / 模型
路由 → 工作区」，正是用户说的"插件的下面、工作区上面"。`sidebar.footer.action` 不再注册。

源码依据（三条，都不是推测）：

1. `.footerActions` 只有 `display:flex; width:100%`，注释明写 "Each occupant owns its button
   geometry"（`ui-sidebar/src/client/SidebarRoot.module.css:572-589`）。DSH 自家的 ui-cordis
   把自己写成 `flex:none; width:100%` + 按钮 `width:calc(100% + 4px)`
   （`extensions/ui-cordis/src/client/CordisPanel.module.css:3-11,19-35`），第三方 occupant
   同样 `width:100%`。**两个 100% 在 flex 行里只能按 min-content 互相挤**——不是谁的 flex
   写错了，是这个槽位没有分宽规则，DSH 自己也只发一个 occupant。
2. `PanelRow` 自己接管点击并调 `layout.selectPanel(id)`，而 `ui-layout/src/client/service.ts:72-78`
   对没有 `main` 注册的 id 直接 `throw`。所以 `sidebar.panellist` 的一条**必须**配一个
   `main` 注册、用同一个 id；occupant 只提供图标（ownerProps 只有 `size`/`active`）。
3. 面板列表在 `SidebarRoot.tsx:279-302` 里位于 `regionArea`（工作区）之前，位置天然符合要求。

连带改动：
- `footer.ts` 删除，改成 `panel.ts`：面板页 = 页头（图标 / 标题 / 状态徽标 / 返回会话 / 放弃 /
  保存）+ 原来的工作台。`selectPanel(null)` 回会话（`ui-workspace/src/client/navigation.ts:496`
  同款）。
- 描述文字按用户"为啥非要写一些描述"一并删掉：接管开关行只留标签，第一跳卡只留标题 + 徽标，
  降级段头只留标题 + 计数。关着时那块说明卡说清"现在什么都不做"，够了。
- `order` 继续不写死：读 `entriesOfSlot('sidebar.panellist')` 取 max+1。

## Alternatives considered

### A1. 继续用 footer.action，把 flex 修对

**最强理由**：改动最小，载体不用动；`flex` 确实有"正确值"（`0 1 auto` 按内容定宽）。

**为何被否**：**实测证明它修不好**。`flex: 0 1 auto` 之后两者都按 min-content 定宽，同伴的
min-content 是 172px（"工具箱"+图标），我们只剩 88px——不是我们的 flex 错，是行宽不够分。
只要有两个 occupant，就一定有一个被截。根源是这个槽位没有分宽规则，不是我们的样式。

### A2. 占满一行（`width:100%` + `flex:none`，照抄 ui-cordis）

**最强理由**：和 DSH 自家插件完全一致，视觉上绝对对齐。

**为何被否**：两个都占满就是 200%，照样互相挤（只是换成对方被挤）。而且这是明知会挤还照着
抄。

### A3. 只在只有一个 occupant 时占满，多个时让

**最强理由**：两种情况都照顾。

**为何被否**：`@media`/`:only-child` 已经这么做了（`.wide:only-child`），实测多个 occupant 时
仍然挤——因为让的那一方没有宽度可让。见 A1。

### A4. 注册一个 main 面板，但保留弹窗做第二个入口

**最强理由**：用户既能从侧栏快速点开，又能在面板里用大界面。

**为何被否**：两个载体 = 两套布局常数 + 两个"哪个是真的"的问题，这是本项目 2026-10-16 已
经实测并删掉过的形态（memory.md 记着量测证据）。用户要的是位置，不是第二个入口。

## Consequences

**收益**

- 位置符合要求：面板列表在「新会话」下面、工作区上面，和 DSH 自家的插件/任务管理并列。
- 彻底消除挤一行的问题：面板列表一个 id 一个 cell，没有宽度要分。
- 工作台从弹窗变成主列面板，可用宽度从 ~700px 变成 ~1190px，两栏布局更从容。
- 描述文字少了一批。

**代价**

- **载体变更**：弹窗没了，快捷打开没了。用户要开路由配置必须切到面板（点侧栏那一行）。
- `main` 槽位是 keyed，面板页要在自己的页头里提供"返回会话"——原来 Modal 的 Escape/遮罩/焦点
  圈禁都由 DSH 提供，现在这些都没有了（保存/放弃在工作台自己的脏条里也有）。
- Ctrl+S 的 `modals: ['model-router']` 约束事实上失效（没有 modal 了）；`registry.ts:142` 在
  `context.modal === null` 时本来就不拦，所以行为不变，但那条约束已经名存实亡。

## 验证

- 单测：unit **142**、client-controller **49**（新增两条守卫：`main` 与 `panellist` 必须成对
  同 id；`order` 不许写死且必须从已注册条目推导）、run.mjs **23 场景 0 失败**、remote **15**、
  bundle / tsc / `node --check` 全过；DSH checkout 0 行。
- **浏览器实测**（隔离 `.dshhome-view` 端口 3399 + Chrome MCP）：侧栏出现「模型路由」行、位于
  「插件」之下；footer 行只剩别人一个 occupant；点行进面板，页头/导航/降级链/第一跳/脏条全部
  渲染，无原始字典键；接管开关 false→true、草稿变脏、保存按钮可用、控制台无错；面板 1188×880
  撑满主列且无双层滚动。
- **实测抓到并修掉一个自己引入的真 bug**：开关搬到 `chain.ts` 后 `page.ts` 没传 `onEnabled`，
  点一次 `TypeError: props.onEnabled is not a function`，草稿不变、保存按钮永远禁用。已补接线。
- **实测定位一个环境问题（非产品缺陷）**：隔离 home 里保存必然失败——`--patch` overlay 插入的
  插件行不在 bundle include 之下，`settings/src/index.ts:382` 的 `configEditor.entries()` 找不到
  它，宿主直接拒写。要测保存链路必须 `dsh plugin add` 真安装。已写进 tools.md。

**未覆盖**：真实宿主的保存落盘（环境不可达，见上）；面板的 Escape/焦点圈禁（Modal 不再提供，
本插件未自建——工作台自己的脏条承担保存/放弃）。
