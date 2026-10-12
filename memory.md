# DSH Model Router 项目状态

> 当前状态快照 + 最近活跃窗口；决策理由见 `.agents/notes/`，稳定协作知识见 `tools.md`，设计现状见 `docs/`。

## 当前基线

- Markdown 设计 + Phase 1 插件实现（`packages/dsh-model-router/`，host 侧最小闭环）；无 UI 半包、无条件路由。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`；项目根：`D:\sudy\myproject\dsh-model-router`。
- 最后更新：2026-10-12（晚：Phase 1 host 最小闭环落地并测试通过）。
- 验证状态：17 个 Markdown 文件本地链接 0 失效；166 条 DSH 源码行号引用 0 越界；Phase 1 spike 实跑 exit 0；Phase 1 组合测试 8/8 通过（真实 headless Loader boot + stub adapter，断言 durable session 事件）；`tsc --noEmit` 0 错误。

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
- **配置生命周期**：`fiber.update()` 先校验再 `restart()`（炸插件不炸 app）；DSH 插件校验范式 = schemastery schema + `apply()` 里 validateConfig，**不存在 `Config.check()` 方法**。
- **Phase 1 插件实现落地**（`packages/dsh-model-router/`）：函数插件（`name`/`inject`/`Config`/`apply`），schemastery Config 全 volatile，`config.x.get()` 读取；`agent/request` prepend 选路（每 attempt 都过，压住 llm-retry 重试）、`agent/request-error` 注册于 `agent/created` 的 `agent.ctx` 且不用 prepend；候选索引 WeakMap 单槽按 (turn, step)；预校验走 `ctx.llm.resolveCallConfig`（不过即跳过候选 + skip notice）；notice 经 `agent.session.append('user/message', createUserMessage({source:{kind:'model-router',form:'notice',summary}}), {surfaceOp:'append'})`；失败码经 `session/event` feed + recovery 双路记录。
- **实现期抓到的真 bug 已修**：到顶换候选原先不查 switchOn（llm-retry 抢占 recovery 时绕过用户选择）——`planFire(state, mayAdvance)` 加门，见 `.agents/notes/implemented/2026-10-12-cap-advance-must-respect-switch-on.md`。
- **实现期 API 事实**：schemastery 无 `z.infer`（手写 interface + `Volatile<T>` 三段式，样板 llm-pi-ai/src/config.ts）；`Fiber.entry` 是 loader 包运行时增强，外置插件勿依赖；`resolveRetryPolicy` 的 `retryableCodes` 不可为空；stub adapter 必须对 `options.purpose !== undefined` 直接成功；headless CLI 入口 `node_modules/@deepseek-ai/dsh/lib/bin.js`。

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
- **Phase 1 host 侧闭环已完成并测试通过**（8/8 组合测试）：有序备份链 + switchOn + 每候选次数 + 硬总上限 + 中文 notice + 预校验跳过 + 总闸 + default 纯备用池 + 加载时结构校验；实现在 `packages/dsh-model-router/`。
- **Phase 1 UI 半包已完成并浏览器实测**：`src/client.js`（单文件 factory，~1200 行）挂 `plugins.bundle.config`（key=包名），控制器自持草稿 + `scope.mutate` 整段保存；实测通过：表单全量渲染、总开关、新建 Profile（manual 路径；目录为空时 manual 入口可达）、primary 钉死、候选增删、attempt 编辑、保存持久化、刷新恢复、switchOn 嵌套写入往返。实测抓到并修 5 个 bug：2 处括号语法、serverError 词典 key、**store devFreeze 冻结草稿**（发布必须克隆）、空目录弹窗断点、active tab 卡默认页（autoActive 标志）。
- **Phase 2 条件路由落地并测试通过**（2026-10-13）：宿主 `agent/pre-step` 取图片（`type==='image'` 规则）+ `sessionProjections.snapshot()['contextPressure'].projectedTokens`（canonical wire 值，未采样即 undefined=未满足），每步一次、重试稳定；用户路由豁免；条件不满足跳过并留 condition-skip notice。UI needs 面板（images Switch + minContextTokens 输入，仅备用候选）+ 推理档位徽标（catalog reasoning.efforts）。测试：单测 12/12（node strip-types 直导 .ts）+ 组合测试 condition-skip 场景 + 全套 9/9；浏览器实测 needs 编辑→保存→刷新恢复。
- **Phase 2 全部完成并实测**（2026-10-13）：① 条件路由（needs images/minContextTokens，pre-step + contextPressure wire view）；② lineage 投影 `router/failover-history`（fold request/header 'change' + 前序失败 attempt，bounded 20，wire UI-scale）；③ 遥测抽屉（portal + list→projections，浏览器实测三条真实条目）；④ catalog picker 真实 provider 下实测通过（stub 三 group）；⑤ 保存路径无 overlay boot 实测通过。测试：单测 23/12（pure）+ 组合 9/9 + 浏览器全链路。
- **本轮抓到并修 4 个客户端 bug**：drawer 读错状态路径（state.ui.*）、projections 响应无 kind 字段却以其门禁、modelCatalog 忘拆 `{ok,value}` 信封、catalog apply 时抢跑改懒加载。另发现测试环境坑：overlay 改写行 config 后同 boot 内该 ns 保存被 revision 冲突拒（无 overlay 正常）。
- **下一步（收尾项）**：删除 Profile 的 RiskConfirmation 流程补测；notice 浏览器样式；投影 fork/resume 一致性；热卸载测试；`dsh plugin add` 交付路径复验（当前用 link 安装）。
- 交付物：三 commit（852ad64 设计基线 / c01fcb2 Phase 1 host / 9a43ac5 Phase 1 UI）。
- 决策笔记状态：三篇 `proposed/` + 四篇 `implemented/`（外置插件实跑、砍 needs.tools、reasoningEffort 预校验、cap advance 过 switchOn 门）。

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
- **四路并行源码核查 + 九项决策落档**（2026-10-12 晚）：① reasoningEffort 失败路径（源码+既有测试：直接终态不进 recovery）；② 工具能力元数据（全仓库+pi-ai SDK 均无；不兼容走运行时 failover）；③ 插件投影读取通路（snapshot/list/projections/guard 四段核实）；④ 主流能力元数据调研（OpenRouter `supported_parameters`、LiteLLM cost map + pre-call checks、Portkey `type.supported`）。据此关闭 open-questions 全部九项，修订 product-plan/ui-design/capability-boundary/prior-art，同步 mockup，落两篇 implemented 决策笔记。
- **Phase 1 host 最小闭环落地**（2026-10-12 深夜）：搭包骨架（`dsh.bundle`/patch row id=model-router/peerDeps）、schemastery Config 三段式、`agent/request` prepend 选路 + 每候选 attempt 计数、`agent/request-error` 内层交接、`resolveCallConfig` 预校验跳过、中文 notice、`session/event` 失败码记录；写 stub adapter + 8 场景真实 Loader 组合测试（boot headless CLI + 断言 durable session 事件）。**测试抓到一个真 bug**：到顶换候选不查 switchOn（llm-retry 抢占 recovery 时绕过用户选择），已修并留决策笔记。`tsc --noEmit` 0 错误。
- **Phase 1 UI 半包落地并浏览器实测**（2026-10-13 凌晨）：`src/client.js` 单文件 factory（createElement + DSH 原语 + locale 词典 + 内联 design-token 样式）；装进 web profile（link）实测：全表单渲染、建 Profile、加候选、改 attempt、保存、刷新恢复全通。抓到 5 个 bug 全修（2 括号、词典 key、devFreeze 冻结草稿、空目录 manual 断点、active tab 卡默认）。spike 探针两处保真度问题（布尔文本框、specs 未注册）在本实现不存在——布尔走控制器草稿 + Switch/checkbox 原语，保存脏态由控制器自持。
