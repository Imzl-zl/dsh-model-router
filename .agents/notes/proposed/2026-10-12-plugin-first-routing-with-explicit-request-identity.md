# Agent Note: 先验证插件路由，不伪装逻辑模型身份

Status: proposed

## Problem

DSH 已有 Agent request middleware 与 failed-request retry hooks，可以让插件挑选物理候选并在失败后重试。DSH GUI selection、请求 header、assistant source 与 session projection 却以物理 provider/model 为键，若插件把虚拟逻辑模型 ID 当成 provider 写入，核心 adapter 无法解析；若静默换成物理候选，则 UI/Session 可能将故障切换误读成用户切换模型。

## Decision

先以外置 Cordis 插件验证 Agent 主请求的有序物理候选与有限 failover，不修改 DSH 仓库；只有源码证明纯插件无法保持所需的模型身份、失败状态恢复或 UI 语义时，才提出范围最小的 DSH 核心扩展。

可检验条件：

1. Agent 主请求的候选选择发生在 `agent/request`，候选必须是已注册 adapter 能解析的真实 provider/model。
2. 失败只通过 `agent/request-error` 恢复；取消失败、超出总预算或明确不可重试错误不会无限重试。
3. 不能在已经绑定 adapter generation 的 `llm/stream` 上切换 provider，不能从该 waterfall 递归发起 `ctx.llm.stream()` 来充当 adapter dispatch。
4. GUI 逻辑 profile 选择或 restart-safe route state 若未被公开扩展点支持，必须分别作为核心 catalog/identity 扩展或 durable Session recovery 扩展评估，不能伪造 header 或当作已支持能力。

## Alternatives considered

1. 先向 DSH runtime 添加虚拟 provider/router adapter 与 nested dispatch API。
   - 最强的理由：可在一次 runtime 调用里封装多次物理尝试，也可能方便对普通 `ctx.llm.stream()` 的调用统一路由。
   - 为何被否：这会先承担 public LLM API 与 adapter registry 的修改、测试及 Session identity 集成，尚未证明现有 Agent 扩展点不够；递归调用 waterfall 本身也不是安全的 adapter dispatch API。
2. 只在 `llm/stream` 中改写 provider 并尝试 `next()`。
   - 最强的理由：该事件位于 LLM runtime 主 dispatch 上，raw `ctx.llm.stream()` 对尚未 prepare 的调用确实允许 waterfall 修改 route。
   - 为何被否：Agent loop 使用 `prepareCall()` 固定 adapter、metadata 和 resolved config 后再调用 prepared stream；中途改 provider 会违反准备时捕获的 route 绑定。其失败恢复也由 Agent lifecycle 拥有。
3. 把逻辑 profile ID 写入现有 `provider` 字段，并让 UI 当作 provider/model。
   - 最强的理由：少改字段和 selector，单个 provider/model pair 表面上能表示一个可选择项。
   - 为何被否：runtime 需要已注册 provider adapter；Session selection projection 依赖 request header 的 provider/model 完全匹配，assistant attribution、usage 与 replay 需要真实物理 route。单字段不能无损承载逻辑 profile 与实际渠道两者。
4. 一开始就做全局共享 cooldown、latency routing 和 failover。
   - 最强的理由：更接近成熟 AI gateway，可以控制流量并适配多实例故障。
   - 为何被否：它增加跨 Agent 并发、时间窗口、跨进程共享状态和恢复语义，超出验证“插件能否实现有序故障切换”的最低需要；应由真实使用需求触发。

## Consequences

- 收益：先沿 DSH 既有 Agent 扩展点验证产品核心，保持 DSH 仓库不受试验插件污染；物理 adapter 仍拥有 wire、凭证、能力与 retry policy。
- 代价：Agent-only MVP 不等于所有 `ctx.llm.stream()` 调用都自动路由；完整逻辑模型 UI 和跨重启恢复可能需要后续 DSH 核心设计；路由状态与已有 `llm-retry` 必须做真实组合验证。
