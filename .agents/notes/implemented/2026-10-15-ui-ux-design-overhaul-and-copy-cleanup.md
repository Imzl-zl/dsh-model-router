# Agent Note: 控制台视觉质感重构、信息架构分层与文案产品化修复

Status: implemented

## Problem

在用户实测中，控制台暴露出 6 处严重的视觉崩溃、交互隐蔽性、信息架构混叠与文案灾难：
1. **多模态高级路由条件排版崩溃与字体溢出**（对应截图 1）：
   - `needHeader` 强行把卡片标题（`图像/多模态输入`）与 `SegmentedTabs`（包含 3 个选项，字数共 12 字）并排在同一行，卡片宽度在响应式网格下仅有 260px~300px。
   - 分段控件被挤压至不足 120px，按钮文字发生恶性竖向折行（“仅带\n图请\n求”），文字严重错位、重叠并溢出容器。
2. **候选渠道健康指示器过于隐蔽**（对应截图 2）：
   - 候选行标题后的 `HealthSignalDot` 原实现为一个 8px 的裸露灰色小空心圆圈，无任何文字说明或按钮外框。
   - 在暗色模式下，灰色圆圈与背景几乎融为一体，用户根本无法识别这是一个可以点击联动跳转到健康大盘的交互控件。
3. **候选行调节位置与删除按钮极小且视觉不齐**（对应截图 3）：
   - 上移和下移图标使用的是手绘的 7x4px 实心小三角（`ICON_UP` / `ICON_DOWN`），且按钮无底色、无边框；
   - 第 0 个主选节点的上移和删除按钮设置了 `opacity: 0.25`，变成近乎不可见的漂浮灰影，与左侧 32px 的带框胶囊（“单渠道尝试 2 次”）在视觉权重和对齐上严重脱节。
4. **手动添加渠道弹窗自嘲式文案引发用户信任危机**（对应截图 4）：
   - 文案写着“写错的名字不会报错，只会在运行时被静默跳过，所以这里不给你打错的机会”等开发人员吐槽式语言，导致用户严重担忧“在 DSH 设置中没有预设的模型，手动填了到底有没有用”。
5. **侧边栏信息架构混叠**（对应截图 5）：
   - 侧边栏在“已配置的路由规则 (PROFILES)”标题下，紧接着列出各个 Profile，尾部直接跟随“📊 渠道健康监控”卡片；
   - 缺乏空间与语义隔离，用户误以为“渠道健康监控也是一条路由规则”。
6. **渠道健康设置弹窗文案离谱且排版粗糙**（对应截图 6）：
   - 文案居然直接向最终用户展示内部开发借口：“DSH 的插件远程接口要求构建管线生成的 Typert 贡献，而这个插件是手写单文件、没有构建步骤——所以这一档的开关和配置先不做，等构建管线就绪再开”；
   - 包含大段口语化碎碎念，四档配置容器样式不统一，开关与表单高低不齐。

7. **添加入口分裂导致用户心智困惑**：
   - 流水线底部并排摆放「从已配置的模型目录中添加候选」与「+ 手动输入渠道信息」两个按钮；
   - 用户困惑“手动添加既然也只能选已配置渠道，跟从已配置目录选有什么区别？是不是重复了/混乱了？”
8. **健康设置弹窗严重越界并被屏幕顶部遮挡**：
   - `prim.Modal` 默认宽度仅 380px，无最大高度和内部滚动条约束；
   - 弹窗内塞入 4 档卡片与大段文字后总高超过 1200px，在视口垂直居中布局下，弹窗顶部 150px+ 直接伸出浏览器屏幕之外，导致标题、关闭按钮和第一档选项被彻底裁切遮挡。

## Decision

1. **多模态条件卡片结构重构**：
   - 统一两张卡片的网格布局：`[标题 + 状态微标签]` -> `[独占整行控件容器]` -> `[说明提示文案]`。
   - `SegmentedTabs` 容器占满整行宽度，选项按钮文字精简为“不限”、“仅带图”、“仅无图”，CSS 增加强制 `white-space: nowrap !important`，彻底杜绝换行溢出。
2. **升级健康指示器为状态胶囊徽标（`HealthSignalDot`）**：
   - 从 8px 隐形小圆点升级为带呼吸灯 + 状态文字的微型胶囊按钮（如 `[🟢 正常 · 140ms]` 或 `[⚪ 待观测]`）。
   - 带有微妙的背景、边框与悬浮高亮效果，清晰传达当前健康状态，并明确引导点击跳转至全局健康矩阵。
3. **重塑候选节点操作按钮组（`nodeActions`）**：
   - 引入高度 32px 的独立操作坞（Action Dock），与左侧 `attemptPicker` 高度、基准线严格对齐；
   - 升级为标准的矢量 Chevron 箭头（`ICON_CHEVRON_UP / DOWN`）与删除垃圾桶（`ICON_TRASH`）；
   - 赋予统一的背景、边框和圆角，删除按钮支持危险态 Hover 变红，禁用状态保持清晰轮廓。
4. **统一候选渠道添加入口与合一弹窗（`AddCandidateModal`）**：
   - 流水线底部删去两个割裂的并排按钮，归一为一个主操作入口 `[+ 添加候选渠道]`；
   - 打开统一模态框，内置清晰的 Tab 切换：`[📋 从已配置模型目录选择]`（常规）与 `[✍️ 自定义模型 ID (网关未收录)]`（高级网关自定义）；
   - 用户在一个弹窗内既能浏览勾选现有目录，又能针对 OneAPI / NewAPI 等网关输入任意 Model ID，逻辑清晰明确，消除重复感。
5. **侧边栏双区域分层（IA 重构）**：
   - 侧边栏划分为：中间可滚动区域（纯粹负责 Profiles 路由规则体系）与底部固定区域（`sidebarFooter`，系统运维与健康大盘）；
   - 底部常驻“系统观测与健康”专栏，彻底将业务规则与全局观测解耦，杜绝误解。
6. **健康设置弹窗视口约束、内部滚动与脱水紧凑化**：
   - 注入 `.dsh-router-settings-modal` 与 `.dsh-router-candidate-modal` 全局视口硬规则：宽度扩展至舒适的 620px，最大高度严格锁死在 `84vh`（`max-height: 84vh !important`），内容区域强制 `overflow-y: auto` 内部平滑滚动；
   - 彻底删除顶部冗余无用的 80px `introBox` 大横幅，直接露出标题与第一档；
   - Tier 3（主动测速）收拢为紧凑的一行规划中说明卡片；Tier 4（自动熔断）在关闭时折叠规则列表；
   - 弹窗头部、标题、关闭按钮和底部保存按钮永远钉死在视口可见区域内，彻底杜绝任何越界遮挡！

## Alternatives considered

- **仅缩小分段控件字号或允许文字折行**：
  - *最强理由*：改动最小，不需要调整 DOM 层次结构。
  - *为何被否*：在 260px 的卡片宽度下，左右并排无论怎么缩字号都会在窄屏下被挤爆；分段控件作为核心交互原语，必须拥有充裕的整行宽度。
- **将渠道健康监控做成顶部全局 Tab**：
  - *最强理由*：在最顶层做模式切换，层级最彻底。
  - *为何被否*：顶部已有全局保存、放弃与开关控制，再加一级全页面 Tab 会加深层级并破坏现有的左右 Master-Detail 工作台流线；侧栏底部固底属于主流控制台经典模式（如 VSCode / 云控制台），心智负担最低。

## Consequences

- 收益：
  - 全面消灭文字竖排溢出、8px 隐形点、操作按钮不齐等视觉残疾；
  - 侧边栏职责清晰，业务配置与系统运维各归其位；
  - 文案彻底产品化，消除用户顾虑与技术借口；
- 代价：
  - 侧边栏底部占用了约 70px 的固定高度，中间 Profiles 列表的可视高度略微减少（通过滚动条支持无限长列表）。
- 验证：
  - `node --check packages/dsh-model-router/src/client.js`：语法与深层括号配平全绿；
  - `node packages/dsh-model-router/tests/client-controller.mjs`：21/21 通过（含工作台结构回归 + 弹窗视口约束守卫）；
  - `node packages/dsh-model-router/tests/unit.mjs`：35/35 通过；
  - `node packages/dsh-model-router/tests/run.mjs`：12/12 真实 Loader 组合测试通过；
  - `npx tsc --noEmit`：0 错误；
  - DSH 源码树（`D:\sudy\github\deepseek-harness`）：严格 0 修改。

## 审查发现与修复（2026-10-15 收尾复查）

用户追问「自定义也必须设置里已配置，那何必手填？」后做了一轮完整审查，抓到 5 个自己引入的问题：

1. **DSH 原生接口已覆盖全部已配置模型**：`ctx.remote.session.modelCatalog()`（`session-controller/src/catalog.ts` 的 `buildModelCatalog`）就是 DSH 对话框模型切换器本身使用的接口，按 provider 分组返回 Settings → Models 里登记过的每个模型。所谓「手动输入」只对「网关提供、但用户没登记到 DSH」的透传模型有意义，却被做成了并列主按钮，制造了重复感。修法：主界面只留一个 `[+ 添加候选渠道]`，弹窗内用 Tab 区分「已配置目录直接勾选」与「自定义 Model ID」，并把引导文案改成「上一个 Tab 已列出您登记过的全部模型」。
2. **空态文案张冠李戴**：合并弹窗的目录 Tab 在无模型时复用了 `noUnconfiguredModels`（「所有已目录模型都已配置规则」）——那是新建 Profile 弹窗的语义，放在「加候选」语境下是错的。改为专用 `addCandidateEmpty`。
3. **死代码一批**：`onOpenManual` action、`modal.kind === 'manual'` 分支、`ManualChannelModal` / `CatalogPickerModal` 两个只剩转发的壳、`onOpenManual` prop 穿线、`catalogLoading` 死 prop、字典键 `addFromCatalog` / `addManual` / `manualModalTitle` / `catalogModalTitle`、样式 `signalDotBtn` / `iconBtnDisabled`、CSS 规则 `.dsh-router-manual-btn:hover`。两个 modal kind 合并为单一 `'add-candidate'`。
4. **一条 CSS 选择器从未生效**：`.dsh-router-need-control [class*="SegmentedTabs"]` 猜了组件名，而 DSH 的 CSS modules 模式是 `[hash]_[local]`（`packages/client/tsdown.client.ts:562`），生成的类名是 `<hash>_tabs`——选择器永远匹配不上。改用 `role="tablist"` / `role="tab"` 这类不依赖哈希的稳定钩子，并去掉会与内联 `gridTemplateColumns` 打架的 `display: flex` 覆盖（防折行只靠 `white-space: nowrap`）。
5. **弹窗视口约束没有回归守卫**：本次修复完全建立在「`className` 钩子 + `ROUTER_CSS` 规则」这一对前提上，任何一侧被后人删掉都会静默恢复「标题被顶出屏幕」的故障。新增 `client-controller.mjs` 守卫 `every plugin dialog is capped to the viewport and scrolls inside itself`，并对「把 `max-height: 84vh` 改成 `none`」的形态实测报红后复原。

遗留未决：本次修复未经浏览器实测——隔离 `.dshhome-view`（端口 3395）可正常起服务并从 `/plugins/??dsh-model-router/client.js&rev=...` 取到最新代码（已逐字符串核对），但 Chrome MCP 端到端超不可用，无法量测真实盒模型。弹窗约束的机制侧证据（`!important` 对无 `!important` 的 `.dialog` 必胜、`Modal.tsx` 确实把 `className` 合并到 dialog 元素、`ROUTER_CSS` 已随 bundle 下发）已齐，真实渲染待浏览器恢复后补测。

## 第二轮审查（2026-10-15，用户实测截图后）

用户实测又报三处，全部修复并补了浏览器量测：

1. **「+ 添加候选渠道」出现两个加号**：字典值自带 `'+ '` 前缀，渲染时又前置了一个 `ICON_PLUS`——与记忆中「需求按钮标签双齿轮」是同一类错误（图标与文案各写一份）。修法：字典只留文字，图标归渲染侧。实测按钮 `textContent` 为「添加候选渠道」、`querySelectorAll('svg').length === 1`。
2. **侧栏「模型路由」与「设置」两行不垂直居中**：根因是这一行的几何完全由占位者自己负责——DSH 的 `SidebarFooterActionOwnerProps` 只有 `wide` 一个字段（`ui-sidebar/src/client/contract/slots.ts:108`），`SidebarRoot.module.css:572-589` 明确写「Each occupant owns its button geometry」。而我此前拍的是 `height: 38 / fontSize: 13.5 / margin: 0`，DSH 自己的设置行是 `.trigger`（`ui-settings-general/src/client/SettingsRoot.module.css:16-36`）：`height: 42 / fontSize: 14 / lineHeight: 22 / padding: 0 10px 0 8px`，外层 `.triggerRow` 还用 `margin: 4px -2px; width: calc(100% + 4px)` 让悬浮底色与上方导航行对齐。修法：照抄这套数字（含 -2px 出血与 rail 态 `margin: 8px 0 10px`）。**浏览器实测两行均为 x=10 / w=260 / h=42，字号、行高、内边距、圆角逐项相同**，间距 8px（= 我方 4px 下外边距 + 设置行 4px 上外边距，符合 DSH「additive actions stack above Settings」的节奏）。
3. **熔断规则编辑有 stale closure，快速连点会静默吞规则**：`setRules(rules.concat(...))` / `patchRule` 读的是渲染期闭包里的 `rules`，React 批处理下同一 tick 内的多次点击都往同一个数组上追加、最后一次写入覆盖前几次——用户明明看到规则出现了，保存时却少几条。四个写入点（预设 chip、添加规则、patchRule、删除）全部改为 `setRules(current => ...)` 更新器形式。复现方式：同步连点 8 次只进 1 条；改为逐次 `await sleep(120)` 后 10 条全进。新增回归测试 `breaker rule mutations go through the state updater, not the closure`，并对重新引入闭包写入的形态实测报红（21 passed + 1 FAIL）后复原。

**浏览器实测（隔离 `.dshhome-web`，端口 3396，Chrome MCP）**：
- 侧栏两行几何逐项相同（见上）；
- 健康设置弹窗 10 条熔断规则的最坏情况：内容 `scrollHeight 1179px`，插件内层滚动容器 `max-height: 500px` 且 `scrolls: true`，弹窗总高 660px、`top 110 / bottom 770`，视口高 880，标题栏 `top 110` 可见、底栏 `bottom 750` 可见，`fullyInsideViewport: true`——内容再多也只在弹窗内部滚动，标题与操作栏不会飞出屏幕；
- 默认档位（熔断关闭）弹窗高 601px，body 无需滚动即完整呈现。
