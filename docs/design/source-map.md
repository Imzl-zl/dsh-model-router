---
title: "DSH Model Router — DSH 源码地图"
status: "verified-source-facts"
kind: "architecture-reference"
last_updated: "2026-10-12"
---

# DSH Model Router — DSH 源码地图

## 摘要

本页定位与外置路由设计直接相关的 DSH 实现。源码根目录为 `D:\sudy\github\deepseek-harness`；链接使用该工作区的本地 `file:///` URI，因为它与本项目根目录并不相邻。行号是核对时的定位提示，源码更新后须重新核验。

## Agent 主请求

- [`runtime-types.ts:337`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L337) 声明 `agent/request` 配置 waterfall。它在 prompt assembly 与 `step/start` 后、system/user input admission 和 `prepareCall()` 前运行；payload 提供 Agent、turn、step 与 signal，不含最终消息/tool 请求体。
- [`agent.ts:400`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L400) 的 Agent `step()` 每次循环重新运行 `prepareRequest()`，然后追加 system/user 输入并记录请求。
- [`agent.ts:563`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L563) 的 `prepareRequest()` 运行 `agent/request`，随后调用 `ctx.llm.prepareCall()`；`NO_ADAPTER` 会延迟至 dispatch 转成 failure chunk，其他 preparation errors 可直接中止 step。
- [`agent.ts:615`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L615) 的 `buildRequest()` 将 resolved config 写入 `request/header`，将 provider/model 与 adapter capability 中的 contextWindow/systemPromptUpdate 写入 `request/context`，再从 Session 派生模型历史并构建冻结请求。
- [`agent.ts:452`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L452) 将 prepared call 的 stream 结果送进 Agent stream accumulator。
- [`agent.ts:506`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L506) 对已启动 stream 的 terminal finish `error/aborted` 追加 `assistant/attempt`，再分发 `agent/request-error`；listener 返回 retry 后从同一 step 的循环顶部重新准备。Agent 自身在首个 chunk 前抛出的 errors 走单独 catch 并直接结束 step。Adapter dispatch、iterator construction 和 iteration error 由 [`llm/index.ts:1161`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1161) 的 `adapterFailureChunk()` 转成终态 `finish` chunk：signal 已取消或 failure code 为 `ABORTED` 时判为 `aborted`，否则为 `error`。
- [`runtime-types.ts:353`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/runtime-types.ts#L353) 定义失败恢复输入：失败 request 的 provider、规范化 failure、adapter registration 捕获的 retry policy 与 abort signal。

## Adapter 捕获与 `llm/stream`

- [`llm/index.ts:933`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L933) 的 `prepareCall()` 在异步模型解析前捕获实际 provider registration；返回的 one-shot `PreparedLlmCall` 同时携带 resolved config、模型能力、retry policy 和 dispatch。
- [`llm/index.ts:1041`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1041) 的 `adapterStream()` 对 prepared dispatch 使用其捕获的 registration/adapter call；[`llm/index.ts:1062`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1062) 还会拒绝与 resolved config 不一致的 prepared options。
- [`llm/index.ts:1135`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L1135) 说明 `llm/stream` 位于 stream dispatch 路径；prepared call 仍保留固定 dispatch。
- [`service.spec.ts:1450`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/tests/service.spec.ts#L1450) 证明未准备的直接 `ctx.llm.stream()` 在 adapter 解析前可由 `llm/stream` listener 改 route；此行为不能外推至 Agent prepared call。
- [`types.ts:552`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/types.ts#L552) 定义请求上的可选 `purpose`，包括 `compaction` 与 `session-title`；[`summarizer.ts:160`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts#L160) 与 [`session-title-llm/index.ts:264`](file:///D:/sudy/github/deepseek-harness/packages/session/session-title-llm/src/index.ts#L264) 都以 `ctx.llm.stream()` 发起这些调用，不走 Agent request recovery。
- [`session/index.ts:984`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/index.ts#L984) 的 `deriveMessages()` 从 `surfaceOp` 标记的 message-producing events 派生模型历史；`assistant/attempt` 等 log-only event 不进入该历史。

## Retry 与失败

- [`llm-retry/index.ts:123`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L123) 注册重试 projection；重试次数按 Session 的 `step/start` 和 `turn/end` 清理，并由已记录的 `llm/retry` 恢复。
- [`llm-retry/index.ts:194`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-retry/src/index.ts#L194) 的 recovery listener：normal policy 在 failure code eligible 且预算未耗尽时自行 backoff，否则 delegate；always policy 先 await downstream，若未收到 retry 且未 abort 才执行自己的 backoff。Backoff 追加 `llm/retry`，等待成功后追加 `llm/retry-started` 并返回 retry。
- [`retry-policy.ts:14`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/retry-policy.ts#L14) 当前 normal policy 默认最多 5 次 eligible retries（不含首次调用），默认 code 为 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`；adapter 可配置自己的 policy。always 模式没有重试上限，只受取消与插件生命周期约束。
- [`agent-loop` request-error tests](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/tests/request-error.spec.ts#L52) 验证多次同一步失败后 retry；相邻 tests 验证 cancellation 优先于 retry action、recovery listener error 不触发下一次请求。
- [`session/types.ts:350`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L350) 定义 `assistant/attempt`：一次没有提交可见 surface message 的 model attempt，嵌入压缩 stream，保留失败、重试、取消或 stream-error attempt，且不伪造模型可见历史。
- [`session/index.ts:468`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/index.ts#L468) 说明 `appendPluginRecord()` 属实验性 API，生产调用限制于 `packages/experimental/`；record 对未知 reader 可忽略，格式迁移只 best-effort 保留，不适合作为外部插件的关键恢复状态承诺。
- [`session/index.ts:798`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/index.ts#L798) 的公开 `Session.append()` 仅接收 `SessionEventMap`；仓库 gate 同时限制生产调用者在 `packages/experimental/` 内使用 `appendPluginRecord()`。

## Partial stream 的呈现与重试

- [`agent.ts:443`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L443) 在接收 stream chunks 前创建独立 assistant attempt；[`assistant-stream.ts:63`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/assistant-stream.ts#L63) 发布 transient frames。
- [`agent.ts:491`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L491) 在 failure recovery 前将失败 stream 结算为 durable `assistant/attempt`；[`session/types.ts:350`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L350) 规定该记录不进入模型可见历史。
- [`session-controller/assistant-stream.ts:124`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts#L124) 规定 interrupted、failed、abandoned attempts 即时退役 transient rows；成功消息的 rows 保留至 Step 结束。失败 settlement 通过 [`session.ts:715`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/client/sessions/session.ts#L715) 交给 conversation assembler。
- [`assistant.ts:317`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/assistant.ts#L317) 收到 `llm/retry` 时重置当前 step 的 Assistant state，但保留 first-token 时间；[`turn-process.ts:64`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts#L64) 不将 `assistant/attempt` 计作可见答案，`llm/retry` 则作为 process evidence 见 [`turn-process.ts:87`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts#L87)。
- 每次失败 settlement 都按 attempt ID 退役 transient rows，并重放受影响的 conversation contexts；Chat 内容 reset 由 `llm/retry` 单独驱动。直接 Router retry 不产生 retry schedule/start records 或 `turn-process` retry evidence。

## 模型身份、目录与 UI

- [`model-selection.ts:63`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L63) 说明 selection 如何用于 prompt 和 request；[`model-selection.ts:96`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L96) 注册 `agent/request` listener；[`model-selection.ts:113`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L113) 注册 `agent/pre-step` notice listener。Selection 字段见 [`model-selection.ts:21`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L21)。
- 同一 `agent/request` waterfall 中，此 listener 调用 `next()` 后把自身捕获的 selection 写回 provider/model；因此其他 router listener 的先后顺序会决定谁拿到最终 route。`system-prompt/assemble` 也只把已选 provider/model 写入 prompt variables。
- [`commands.ts:151`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/commands.ts#L151) 先通过当前模型 catalog 验证 GUI 选择，再解析具体 route config 并设置 Session 下一次请求 selection。
- [`model-selection-projection.ts:39`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/model-selection-projection.ts#L39) 遇到 `model/selection` 时建立 pending selection；任何 `request/header` 都更新 last-used，只有 header provider/model/reasoningEffort 与 pending selection 全相同才清除 pending。
- [`catalog.ts:24`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/catalog.ts#L24) 从已注册 provider 与 adapter model lists 建立按 provider 分组的 GUI model catalog；Settings slot 本身不扩展 Session selector。
- [`slot-contract.ts`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-models/src/client/slot-contract.ts) 定义 Settings Models 页 provider-card 与 footer slots，可扩展配置 UI。

## 多 provider 配置先例

- [`llm-pi-ai/config.ts`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/config.ts) 验证 provider profiles 并从设置生成有序 route profile snapshot。
- [`llm-pi-ai/index.ts`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/index.ts) 监听配置变化并注册/替换 adapter routes。
- [`llm-pi-ai/adapter.ts`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts) 将 profile 与 adapter model collection 作为不可变 snapshot 使用，避免动态设置在请求准备期间分裂。

## 模型发现（model discovery）

- [`llm/src/index.ts:557`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L557) `registerModelDiscovery(settingsNs, discover)` 以 **settings namespace** 为键登记一个端点查询实现，随 fiber 卸载撤销；空 ns 抛 `INVALID_DISCOVERY`，同 ns 重复登记抛 `DUPLICATE_DISCOVERY`（[`:566`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L566)、[`:569`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L569)）。
- [`llm/src/index.ts:589`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L589) `discoverModels(settingsNs, request)` 先在登记表里查 ns，查不到抛 `NO_DISCOVERY`（[`:596`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L596)）；`provider` 与 `baseURL` 都为空时抛 `INVALID_DISCOVERY`（[`:601`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L601)）。两个判断都在调用任何 discovery 之前，因此这两种码意味着**请求从未发生**。
- [`llm/src/index.ts:630`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/index.ts#L630) `@Remote('discoverModels')` 把所有失败包成 `RemoteError('llm/model-discovery-rejected', message)`，`details` 只带 `settingsNs` 与 `baseURL`，原始 `LlmError.code` 不进 wire（[`types.ts:301`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/types.ts#L301)）。跨 Remote 消费方只能按 message 区分失败，而 [`error.ts:14`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm/src/error.ts#L14) 的契约是 `route on this, never by parsing message`。
- 只有 [`llm-pi-ai/src/index.ts:275`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/index.ts#L275) 调用 `registerModelDiscovery`。DeepSeek 家族的 `registerDeepSeekProvider` 只调 `registerAdapter`（[`llm-deepseek/src/host.ts:55`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-deepseek/src/host.ts#L55)），它收到的 `discoverModels` 依赖只喂给 adapter 的 `listModels`（[`llm-deepseek/src/adapter.ts:35`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts#L35)）。所以 `deepseek-official` / `deepseek-account` 在 `listConfigurableProviders` 里看得见、可配置、可用，而 `discoverModels` 对它们必然 `NO_DISCOVERY`。
- [`llm-pi-ai/src/discovery.ts:288`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts#L288) 在无 catalog 且无 baseURL 时抛 `DISCOVERY_FAILED`、[`:301`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts#L301) 对不可列协议抛 `DISCOVERY_UNSUPPORTED`、[`:243`](file:///D:/sudy/github/deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts#L243) 对不可用 key 抛 `INVALID_CREDENTIAL`。这些码由 **被调用的** discovery 自己抛，是该渠道对本次查询的回答，与 runtime 的前置拒绝不是一类。
- DSH 自己的 Models 页把所有 discovery 失败塌成一种：[`ui-settings-models/src/client/operations.ts:102`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-models/src/client/operations.ts#L102) 只区分 `found` 与 `refused`，没有可复用的分类。

## 实现时的复核要求

这些引用定位的是当前 checkout 中的实现，不构成外部插件 API 承诺。进入实现阶段前，重新读取目标分支源码、测试、子目录 `AGENTS.md` 和 DSH 持久化变更审查规则；行号有变化时以当前代码为准。
