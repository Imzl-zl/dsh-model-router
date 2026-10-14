---
title: "DSH Model Router — 架构设计"
status: "proposal"
kind: "architecture-overview"
last_updated: "2026-10-12"
---

# DSH Model Router — 架构设计

## 摘要

研究 DSH 是否能通过 Cordis 插件把一次 Agent 主请求转发至用户配置的有序 provider/model candidates，并定义失败恢复与可观测性。逻辑 profile、透明故障转移和最终产品范围尚未选定；方案应复用 Agent 扩展点与已注册 adapters，不复制 HTTP 协议或自行管理 API 密钥。

当前源码表明，Agent 主请求可在 `agent/request` 选择物理 route，并在 `agent/request-error` 触发同一 step 重试；但它尚不能自然表达逻辑 profile identity、route attempt durable lineage 或 model selection 中的逻辑/物理双身份。本设计建议先验证外置插件的 Agent-only 主请求方案；完整产品范围仍由用户决定。

## 目录

1. [目标和非目标](#目标和非目标)
2. [DSH 中的真实请求路径](#dsh-中的真实请求路径)
3. [设计结构](#设计结构)
4. [执行与失败流程](#执行与失败流程)
5. [配置格式草案](#配置格式草案)
6. [会话记录、重放和 UI](#会话记录重放和-ui)
7. [主要设计约束](#主要设计约束)
8. [实现阶段](#实现阶段)
9. [当前提案与未决决定](#当前提案与未决决定)

## 目标和非目标

### 目标

- 用户选择一个逻辑模型或真实模型时，可以配置有序的物理 provider/model candidates。
- 同渠道尝试数和跨渠道 failover 条件明确，总请求尝试次数可解释。
- 失败策略使用 adapter-normalized `LlmFailure.code` 与实际 provider retry policy，不解析错误文案。
- 复用 adapter 的模型能力校验、取消、错误规范化和请求协议。
- 用户可以理解请求实际使用的渠道、失败 attempt 与最终结果。
- 插件卸载时清理监听、状态与等待，不复制 provider 凭证。

### 非目标（MVP）

- 自建 provider HTTP client、密钥库、兼容网关或 token 计费系统。
- 基于延迟/价格/吞吐的自动测量调度、权重、轮询、并发探测或全局分布式熔断。
- 自动推断不同模型族的上下文、工具、图像或推理能力等价。
- 修改 DSH 主循环，除非 spike 证明公开插件 API 无法满足目标产品语义。

## DSH 中的真实请求路径

Agent 主请求的运行顺序：

1. Agent 运行 `system-prompt/assemble`，随后运行 `agent/pre-step` 并可能提交 `step/start`。
2. `agent/request` waterfall 在 system/user input admission 前形成 provider/model 与 controls；已安装的 model-selection listener 会在此 waterfall 写入本步选择。
3. `ctx.llm.prepareCall(config)` 解析并绑定这次请求的 adapter registration、模型元数据、默认值和 retry policy。
4. Agent 按准备结果写 `request/header`、`request/context`，从 Session 派生冻结的请求。
5. `preparedCall.stream(request)` 进入 `llm/stream` waterfall；prepared dispatch 仍使用准备时绑定的 adapter。
6. Adapter dispatch、iterator construction 或 iteration 抛出的错误由 LLM runtime 转为终态 failure chunk；Agent 结算 `assistant/attempt` 后分发 `agent/request-error`。Agent 自身在首个 chunk 前抛出的 middleware/consumer error 则直接结束 step。返回 `{ kind: 'retry' }` 后回到 `agent/request` 重新准备。

因此 Agent 主请求的 route selector 是 `agent/request`，不是 `llm/stream`。在 `llm/stream` 修改已 prepare 请求的 provider 不能重新绑定 adapter；从该 waterfall 递归调用 `ctx.llm.stream()` 也不是安全的 dispatch 机制。

`agent/request-error` 提供失败的物理 provider、规范化 failure 和 adapter registration 捕获的 retry policy。`llm-retry` 可在此 waterfall 安排重试，并用 `llm/retry` / `llm/retry-started` 记录排程与等待完成。Normal policy 在 failure code 可重试、预算未耗尽且 provider retry-after 不超过 policy 上限时自行安排重试；否则委派下游。Always policy 先 await downstream；若下游未返回 retry 且操作仍可继续，再安排自己的重试。Waterfall 顺序决定 Router 能否观察或截断该决策；真实 Cordis composition 必须确定两个 listener 的顺序和唯一预算 owner。Always policy 无次数上限，不能同时声称 route chain 有界，除非 Router 明确接管或限制总次数。

## 设计结构

本项目的一个插件包可包含以下内部职责：

- **Route profile**：稳定 ID、用户可见名称与有序 candidates。
- **Route candidate**：已注册物理 provider、确切 model ID、可选受限 controls；凭证和 API 地址由原 provider adapter 管理。
- **Candidate eligibility**：使用 adapter model metadata 与实际 request 判断模态、工具、reasoning、上下文和 controls 兼容性。
- **Agent routing coordinator**：按 Agent 隔离 route selection 与 request attempt 状态，并在卸载时释放。
- **Attempt state**：表示本 step 的 candidate、失败和剩余预算。是否必须 durable/restart-safe 尚未决定；`appendPluginRecord()` 是实验性且 best-effort，不是外部插件关键恢复存储。
- **Settings surface**：候选配置与顺序编辑；如需 Settings UI，可用 DSH Models 页面已声明的 provider-card/footer slots。
- **Diagnostics**：可关联逻辑 profile 与实际 provider/model、attempt 顺序和 failure code；不得包含 prompt、凭证或完整响应。

不同模型 ID 的映射必须显式由用户配置，不按名称相似性推断等价。adapter 提供的模型能力与 metadata 仍是唯一技术依据。

## 执行与失败流程

### Agent 主请求的候选流程

下列流程是设计约束，不是已实现的插件行为：

1. `agent/request` 选择一个已注册 adapter 可解析的真实 provider/model candidate。
2. `prepareCall()` 为该物理 route 绑定 registration、model capabilities、默认值和 retry policy。
3. Agent 将实际物理 route 写入 request header/context，并 dispatch 到所绑定 adapter。
4. 成功时 assistant source 和 usage 对应实际 candidate；profile/attempt lineage 需由受支持的状态机制表达。
5. Adapter dispatch、iterator construction 和 iteration error 由 LLM runtime 规范化为终态 failure chunk 并进入 `agent/request-error`；`NO_ADAPTER` preparation error 会在 Agent 中延迟至 dispatch，因此也进入该路径。其他 preparation error、`llm/stream` middleware error 和 consumer error 可能直接终止 step。Route 不得假定所有失败都会触发下一 candidate。
6. Retry 或跨 candidate failover 必须有唯一的预算 owner；有界 candidate chain 应有硬性总上限。
7. Candidate 切换不得伪造物理 provider、凭证或失败诊断。

### Failure 类别提案

`LlmFailure.code` 是开放字符串，不是封闭 union。它是 adapter-normalized 的 machine identity；实现阶段须用目标 adapter 的源码与测试核验 code 映射，不解析错误消息或套用通用 HTTP 规则。

DSH normal retry policy 的默认 eligible codes 是 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`，默认最多 5 次 eligible retries。Always mode 不限制 retry 次数。该 policy 不定义 failover 的默认集合；取消、能力/输入错误、`NO_ADAPTER`、凭证错误和 quota 是否转移必须是明确策略。

### 故障状态范围

- **request/step budget**：一个用户请求内每个 candidate 的次数与整个 route chain 上限。
- **Agent/Session health**：跨请求失败统计，不隐式改变当前 route。
- **auto-disable（熔断）**：命中用户配置的规则后把渠道凉一段时间，冷却到了自动放行重试；状态在插件进程内存，保存配置时重置。跨 Agent 共享、多实例一致性与持久化未做，见 [决策笔记](../../.agents/notes/implemented/2026-10-14-channel-health-rework.md)。

不得将 provider retries、跨渠道 failover 和跨请求健康/禁用当作同一计数。

## 配置格式草案

以下 YAML 仅为说明字段关系的概念配置，不是可执行 DSH plugin config；其字段与示例值均未确认，不代表产品默认值：

```yaml
- name: dsh-model-router
  config:
    profiles:
      - id: coding-main
        displayName: Coding model
        logicalModel: coding-model
        candidates:
          - id: provider-a-primary
            provider: provider-a
            model: model-x
            maxAttempts: 3
          - id: provider-b-backup
            provider: provider-b
            model: model-y
            maxAttempts: 1
        retry:
          eligibleFailureCodes: [RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]
          initialDelayMs: 500
          maxDelayMs: 10000
          jitterRatio: 0.1
        maxTotalAttempts: 4
```

配置 parser 应验证 profile/candidate ID 唯一、引用存在、attempt 上限有界且合法、delay 范围有效，以及候选 route 是否可由已注册 adapter 解析。由于 failure code 是开放字符串，不得校验成封闭枚举；retryability 应显式配置或遵循实际 provider policy。排序和 config version 的来源仍需定义。

## 会话记录、重放和 UI

### 逻辑与物理模型身份

DSH 的模型选择、request header/context、assistant message source、usage 与 replay 基于真实 provider/model。Session controller 对 pending model selection 的完成判断也比较真实 request header 与 pending provider/model。把逻辑 profile ID 写进 provider 字段会令 runtime 查找不存在的 adapter；将 header 后处理成逻辑身份会破坏实际执行记录。

DSH `installModelSelection()` 在 `agent/request` listener 调用 `next()` 后，会将该 step 捕获的选中 provider/model 写回配置；prompt variables 和 model-switch notice 也来自此 selection。waterfall 的数组首个 listener 是最外层且其返回值即最终值，所以 **Router 只有注册在 selection listener 外侧（数组前侧）才能拿到最终 route**；用 `prepend: true` 可取得确定位置，因 `agent/request-error` 上的 `llm-retry` 与 Router 同为 root 级注册、先后由 `apply()` 执行次序决定而非 cordis.yml 书写顺序。必须在真实 Loader composition 中验证 listener 顺序、header、notice 和 pending selection 对账；次序机制与证据见[能力边界](dsh-capability-boundary.md)。

### 透明故障转移的三个必然后果

选项 A（用户选真实模型，插件按策略改用候选）会产生三个确定性后果，均已在源码核实，属产品决策而非待验证项：

1. **每次 failover 在下一步追加一条 durable "model changed" notice**。`agent/pre-step` 的 prepend listener 比较 `selection.assembled` 与 `session.requestHeader()?.config`，不同即向本步消息追加 user-role notice（[`model-selection.ts:113-126`](file:///D:/sudy/github/deepseek-harness/packages/core/agent/src/model-selection.ts#L113)）。failover 后 last header 是候选渠道，与用户选择不同，故 notice 必然触发，且它是 model-visible 的 user 消息。文本为真但用户从未请求；抑制它需抢在 host 的 prepend listener 之前，比接受更差。
2. **UI `next` 停留在未兑现的 pending**。`next = pending ?? lastUsed`，pending 只在某个 `request/header` 与它完全相等时清除（[`model-selection-projection.ts:52,65`](file:///D:/sudy/github/deepseek-harness/packages/api/session-controller/src/model-selection-projection.ts#L52)）。failover 后 `lastUsed` 是实际候选，`next` 仍指向用户选择。
3. **`request/header` 记 `reason: 'change'`**（[`agent.ts:643-648`](file:///D:/sudy/github/deepseek-harness/packages/core/agent-loop/src/agent.ts#L643)），Session 留下真实渠道变更轨迹。

以下仅为待决设计选项，并非完整方案：

- **透明物理模型故障转移**：用户选择真实模型，插件按明确策略改用候选；需在物理模型 header、选择提示及执行归因之间定义一致语义。
- **逻辑模型 profile**：selector 展示逻辑 profile，同时记录逻辑 profile 与实际物理 route。该方案需先定义 DSH catalog、selection 与 Session projection 支持；仅加 Settings 卡不会增加 Session selector 项。

### Attempt persistence 与 partial stream

每个 attempt 的 stream chunks 以 transient frames 发布；结束时 Agent 将 stream 作为 `assistant/message` 或 `assistant/attempt` 持久化。失败的 `assistant/attempt` 不进入 message surface 或下个请求的派生历史。Client 在失败或 interrupted settlement 后按 attempt ID 退役 transient rows，并重放受影响的 conversation contexts；成功 assistant message 的 transient rows 可保留到对应 `step/end`。

`agent/request-error` 的 retry action 本身不追加 `llm/retry`。`llm-retry` 写入 retry schedule/start records；Chat assistant projection 收到 `llm/retry` 时清空同 step 内容，同时保留 first-token 时间。直接 Router retry 在失败 settlement 的 transient rows 清理后也会重放 Assistant projection，但不会保留 first-token 时间或留下相同的 `turn-process` retry evidence。用户是否要求 schedule、等待状态和此类 evidence 可重放，仍需决定。

`llm-retry` 从 durable events 恢复本 step/provider/policy 的 retry 计数；Router 的 candidate index 若只保存在进程内，Agent 重建或进程重启后可能再次选中此前失败的 candidate。`appendPluginRecord()` 仅用于实验性、可丢失的插件状态，不能承诺关键 route recovery。要求 restart-safe 时需先定义受支持的持久化机制。

### Settings UI 与辅助模型调用

Models UI 有 `settings.models.provider-card` 和 `settings.models.footer` 扩展位置；它们不增加逻辑模型至 Session selector。Compaction 与 session-title 调用都以 `ctx.llm.stream()` 直接发起，不经由 Agent request recovery。MVP 若只用 Agent hooks，必须明确范围仅覆盖 Agent 主请求。

## 主要设计约束

- **起点策略**：`order` / `weight` / `round-robin` 三种，只决定从哪条候选开始，失败后的前进逻辑与策略无关。用户自己选的那一条永远在链上且永远被尝试，但权重/轮询下不一定是第一跳。
- **Retry 预算**：Route 与 `llm-retry` 必须由真实 listener composition 证明不会互相嵌套；`always` policy 的无限重试需显式处置。
- **能力校验**：对每个候选验证实际 request controls 和 model metadata；adapter `prepareCall()` 是最终能力权威。准备/配置错误不会自动进入 `agent/request-error`。
- **日志**：request header 与 assistant source 保留真实物理 provider/model；逻辑 profile 需以可恢复方式单独记录。
- **取消**：`AbortSignal` 取消结束当前操作，不切换到备用渠道。规范化 failure code `ABORTED` 若未伴随 signal abort，仍是传给 `agent/request-error` 的 failure；Router 必须明确拒绝或允许这种候选转移。
- **流式失败**：terminal failure 的 partial 可在 durable settlement 前短暂显示；失败 settlement 后 transient rows 按 attempt ID 退役并重放 conversation contexts。`llm/retry` 另负责持久化 retry schedule、保留 Chat first-token 时间并提供 turn-process evidence。直接 retry 的 Router 不产生这些 retry records。
- **并发**：Agent 可并发；route 状态按 Agent/step 隔离，不共享可变 candidate index。
- **配置快照**：一个 request 固定 profile config snapshot/version；设置更新作用于后续请求。
- **热卸载**：清理 listeners、state、timer 与 Settings/UI 注册，且不遗留等待中的 recovery operation。

## 实现阶段

1. **产品边界与 spike 前提**：用户决定透明物理模型故障转移还是逻辑模型 selector、重启恢复要求和辅助调用范围；技术侧确认 `installModelSelection()` listener 排序与 route intent 交接方式。
2. **Agent-only 技术 spike**：在真实 Loader composition 验证候选选择、真实 prepare/dispatch、`llm-retry` 预算、取消、有界 attempt、partial settlement/UI、model selection 与热卸载。
3. **MVP 插件**：仅在 spike 证明语义正确后确定 schema、状态 owner、Settings UI、diagnostics 与 replay/recovery tests。
4. **逻辑模型/核心扩展**：仅当产品决定 selector 展示 profile 时，设计 catalog、selection、route identity 和 Session projection 的最小 DSH 扩展。
5. **生产级调度**：跨进程 health store、latency/price 路由由实证需求触发；权重/轮询/熔断已在插件内实现，细节见 [决策笔记](../../.agents/notes/implemented/2026-10-14-channel-health-rework.md)。

产品可见插件须有真实 Cordis Loader composition 测试，不能只靠手造 Context 单测。DSH 对应包规则见其 `packages/AGENTS.md`；本设计仓库未运行插件测试。

## 当前提案与未决决定

当前提案建议从 Agent 主请求扩展点验证插件路由，不在 prepared `llm/stream` 中改 route，也不递归调用 LLM service。它不等同用户已批准产品范围。

逻辑模型或透明 failover、跨进程持久化、failure 策略、`llm-retry` 责任边界、辅助调用覆盖与 DSH 核心扩展仍待决定；详见[未决问题](open-questions.md)。
