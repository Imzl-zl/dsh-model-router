# 单一载体（侧栏弹窗）+ 语义色单源：渲染层根因修复

日期：2026-10-16
状态：implemented
前置：2026-10-16 渲染层量测轮（隔离 `.dshhome-view` 端口 3391/3392 + Chrome MCP）

## 问题

量测轮在真实浏览器里拿到 5 条渲染层结论，其中 3 条的根因是同一个：**同一个编辑器有两个宿主**。

插件把同一份 controller + 同一个 `RouterPage` 注册进两处：

| 宿主 | 载体 | 外罩 |
|---|---|---|
| 插件管理页 | `plugins.bundle.config`（apply.ts） | DSH 插件详情头 + 组件列表 + 960px 设置列 + 吸顶头 + 底栏压制 |
| 侧栏弹窗 | `sidebar.footer.action`（apply.ts） | 干净的 1000px 模态卡 |

浏览器实测（量测轮）：

- **768px 断点失效（Important）**：`.dsh-router-page` min-content 868.9 > DSH 设置列宽 647.1，页面比列宽 221.8px，DSH 设置容器出现 195px 横向滚动。断点按视口写，容器却是 DSH 的 960 列——载体不对，断点怎么调都不对。根因定位实验：把 `S.stickyHeader` 的 `flexWrap` 改成 `wrap`，页面宽立刻回落到 645.9 = 列宽、滚动容器溢出归 0。
- **吸顶头 -20px 外溢（Minor）**：页面 padding 16px、header `margin: 0 -20px`，header 盒 968 vs 页面盒 960，左右各外溢 4px；`page.scrollWidth 964 > clientWidth 960`。
- **弹窗嵌套滚动（Minor）**：`calc(100vh - 292px)` / `calc(100vh - 280px)` 是按**插件页 chrome 高度**拍的数，弹窗 chrome 更矮却复用同一组数 → 720/1080 下"弹窗体 + 工作区"两条滚动条。
- **探针徽标不可读（Critical）**：`probeVerdictBad` 用 `--dsw-alias-state-error-secondary` 做底、`-error-primary` 做字。DSH 暗色主题下这两个令牌同值（design-platform.css:368-369 都是 red-400），实测 `background-color` 与 `color` 都是 `rgb(242,90,90)` → **对比度 1.00:1，徽标是一条没有字的红条**；浅色 1.37:1。用户截图（选中文字才看得见）确认了这条。
- **Tab 圈禁前向逃逸（Important）**：DSH `useModalLayer.ts:73-81` 用 `button:not(:disabled)` 减 `[inert],[hidden]` 算焦点列表；被插件用 `display:none` 压掉的 SettingsForm 底栏仍是列表最后一项（46 项里 1 项不可见），`atEdge` 在真正的最后一个可见控件上为 false → DSH 不 `preventDefault` → 焦点走到 `<body>`。

## 方案与取舍

用户决策（本轮唯一 user-owned 决定）：**插件管理页不再显示，只留侧栏按钮弹窗**；并要求"从根、从局部最优到全局最优，不要凑结果"。

采纳的全局解，而不是给 5 处各打补丁：

### 1. 摘掉插件管理页载体（删而不是修）

- 删 `apply.ts` 的 `plugins.bundle.config` 注册。scope 来自 `ctx.configForms.get(CONFIG_NS)`，**不依赖页面注册**，弹窗本来就是完整编辑器（渲染的是同一个 `RouterPage`），所以是干净删除。
- `RouterPage` 的 `isModalView` 恒真 → 连带删：吸顶头整段（switch/保存/放弃/标题/描述）、`S.page`（1200 maxWidth + 80px 底留白）、`S.pageModal` 的 40px 底留白、`onDiscard` 双分支、`props.view === 'summary'` 分支、以及 9 个只服务页面的样式对象。
- 上述 3 条量测缺陷（断点、负边距、页面 100vh 常数）随载体消失，无需修复。
- 被否方案：保留页面但把断点改成容器查询 / 把常数按模态重算 / 把 -20px 改成 -16px。否掉理由：每个都合理，但都留在"双宿主"这个结构问题上继续叠条件，且页面 chrome 与弹窗 chrome 的高度差会随 DSH 自己改版再次失效。

### 2. 高度改由容器链给（flex + min-height:0）

弹窗内容区 → `modalRoot` → `workbench` → `detailWorkspace` → `workspaceScroll` 串成 flex 链，每层 `minHeight: 0`；`workbench` 改 `alignItems: 'stretch'` 让两列等高。删除全部 `calc(100vh - …)`。滚动区只剩一个（工作区），弹窗体只在"内容比弹窗最小高度还矮"时才滚——那才是正确的兜底。

### 3. 语义色单源 + AA

- 新增 4 个 theme-resolved CSS 变量（ROUTER_CSS）：`--dsh-router-tone-{ok,warn,bad}`，亮色取 DSH static 调色板的 900 档、暗色取 400 档，选择依据是 `body[data-ds-dark-theme]` 是 DSH 自己的主题契约（design-platform.css:85/284/406 同款选择器）。
- `format.ts` 出三个函数：`healthToneColor`（唯一定调色映射）、`healthToneStyle`（点/时间线条：只上色）、`healthToneBadge`（徽标：12% 色调淡染底 + `label-primary` 文字 + 40% 色调边）。
- **文字永远不是色调色**：DSH 的 `state-*` 别名在某个主题里必然是中间调（`state-success-primary` 亮色 = green-500，对白 2.09:1；`state-error-secondary` 暗色 = `state-error-primary`，1:1），所以文字用 `label-primary`（与 Surface 是配对关系，双主题都过），颜色只进点和边。
- 收掉的范围：探针徽标四套配色、`navStatus{Active,Faulted,Degraded}`、`badge{Running,Dirty}`、`saveFailedBadge`、`primaryBadge`、`workspaceActivePill`、`channelStatusPill`、`dotHealthy/Degraded/Unhealthy`、`railDirtyDot`、`saveBtnSuccess`、`dangerBtn`。此前这些是 12 处各写一份的"12% 淡染 + state-primary 字"，同一缺陷类复发 12 次。
- 被否方案 A：继续用 DSH 的 tertiary 底 + primary 字（照抄 ConnectionIndicator.module.css:63-67）。否掉理由：DSH 自己那套在亮色就只有 2.09:1，且 DSH 没有 error 的 tertiary/label 令牌，抄下去 Bad 仍然 1.00。
- 被否方案 B：暗色红用 `color-mix(... white)` 提亮凑到 4.5。否掉理由：那是为过线而调数，不是根因；且红是唯一需要提亮的色调，特殊分支本身就是异味。

### 4. Tab 圈禁：让被压掉的底栏对 DSH 过滤器可见

`page.ts` 用结构兄弟定位 SettingsForm 底栏（与 CSS 压制同一条接缝：`.dsh-router-form-body` 的后继元素），挂上 `hidden` + `inert`，卸载时摘除。DSH 的 `useModalLayer` 过滤器正好认这两个属性，于是焦点列表从 46 降到 18、末项变成真实可见控件，前向 Tab 绕回弹窗内第一个控件。保留原 CSS `display:none` 规则作为双保险（属性丢失时仍然不显示）。

## 验证（全部实跑）

构建：`npm run bundle` 通过（中途抓到一次自伤：删旧 `modalContentArea` 时把注释和键吃到同一行，oxc 在 EOF 报"Unexpected token"；tsc v7 不报，rolldown 报——教训是构建错误要看解析器自己的行列）。

- 单测 87/87；组合 18/18；remote 9 条 `ok`（汇总行打印 8，双行累加器旧现象）；client-controller 30/30；`node --check lib/client.js`；根 `tsc --noEmit` 0 错误。
- client-controller 新增 3 条守卫：只注册一个载体（且不得再出现 `plugins.bundle.config` / `isModalView`）、无 `calc(100vh …)` 且各层可收缩、语义色单源 + 文字不得用 `state-*-primary` + 底栏必须带 `hidden`/`inert` + 每个 `toneDot` 必须被 `healthToneStyle` 上色（最后一条是第一版实测抓到的：色点忘了给 background，是透明的）。
- 浏览器（隔离 `.dshhome-view` 端口 3392 + Chrome MCP）：
  - 插件管理页已无 Model Router 卡片，只剩 DSH 原生"包含的组件"；侧栏入口照常。
  - 探针徽标对比度：暗色文字 11.55:1、色点对底 3.67:1 / 对卡片 4.24:1；浅色文字 14.83:1、色点 11.27:1 / 14.35:1。四组全过 AA（文字 4.5、图形 3.0）。状态 pill 同样 11.55 / 14.83。
  - 高度 720/900/1080：弹窗分别 633.6 / 792 / 950.4，全部在视口内；嵌套滚动数 1 / 0 / 0（720 只剩弹窗体一个必要滚动区，工作区 329/329、侧栏 417/417 均不滚）。
  - Tab：前向从最后一个可见控件绕回弹窗内首控件（不再是 `<body>`）；反向绕回末控件。
  - 关弹窗再开，未保存草稿与放弃按钮都在；放弃还原干净；Ctrl+Shift+Comma（Web 绑定）保存成功、脏状态清零、无失败徽标。
- 测试 home 已还原（`enabled: true` / `default.enabled: true`）；DSH checkout 0 改动。

## 遗留

- **NO_ADAPTER 被归为 unreachable**：`probe.ts:112-116` 的兜底把任何带 code 的错误都判 unreachable，于是"这个 profile 里根本没有该渠道"渲染成红色"探测未通过"；而 `types.ts:30-34` 自己写着这种情况 = `unavailable` = "没能测"。本轮未改（属于探针语义，不是渲染层），已在量测报告里按 Important 记录，待用户决定。
- 可用率百分比与"探测通过/没能测"两种徽标渲染仍不可实测：隔离 home 无会话日志、无可用渠道（两条渠道分别 NO_ADAPTER / MISSING_CREDENTIAL，预检即失败，未产生真实网络请求）。
- 视觉密度（顶栏卡 + 主侧栏 + 工作台头卡 + 3 子 tab 的 6 层）未动，属用户明示的"另起一轮"。

## 追加 A：flex 高度链三处断裂（同轮实测发现并修）

第一轮改完"高度走 flex 链"后，用户看到**侧栏「渠道健康监控」被推到底部**（距内容 468px）、且长列表把弹窗撑破。逐层测量定位到三处断点，每一处都让上层拿不到确定高度：

| # | 断点 | 实测 |
|---|---|---|
| 1 | DSH 的 `SettingsForm` 外框 `div.form` 是**块级盒** | `flex:1` 的子元素无可填充高度，workbench 按内容算 |
| 2 | 两个视图外包装 `{ flex:1, minWidth:0 }` 也是块级盒 | 链路视图列高 569 > 工作台 533，弹窗体被迫滚 |
| 3 | 行向容器里 `flex:1` 管的是**宽**，高度归 `align-self` 管 | 包装列按内容高度算，仍溢出 35px |

修法：`ROUTER_CSS` 用结构性 `:has()` 把 `div.form` 与 `.dsh-router-form-body` 提升为可收缩 flex 列；两个视图包装补 `display:flex / flexDirection:column / minHeight:0 / alignSelf:'stretch'`；侧栏 `minHeight:0 + maxHeight:100%`、列表 `flex: 0 1 auto`（内容高度）。
实测：短列表侧栏 338px（原 569）、健康入口距内容 **46px**（原 468px）、面板内空洞 0.7px；长列表（+24 行）侧栏稳在 674px、列表 523 可视 / 1570 内容**内部滚**、弹窗体不滚；720/900/1080 三个视口下弹窗体均不滚、唯一滚动区是工作区自己的域。

## 追加 B：按钮忙态从未被绘制（用户三次反馈后修）

用户三次反馈"点完加个状态、转个圈表示在请求，还是点了就闪一下没反应，以为卡了"。源码里**本来就有**忙态（`isProbingThis` → `探测中...` + `ICON_SPINNER` spin），但 MutationObserver 实测：点击后两次 DOM 提交分别在 **2ms** 和 **7ms**——忙态只存在 5 毫秒，从未被绘制。

根因：这条路渠道**预检即失败**（`NO_ADAPTER` = provider 未注册 / `MISSING_CREDENTIAL` = 没配 key），promise 在**微任务**里当场 resolve，React 把"置忙"和"清忙"两次 publish 批进同一帧。

修法：`controller.holdBusy(started, settle)` + `MIN_BUSY_MS = 450`，四个异步入口（`checkAll` / `checkRouteSingle` / `probeAll` / `probeRouteSingle`）全部经它收尾；真实耗时更长时以真实为准，下限只给"瞬时失败"补可见时间。
实测：单路探测忙态 **22 帧 / 约 437ms**（23ms→459ms），转圈 `animationName: dsh-spin` 1s infinite 且 keyframes 已注入；全局"刷新连通性"15 帧 / 约 434ms。
守卫：`client-controller.mjs` 新增"四个入口都必须经 holdBusy + 下限在 300~1200ms"，并实测证明会咬人（摘掉一处入口即报红）；三个既有测试改经 `settleBusy()` 等待（下限值从源码读，不写死）。
