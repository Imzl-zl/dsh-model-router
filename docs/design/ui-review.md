---
title: "DSH Model Router — UI 现状审查与问题清单"
status: "open"
kind: "ui-review"
last_updated: "2026-10-18"
---

# DSH Model Router — UI 现状审查与问题清单

## 摘要

本页记录对**当前实现**（不是 [`ui-design.md`](ui-design.md) 那份 2026-10-12 提案）的完整审查结论：现状长什么样、问题在哪、按什么优先级处理、哪些判断已被源码推翻。

- **事实部分**（§一 架构、§二 控件清单）全部来自源码，标注了文件与行号；改动 UI 前先读这两节，不要按 `ui-design.md` 的旧版面想象。
- **问题部分**（§三）每条标 P0/P1/P2，P0 = 用户找不到或走到错的地方，P1 = 主操作不在视口，P2 = 密度与文案。
- **§四 是已撤回的判断**，保留下来是为了不再重开同一场讨论。

事实与方案分开：本页只写「现在怎样」和「建议怎样」。任一条实施后，把「现在怎样」回写进本页并更新 `ui-design.md` 的对应小节，取舍理由进 `.agents/notes/`。

---

## 一、当前的界面架构（与 `ui-design.md` 已不一致）

`ui-design.md` 描写的是插件页（`plugins.bundle.config`）里的配置面板。**那个形态已被删除**，当前只有一个载体。

```
侧栏 footer 按钮（sidebar.footer.action，order 120）
  └─ DSH Modal（headless，shortcutModal: 'model-router'）
       ├─ 顶栏：Logo + 「模型路由控制中心」+ 启用/暂停 + 未保存 + 保存失败
       │        + [放弃]（仅在 dirty 时出现）+ [保存 + Ctrl+S kbd] + [关闭]
       └─ RouterPage（工作台）
            ├─ 校验问题条（problems > 0 时）
            ├─ 左栏 260px：搜索 + [+] → 🌐 全局默认兜底 → 模型规则列表 → 底栏「渠道健康监控」
            └─ 右栏：ChainView（普通 Profile / 默认池） 或 GlobalHealthWorkspace（健康模式）
```

| 事实 | 依据 |
|---|---|
| 唯一挂载点是 `sidebar.footer.action`，`plugins.bundle.config` 已删除 | `src/client/apply.ts:187-203` |
| 弹窗是 DSH `Modal` 的 `headless` 形态，顶栏由插件自绘 | `src/client/footer.ts:37-84` |
| 弹窗内用 `SettingsForm` 提供 available/writable/dirty/saving 状态机 | `src/client/page.ts:157-175` |
| `SettingsForm` 的 footer 被 `hidden`+`inert` 压掉，避免出现第二个保存按钮并保住 Tab 圈禁 | `src/client/page.ts:99-137` |
| `Ctrl+S` / `⌘S` 走 DSH 原生 shortcuts 服务，只在工作台打开时认领 | `src/client/apply.ts:118-145` |
| 高度链：`modalContentArea → modalRoot → workbench → detailWorkspace → workspaceScroll`，插件内禁 `calc(100vh` | `src/client/styles.ts:384-425`、`709-737`，`memory.md` 2026-10-16 条 |

**副作用**：DSH 设置页固有的「吸顶头 + 页脚保存行」两段都不存在。用户能看见的保存入口只有顶栏那一个（见 P1-1）。

---

## 二、控件与布局现状清单

### 2.1 导航与页头

| 元素 | 实现 | 位置 |
|---|---|---|
| 侧栏 | 宽 260 / min 240，`flex-start` 内容高度，`maxHeight:100%`；列表 `flex: 0 1 auto` 防止把健康入口推到底部 | `styles.ts:406-488` |
| 侧栏项 | `role="button"` + `tabIndex=0` + Enter/Space 键处理；标题、健康微点、候选数、provider 标签、🖼️ 标签 | `page.ts:243-269` |
| 健康入口 | `sidebarFooter` 有 `borderTop` + `layer-2` 底，是独立分区；状态文案随最差状态变化 | `page.ts:272-295` |
| 页头卡 | 头像 + 模型名 + `● 接管中` + provider 徽标 + 候选数 + 描述；右侧删除按钮或默认池开关 | `chain.ts:43-73` |
| 子 Tab | `SegmentedTabs`：`候选链路与调度` / `异常策略与预算` | `chain.ts:86-92` |

### 2.2 候选链（`pipeline.ts`）

| 元素 | 实现 | 行号 |
|---|---|---|
| 策略行 | `SegmentedTabs`：`order` / `weight` / `round-robin` + 每个策略一句 hint | 467-476 |
| Primary 节点 | `★` 序号 + `👑 用户默认首选` + 锁定徽标 + 上移/移除禁用 | 15-33、126-131 |
| 备用节点 | `01/02…` 序号 + 拖拽手柄 + 上移/下移/删除三键组 | 46-159 |
| 节点内控件 | 单渠道尝试次数 stepper（1~5）、权重输入（仅 weight 策略）、`⚙️ 高级路由条件` | 82-125 |
| 条件面板 | 图片三态 `SegmentedTabs`（不限/仅带图/仅无图）+ 最小上下文令牌数 | 160-197 |
| 流转指示 | `▼` 箭头 + `若主渠道失败自动切换至备用 #n` | 260-269 |
| 策略汇总卡 | 「单请求最多总尝试 n 次」+ 跳到策略 Tab | 454-465 |
| 添加候选 | 页底 `addBar`（`marginLeft: 48`），或链路为空时的空态按钮 | 374-384、140-147 |

### 2.3 策略页（`pipeline.ts` 的 `SwitchOnGrid` / `BudgetRow`）

- 6 张触发策略卡片（`repeat(auto-fit, minmax(260px,1fr))`）：中文业务名 + 错误码 Badge + 一行场景说明。
- 常驻安全说明卡（`safetyBox`）：不可重试错误直接抛出。
- 预算网格：单请求最多总尝试次数、**识图粘滞（无图轮）**、退避（只读说明）。

### 2.4 健康工作台（`workspace.ts` / `health-ui.ts`）

| 元素 | 实现 | 行号 |
|---|---|---|
| 页头工具组 | 检查连通性 / 测速 / 健康设置 / 故障转移历史 四个幽灵按钮 | `workspace.ts:171-202` |
| 运行总结行 | 上一次运行的分桶计数，保留到下一次运行 | 206-217 |
| 筛选 | 全部 / 正常 / 异常 / 未调用 四档药丸 + 搜索框 | 220-255 |
| 渠道卡 | 状态点 + provider + model + 状态药丸（含可用率）+ 探测徽标 + 用途徽标 + 两个行内按钮 + 指标仪表盘 | 279-357 |
| 跳转 | `focusRoute` 对象化，点击候选节点信号灯跳到健康卡并滚动高亮 | `health-ui.ts:85-109`、`workspace.ts:74-80` |

### 2.5 弹窗与抽屉（`modals.ts` / `pipeline.ts`）

| 弹窗 | 内容 | 入口 |
|---|---|---|
| 健康设置 | 2 个 Tab：巡检与测速探测（被动观测 / 连通性 / 测速 / 逐路由探测内容）与熔断规则（预设 chip + 规则行） | 健康页工具组第 3 个 |
| 新建 Profile | 目标模型下拉（含手填项）+ 候选链模板下拉 | 侧栏 `+` |
| 添加候选 | 2 个 Tab：目录多选（勾选 + 搜索）与手动输入（provider 下拉 + model 输入 + datalist + 尝试次数） | 页底 / 空态 |
| 删除确认 | DSH `RiskConfirmation`，需勾选才能确认 | 页头卡删除键 |
| 故障转移历史 | body-portal 抽屉，接 `useModalLayer`，最近 20 个会话 | 健康页工具组第 4 个 |

### 2.6 按钮与控件的视觉变体（`styles.ts`）

现有变体已经不少，且在尺寸/圆角上不统一：

| 变体 | 高度 | 圆角 | 用途 |
|---|---|---|---|
| `sidebarAddBtn` | 30 | 6 | 侧栏新建 |
| `catalogBtn` | 34（局部覆盖成 36/32） | 8 | 添加候选 |
| `manualBtn` | 34 | 8 | 虚线次要按钮 |
| `addProfileBtn` | 30 | 8 | 虚线次要按钮（与 `manualBtn` 近似重复） |
| `dangerBtn` | 28 | 8 | 删除 Profile（红字透明底） |
| `iconBtn` | 32 | 8 | 弹窗关闭 |
| `actionBtn` | 26 | 6 | 节点行内三键 |
| `stepperBtn` | 24 | 6 | 尝试次数加减 |
| `chipBtn` | 26 | 8 | 熔断码预设 |
| `filterPill` | 由 padding 决定 | 8 | 健康筛选 |

`catalogBtn` 在 `chain.ts:144` 与 `pipeline.ts:381` 被 `Object.assign` 覆盖成两套不同尺寸，同一视觉角色有两种外观。

---

## 三、问题清单

### P0：功能藏错位置，等于不存在

**P0-1 `stickyTurns` 放错了页签。** ✅ **已处理（2026-10-18）**
它属于识图路由的语义（带图轮之后继续按有图路由的轮数），原先渲染在 `policies` 页签的 `BudgetRow` 里，与「单请求最多总尝试次数」并列。图片条件本身在另一个页签的节点折叠面板里，用户在条件旁边永远找不到它。
**已改为**：渲染进 `needImages` 卡片内，仅 `imagesMode === 'require'` 时出现（与你确认的口径一致）；`BudgetRow` 与 `chain.ts` 的 `policies` 分支不再传 `stickyTurns`。标题改为「识图粘滞」，hint 开头补「选『仅带图』后生效」。

**P0-2 识图路由没有任何「已配置」的可见信号。** ✅ **已处理（2026-10-18）**
全链路原先只靠节点按钮文本 `⚙️ ● 高级路由条件` 和侧栏一个 🖼️ 表达。页头卡不体现，用户配完回来也看不出这条链有识图路由。
**已改为**：页头卡在存在带图片条件的候选时渲染可点的 `🖼️ 识图路由` 徽标（accent 系，与 P2-4 同一纪律），点击切到候选链页签并展开第一个配了图片条件的节点；再点一次收起。`ChainView` 用序号而非布尔持有聚焦目标（`imageFocus`），节点通过 `useEffect` 单向跟随，不接管用户之后的开关；切换 Profile 时清空，避免同序号在新链上误展开。

**P0-3 健康页只能跳进去，跳不回来。** ✅ **已处理（2026-10-18）**
候选节点 → 健康卡是通的（`focusRoute`），反方向只有静态的 `channelUsageBadge` 文本。而 `usages` 里已经存了 `name`（profile id），跳回能力现成但没有接线。
**已改为**：用途徽标改成按钮（`channelUsageBadgeButton`，默认外观与静态徽标一致，只加 `cursor: pointer`，避免一屏文本里突然出现一排按钮），点击调 `props.onJumpProfile(u.name)` 回到对应条目；`__default__` 回到默认兜底池。跳转前清掉 `focusRoute`，否则回到链视图后残留的上次高亮会误导。

### P1：主操作不在用户的视口里

**P1-1 唯一的保存入口在顶栏，编辑区在几百像素之下。** ✅ **已处理（2026-10-18）**
底栏被压掉是正确的（Tab 圈禁根因见 `page.ts:99-137`，不要回退），代价是改完中部节点的数字后要滚回屏幕顶端。
**已改为**：`ChainView` 底部新增 `dirtyBar`，只在 `dirty && !saving` 时出现，含「有未保存的修改」+ 放弃 / 保存两个按钮。它复用顶栏那一对 `onSave` / `onDiscard`，不新增状态源；`invalid` 时保存按钮同样禁用。

**P1-2 删除与添加的视觉权重倒置。** ✅ **已处理（2026-10-18）**
`删除此规则` 原先是 `dangerBtn`，直接摆在页头卡右侧、与候选数同一行；而「添加候选」在整页最底部。
**已改为**：删除移入 `policies` 页签底部的 `dangerZone`（红色 28% 描边 + 5% 淡底 + 标题与说明），页头卡右端只留默认池开关；二次确认仍由 `RiskConfirmation` 承担。

### P2：密度、文案与一致性

**P2-1 同一个候选数，两种含义。** ✅ **已处理（2026-10-18）**
侧栏与页头卡都用 `candidateCountTag`，但传的是 `candidates.length - 1`（减掉钉死的 primary）；`__default__` 视图传的是 `candidates.length`。同一个词条一个减一一个不减，页面没有解释这个减一。
**已改为**：词条统一为 `{n} 条备用` / `{n} fallback candidates`。两个视图的**计数口径不变**——Profile 仍是「扣掉 primary 后的备用数」，默认池没有 primary、全部候选都是备用池成员，所以仍是全长；变的是词条含义，不再是含糊的「候选」。

**P2-2 右侧纵向有四个标题层在说同一件事。** ✅ **已处理（2026-10-18）**
`workspaceHeaderCard`（模型名 / provider / 候选数 / 接管中 / 描述）→ `sectionTitle` → `primaryTargetSection` → `fallbackChainSection`。
**已改为**：删掉页头卡里的描述句（`workspacePrimaryHint` / `workspaceDefaultHint`），并删除这两个已无引用的字典键。节点区的 `primaryTargetHint` 与默认池的 `introBox` 已经说过同一件事。`primaryTargetSection` / `fallbackChainSection` 两个 section 标题**保留**——它们是节点区自己的分组标题，与节点上的 `★` 序号承担不同职责（分组 vs 顺位）。

**P2-3 页头卡与子 Tab 的间距分层不合理。** ✅ **已处理（2026-10-18）**
`detailWorkspace` 的 `gap: 16` 加 `subNavBar` 的 `marginBottom: 16`，两块是同层级信息却隔得最远，滚动区晚 30px 开始。
**已改为**：`gap: 10`、`marginBottom: 10`。

**P2-4 `接管中` 徽标借用了健康色。** ✅ **已处理（2026-10-18）**
页头卡的活动徽标写死 `healthToneBadge('healthy')`，把「规则生效」和「渠道健康」压到同一个绿色上。
**已改为**：新增 `workspaceStatePill`（accent 文字 + 10% accent 底 + 22% accent 边），页头卡的 Profile 活动徽标、默认池启用徽标、侧栏默认池条目三处一起换掉；`chain.ts` 不再导入 `healthToneBadge`。绿色只留给真正的健康状态（侧栏「全部正常」、节点信号灯、渠道卡状态药丸不变）。

**P2-5 健康设置弹窗塞了四块内容。** ✅ **已处理（2026-10-18）**
四个 Tier（被动观测 / 连通性巡检 / 测速探测 / 熔断）+ 逐路由探测内容覆盖，用两个 Tab 切；熔断规则表是长期配置，探测内容覆盖是一次性调优。
**已改为**（按你选的方案：同弹窗内保留两个 Tab，只把规则行编辑器收进独立弹窗）：主弹窗的熔断 Tab 现在只有开关、规则摘要（「已配置 N 条规则」/「尚未配置任何规则」）和「管理规则」按钮；逐条编辑（码 / 消息 / 冷却 / 范围 / 删除 + 预设 chips + 添加）移入新的 `BreakerRulesModal`。规则状态仍由主弹窗持有，子弹窗只拿到当前值与 `setRules`，不存副本；子弹窗是独立的 DSH `Modal`，层级、Escape 归属与焦点圈禁由 DSH modal 层仲裁。

**P2-6 按钮变体尺寸不统一。** ✅ **已处理（2026-10-18）**
`catalogBtn` 被两处 `Object.assign` 覆盖成 36 与 32 两套；`manualBtn` 与 `addProfileBtn` 近乎重复。
**已改为**：新增 `catalogBtnLg`（36）与 `catalogBtnSm`（32）两个命名档位，调用点只选档、不再就地改尺寸；删除已无引用的 `addProfileBtn` 与 `catalogBtn`。`dangerBtn`（28）与 `iconBtn`（32）保留——它们承担不同角色（文字危险操作 / 纯图标），不在同一档位体系里。

**P2-7 策略卡片区的文字密度。** ✅ **已处理（2026-10-18，第三批补）**
6 张卡片各带一句场景说明，下方还有常驻安全说明卡，用户打开这个页签的真实任务是「该勾哪几个」，却要先读 8 行字。
**已改为**：卡片区上方加一行实时摘要（`triggerSummary`）：`已勾选 N / 6 类异常：只有勾选的异常会切换备用渠道`。勾选状态变化时数字当场更新；一张都没勾时图标换成警告色，提示这条路不会切换。6 张卡片本身不动。

---

## 四、已撤回的判断（不再重开）

| 判断 | 撤回原因 |
|---|---|
| 「`activeBadge` 所有 Profile 都显示已激活，等于没有信息」 | 词条是 `'接管中'`（`locales.ts:25`），语义是规则生效中，不是冗余。真问题是借色（改为 P2-4） |
| 「侧栏中部有空区、健康入口像列表的一部分」 | `sidebarFooter` 有 `borderTop` + `layer-2` 底（`styles.ts:646-652`），分区清楚；`workbench` 的 `alignItems: 'flex-start'` 让侧栏按内容高度收缩，不存在把入口推到底部的问题 |
| 「保存按钮在顶栏是缺陷」 | 压掉 `SettingsForm` 底栏是为了抢回 Tab 圈禁（`display:none` 压掉的底栏会成为 DSH 焦点列表的最后一项，见 `memory.md` 2026-10-16 条）。结构正确，只有可发现性问题（改为 P1-1） |

---

## 五、处理顺序

1. ✅ **第一批（2026-10-18）**：P0-1 `stickyTurns` 归位、P2-1 候选数措辞、P2-3 间距、P2-4 活动徽标改色。只动渲染层。
2. ✅ **第二批（2026-10-18）**：P0-2 识图路由徽标、P0-3 用途徽标跳回、P1-1 粘性保存条。
3. ✅ **第三批（2026-10-18）**：P1-2 删除降权、P2-2 标题层收拢、P2-6 按钮档位收敛、P2-5 熔断规则编辑器拆成独立弹窗、P2-7 策略摘要行。

**清单已全部关闭。**

**验证（第二、三批之后复跑）**：`npm run bundle` 通过（含 `tsc -p tsconfig.json`）、组合测试 **21 场景 0 失败**、client-controller **46 条通过**。

**过程中被测试挡下的两处真实回归**（记录在此，避免以后重犯）：重构 `BreakerRulesModal` 时一度把规则写入改成读渲染期闭包的 `props.onChange(rules.concat(...))`，且没有把 `disabled` 透传给子弹窗——`client-controller` 的两条守卫用例当场打红。前者正是同 tick 双击丢规则的那个 bug，后者会让只读/保存中的熔断范围控件仍可点。两处都已改回更新器形式并补齐 `disabled`。

---

## 六、浏览器实测（2026-10-19）

隔离 home（`.dshhome-view`，端口 3395，带 token URL）实测，12 条逐条点过：

| 项 | 实测结果 |
|---|---|
| P0-1 | 「不限」态下 `识图粘滞` 不渲染；切「仅带图」当场出现，hint 文案正确 |
| P0-2 | 页头徽标出现并可点；收起节点后点徽标能重新展开；`aria-pressed` 跟随 |
| P0-3 | 点「全局兜底 #2」跳回默认池、侧栏高亮正确；用途徽标确为按钮 |
| P1-1 | 改 stepper 后底部保存条出现；点它保存成功，`cordis.patch.yml` 的 `maxAttempts` 2→3 落盘 |
| P1-2 | 页头无删除键；删除位于策略页底部危险区 |
| P2-1 / P2-2 | 页头与侧栏均显示「2 条备用」；描述句已消失 |
| P2-5 | 熔断 Tab 只剩开关+「已配置 2 条规则」+管理规则；子弹窗独立打开，2 条规则与预设 chips 正常；**Escape 只关最上层子弹窗**，健康设置与主弹窗保留 |
| P2-6 / P2-7 | 按钮档位生效；摘要行显示「已勾选 6 / 8 类异常」 |

**实测发现的新缺陷（已修）**：三处配置状态徽标把 accent 当文字色，深色主题下 `● 接管中` 2.61:1、`🖼️ 识图路由` 2.66:1、`主模型固定首位` 3.01:1，低于 AA 4.5:1。已改为 `accentBadge()`（accent 只做底与边、文字 `label-primary`），深色 **11.94:1** / 浅色 **16.18:1**。取舍见 `.agents/notes/implemented/2026-10-19-browser-verification-and-accent-contrast.md`。

**同轮补完（非徽标的 accent 文字）**：另四处 accent 文字同样低于 AA——`primaryCardTitle`、`policySummaryBtn`、`guideToggleBtn`、`needsBtnActive`。它们不该改成 `label-primary`（会抹掉强调层级），改为新增按主题解析的 `--dsh-router-accent-text`：浅色混 20% 黑、深色混 40% 白，比例由四个元素**实测背景**反推，落地后实测深色 5.37–5.78:1、浅色 6.19–6.85:1。

**同时修掉一个既有 bug**：`.dsh-router-add-profile-btn:hover` 把图标色设成 accent，而按钮底色就是 accent，悬停时加号 accent-on-accent 消失（1:1）。改为悬停压暗底色 12%，白字实测 5.96:1。抓手图标悬停色一并换成 `accent-text`。

**守卫**：`configuration-state badges…` 扩展为同时检查四处 `accent-text` 使用与两个主题的 token 定义；新增 `the sidebar add button keeps a visible glyph on hover`。两条都做过 revert 抽样（改坏即红）。
