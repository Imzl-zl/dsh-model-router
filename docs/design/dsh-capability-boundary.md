---
title: "DSH Model Router — DSH 能力边界与插件方案"
status: "verified-source-facts"
kind: "architecture-reference"
last_updated: "2026-10-12"
---

# DSH Model Router — DSH 能力边界与插件方案

## 摘要

本页回答四个问题：DSH **原生支持**什么、**不原生支持**什么、每个缺口**最优雅的补法**是什么、外置插件必须遵守哪些**社区规范**。论断标注【源码证实】或【推断】，行号指向只读 checkout `D:\sudy\github\deepseek-harness`，实现前须回目标分支复核。

本页是能力边界的唯一权威说明；[架构设计](architecture.md)只引用结论，不重复事实。

## 一、DSH 原生支持（直接用，不重造）

| # | 能力 | 机制与位置 |
|---|---|---|
| 1 | 按请求切换物理 route | `agent/request` waterfall 返回 `LlmCallConfig`，返回替换值即切换 provider/model。[`runtime-types.ts:322-337`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L322) 契约写明 "return a replacement to switch"；[`agent.ts:593-604`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L593) 分发后交 `prepareCall()`。【源码证实】 |
| 2 | 同 step 内失败后重新准备 | `agent/request-error` 返回 `{ kind: 'retry' }` → [`agent.ts:523-526`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L523) `continue` 回到 [`agent.ts:409-410`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L409) 循环顶部，**完整重跑 `agent/request` + `prepareCall()`**；这是同 step 内再次 prepare 的**唯一**路径。类型见 [`runtime-types.ts:122`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L122)。【源码证实】 |
| 3 | 同 route 重试的预算、退避与 durable 记录 | `llm-retry` 插件：[`llm-retry/src/index.ts:243`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L243) 注册 recovery，[`194-241`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L194) 实现 normal/always；默认可重试码与 5 次上限见 [`retry-policy.ts:14-24`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/retry-policy.ts#L14)。【源码证实】 |
| 4 | adapter 边界失败规范化 | dispatch、iterator construction、iteration 抛出的错统一转为终态 failure chunk：[`llm/index.ts:1161-1169`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1161)，调用点 [`1097-1099`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1097) 与 [`1111-1113`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1111)。`NO_ADAPTER` 被延迟到 dispatch：[`agent.ts:603-610`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L603)。【源码证实】 |
| 5 | 取消优先于任何恢复决策 | [`agent.ts:522`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L522) 在检查 action 前 `signal.throwIfAborted()`。【源码证实】 |
| 6 | 失败 attempt 的 durable 记录 | `assistant/attempt` 嵌入完整 compact stream（含终态 finish chunk 及其 `failure`）：[`agent.ts:506-510`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L506)、[`assistant-stream.ts:112-114`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/assistant-stream.ts#L112)；不进模型可见历史见 [`session/types.ts:355`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L355)。**该事件不含 provider/model**，只有 `turn`/`step`/`stream`。【源码证实】 |
| 7 | **插件自有的 durable 状态** | `ctx.sessionProjections.register()` 是普通插件缝：[`token-meter/src/usage-projection.ts:117-150`](file:///D:/sudy/github/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts#L117) 与 [`173-218`](file:///D:/sudy/github/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts#L173) **只折叠核心事件**（`assistant/message`、`assistant/attempt`、`llm/retry-started`、`request/context`），不拥有任何自有事件类型；`wire` 块使其对客户端可见。契约见 [`docs/subsystems/session-projection.md`](file:///D:/sudy/github/deepseek-harness/docs/subsystems/session-projection.md)。【源码证实】 |
| 8 | 带热更新值的配置 | 插件 `Config` schema + `Volatile<T>`，Plugins 页自动生成表单；"A request that needs a consistent snapshot captures its values once"。见 [`docs/cookbook/adding-a-settings-card.md:9-30`](file:///D:/sudy/github/deepseek-harness/docs/cookbook/adding-a-settings-card.md#L9)。【源码证实】 |
| 9 | 按 Agent 隔离的注册 | 用该 Agent 的 `agent.ctx`：[`docs/architecture.md:163`](file:///D:/sudy/github/deepseek-harness/docs/architecture.md#L163)。【源码证实】 |
| 10 | Settings Models 页扩展位 | `settings.models.provider-card`（keyed = 该行 settingsNs）、`settings.models.sign-in`（single）、`settings.models.footer`（list）：[`ui-settings-models/src/client/slot-contract.ts:24-58`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-models/src/client/slot-contract.ts#L24)。**按 provider 行键控，不给逻辑 profile 留位**。【源码证实】 |
| 11 | 候选存在性校验 | `ModelCatalog.routableProviders` 与 `groups`：[`catalog.ts:20-72`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/catalog.ts#L20)、[`types.ts:158-164`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/types.ts#L158)。【源码证实】 |
| 12 | 新增 provider route 的唯一正路 | `ctx.llm.registerAdapter(providers, adapter)` + `LlmAdapter` 子类；一个 adapter 实例可持多个 route key，冲突抛 `DUPLICATE_ADAPTER`：[`llm/index.ts:208-291`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L208)、[`389-432`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L389)。【源码证实】 |
| 13 | 仓库外插件是一等公民 | profile "holds any out-of-tree plugins it installs"：[`docs/architecture.md:17`](file:///D:/sudy/github/deepseek-harness/docs/architecture.md#L17)；经 `dsh plugin` 安装：[`docs/architecture.md:47`](file:///D:/sudy/github/deepseek-harness/docs/architecture.md#L47)。【源码证实】 |
| 14 | DSH 的 attempt 设计哲学 | pi-ai adapter 显式设 `maxRetries: 0`，注释 "The agent recovery layer owns visible attempts; one adapter call is one SDK attempt"：[`llm-pi-ai/src/adapter.ts:140-142`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L140)。**attempt 归属 Agent 恢复层，不归 adapter**。【源码证实】 |
| 15 | 仓库外插件的开发/安装/测试闭环 | 本地加载用 `--patch` overlay 指向绝对路径模块，无需打包（[`tutorial index.md:46-62`](file:///D:/sudy/github/deepseek-harness/docs/user/develop/basic/index.md#L46)）；可安装交付用 `dsh.bundle` + `dsh plugin add`（[`publish.md:64-80`](file:///D:/sudy/github/deepseek-harness/docs/user/develop/basic/publish.md#L64)）；**真实组合测试**用 `@deepseek-ai/dsh-loader-smoke` 的 `runLoaderSmoke()`（[`keyless-smoke.e2e.ts:20-48`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts#L20)）；stub adapter 模板见 [`retry-snapshot-backend.mjs`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/tests/fixtures/retry-snapshot-backend.mjs)。【源码证实】 |

## 二、DSH 不原生支持（缺口）

| # | 缺口 | 证据 |
|---|---|---|
| G1 | 一个逻辑名映射多个部署/多 endpoint | `LlmAdapter` 以**单一 provider 字符串**为键：`providerInfo(provider)`、`resolveModel(provider, model)`、`prepareCall(provider, model)` 全部如此（[`llm/index.ts:208-291`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L208)）。`GenerateOptions.provider` 与 `LlmCallConfig.provider` 都是单值字符串（[`llm/src/types.ts:512-513`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/types.ts#L512)）。`ModelProviderGroup` 只是 GUI 展示分组，`group.id` 就是 `provider.id`（[`catalog.ts:49-52`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/catalog.ts#L49)）。仓库无 alias/group 路由概念。【源码证实】 |
| G2 | 跨 candidate 故障转移 | `agent/request-error` 默认返回 `undefined` 即终态（[`runtime-types.ts:122`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L122)、[`agent.ts:520,523-525`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L520)）。`llm-retry` 只重试**同一条 route**（状态键含 provider，[`llm-retry/src/index.ts:79-81`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L79)）。【源码证实】 |
| G3 | route attempt lineage 作为一等身份 | `request/header` **仅在信封变化时**才记录（[`agent.ts:643-648`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L643)）；`assistant/attempt` 不含 provider/model。没有任何事件表达"某 profile 的第 N 次 attempt 用了候选 C"。【源码证实】 |
| G4 | 逻辑模型进入 GUI selector | selection 是 provider/model 对（[`model-selection.ts:22-29`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L22)）；pending 仅在 header 与 selection **完全一致**时清除（[`model-selection-projection.ts:52`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/model-selection-projection.ts#L52)）；catalog 按 provider 分组；`settings.models.provider-card` 按 provider 行键控。【源码证实】 |
| G5 | 辅助模型调用被路由 | compaction 与 session-title 直接 `ctx.llm.stream()`，带 `purpose`，不经 Agent recovery（[`types.ts:552`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/types.ts#L552)、[`summarizer.ts:160`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts#L160)、[`session-title-llm/index.ts:264`](file:///D:/sudy/github/deepseek-harness/packages/session/session-title-llm/src/index.ts#L264)）。【源码证实】 |
| G6 | 跨进程/全局 provider 健康度 | 目录名含 route/fallback/balance/breaker/cooldown/health/failover 的包：**零个**。【源码证实】 |
| G7 | 仓库外插件新增 durable 事件类型 | `SessionEventMap` 是 merge-extensible interface，仓库外可 `declare module` augment（[`session/src/types.ts:281`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L281)、`persistence-catalog-source.ts:137-180` 只扫本仓库）；但 `KNOWN_SESSION_EVENT_TYPES` 是生成文件，只收本仓库声明，未知类型且 `ignorable !== true` 会被 [`storage-contract.ts:75-80`](file:///D:/sudy/github/deepseek-harness/packages/session/session-persistence/src/storage-contract.ts#L75) 拒读整个 log。**功能上仓库外只能写 `ignorable: true` 记录，即 plugin record 信封**；而 [`session/README.md:70`](file:///D:/sudy/github/deepseek-harness/packages/core/session/README.md#L70) 明写 "Plugins outside this repository must not call it either"。【源码证实】 |
| G8 | attempt 顺序/切换原因的既有 UI | `turn-process` 只呈现过程边界，不含 provider/model（[`turn-process.ts:64-89`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts#L64)）；带 provider 与失败分类的只有 `llm/retry`（[`llm-retry/src/types.ts:16-40`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/types.ts#L16)）；实际 route 事实只在 `request/header` session 事件里。【源码证实】 |

## 三、每个缺口的最优雅补法

### G1 — 逻辑 profile 只存在于插件 Config 内

candidate 必须是已注册 adapter 能解析的真实 provider/model。**绝不把逻辑 ID 写进 `provider` 字段**：空值被 [`agent.ts:598-600`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L598) 拒绝，未注册值在 dispatch 时抛 `NO_ADAPTER`（[`llm/index.ts:995`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L995)）。DSH 侧永远只看到真实 route，profile 是插件的私有抽象。这也符合 [`llm-pi-ai/src/adapter.ts:140-142`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L140) 确立的分工：adapter 一次调用一次 attempt，attempt 归属 Agent 恢复层。

### G2 — `agent/request` + `agent/request-error` 配对，Router 用 `prepend: true` 拿最外层

**次序方向（已核实并实测，早前文档的反向表述是错的）**：waterfall 从 `_hooks[name]` 数组**头部**取 listener，数组首个即最外层，最外层的返回值就是最终值（[`events.ts:234-243`](file:///D:/sudy/github/deepseek-harness/vendor/cordis/src/events.ts#L234)）；`prepend: true` 是 `unshift` 到队首（[`events.ts:255`](file:///D:/sudy/github/deepseek-harness/vendor/cordis/src/events.ts#L255)）。在 `await next()` **之后**改写返回值的 listener 覆盖内层的改写（[`cordis-primer.md:33`](file:///D:/sudy/github/deepseek-harness/docs/cordis-primer.md#L33)）。`installModelSelection()` 的 `agent/request` listener 正是此模式（[`model-selection.ts:96-112`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L96)），所以：

- Router 在数组**前侧（外层）** → Router 在 `next()` 之后覆盖生效，**Router 赢**
- Router 在数组**后侧（内层）** → 被 `installModelSelection` 覆盖，**Router 输**

> **已由 spike 实测**：见第七节 7.2。同时注册两条 route，`prepend` listener 把 agent 请求的 `deepseek-official` 换成 `spike-backup`，durable `request/header` 与 `assistant/message` 最终都记 `spike-backup`。外层覆盖压过 selection 写回，Session 归因跟着真实 route 走。

hook 列表跨 context 共享：root 构造时创建唯一 `EventsService`（[`context.ts:80`](file:///D:/sudy/github/deepseek-harness/vendor/cordis/src/context.ts#L80)），`extend()` 是原型继承，`createScope()` 只做 `extend()`（[`scope/src/index.ts:139-140`](file:///D:/sudy/github/deepseek-harness/packages/core/scope/src/index.ts#L139)），全仓库无 `isolate('events')`。未打 scope tag 的 listener 收到所有后代 scope 的事件（[`scope/src/index.ts:170-185`](file:///D:/sudy/github/deepseek-harness/packages/core/scope/src/index.ts#L170)）。

**两个 waterfall 的位置不对称，都已实测（见第七节 7.2 与 7.4）**：

| 钩子 | 位置 | 手段 | 理由 |
|---|---|---|---|
| `agent/request` | **最外层** | `prepend: true` | 必须压过 `installModelSelection` 在 `next()` 之后对 provider/model 的写回 |
| `agent/request-error` | **`llm-retry` 内层** | 在 `agent/created` 里注册到 `agent.ctx`，不用 prepend | 让 `llm-retry` 先管同 route 重试；它放弃时 `return next()` 正好交给 Router |

**为什么 `agent/request-error` 不能也用 prepend**：`llm-retry` 的全部"放弃"路径都是 `return next()`（[`llm-retry/src/index.ts:198,216,223,231`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L198)），而 `next()` 只往内走、不往回走。若 Router 在最外层且委派，llm-retry 放弃时 `next()` 直达默认 thunk 返回 `undefined`（终态），**Router 永远等不到放弃信号，再也无法 failover**。注册在内层则交接自然成立。

**为何内层位置是确定性的**：`llm-retry` 与另两个 `agent/request-error` 消费者（`compaction-basic`、`compaction-image-offload`）都在**插件加载时**注册；Router 在 **agent 创建时**经 `agent/created` 注册，必然晚于它们，故必然在内层。注册到 `agent.ctx` 还顺带解决生命周期——随 agent 销毁，不会每个 agent 漏一条 listener。

**这一位置的产品语义**：内置恢复（同 route 重试、上下文溢出压缩、图片 offload）全部优先；它们都放弃后才轮到 Router 做跨候选 failover；Router 是终态前的最后一道，它返回 `undefined` 即终态，且内层没有东西可饿死。

**为什么必须 `prepend: true`（不是可选）**：`installModelSelection` 在 **agent 创建时**注册于 `agent.ctx`（[`session-controller/src/agent.ts:323`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/agent.ts#L323)、[`agent-loop/src/index.ts:810-815`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/index.ts#L810)），晚于插件加载，故 Router 对 `agent/request` 天然占优。但 `agent/request-error` 上 `llm-retry` 同样注册在 root 插件 ctx 且**不用 prepend**（[`llm-retry/src/index.ts:243`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L243)），二者谁外层由 `apply()` 实际执行先后决定，而 **cordis.yml 书写顺序不决定该先后**（[`cordis-tutorial/03-services.zh.md:59`](file:///D:/sudy/github/deepseek-harness/docs/cordis-tutorial/03-services.zh.md#L59)）。文档给出的唯一确定性前置机制就是 `prepend: true`（[`cordis-primer.md:33`](file:///D:/sudy/github/deepseek-harness/docs/cordis-primer.md#L33)）。因此两个 waterfall 都必须 `prepend: true`。

`agent/request-error` 现有三个 src 消费者，Router 是最外层后必须逐一让路：
- `llm-retry` — 同 route 重试预算（[`llm-retry/src/index.ts:243`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L243)）
- `compaction-image-offload` — `IMAGE_OFFLOAD_REQUIRED` durable 修复，注释明写 "spends no retry budget and logs no retry event"（[`compaction-image-offload/src/index.ts:27-32`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-image-offload/src/index.ts#L27)）
- `compaction-basic` — `CONTEXT_WINDOW_EXCEEDED` 溢出恢复，自带 `maxOverflowRetries`（[`compaction-basic/src/index.ts:190-200`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-basic/src/index.ts#L190)）

**Router 不拥有的 failure code 必须 `next()` 委派**——硬规范（[`AGENTS.md:133`](file:///D:/sudy/github/deepseek-harness/AGENTS.md#L133)）。

**预算归属（两层，owner 不同、互不复制）**：[`agent.ts:409`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L409) 的 `while (true)` **没有任何 attempt 上限**，DSH 不提供边界。

- **第一层：同 route 重试，归 `llm-retry`。** Router 注册在它**内层**（见上），所以同 route 的多次重试连同退避与 `llm/retry` durable 记录都由它负责，**Router 不复制退避逻辑**。其预算按 `(provider, policyKey)` 键控并在 `step/start`/`turn/end` 清零（[`llm-retry/src/index.ts:79-81,130-137`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L79)），切到新 provider 时自然归零。
- **第二层：跨候选 failover 与硬总上限，归 Router。** Router 只在 `llm-retry` 放弃后才拿到 failure，此时才判断是否前进到下一个候选；总 attempt 上限由 Router 在这里硬性兜住。
- **adapter 不声明 policy 时仍有默认 normal policy**（已实证，见第七节）：`providerRetryPolicy()` 返回 `undefined` 时 `llm-retry` 以 `mode=normal, maxRetries=5` 重试。**Router 不能假设"无 policy 就是不重试"**，第一层对每个候选都生效。
- **`always` policy 必须显式拒绝**：该模式无重试上限（[`retry-policy.ts:47-54`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/retry-policy.ts#L47)），且它**先 await 下游**（[`llm-retry/src/index.ts:199-214`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L199)）——下游返回 retry 它就直接采用，与 normal 模式行为相反。声明 `always` 的候选 provider 在配置加载时拒绝，不在运行时 veto。
- **总 worst case = `候选数 × (1 + maxRetries)`**：`mode` 与 `maxRetries` 可从 `agent/request-error` 的 `retryPolicy`（[`runtime-types.ts:353`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L353)）读到，Router 无需预测下游即可给出上界。

**重试时的选路**：`prepareRequest` 在上一次已记录 header 时用 `requestProposal(persistedHeader)` 作种子（[`agent.ts:583-592`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L583)），即上一次的 route；随后 `installModelSelection` 又覆盖回用户选择。所以 Router 每次拿到的都是用户选择，**必须靠自己的 per-(agent, turn, step) 索引决定前进到第几个 candidate**。

> **已由 spike 实证**：`agent/request` 在重试时再次触发，且两次都解析回同一条 route（见第七节日志）。这不是推理，是实跑输出。`agent/request-error` 的 payload **只有 `provider`，没有 `model`**（[`runtime-types.ts:353`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L353)），且 `assistant/attempt` 也不含 provider/model，无法从事件反推失败候选，索引只能 Router 自持。先例：`compaction-basic` 用 `WeakMap<Agent, number>` 持 `overflowRetries`，在 `agent/status` idle 与 `assistant/message` 时清理（[`compaction-basic/src/index.ts:134,178-188`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-basic/src/index.ts#L134)）。

### G3 — 插件自有 session projection 折叠核心事件，零核心改动

本设计最关键的结论：**durable attempt lineage 不需要新事件类型、不需要 plugin record、不需要 bump `SESSION_FORMAT_VERSION`、不需要改 SDK**。

理由有两条，缺一不可：
1. 新增 durable 事件类型对仓库外插件实际封闭（G7）——核心会拒读非 `ignorable` 的未知类型，而 `ignorable` 就是 plugin record 信封，且被 README 禁止。
2. lineage 所需事实已在核心事件里：`request/header` 在 route 变化时记录真实 provider/model（[`agent.ts:643-648`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L643)），`assistant/attempt` 嵌入含终态 finish chunk（带 `failure`）的完整 stream。

一个纯 fold 即可重建：每个 `(turn, step)` 内每次 attempt 用了哪条 route（取该 attempt 之前最近的 `request/header`）、失败码是什么、最终成功在哪条 route 上。同 route 重试不产生新 header，但 attempt 事件本身可计数，归属不会错。

范式就是 `token-meter`：只折叠核心事件、声明 `SessionProjectionStateMap`、给 `stateVersion` 与 `stateSchema`、可选 `wire` 供客户端。resume/fork 时由 checkpoint + 尾序重放自动重建（[`docs/subsystems/session-projection.md:70`](file:///D:/sudy/github/deepseek-harness/docs/subsystems/session-projection.md#L70)）。

### G4 — 插件无解，须核心扩展；MVP 走透明物理故障转移

把逻辑 ID 塞进 provider 会让 runtime 找不到 adapter；后处理 header 成逻辑身份会破坏执行记录；`settings.models.provider-card` 按 provider 行键控，也不给逻辑 profile 留位。要让逻辑模型出现在官方 selector，需要核心同时改：catalog 增加非 provider route 的可选项、selection validation、逻辑身份的 Session projection。列入 Phase 3。

### G5 / G6 — 明确划在范围外

Agent hook 插件不覆盖 `ctx.llm.stream()` 直发调用；全局健康度是另一子系统。两者都必须在产品描述里写明，不得暗示覆盖。

### G7 — 不新增事件类型；durable 走 projection，进程内预算走 WeakMap

见 G3 与 G2。

### G8 — 诊断走 logger + projection，不新建 UI 面板

既有 UI 不展示 attempt 顺序与切换原因。MVP 用两条既有通道：`ctx.logger` 带插件前缀记录 attempt 与失败码；projection 的 `wire` 把 lineage 暴露给客户端。若要做 UI，`conversation.chat.node` 是 keyed slot，可注册自有 `ConversationNodeDefinition`（[`turn-process.ts:307-323`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts#L307)），但属 Phase 3。

## 四、failover 的三个必然后果（产品决策，不是待验证项）

1. **一条 durable "model changed" notice**。`agent/pre-step` 的 prepend listener 比较 `selection.assembled` 与 `session.requestHeader()?.config`，不同就向本步消息追加 durable user-role notice（[`model-selection.ts:113-126`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L113)、[`47-61`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L47)）。failover 后 last header 是候选渠道，与用户选择不同 → **每次 failover 在下一步产生一条 notice**，且它是 model-visible 的 user 消息（`agent.ts:434` 以 `surfaceOp: 'append'` 提交 `user/message`，进 surface，无 `form: 'notice'` 过滤）。
   - **已核实的抑制路径全部不通**：① 改 live selection 需要 `selectForNextRequest`，它在 `SessionController` 的 **private** `agents` 字段后（[`session-controller/src/index.ts:125`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/index.ts#L125)、[`agent.ts:333`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/agent.ts#L333)），插件不可达；② 只 append `model/selection` 事件不改变 `selection.current`，因此不改变 `assembled`，notice 照旧；③ 抢在 host 的 prepend listener 前剥离 notice，正是 [`packages/AGENTS.md:14`](file:///D:/sudy/github/deepseek-harness/packages/AGENTS.md#L14) "listener order is not enforcement" 禁止的模式。
   - **结论：接受，这不是阻塞项。** notice 的语义为真（上面的 turns 确实由候选生成），且它正是 DSH 为"生成模型变更"设计的机制。残余风险只有**用量**：候选持续失败时每步一条。用量由 Router 自己的失败策略封顶（候选数有界、连续失败可停用 profile），不依赖核心改动。
2. **UI `next` 停留在未兑现的 pending**。`next = pending ?? lastUsed`（[`model-selection-projection.ts:65`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/model-selection-projection.ts#L65)），pending 只在某个 `request/header` 与它完全相等时清除。failover 后 `lastUsed` 是实际候选，`next` 仍指向用户选择。输入框因此继续显示用户选择——对选项 A 是可接受语义，但必须写明。
3. **`request/header` 记 `reason: 'change'`**，Session 里留下真实的渠道变更轨迹（[`agent.ts:643-648`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L643)）。这是可接受的：它如实反映执行身份。

## 五、外置插件必须遵守的社区规范

来源：根 [`AGENTS.md`](file:///D:/sudy/github/deepseek-harness/AGENTS.md) 与 [`packages/AGENTS.md`](file:///D:/sudy/github/deepseek-harness/packages/AGENTS.md)。

| 规范 | 对本插件的具体含义 |
|---|---|
| 函数插件形态：命名导出 `name`/`inject`/`Config`/`apply`，无 default export（`packages/AGENTS.md:5`） | 混用形态会被 Loader 丢弃命名空间 |
| 可选服务用 `ctx.get(name)`，不用 `ctx.<name>`（`packages/AGENTS.md:6`） | `llm`、`sessions`、`sessionProjections` 按需 `inject` 或 `ctx.get` |
| 产品可见插件必须有**真实 Loader 组合测试**，boot 一个 test-only `cordis.yml`（`packages/AGENTS.md:7`） | 手造 Context 单测不合格；listener 次序只能用真组合证明 |
| waterfall listener 必须 `next()` 委派（`AGENTS.md:133`） | Router 不拥有的 failure code 一律 `next()` |
| 插件内不写死可调参数，部署级选择必须是 validated `Config` 字段（`AGENTS.md:139`） | candidate 列表、各类上限、退避参数全部进 Config |
| 误配置在加载时响亮失败（`AGENTS.md:140`） | profile/candidate ID 重复、引用不存在、上限非法，加载即抛 |
| model-visible ⟺ logged（`AGENTS.md:134`） | 本插件不新增模型可见内容；notice 由 host 产生，不由插件注入 |
| 跨边界不透明 ID 用 `Branded<B>`（`AGENTS.md:141`） | profile id / candidate id 用品牌类型 |
| 边界处显式优于隐式（`AGENTS.md:138`） | 默认策略是一次显式 `resolve()`，不是 `run()` 里的 `?? default` |
| 上限作用于完整结果（`packages/AGENTS.md:16`） | 总 attempt 上限须覆盖 llm-retry 代跑的重试 |
| 状态只在提交点发布（`packages/AGENTS.md:15`） | projection 是唯一权威，UI/日志从它派生 |
| 注册贡献须证明可 Dispose（HMR 测试，`packages/AGENTS.md:17`） | 热卸载测试断言 listeners/投影/UI 全部移除 |
| README 需 `## Known Limitations and Deferred Work`（`packages/AGENTS.md:27`） | 写明不覆盖辅助调用、无跨重启预算、failover 三后果 |
| 加载次序通过 `inject` 服务依赖表达（`cordis-primer.md:11`） | 依赖 `llm`/`sessions`/`sessionProjections` 用 `inject` |
| `prepend: true` 仅用于必须跑到普通注册之前的 listener（`cordis-primer.md:33`） | 两个 waterfall 都用，理由见 G2 |
| 需要一致快照时一次捕获 Config 值（`adding-a-settings-card.md:30`） | 每个请求固定一份 profile 快照 |
| 诊断文本：类型化失败、机器身份与展示文本分离、不解析错误消息、敏感细节不进用户可见文本（`.agents/skills/dsh-error-handling/SKILL.md:10-26`） | 失败分类用 `LlmFailure.code`，不用 message 匹配 |
| 日志：插件名前缀 + 格式串 + `%o` 传 error 对象；`warn` 可恢复、`error` 终止性（先例 `llm-retry/src/index.ts:207-210`） | 统一 `dsh-model-router: ...` 前缀 |
| 凭证绝不入日志（`llm-deepseek` README:118 "never any part of the key"） | 只记 provider/model 与 failure code |
| prompt 不入 logger，走 session 事件（`AGENTS.md:134`） | 不记录请求内容 |
| 客户端 UI 文案走 locale 字典（`AGENTS.md:153`） | 仅当增加 UI 时适用 |

## 六、待验证项（不能从源码推定）

1. 折叠 `request/header` + `assistant/attempt` 重建 lineage 的投影，在 fork/resume 与 snapshot 重放下是否与在线结果一致。
2. 进程内 per-(agent, turn, step) candidate 索引在 Agent 并发与热卸载下的清理是否完整（对照 `compaction-basic` 的 WeakMap 模式）。
3. 交付形态：spike 用 `--patch` overlay，交付用 `dsh plugin add` 安装进 profile，两者模块解析路径不同，后者未测。
4. notice 在浏览器里的实际折叠行样式（源码路径已确认，见 7.7，但未过真实浏览器）。

> `prepend: true` 的次序、`llm-retry` 与 Router 的两层交接、route 覆盖压过 selection 写回、外置插件 append 自带 notice、条件路由取数时机——这五项原为待验证，已分别由第七节 7.2、7.4、7.7 实测通过，不再列为未知。

## 七、Phase 1 spike 的实证结果（2026-10-12）

用 `spike/` 下两次真实 boot 已验证的事项。命令与产物见 [`spike/run.ps1`](../../spike/run.ps1) 与 [`spike/src/spike-probe.mjs`](../../spike/src/spike-probe.mjs)；以下是**实跑输出**，不是推理。

### 7.1 插件加载与 waterfall 可达性

```
apply
agent/request turn=1 step=1 resolved=deepseek-official/deepseek-flash
agent/request-error provider=deepseek-official code=RATE_LIMIT policy=normal
agent/request turn=1 step=1 resolved=deepseek-official/deepseek-flash
```

durable session 事件链：

```
request/header    provider=deepseek-official model=deepseek-flash
assistant/attempt turn=1 step=1 finish=error code=RATE_LIMIT
llm/retry          provider=deepseek-official mode=normal retry=1/5 code=RATE_LIMIT
llm/retry-started  retry=1
assistant/message  provider=deepseek-official model=deepseek-flash text=SPIKE_OK ...
turn/end           reason=completed
```

| 已实证 | 结论 |
|---|---|
| 仓库外插件可加载 | `--patch` overlay 以绝对路径指向 checkout 外的 `.mjs`，`apply()` 正常执行 |
| 模块单实例 | `@deepseek-ai/dsh-llm` 在安装后只有一份，`ctx.llm.registerAdapter()` 与 `LlmAdapter` 基类均正常，无双副本问题 |
| `prepend: true` 两个 waterfall 都收到 | `agent/request` 与 `agent/request-error` 的 out-of-tree listener 均被调用，且拿到解析后的 config 与失败事实 |
| **`agent/request` 在重试时再次触发，且解析回同一条 route** | `installModelSelection` 在每次 attempt 都把用户选择写回，所以 **Router 无法从 waterfall 推断当前候选，必须自持 per-(agent, turn, step) 索引** |
| adapter 不声明 policy 时仍有默认 normal policy | `providerRetryPolicy()` 未实现 → `llm-retry` 以 `mode=normal, maxRetries=5` 重试。**Router 不能假设"无 policy 就是不重试"** |
| durable 事件链可折叠 | `request/header` → `assistant/attempt`(带 failure) → `llm/retry` → `llm/retry-started` → `assistant/message` 正是 projection 需要的事实，G3 方案得到实证 |

### 7.2 Router 能否拿到最终 route 决策权（设计地基）

同时注册 `deepseek-official`（agent 自己的 selection 请求的路由）与 `spike-backup`，在 `agent/request` 用 `prepend` 把前者换成后者：

```
agent/request  in =deepseek-official/deepseek-flash
agent/request  out=spike-backup/deepseek-flash (swapped)
request/header    provider=spike-backup model=deepseek-flash
assistant/message  provider=spike-backup model=deepseek-flash text=SPIKE_OK served_by=spike-backup
turn/end           reason=completed
```

| 已实证 | 结论 |
|---|---|
| `in` 是 `deepseek-official` | `installModelSelection` 确实在写回用户选择，与 Router 真实竞争 |
| `out` 是 `spike-backup` | **外层 listener 的覆盖压过了 selection 的写回** |
| `request/header` 与 `assistant/message` 都是 `spike-backup` | **durable 记录反映真实执行 route，而非用户选择** |

**G2 的次序结论由此从源码推理升级为实测**：外置插件用 `prepend: true` 可以决定物理 route，且 Session 归因、usage、replay 全都跟着真实 route 走。这不需要对 DSH 核心做任何改动。

### 7.4 Router 注册在 `llm-retry` 内层，交接成立

`agent/request-error` 上，`llm-retry` 与另两个消费者都在插件加载时注册。本 spike 把 listener 推迟到 `agent/created` 时注册到 `agent.ctx`，并用两种失败码验证次序：

```
apply
agent/created -> registering request-error listener
agent/request  turn=1 step=1 resolved=deepseek-official/deepseek-flash    ← 尝试 1
agent/request  turn=1 step=1 resolved=deepseek-official/deepseek-flash    ← 尝试 2（llm-retry 重试后）
request-error  INWARD listener code=AUTH policy=normal                    ← 本 listener，只在 AUTH 时被调
agent/request  turn=1 step=1 resolved=deepseek-official/deepseek-flash    ← 尝试 3（本 listener 返回 retry 后）
```

```
assistant/attempt  code=RATE_LIMIT    ← llm-retry 自己重试，未委派（本 listener 未被调）
llm/retry          retry=1/5
llm/retry-started
assistant/attempt  code=AUTH          ← llm-retry 放弃，next() 交给本 listener
assistant/message  ... main call=3    ← 本 listener 的 {kind:'retry'} 生效
turn/end           reason=completed
```

| 已实证 | 结论 |
|---|---|
| RATE_LIMIT 时本 listener **未**被调用 | 它在 `llm-retry` 内层；同 route 重试归 llm-retry |
| AUTH 时本 listener 被调用 | llm-retry 的"放弃"路径 `return next()` 确实到达内层 |
| 本 listener 返回 `{kind:'retry'}` 后 `agent/request` 第三次触发 | 交接真实成立，failover 可行 |
| 无需复制退避逻辑 | 两层各有一个 owner，不形成第二处真相源 |

**这一条同时推翻了"Router 也用 prepend"的想法**：若 Router 在 `agent/request-error` 最外层且委派，llm-retry 放弃时 `next()` 直达默认 thunk 返回终态，Router 永远等不到放弃信号。

### 7.5 spike 自身踩到的坑

stub adapter 的调用计数器**会被辅助调用吃掉**。`session/title-llm` 与主请求走同一条 route 且不带 `purpose` 之外的区分，第一版测试里计数器被标题调用消耗，导致失败脚本打在了错误的 attempt 上，测试无效。修正：stub 必须对 `options.purpose !== undefined` 的调用直接成功，只让主请求参与失败脚本。

### 7.7 外置插件可 append 自带 notice，且条件路由取数时机成立

一次 boot 同时验两件事。`agent/pre-step` 与 `agent/request` 的相对次序，以及从 `agent/request-error` 里 append 一条自定义 notice：

```
pre-step    turn=1 step=1 messages=2 imageBlocks=0
request     turn=1 step=1 resolved=deepseek-official/deepseek-flash
request-error code=AUTH
notice appended summary="主模型 deepseek-official 失败（AUTH），已切换"
request     turn=1 step=1 resolved=deepseek-official/deepseek-flash
```

落地的 durable 事件：

```
seq 17  kind=model-router  form=notice  summary=主模型 deepseek-official 失败（AUTH），已切换
        text=[路由切换] 主模型 deepseek-official 失败（AUTH），已切换
```

| 已实证 | 结论 |
|---|---|
| `pre-step` 在 `request` **之前**触发，`decision.messages` 可读 | 条件路由的取数时机成立：本步用户消息（含 `ImageBlock`）在 route 决策前即可得 |
| 自定义 `kind: 'model-router'` + `form: 'notice'` 的 `user/message` 完整落库 | 外置插件可发自带中文通知；`createUserMessage` 不校验 source kind，`MessageSourceMap` 可 merge-extensible 且有客户端 fallback |
| append 发生在 recovery 途中，运行 exit 0、循环未被破坏 | 该放置点可用 |

客户端渲染路径已由源码确认（非实测浏览器）：`contextForm()` **只读 `form`** 且 `KNOWN_FORMS` 含 `'notice'`（[`event-projection.ts:38-53`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts#L38)）；未知 kind 走 `contextProducer()` 的 `default: { role: 'inject', label: kind }`，注释明写 "MessageSourceMap is merge-extensible; keep an unknown producer visible by its durable kind"（[`:60-76`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts#L60)）。notice 摘要应经 `boundContextSummary()` 限到 120 字符（[`message.ts:118-133`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/message.ts#L118)）。

**仍未实测**：浏览器里的实际折叠行样式。源码路径完整，但首版上线前建议用 web profile + 真实会话过一次。

### 7.9 仓库外插件的打包/安装/客户端半包：九个已踩实的坑

用一个本地目录包（`spike/plugin/`）经 UI「+ 添加插件」安装进 web profile 实测，逐条证实：

| # | 坑 | 正确做法 | 证据 |
|---|---|---|---|
| 1 | `dsh.bundle` 写成字符串被拒 | 必须是**对象**：`{ bundle: { patch: './cordis.patch.yml' } }`。`inspectionOf` 要求 `typeof bundle === 'object'`；`bundlePatchFiles` 读的是 `bundle.patch` | [`plugin-manager/src/index.ts:129-141,406`](file:///D:/sudy/github/deepseek-harness/packages/boot/plugin-manager/src/index.ts#L129)、[`app-boot/src/profile.ts:58-75`](file:///D:/sudy/github/deepseek-harness/packages/boot/app-boot/src/profile.ts#L58) |
| 2 | 行的 specifier 写成子路径，客户端半包不挂载 | 必须是**裸包名**。client module system 把包的浏览器半包挂在 specifier 为该包名的那一行上 | [`adding-a-settings-card.md:58`](file:///D:/sudy/github/deepseek-harness/docs/cookbook/adding-a-settings-card.md#L58) |
| 3 | `--patch` 覆盖层重复 insert 同一 id，把 bundle 的行顶掉 | **行只由 bundle 自己的 patch 插入**；`--patch` 只做禁用/改配置。Cordis `insert` 后写覆盖同 id 行，绝对路径行的 `nearestPackage` 会命中外层目录的 `package.json`（无 `dsh.client`）→ 整行静默变成"不是客户端行" | [`vendor/include/src/index.ts:79-101`](file:///D:/sudy/github/deepseek-harness/vendor/include/src/index.ts#L79)、[`vendor/loader/src/config/group.ts:51-52`](file:///D:/sudy/github/deepseek-harness/vendor/loader/src/config/group.ts#L51)、[`client-modules/src/index.ts:871-905`](file:///D:/sudy/github/deepseek-harness/packages/client/modules/src/index.ts#L871) |
| 4 | `exports` 没列 `./package.json` | Node 的 `exports` 是白名单，client-modules 靠解析 `<pkg>/package.json` 找包根，解析不到就静默丢弃整行 | 同 3 的 `locatePkgJson` |
| 5 | keyed slot 用 `id` 注册 | `plugins.bundle.config` 是 **keyed** slot，要用 `key: '<包名>'`，用 `id` 会在 console 报 `keyed slot ... requires options.key` 且不渲染 | [`ui-plugin-manager/src/client/slot-contract.ts:107`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-plugin-manager/src/client/slot-contract.ts#L107) |
| 6 | settings 命名空间用包名 | 必须是 **bundle patch 里那一行的 `id`**（`ns: entry.options.id`），不是包名 | [`settings/settings/src/index.ts:315,326`](file:///D:/sudy/github/deepseek-harness/packages/settings/settings/src/index.ts#L315) |
| 7 | store 投影缺 `form.shell()` | `SettingsForm` 在 `!state.available` 时只渲染一行 unavailable 文案；投影必须含 `form.shell()`（它带 `available`） | [`ui-primitives/src/settings-form/SettingsForm.tsx:55`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/settings-form/SettingsForm.tsx#L55) |
| 8 | 用 `/plugins/<pkg>/client.js` 探测半包 | **该 URL 形态永远 404**，不是合法路由。合法的是 combo `/plugins/??<id>/client.js&rev=<rev>` 与 chunk `/plugins/<id>/client.<name>.js?rev=<rev>` | [`client-modules/src/index.ts:225-251`](file:///D:/sudy/github/deepseek-harness/packages/client/modules/src/index.ts#L225) |
| 9 | 客户端半包必须搭 tsdown | **不必**。factory 格式可手写：`window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })`；JSX 用 `React.createElement` 避开 transform | 与真实产物 `dsh-client-ui-agent-preset/lib/client.js` 首尾比对 |

本地路径安装是 **reparse point（软链接）**指向源码目录，改动实时生效，不需要重装。

**单包即可，不必拆两包。** 早前猜测"host + client 必须拆成两个包"不成立——合体包在上述九条修正后客户端半包正常服务、表单正常渲染。原生做法参考 [`ui-settings-web-search`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-web-search/src/client/index.ts)（它的 host `apply` 为空只是因为它本来就只有 UI 半侧，不是硬性要求）。

### 7.9.1 配置表单已实测渲染

同一实例、独立浏览器页面复现，Plugins 页 → 已安装 → `dsh-model-router-spike` 渲染出：

```text
接管未配置的模型      关闭时，只有下面显式配置了备份链的模型会走路由。
备份链                按顺序尝试。第一个通常是用户自己选的那个模型。
provider | 模型 ID | 移除 | 添加候选
哪些失败会切换        限流 / 服务端错误 / 超时 / 网络传输失败 / 空回复
最多尝试次数          单个请求的硬上限，包含同渠道重试。
保存
包含的组件  共 1 个 · 1 运行中
```

标签全部来自插件自己的 `zh`/`en` locale 字典。**遗留保真度问题（spike 探针，不影响"表单能出现"）**：`switchOn` 五个布尔和 `takeOverOthers` 走的是 `SettingsValueField` 文本输入而非开关/复选框（手写 client.js 把它们当 `settingsTextField` 传给 `SettingsFormModel`）；`candidates`/`switchOn` 未注册进 specs，改动后保存按钮不变 enabled。正式实现要按字段类型选 `settingsBooleanField` 等并全部注册。

### 7.10 运行环境的三个陷阱

1. `session-persistence-jsonl` 的 `root: './.sessions'` 相对**进程 cwd** 解析，运行器必须 `Set-Location` 到 spike 目录，否则写进调用方目录。
2. `probe.log` 经 `new URL('./probe.log', import.meta.url)` 解析，落在模块所在的 `src/` 下而非 spike 根。
3. headless 的 provider 来自 `agentDefaultModel.currentSelection()`，**不是** `agent-loop.agents`；所以 stub 必须注册在 `deepseek-official` 这个 route 上才能被 agent 选中。

安装方式：`npm install @deepseek-ai/dsh`（536 包，约 2 分钟）。

## 八、能力元数据与数据通路核查（2026-10-12 晚，【源码证实】）

### 8.1 reasoningEffort：元数据可读，但失败路径是死的

`resolveModel()` 与 `modelCatalog` 均暴露 `reasoning.efforts`（[`types.ts:130-133`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/types.ts#L130)），但 `prepareCall` 对不支持的 effort 抛 `UNSUPPORTED_REASONING_EFFORT` 属于 preparation error：`prepareRequest` 的 try/catch 只吞 `NO_ADAPTER`、其余 rethrow（[`agent.ts:603-610`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L603)）；异常穿过 `step()`（[`agent.ts:410`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L410) 无 try）与 `turn()` 双层 catch（[`agent.ts:344-355,368-383`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L368)）直接终态，**不进** `agent/request-error`（唯一 dispatch 点 [`agent.ts:511`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L511) 只在流内终态 chunk 路径）。[`request-reconstruction.spec.ts:438-467`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/tests/request-reconstruction.spec.ts#L438) 断言该终态（零 adapter 请求、无 request/header）。`RequestErrorAction` 只有 `{kind:'retry'}|undefined`（[`runtime-types.ts:122`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L122)），无法表达"去掉 effort 重试"。

**结论**：Router 必须在 `agent/request` 返回候选前自行预校验——`ctx.llm.resolveCallConfig(candidate)`（`selectModel` 同款，[`commands.ts:156`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/commands.ts#L156)），不过即跳过该候选。两个自带 adapter 的 `resolveModel` 均为内存快照直读（[`llm-pi-ai/src/adapter.ts:300-309`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L300)、[`llm-deepseek/src/adapter.ts:37-39`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts#L37)），预校验无网络成本；外置 adapter 可实现为异步查找，真实成本由组合测试测定。

### 8.2 工具能力：无任何机器可读来源；不兼容走运行时 failover

`LlmModelInfo`/`LlmResolvedModelInfo` 唯一能力字段是 `inputModalities`（[`llm/src/types.ts:330-341`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/types.ts#L330)）；pi-ai SDK 的 `Model` 接口无工具能力字段（本地副本 `spike/node_modules/@earendil-works/pi-ai` 0.87.1 的 `dist/types.d.ts:805-830`；DSH 侧 [`llm-pi-ai/src/catalog.ts:248-307`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts#L248) 编译期 drift gate 逐字段枚举全部 compat flag，无一是"是否支持工具"）；`normalizeModelInfo` 白名单重建会丢弃 adapter 多返字段（[`llm/src/index.ts:805-815`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L805)）。

dispatch 前不按能力过滤 tools（[`llm/src/index.ts:1078-1095`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1078) 只投影图片与 toolUpdate）。模型不支持时由 provider 拒绝后规范化为 `INVALID_REQUEST`（[`llm-deepseek/src/transport.ts:33`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-deepseek/src/transport.ts#L33)）或 `PI_AI_ERROR`（[`llm-pi-ai/src/stream.ts:67`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/stream.ts#L67)）→ 终态 failure chunk → `agent/request-error` → llm-retry 不重试（不在 [`retry-policy.ts:18-24`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/retry-policy.ts#L18) 默认集）→ **Router 可承接切换**。

**结论**：`needs.tools` 不作资格条件；`INVALID_REQUEST` 进 switchOn 可选项（默认不勾）；分类跨 provider 不一致，README 声明。

### 8.3 插件投影可被客户端读取：设置页遥测的通路

- `sessionProjections.snapshot()` 遍历全部注册项，唯一门槛是 `def.wire === undefined`（[`session-projection/src/index.ts:339-353`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection/src/index.ts#L339)）；DSH 测试用非核心 key `test/last-user` 证明其出现在 list 行、history tail 页与 control baseline（[`session-projections.host.spec.ts:476-491`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/tests/session-projections.host.spec.ts#L476)）。
- `@Remote('list')` 收空请求、无 sessionId（[`session-controller/src/index.ts:259`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/index.ts#L259)），返回行自带 `projections` hints（live 走 `cachedSnapshot` 零 I/O，cold 读 checkpoint；[`list.ts:291-329`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/list.ts#L291)）。
- `@Remote('projections')` 按 sessionId 返回含插件贡献值的 `values`（[`index.ts:506-539`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/index.ts#L506)；[`types.ts:80-82`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/types.ts#L80) 开放索引即编译面外键）。
- client 半包直连可行：`inject: ['remote','remote.session']` + guard 只查声明（[`guard.ts:210-217`](file:///D:/sudy/github/deepseek-harness/packages/extensions/cordis-client-runner/src/client/guard.ts#L210)）；同型先例 `ui-settings-models` 在设置卡片调 `ctx.remote.session.modelCatalog()`（[`ui-settings-models/src/client/store.ts:236`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-models/src/client/store.ts#L236)）。
- 硬约束：key 带命名空间（`router/failover-history`）、`stateVersion` 从 1 起只增（撞键不同版本抛，[`session-projection/src/index.ts:279-281`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection/src/index.ts#L279)）；wire view 守 UI-scale——每个 tail 页携带全部 client-visible key、无按 key 裁剪（[`session-projection/README.md:129`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection/README.md#L129)）；state 必须 plain JSON；view 返回对象复用引用；注册是 fiber 效应，卸载即 key 消失；客户端类型靠 declaration merge + 纯类型出口 type-only import。

**结论**：遥测抽屉只做"最近故障转移历史"（`list` → 对最近 N=20 个会话 `projections`）；健康度/延迟/冷却不做。

### 8.4 配置生命周期：更新先校验后重启，炸插件不炸应用

Cordis `fiber.update(config)` 先校验再 `restart()`（[`fiber.ts:731-751`](file:///D:/sudy/github/deepseek-harness/vendor/cordis/src/fiber.ts#L731)）；DSH 插件范式是 zod schema 管字段级 + `apply()` 里 `validateConfig()` 管跨字段、加载即抛（[`llm-retry/src/index.ts:30,123-124`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L30)）。校验失败的爆炸半径是插件 fiber，不是 DSH 本体。

**结论**：结构错误（ID 重复、上限非法、候选为空）硬失败；provider 未注册（环境漂移）降级为该 profile 停用 + warn + UI 徽章。

### 8.6 lineage 投影与设置页读取（2026-10-13，【源码证实】）

- `SessionProjectionRegistry.register()` 接受带 wire 块的定义即对客户端可见；`snapshot(session)` 遍历全部注册项、唯一门槛是有无 wire（[`session-projection/src/index.ts:339-353`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection/src/index.ts#L339)）。插件经 `ctx.get('sessionProjections')` 可选注册（无该服务的组合仍可路由，仅历史视图降级）。key 必须命名空间化（`router/failover-history`），`stateVersion` 从 1 起。
- failover 标记 = `request/header` 的 `reason: 'change'`（[`session/types.ts:273`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L273)）+ 前一个失败 attempt 的 code；用户主动换模型（无前序失败）不记入。组合测试已从 durable log 直证 `['initial','change']` 序列。
- **投影缓存是 fire-and-forget 写回**：`turn/end` 是必写点但异步（[`session-projection-cache/src/index.ts:96-103`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection-cache/src/index.ts#L96)），CLI 退出会竞态掉最后的写——集成测试断言缓存行时需在 overlay 里把 `writeEveryEvents` 调小。
- **client 半包远程调用解析出的是 `{ok, value}` 信封**，不是裸值（先例：`ui-settings-models/src/client/store.ts:236`、`ui-model-selection/src/client/catalog.ts:56` 均读 `response.value`）；`session/list` 收空请求、行带 cached 投影 hints，`session/projections` 按 sessionId 返回 live `values`（**响应不带 `kind` 字段**，勿以其门禁）。
- **测试环境坑**：`--patch` overlay 改写某插件行的 config 后，同一 boot 内该 ns 的 settings 保存会被 revision 冲突拒绝（overlay 应用与 describe 的 revision 竞态）；无 overlay 的 boot 保存正常。插件保存路径本身已在多个 boot 实证。
- **notice 的 chat 呈现（2026-10-13 浏览器实测）**：notice 形态的 `user/message`（`source.kind !== 'user'`）被对话装配器归类为 **context 节点**（[`ui-chat/src/client/conversation-nodes/message.ts:76`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/message.ts#L76)），经 `ContextMessageNodeView → ContextInjectionRow` 渲染；本 build 中该行不出现在对话视图（DOM 无 `[data-context-form]`、无折叠组），但**轨迹视图完整渲染**（"上下文，[路由切换] 主模型 …失败（限流），已切换至 …（候选 2/2）"）。DSH 自己的 model-selection notice 走同一代码路径，呈现策略一致；未知 producer 的 `ContextInjectionRow` 还会折叠掉 summary（[`ContextInjectionRow.tsx:63`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/chat/ContextInjectionRow.tsx#L63)）。**结论：notice 的权威可见面是轨迹视图**，插件的 notice 形状（form+summary+surfaceOp append）与官方惯例一致。
- **热卸载与 fork 一致性（2026-10-13 浏览器实测）**：bundle 开关关闭后同渠道重试 5/5 后如实失败（RATE_LIMIT）且无跨候选转移——监听器随 fiber 清理干净；重新启用后 failover 立即恢复。fork 会话从继承前缀重建投影：抽屉出现同时间戳的两条（原会话 + fork），证明 ledger 是 log 的纯函数。

### 8.5 条件路由取数（2026-10-13，【源码证实】）

- `agent/pre-step` 的 payload 为 `{ agent, messages: UserMessage[], turn, step, signal }`（[`runtime-types.ts:320`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L320)）；spike 7.7 已实测它在 `agent/request` 之前触发且消息可读。图片判定用与 llm 层一致的规则：内容块 `type === 'image'`（[`llm/src/index.ts:1078-1082`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1078) 的文本模型图片投影同款）。
- `contextPressure` 投影的 **wire view** 才产出 `projectedTokens`（= `pressureTokens + surfaceTokens - sampledSurfaceTokens`），且仅在首次用量采样后存在（[`usage-projection.ts:208-216`](file:///D:/sudy/github/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts#L208)）；host 侧经 `ctx.sessionProjections.snapshot(session).values['contextPressure']` 读该 canonical 值（[`session-projection/src/index.ts:339-353`](file:///D:/sudy/github/deepseek-harness/packages/session/session-projection/src/index.ts#L339)），不自行复算公式。未采样/未安装 token-meter 时读作 undefined，`minContextTokens` 门按“未满足”处理。
- 取数时机：两个源都在 route 决策之前且重试不重跑，条件在一步内稳定。用户自己的路由（钉死 primary / default 隐式第一跳）豁免条件——跳过它就是无失败静默改路。
