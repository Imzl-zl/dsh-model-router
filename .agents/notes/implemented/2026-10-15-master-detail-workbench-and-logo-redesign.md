# Agent Note: 控制台 Master-Detail 左右分栏工作台重构与星轨枢纽矢量 Logo 升级

Status: implemented

## Problem

近期功能扩展（双引擎渠道遥测、24 柱 Sparkline 时间轴、条件/识图路由、断路器规则）后，原有的控制台遭遇严重布局瓶颈与审美缺陷：
1. **上下嵌套单页的视觉压迫与心智负担**：
   - 原界面在顶部水平陈列模型规则（Profile）的 SegmentedTabs，下方卡片内又嵌套第二排流水线/策略/遥测 Sub-tabs，两排横向选项卡上下叠放。
   - 当用户配置 3~5 个以上模型时，顶部水平选项卡横向挤满换行或溢出；切换模型时整屏重刷，用户无法建立全局总览感（Master Overview），反复滚动寻找，操作体验极度别扭。
2. **全局默认兜底（Default Pool）层级模糊**：
   - 默认兜底混在顶部横向 Tab 末尾，其“未配置模型的保底网关”地位与单模型 Profile 混为一谈，用户不易察觉与区分。
3. **Logo 视觉粗糙单薄**：
   - 原 `icon.svg` 仅为 3 个细空心圆与 2 根折线，缺乏专业现代云原生网关质感与辨识度。

## Decision

1. **全面转向 Master-Detail（左右分栏）控制台架构**：
   - **左侧专享导航栏 (`masterSidebar`，宽 260px)**：
     - *顶栏搜索与快创*：集成即时模型/渠道模糊搜索输入框（`searchBox`）与高亮新建规则主操作按钮（`sidebarAddBtn`）。
     - *常驻置顶默认兜底池*：将 `🌐 全局默认兜底` 单独固定置顶，以特殊微背景（`navItemDefault`）与启用状态徽章（`navStatusActive`）直观呈现其全局保底地位，与下方模型列表以分割线清晰解耦。
     - *垂直模型规则卡片*：清晰呈现主模型 ID、Provider 徽标、候选数、健康微点与多模态/识图标签；选中态赋予主强调色（`--dsh-router-accent`）边框与微发光背景。
   - **右侧专享流水线工作区 (`detailWorkspace`，flex: 1 撑满)**：
     - *工作区专属 Header*：展示当前主模型名称、Provider 标签、`接管中` 状态胶囊，并将“删除此规则”按钮优雅收进顶栏右侧，彻底摆脱次级导航栏挤占。若是全局默认兜底，则在顶栏集成接管总开关。
     - *高内聚三视窗切换*：保留清晰聚焦的 `🔄 降级流水线`、`⚡ 异常策略与预算`、`📊 渠道遥测与监控` 单层 Sub-tabs，彻底消除“双层横向 Tab 上下堆叠”现象。
     - *流水线拓扑连贯感*：候选人卡片通过向下连接器与流向箭头串接，直观表达主备降级顺序。
2. **升级矢量 Logo 为【星轨枢纽 · Nexus Mesh】（方案 A）**：
   - 构图：六边形外框（高可用韧性防护 Shield）+ 中心微发光路由决策核（Nexus Core）+ 三向动态流光轨道（Signal Pathways）与各候选端点。
   - 渐变色：DeepSeek 品牌蓝（`#4A65E8`）渐变过渡至科技深蓝（`#3B82F6`）与青色（`#06B6D4`）。
   - 兼容性：SVG 矢量化原生兼容 16px（侧栏/状态点）、24px（弹窗顶栏）、36px（插件包徽标）、48px（独立展示）；支持禁用灰度与暗色/亮色自适应。

## Alternatives considered

1. **继续在原有上下结构上微调间距或缩窄 Tab**
   - 被否原因：治标不治本，双层横向选项卡与长垂直滚动的根本心智缺陷未变，无法适应多模型场景。
2. **采用多面板四宫格平铺式布局**
   - 被否原因：信息密度过度破碎，在 1000px 弹窗或小屏视口下容易被严重挤压。

## Consequences

- 收益：
  - 彻底终结了“上下堆叠、双排水平 Tab”的别扭排版，操作路径清晰符合直觉（左选目标、右配流水线）；
  - 全局兜底与专属 Profile 关系一目了然，搜索框支持海量模型规则秒级定位；
  - 界面呈现出云原生大模型网关（如 Portkey / LiteLLM）的专业质感；
  - 现代矢量 Logo 大幅提升产品形象。
- 验证：
  - `node --check packages/dsh-model-router/src/client.js`：AST 语法 0 错误；
  - `node packages/dsh-model-router/tests/client-controller.mjs`：14/14 单元测试通过；
  - `node packages/dsh-model-router/tests/unit.mjs`：66/66 单元测试通过；
  - `node packages/dsh-model-router/tests/run.mjs`：12/12 真实 Loader 组合测试通过；
  - `tsc --noEmit`：类型校验 0 错误；
  - DSH 参考仓库（`D:\sudy\github\deepseek-harness`）：严格 0 修改（只读）。
