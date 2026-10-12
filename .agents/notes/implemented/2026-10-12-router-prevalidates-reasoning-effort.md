# Agent Note: reasoningEffort 不兼容由 Router 在 agent/request 预校验，不指望 recovery

Status: implemented

## Problem

DSH 暴露了机器可读的 reasoning 能力元数据（`resolveModel` 与 `modelCatalog` 均给 `reasoning.efforts`，`session-controller/src/types.ts:130-133`），但 `prepareCall` 对不支持的 effort 抛 `UNSUPPORTED_REASONING_EFFORT` 属于 preparation error：`prepareRequest` 的 try/catch 只吞 `NO_ADAPTER`、其余 rethrow（`agent-loop/src/agent.ts:603-610`），异常穿过 step/turn 直接终态，**不进** `agent/request-error`（该 waterfall 唯一 dispatch 点 `agent.ts:511` 只在流内终态 chunk 路径；`tests/request-reconstruction.spec.ts:438-467` 断言此终态）。若 Router 把请求切到不支持当前 effort 的候选，结果不是 failover 而是整个 step 猝死，且三个既有 recovery 消费者结构上都接不到 preparation error。

## Decision

Router 在 `agent/request` 返回候选 config 之前，先对候选调用 `ctx.llm.resolveCallConfig()`（`selectModel` 同款预校验，`session-controller/src/commands.ts:156`），校验不过即跳过该候选进入下一个；全部候选不可用才终态。UI 候选节点展示 catalog 的 reasoning 档位作为静态提示。

准入门槛（可机械判定）：

1. Router 返回的任何候选 config 必须先经 `resolveCallConfig` 通过；不得把未校验的 controls 交给 `prepareCall`。
2. 预校验失败 = 候选不可用，按候选顺序继续；不得依赖 llm-retry / compaction 等既有消费者处理 preparation error——它们只收 adapter stream failure。
3. 组合测试必须覆盖"primary 带 effort、候选不支持 → 自动跳过该候选且 step 不猝死"用例。

## Alternatives considered

1. 指望 `agent/request-error` 接住再切换
   - 最强的理由：如果成立，Router 一行预校验都不用写，与其他失败码同一套处理。
   - 为何被否：源码与测试都证明 preparation error 不进该 waterfall，结构上接不到；`RequestErrorAction` 只有 `{kind:'retry'}|undefined`，也无法表达"去掉 effort 重试"。
2. 静态缓存候选元数据避免重复校验
   - 最强的理由：少调用少等待，配置不变时零开销。
   - 为何被否：DSH 自带两个 adapter 的 `resolveModel` 均为内存快照直读（`llm-pi-ai/src/adapter.ts:300-309`、`llm-deepseek/src/adapter.ts:37-39`），缓存省不下什么，却引入失效问题（provider 配置热更新后缓存过期）。先做无缓存版，有实测证据再优化。
3. 让用户自行保证候选支持档位（纯文档责任）
   - 最强的理由：实现为零；Portkey 官方就是"Ensure fallback LLMs are compatible with your use case"。
   - 为何被否：代价是 step 猝死且错误信息指向插件"换错模型"，用户无从预判；LiteLLM 用 pre-call checks 把这类校验制度化，说明工程上应当由路由器承担。

## Consequences

- 收益：消灭"换错候选 → 整个 step 猝死"这一类静默灾难；候选兼容性从用户责任变成插件保证，与主流 pre-call check 范式对齐。
- 代价：每次请求每个候选多一次 `resolveCallConfig` 调用——DSH 自带 adapter 是内存级成本，但外置 adapter 可实现为异步查找，真实成本只能在组合测试中测定；预校验只覆盖 reasoning effort 与 maxTokens 默认化，不替代运行时 failover。
