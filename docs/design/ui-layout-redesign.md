---
title: "DSH Model Router — 工作台布局重构"
status: "implemented"
kind: "ui-design"
last_updated: "2026-10-20"
---

# 工作台布局重构

## 问题

当前工作台是一个 260px 内部侧栏 + 右侧工作区：只有「降级链路 / 渠道健康」两个一级视图，侧栏下方 80% 是空地，右侧被无谓挤窄；链路页里标题重复（面板头一次、链路头一次），首跳是虚线卡片、候选是卡片套卡片，空态同时出现两个「添加候选渠道」；健康设置弹窗高度随页签跳变，熔断规则藏在第二层子弹窗；故障转移历史是贴右边界的自建抽屉。2026-10-19 的 `implemented/workbench-top-navigation…` 笔记声称已修，但树里没有任何对应改动（`page.ts` 仍是 `<aside>`，测试还钉着这个类名），该笔记已删除。

## 原生契约（只读 checkout 核实）

| 契约 | 位置 | 取值 |
| --- | --- | --- |
| 主面板页 | `ui-plugin-manager/src/client/PluginManagerPage.module.css` `.page` | 全高 flex 列、`overflow:auto`、`padding: 0 clamp(24px,4vw,48px) 48px` |
| 居中列 | 同上 `.page > *` | `max-width: 960px` |
| 页头 | 同上 `.pageHead`；`ui-schedule/.../TaskManagerPage.module.css` `.pageHeading` | `padding-top:28px`、`flex-wrap`、`space-between`、`gap:16px`；h1 `20/28 500` |
| 分区 | 同上 `.detailSections` / `.detailSection` | 分区间 `gap:32px`；区内 `gap:12px`；标题 `14/20 500` |
| 列表行 | 同上 `.row` / `.rowLine` | `padding:12px 2px`、行间 `0.5px border-l2`、行内 `gap:16px` |
| 设置字段 | `ui-primitives/settings-form/fields.module.css` | 字段 `padding:12px 0`、label `13/500`、hint `12/1.5 tertiary`、输入高 34 |
| 弹窗 | `ui-primitives/Modal.tsx` + `.module.css` | 居中 portal，默认宽 380；`className` 定宽高、`contentClassName` 定滚动区；标题 `16/24 500`；底部按钮右对齐 |
| 页签/分段 | `ui-primitives/SegmentedTabs.tsx` / `SegmentedControl.tsx` | `items`/`options` 由调用方给，`label` 必填；tab 自带 `role="tab"` 与方向键 |
| 控件 | `ui-primitives` | `Button`(primary/ghost/outline/toolbar, md36/sm28)、`Tag`(outline/neutral/info/success/warning/danger)、`Checkbox`、`Input`、`StateDot`、`Switch` |

## 目标布局

```
main panel
└── .dsh-router-page           全高 flex 列；overflow-y:auto + scrollbar-gutter:stable，
                               padding:0 clamp(24,4vw,48)——水平留白与滚动条都属于它
    ├── .dsh-router-top        position:sticky; top:0；页头 + 页签的整体吸顶行
    │   ├── .dsh-router-head   padding-top:28; 左：h1 + 状态 Tag；右：接管 Switch
    │   └── .dsh-router-tabs   SegmentedTabs「降级链路 N」「渠道健康 N」
    ├── .dsh-router-content    960 列，随页面滚动
    │   └── 视图内容（下方）
    └── .dsh-router-footer     position:sticky; bottom:0；常驻：提示 + 放弃 + 保存
```

- **一条列，只写一次**：页头、页签、正文、保存条共用一条合并选择器（`width:100%; max-width:960px; margin:0 auto`），行内不许有水平 padding。页面自己滚动时，四条行和滚动条住在同一个容器里，左边界由构造决定而不是各算一份——此前把滚动区拆成兄弟节点，四行分别写 padding，实测页头/页签 442、页脚 394、正文 390。
- **唯一保存入口**：吸底且常驻的 footer 条，两个视图共用；面板头不再有保存/放弃/返回按钮。返回会话由侧栏的会话行承担（与 Plugins 面板一致，DSH 没有面板级返回按钮）。
- **一级导航**：`SegmentedTabs`，紧贴页头，与页头同处一个吸顶行，取代内部侧栏。
- **链路视图**（`chain`）：
  1. `第一跳` 分区：一行，闪电图标 + 「你当前选中的模型」+ 一句说明 + 失败后重试 stepper。实色行，不是虚线卡。
  2. `降级候选` 分区：分区头 = 标题 + 计数 + 右侧唯一的 `+ 添加候选`（primary, sm）。候选是扁平行：序号/拖拽柄、渠道显示名（目录里的 provider/model 名，原始键入 title）、健康胶囊、失败后重试、权重（仅 weight）、高级条件（`DisclosureRow`）、删除。空态是一句 tertiary 文案 + 同一个添加按钮，不再出现第二个。
  3. `失败切换` 分区：`Checkbox` 网格（DSH 原生控件），一行实时摘要。
  4. `重试与轮次` 分区：只读的最坏调用数摘要、粘滞轮数（`SegmentedControl`）+ 策略说明。
- **健康视图**（`health`）：
  1. 分区头：标题 + 观测说明 + 右侧工具组（检查全部 / 探测全部 / 设置 / 历史）。
  2. 汇总行 + 时间轴图例（tooltip 放细节）。
  3. 过滤（`SegmentedControl`：全部/健康/异常/未观测）+ 搜索（`Input`）。
  4. 渠道行：状态点 + provider + model + 状态胶囊 + 可用率；第二行 24 柱时间轴 + 延迟/吞吐；右侧检查/探测按钮。扁平行，不再每张卡套一层。
- **弹窗**：
  - 添加候选：`Modal` 宽 560、高 560，内容区滚动，底部取消/添加。
  - 健康设置：`Modal` 宽 560、高 560，四个分区顺序排列（运行时记录 / 连通性 / 探测 / 自动禁用），熔断规则直接内嵌，删除第二层子弹窗与页签跳变。
  - 故障转移历史：`Modal` 居中列表，删除自建右侧抽屉。
- **样式载体**：注入的 class 样式表承载布局与静态外观（沿用 DSH 的 token 与字号），内联样式只保留动态值（柱高、色调、宽度）。删除 1995 行 `S` 对象里只为旧结构存在的条目。

## 同步修的逻辑语义

1. `pendingAdvance` 的 advance/retry 混用：`decideRecovery` 在 llm-retry 放弃后只允许「有下一条候选 → 前进」，没有下一条就终态；删除 `canFireAgain` 这个把「本候选还有额度」当「还能发火」的谓词，末位候选不再盲打一次。
2. 旧配置迁移把 `candidates[0].maxAttempts`（调用次数）带进 `firstHopMaxRetries`（重试次数，`-1`）。
3. 组合测试改跑当前 `chain` 形状；`primary-success` 重写为真的会经过路由器的场景。
4. 检查/探测汇总文案进字典（英文界面不再出现中文标签）。
5. 默认值单源：`DEFAULT_MAX_TOTAL_ATTEMPTS` 只留一个（3）；删 `IMPLICIT_HOP_MAX_ATTEMPTS`；策略清单从 `defaults.ts` 出，客户端不再手抄。
6. probe 走 AbortSignal，卸载即取消（与连通性检查同契约）。

## 落地状态

已落地：页面壳（`page.ts`：页面自己滚动，页头与页签同处一个 sticky 行吸顶、保存条 sticky 吸底；保存条常驻，干净时显示"所有修改已保存"并禁用保存）、`panel.ts` 退成纯载体、链路视图五分区（起点策略在最前，随后第一跳、降级候选、失败切换、尝试预算；首跳实色行、候选扁平行、`Checkbox` 触发网格、预算用两列字段 + 计算式 + DSH 原生重试说明）、健康视图扁平行（无内层卡片，状态点 + Tag + 内联指标；过滤改 `SegmentedControl`；行内只放数据，图例/指标说明收进 tooltip，长副标题删除）、两个配置弹窗重写（原生 `Modal`、560×560 定高、内容区滚动、分区标题 + 右侧开关、熔断规则内嵌无第二层子弹窗）、故障转移历史改居中 `Modal`、`styles.ts` 从 1995 行清到 319 行且 `S` 对象整个删除。

**起点策略（2026-10-20 定案）**：第一跳永远是用户选中的模型、永远先试；`order` / `weight` / `round-robin` 只决定它失败后从哪条降级候选开始。`startStep` 保留链首、只旋转降级候选，`resolveStartIndex` 只收降级候选。被否方案是给首跳加一个可配权重——它把"我选了它就先用它"变成可被权重覆盖的默认值，且 UI 要多一个只对 weight 有意义的输入。

浏览器实测（2026-10-20，隔离 `.dshhome-view` + Chrome MCP，端口 3401）覆盖：固定/滚动分层、策略先行、添加候选按钮可见、保存条常驻、权重策略的校验提示、识图粘滞分段、尝试预算计算式、健康扁平行、两个弹窗与历史 Modal。证据与两处实测修复见
`.agents/notes/implemented/2026-10-19-recovery-rulings-and-page-shell.md`。

**列宽单源与分区头基线（2026-10-20 实测修）**：把滚动区并回 `.dsh-router-page` 后，四条行共享一条列规则——1468 视口下四行左边界均为 391.7、1000 视口下均为 96；滚到最大时 `.dsh-router-top` 的 `top` 恒为 0、`.dsh-router-footer` 的 `bottom` 恒等于视口高，`document.scrollingElement` 不滚动（没有第二根滚动条）。分区头 `align-items` 由 `center` 改为 DSH 自己的 `baseline`（`PluginManagerPage.module.css` `.sectionHead`），"降级候选 3" 的计数不再像上标。取舍见 `.agents/notes/implemented/2026-10-20-page-owns-the-column.md`。

字典与文档同步：删掉 82 个旧 UI 的键（zh/en 各 243 键、零重复、零缺失）；`product-plan.md` 的"只打一次"、旧 UI 表、"不做"表与 `open-questions.md` 的 `profiles`/primary 旧裁定已按现状更新。

未落地：无。

