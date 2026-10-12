# DSH Model Router 项目状态

> 当前状态快照 + 最近活跃窗口；决策理由见 `.agents/notes/`，稳定协作知识见 `tools.md`，设计现状见 `docs/`。

## 当前基线

- 仅包含 Markdown 设计提案与源码研究；无插件实现、自动化测试或构建脚本。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`；项目根：`D:\sudy\myproject\dsh-model-router`。
- 最后更新：2026-10-12（晚：九项产品决策关闭并落档）。
- 验证状态：17 个 Markdown 文件本地链接 0 失效；166 条 DSH 源码行号引用 0 越界；Phase 1 spike 实跑 exit 0。本轮新增引用未重新全量校验。

## 已完成能力

- 建立路由架构提案、源码地图、未决问题、实施阶段和官方先例对照。
- 新增[产品形态与配置面](docs/design/product-plan.md)：用户视角这是什么、能配什么、看得到什么、做不了什么、分期与待决项。
- 新增[DSH 能力边界](docs/design/dsh-capability-boundary.md)：分层记录 DSH 原生支持、不原生支持、每个缺口的最优雅补法、外置插件须遵守的社区规范。
- 确认 Agent 主请求的 route selection 位于 `agent/request`；失败恢复位于 `agent/request-error`。
- **修正 listener 次序方向**：waterfall 数组首个 listener 是最外层且其返回值即最终值；`await next()` 之后改写会覆盖内层。Router 必须 `prepend: true` 才能位于 `installModelSelection` 与三个 `agent/request-error` 消费者之外层。cordis.yml 书写顺序不决定 listener 次序。
- **确定 attempt lineage 持久化路径**：插件自有 `ctx.sessionProjections.register()` 折叠 `request/header` + `assistant/attempt` + `assistant/message`，零新增事件类型、零 plugin record。仓库外插件新增 durable 事件类型实际封闭（核心拒读非 `ignorable` 未知类型，`ignorable` 即 plugin record 信封且被 README 禁止仓库外调用）。
- **确定两层 attempt 边界**：第一层 Router 拥有"一个 step 最多用多少不同 route"（委派前判断）；第二层委派 `llm-retry`（同 route 重试）。总 worst case = `候选数 × (1 + maxRetries)`。`always` policy 在配置加载时拒绝。
- **确定条件路由三维度全部可达**：图片走 `agent/pre-step` 的 admitted 用户消息（`ImageBlock`，精确）；工具走 `system-prompt/assemble` 的 `assembly.tools`；上下文走 `tokenMeter` 的 `contextPressure` 投影（`projectedTokens`，估算且低估 CJK）。三者都跑在 route 决策之前，且重试不重跑，条件在一步内稳定。
- **确定尝试链无需插件绘制**：`ui-trajectory` 本就把 `assistant/attempt`、`llm/retry`、`request/header` 渲染成节点，带 `providerMetadata` 和 `details.lastAttemptError`。缺的只是"这几次是同一请求的备份链"这个关联，用一条 notice 补。
- **确定不路由辅助调用**：DSH 已自带——compaction 有 `summarizationProvider`/`summarizationModel` 和按模型分别指定的 `modelPolicies`；session-title 有 `provider`/`model`。且它们走未 prepare 的 `ctx.llm.stream()`，无 `agent/request-error` 可接，只能选路不能故障恢复。插件再做就是两处真相源。
- **Phase 1 spike 已实跑通过**（见下）。
- 记录透明故障转移的三个必然后果：一条 durable "model changed" notice（去不掉）、UI `next` 停留未兑现 pending、`request/header` 记 `reason: 'change'`。
- 补齐 DSH 社区规范清单（函数插件形态、`ctx.get`、真实 Loader 组合测试、Config/Volatile、branded id、诊断与日志规范等）。
- 完成 Markdown 本地链接与 DSH 源码锚点校验。
- **九项未决问题全部关闭并落档**（2026-10-12 晚）：`needs.tools` 砍掉（无机器可读元数据；运行时 failover 承接，`INVALID_REQUEST` 进 switchOn 默认不勾）；reasoningEffort 由 Router 在 `agent/request` 用 `resolveCallConfig` 预校验（`prepareCall` 抛错直接终态、不进 recovery，有测试断言）；遥测抽屉只留故障转移历史（`list`→`projections` 通路已核实）；canonical schema 定稿（`enabled` 总闸 + `profiles` 数组 + `default` 纯备用池）；primary 钉死；条件全不满足终态；校验分级（结构硬失败 / provider 缺失降级）。两条 decision note 落 `implemented/`。
- **DSH 能力元数据事实**：工具能力全仓库无机器可读来源（`LlmModelInfo` 仅 `inputModalities`；pi-ai SDK `Model` 接口无；`normalizeModelInfo` 白名单重建）；reasoning efforts 可读，两个自带 adapter 的 `resolveModel` 均为内存快照（预校验零网络成本）。
- **投影读取通路**：`snapshot()` 唯一门槛是 wire；`@Remote('list')` 空请求可枚举会话且行带投影 hints；client 半包 `inject ['remote','remote.session']` 可直连 `projections`（guard 只查声明，`ui-settings-models` 同型先例）。
- **配置生命周期**：`fiber.update()` 先校验再 `restart()`（炸插件不炸 app）；DSH 插件校验范式 = zod schema + `apply()` 里 `validateConfig()`，**不存在 `Config.check()` 方法**。

## Phase 1 spike 实证结果（2026-10-12，`spike/`）

三次真实 boot（`dsh --profile headless --patch`，536 包安装约 2 分钟）。

**7.1 插件加载与 waterfall 可达性**：

```
apply
agent/request turn=1 step=1 resolved=deepseek-official/deepseek-flash
agent/request-error provider=deepseek-official code=RATE_LIMIT policy=normal
agent/request turn=1 step=1 resolved=deepseek-official/deepseek-flash
```

**7.2 Router 能否拿到最终 route 决策权（设计地基，已通过）**：同时注册 `deepseek-official` 与 `spike-backup`，`agent/request` 用 `prepend` 把前者换成后者：

```
agent/request  in =deepseek-official/deepseek-flash      ← installModelSelection 写回用户选择
agent/request  out=spike-backup/deepseek-flash (swapped) ← Router 覆盖
request/header    provider=spike-backup                  ← durable 记真实 route
assistant/message  provider=spike-backup served_by=spike-backup
```

已证实：仓库外插件可加载；`@deepseek-ai/dsh-llm` 单副本；**外层 listener 的 route 覆盖压过 `installModelSelection` 写回，且 durable 归因跟着真实 route**；`agent/request` 重试时再次触发且解析回同一条 route（Router 必须自持候选索引）；adapter 不声明 policy 时 llm-retry 仍以默认 normal `maxRetries=5` 重试。

**7.4 Router 注册在 llm-retry 内层，交接成立（本轮关键）**：`agent/request-error` 上把 listener 推迟到 `agent/created` 时注册到 `agent.ctx`，即位于三个插件加载期消费者（llm-retry、compaction-basic、compaction-image-offload）内层。实测 RATE_LIMIT 时该 listener **未**被调用（llm-retry 独占同 route 重试），AUTH 时被调用（llm-retry 放弃后 `next()` 交接），其 `{kind:'retry'}` 让 `agent/request` 第三次触发并成功。

**两个 waterfall 位置不对称**：`agent/request` 用 `prepend: true` 拿最外层；`agent/request-error` **不能用 prepend**，必须位于 llm-retry 内层——否则 llm-retry 放弃时 `next()` 直达终态，Router 永远等不到放弃信号。两层各有一个 owner，不复制退避逻辑。

**7.5 spike 坑**：stub 的调用计数器会被辅助调用吃掉（session-title 与主请求同 route），必须对 `options.purpose !== undefined` 直接成功，只让主请求参与失败脚本。

**7.7 外置插件可 append 自带 notice + 条件路由取数时机（本轮关键）**：`agent/pre-step` 在 `agent/request` **之前**触发且 `decision.messages` 可读（条件路由取数时机成立）；从 `agent/request-error` 里 append 自定义 `kind:'model-router'` + `form:'notice'` 的 `user/message` 完整落进 durable log，运行 exit 0 未被破坏。客户端渲染路径已由源码确认（`contextForm()` 只读 `form`，`KNOWN_FORMS` 含 `'notice'`；未知 kind 走 `default:{role:'inject',label:kind}`），**浏览器实际样式仍未实测**。

**技术可行性到此没有剩余未知量；剩下的是产品决策与实现。**

运行陷阱：`.sessions` 相对进程 cwd 落地（运行器须 `Set-Location`）；`probe.log` 落在 `src/`；stub 要注册在 `deepseek-official`，因为 headless 的 provider 来自 `agentDefaultModel.currentSelection()` 而非 `agent-loop.agents`。

## 进行中

- **产品形态已定稿**，见[product-plan.md](docs/design/product-plan.md)：选项 A（透明物理故障转移）；范围只限 Agent 主请求；四个产品决定已定——条件路由进 Phase 2、第一版就要中文通知、`default.enabled` 默认关、辅助调用选路不做（DSH 已自带）。
- **配置界面：DSH 完全支持插件带 UI**（slot 系统 + SettingsForm 原语 + locale 字典 + form model + schema 自查询），但**没有"声明 Config 就自动出表单"**——每个插件自己写表单 JSX；连 Models 页那个最像生成的表单也是手写编辑器 + 读 schema 取选项/校验（`ProviderEditor` 按 `layoutOf(ns)` 在手写布局间选）。`.description()` 不会被任何客户端代码读取，标签必须来自插件自己的 locale 字典。客户端半包 factory 格式可手写不必搭 tsdown。
- **配置界面设计已定稿**，见[ui-design.md](docs/design/ui-design.md)，可视化模板 `spike/ui-mockup.html`。关键结论：① slot 用 `plugins.bundle.config`、key=bundle 包名、只渲染 `view:'page'` 且不传 form（跟随 cot-translation 同形态先例）；② 配置 ns = **bundle patch 行的 id**；③ `SettingsFormModel` 只有 text/number 两个规格工厂，**无 boolean、无 min/max、无列表原语**，自定义 `SettingsFieldSpec` 是官方范式；④ 布尔合规写法只有一条有先例的路——`Switch`/checkbox 原语 + 卡片控制器动作（绕过表单暂存）；⑤ 有序列表范式在 `ui-settings-models/ModelListEditor`（受控、整数组 onChange、按下标增删、**无排序控件**，排序须自造）；⑥ `form.edit` 只收文本，数组必须走整段 `set` path op；⑦ `SettingsForm.labels` 只有 6 个必填键，无 discard/saved/inherited；⑧ i18n gate 禁 JSX 文本/copy 属性/子表达式，文案全进 locales.ts。
- **两处待用户定已裁定**：排序用行内上移/下移（DSH 无拖拽先例）；多 profile 一屏一链（Profile Bar 标签切换）。
- 交付物尚未提交 Git；本仓库当前无任何 commit，全部文件为 untracked。
- **技术准入全绿**：引擎侧（route 决策权、两层 failover 交接、候选索引、中文通知、条件路由取数）与 UI 侧（配置表单真实渲染）均已实测。
- **下一步：Phase 1 开工**（有序备份链 + switchOn + 每候选次数 + 硬总上限 + 中文通知；条件路由与遥测抽屉进 Phase 2）。准入项：完整候选链 `runLoaderSmoke`、notice 浏览器样式、投影 fork/resume 一致性、设置页读投影组合覆盖、热卸载测试。
- 遗留保真度问题（spike 探针，正式实现要修）：`switchOn`/`takeOverOthers` 用了文本字段而非开关/复选框；`candidates`/`switchOn` 未注册进 `SettingsFormModel` specs，改动后保存按钮不变 enabled。
- 决策笔记状态：两篇 `proposed/`（lineage 走 session projection、两个 waterfall 位置不对称）+ 三篇 `implemented/`（外置插件已实跑验证、砍 needs.tools、reasoningEffort 预校验）。

## 仍需注意的坑点

- waterfall 数组首个 listener 是最外层、其返回值即最终值；`await next()` 之后改写覆盖内层。Router 必须 `prepend: true`。
- **`agent/request` 在重试时再次触发且解析回同一条 route**（`installModelSelection` 每次 attempt 写回用户选择）。Router 无法从 waterfall 推断当前候选，必须自持 per-(agent, turn, step) 索引。
- **adapter 不声明 policy 时 llm-retry 仍以默认 normal `maxRetries=5` 重试**。Router 不能假设"无 policy 就是不重试"。
- Agent step 循环 `while (true)` 没有 attempt 上限；总边界只能由 Router 的第一层提供，且必须覆盖 llm-retry 代跑的重试。
- 仓库外插件新增 durable 事件类型实际封闭；`appendPluginRecord()` 被 README 明确禁止仓库外调用。durable lineage 走插件自有 session projection。
- `agent/request-error` 已有三个消费者：`llm-retry`、`compaction-image-offload`（不花重试预算）、`compaction-basic`（`CONTEXT_WINDOW_EXCEEDED`，自带 `maxOverflowRetries`）。
- 透明故障转移必然产生 durable "model changed" notice（去不掉，不影响主要功能，已决定接受）、UI `next` 停留未兑现 pending、`request/header` 记 `reason: 'change'`。
- `assistant/attempt` 不含 provider/model，只有 `turn`/`step`/`stream`；route 归属须取最近的 `request/header`。
- `agent/request-error` payload 只有 `provider`，没有 `model`；candidate 索引只能 Router 自持（对照 `compaction-basic` 的 `WeakMap<Agent, number>` 模式）。
- DSH 设计哲学：adapter 一次调用一次 attempt，attempt 归属 Agent 恢复层（`llm-pi-ai/src/adapter.ts:140-142` 显式 `maxRetries: 0`）。
- **`agent/pre-step` 在 `agent/request` 之前触发，`decision.messages` 可读**——条件路由（图片/工具/上下文）的取数时机成立。
- **外置插件可 append 自带 notice**：自定义 `kind` + `form:'notice'` 的 `user/message` 能落进 durable log；`createUserMessage` 不校验 source kind，`MessageSourceMap` 可 merge-extensible；`contextForm()` 只读 `form`。浏览器样式未实测。
- spike 运行陷阱：`.sessions` 相对进程 cwd 落地（运行器须 `Set-Location`）；`probe.log` 落在 `src/`；stub 要注册在 `deepseek-official`，因为 headless 的 provider 来自 `agentDefaultModel.currentSelection()` 而非 `agent-loop.agents`；**stub 计数器必须按 `options.purpose` 过滤辅助调用**。
- 失败 durable settlement 会退役对应 transient rows；`llm/retry` 额外记录重试排程、保留 Chat first-token 时间并提供 turn-process evidence。直接 retry 不等价于这组状态更新。
- `LlmFailure.code` 是开放 string；`llm-retry` always mode 无重试上限。
- **`UNSUPPORTED_REASONING_EFFORT` 是 preparation error，直接终止 step+turn，不进 `agent/request-error`**（`agent.ts:603-610` 只吞 `NO_ADAPTER`；测试 `request-reconstruction.spec.ts:438-467` 断言）。Router 必须在 `agent/request` 返回前用 `ctx.llm.resolveCallConfig()` 预校验候选，不能指望任何 recovery。
- **工具能力无任何机器可读来源**：`LlmModelInfo` 唯一能力字段是 `inputModalities`；pi-ai SDK `Model` 接口也没有；`normalizeModelInfo` 白名单重建。工具不兼容运行时才炸（`INVALID_REQUEST`/`PI_AI_ERROR`），分类跨 provider 不一致，靠 switchOn 承接。
- **配置热更新会整体重启插件**（`fiber.update()` 先校验再 restart）；校验失败炸的是插件 fiber 不是 DSH；provider 缺失必须降级停用而非硬失败，否则卸载一个 provider 杀死整个路由器。
- **投影 wire 硬约束**：key 带命名空间、`stateVersion` 只增；每个 tail 页携带全部 client-visible key（无按 key 裁剪，view 必须 UI-scale）；state plain JSON；view 对象复用引用；卸载即 key 消失、客户端读成能力缺失。

## 最近活跃窗口

- 核验了 DSH retry executor 的 projection、policy 及 UI partial-stream reset 行为。
- 补充 model-selection listener 顺序、请求物理身份和 recovery-transition 待验证项。
- 规范协作文件并修复跨目录源码链接。
- 逐条核对 LiteLLM/Portkey/OpenRouter 官方文档，修正 prior-art 中两处不准确表述。
- **四路并行深挖 DSH 能力边界**：原生路由能力、持久化与身份、UI slots 与可观测性、Cordis composition 与次序。
- 新增 `docs/design/dsh-capability-boundary.md`，分四层记录原生支持/不支持/最优雅补法/社区规范。
- 修正 listener 次序方向错误；确定 lineage 走 session projection、两层 attempt 边界。
- 记录两篇 proposed 决策笔记；完成 166 条源码锚点校验。
- **Phase 1 spike 实跑通过**：`npm install @deepseek-ai/dsh` + `--patch` overlay，仓库外插件加载成功、模块单副本、两个 waterfall 均收到事件、`agent/request` 重试时解析回同一条 route。
- 记录一篇 implemented 决策笔记；补 `.gitignore` 忽略 spike 运行时产物。
- **四路并行源码核查 + 九项决策落档**（2026-10-12 晚）：① reasoningEffort 失败路径（源码+既有测试：直接终态不进 recovery）；② 工具能力元数据（全仓库+pi-ai SDK 均无；不兼容走运行时 failover）；③ 插件投影读取通路（snapshot/list/projections/guard 四段核实）；④ 主流能力元数据调研（OpenRouter `supported_parameters`、LiteLLM cost map + pre-call checks、Portkey `type.supported`）。据此关闭 open-questions 全部九项，修订 product-plan（canonical schema/validateConfig 范式/backoff 只读）、ui-design（条件 2 项+推理徽标+primary 钉死+INVALID_REQUEST+历史抽屉）、capability-boundary 第八节、prior-art 能力元数据一节，同步 mockup，落两篇 implemented 决策笔记。
