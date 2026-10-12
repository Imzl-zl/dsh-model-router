---
title: "DSH Model Router — 主流模型路由设计对照"
status: "researched"
kind: "prior-art-review"
last_updated: "2026-10-12"
---

# DSH Model Router — 主流模型路由设计对照

## 摘要

LiteLLM、Portkey 和 OpenRouter 的官方资料都把“调用者选的 model / group”“执行候选 deployment/provider”“路由或排序策略”“retry/fallback 条件”和“实际 attempt 观测”分开描述。DSH 可以借用这些概念边界，但不能照抄网关默认值：DSH 是单机内由 Cordis plugins 组合的 Agent harness，有 append-only Session、适配器捕获、模型可见输入重放和 GUI 的 provider/model selection。

## LiteLLM Router

### 可借鉴做法

- 同一个 `model_name` 下可挂多个 provider deployment；model alias/group 可以形成 caller 看到的虚拟入口。
- 区分同一次调用的重试与跨 group 的 fallback：一次调用在 `num_retries` 耗尽后才 fallback 到另一个 model group；fallback 列表按顺序执行。
- fallback 分三类：content-policy 违规、context window 超限、其余错误（如限流）；可另设 `default_fallbacks` 兜底配置错误的 group。
- 同一 model group 的多个 deployment 之间也存在基于 order 的递进；流中断后有独立的 mid-stream fallback。
- Router 同时处理 cooldown、timeouts 和重试；生产多进程可用 Redis 跟踪 cooldown 与 tpm/rpm 用量。
- Router 提供 Weighted Pick、Rate-Limit Aware、Latency-Based、Least-Busy、Lowest Cost 等策略，并支持自定义策略。

### 设计含义

DSH 应区分 `(logical profile -> ordered candidates)`、`per-candidate attempt budget`、`cross-candidate failover` 与可选 `health cooldown`，并验证嵌套预算的总上限。MVP 只采用可解释的 priority order；`retryPolicy` 与 failover 需做明确组合，不使用未定义的乘法重试。

### 来源

- [Router - Load Balancing](https://docs.litellm.ai/docs/routing)
- [Fallbacks (Provider Failover)](https://docs.litellm.ai/docs/proxy/reliability)

## Portkey AI Gateway

### 可借鉴做法

- Fallback 配置使用有序 targets；每个 target 可声明 provider 或覆盖 model。
- 可设置具体触发状态码，官方页给出默认非 2xx 与显式状态码列表两种表达。
- 多级 target 可将 fallback 与 load balancer 或 conditional router 组合，而不是将所有规则压成一个巨大开关。
- 官方文档强调单个 request 可能调用多个 LLM，且不同候选有不同延迟/价格；调用链以 trace ID 关联观测。

### 设计含义

DSH 可把“retry predicate/失败类别”与“候选策略”分开，记录一个逻辑请求下的 attempt lineage；UI 报价和状态应坦率展示切换造成的额外调用。HTTP 状态码属于网关/provider 边界，DSH 层应消费 adapter 已规范化的 failure code。OpenRouter 按最终使用的模型计费、Portkey 用 trace ID 串起一次请求的多次调用，这两点对应 DSH 的 assistant source/usage 与 attempt lineage 要求。

### 来源

- [Fallbacks](https://portkey.ai/docs/product/ai-gateway/fallbacks)
- [AI Gateway Configs](https://portkey.ai/docs/product/ai-gateway/configs)

## OpenRouter Provider Routing

### 可借鉴做法

- 请求级 provider preference 可以配置 `order`、`only`、`ignore`、`allow_fallbacks`、`require_parameters`、`data_collection`/`zdr` 与 `sort`。
- 显式 `order` 或 `sort` 会禁用默认的按价格负载均衡，router 改为按顺序尝试 provider。
- 默认策略本身按价格加权并参考近期可用性，其余 provider 作为 fallback。
- 模型级 fallback 用 `models` 数组按优先级排列；上下文超限、审核拒绝、限流、宕机等错误都会触发下一个模型。Anthropic Messages API 另有 `fallbacks` 参数映射到同一机制，每条只接受 `model` 字段，最多 3 条，且不能与 `models` 并用。
- 计量按最终实际使用的模型计费，响应体的 `model` 字段返回该模型。

### 设计含义

渠道列表应是一份用户可读、可验证的显式序列；兼容性/隐私限制作为候选 eligibility predicate，而不是在 fallback 时才发现不满足。MVP 不同时启用 `order` 与自动平衡，也不跨不同逻辑模型族做价格/延迟全局排序。

### 来源

- [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)

## 能力元数据：模型支持 tools / reasoning 的来源与路由前过滤

| 方案 | 能力元数据 | 工具能力字段 | 不兼容时行为 |
|---|---|---|---|
| OpenRouter | `GET /api/v1/models` 每模型 `supported_parameters: string[]` + 独立 `reasoning` 对象（`supported_efforts` 等） | 有，一等公民 | fallback 错误驱动，**不**按 supported_parameters 预筛候选 |
| LiteLLM | model cost map（`model_prices_and_context_window.json`）含 `supports_function_calling`/`supports_reasoning` 布尔字段 | 有 | 不支持的参数默认抛异常；Router fallbacks 错误驱动，但 `enable_pre_call_checks`（context window）/`enforce_fallback_model_access`/`enforce_fallback_budget` 把"路由前元数据过滤"制度化 |
| Portkey | Model Catalog 无能力元数据；开源 models DB `type.supported`（含 `tools`，无 reasoning） | 有 | 默认任何非 2xx 触发 fallback；官方明说 "Ensure fallback LLMs are compatible with your use case"——兼容性是用户责任 |

**设计含义**：把"请求所需能力"与"渠道已声明能力"显式建模为同一份注册表、路由前做纯函数过滤，是可借鉴的范式（OpenRouter 目录层 `?supported_parameters=tools` 查询过滤即最小形态；LiteLLM pre-call checks 证明路由层可行）。三家的路由层都靠"运行时错误 + fallback"，能力预过滤只发生在元数据可信处。DSH 插件因此只对 reasoning 档位做路由前过滤（有元数据），工具维度靠运行时 failover 承接，见[能力边界](../design/dsh-capability-boundary.md)第八节。

### 来源

- [Models overview（Supported Parameters）](https://openrouter.ai/docs/guides/overview/models)
- [List all models and their properties（API Reference）](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [Add Model Pricing（cost map 字段 spec）](https://docs.litellm.ai/docs/provider_registration/add_model_pricing)
- [Input Params（默认抛异常与 drop_params）](https://docs.litellm.ai/docs/completion/input)
- [Reliability / Fallbacks](https://docs.litellm.ai/docs/proxy/reliability)
- [Portkey Models（Get Model Configuration）](https://portkey.ai/docs/product/model-catalog/portkey-models)
- [Portkey Fallbacks](https://portkey.ai/docs/product/ai-gateway/fallbacks)

## 借鉴边界与 DSH 独有条件

| 主题 | 网关先例 | DSH 的应用限制 |
|---|---|---|
| Alias/group | caller 可请求 virtual model/group | DSH GUI selection、Session model projection 当前用 provider/model 对；逻辑 ID 不能冒充未注册 provider |
| Retries 与 fallback | 通常都在同一个 router request pipeline 内 | DSH retry 建立在 Agent step 与 durable Session 事件之上，直接流式辅助调用不自动有这套恢复 |
| Route identity | gateway request/trace/spend 可单独记 group 与实际部署 | DSH header、assistant message source、usage 和 replay 需要保留实际 adapter route；另行记录 logical profile |
| Provider capabilities | request filters / provider requirements | DSH 仅把图像模态与 reasoning 档位暴露为机器可读能力；工具能力无元数据，不兼容在运行时以 `INVALID_REQUEST`/`PI_AI_ERROR` 出现、由 Router 按 switchOn 承接，见[能力边界](../design/dsh-capability-boundary.md)第八节 |
| Cooldown | router 按部署健康或共享 store 管理 | DSH 要先定义并发 Agent、重启、跨进程、窗口和持久化；不属于单一失败阈值功能本身 |
| Observability | trace ID 串联 attempts | DSH 可依赖 Session 与 assistant attempt，但 plugin 自有状态的 durable support 需慎用 experimental plugin record |

## 结论

最可迁移的是概念架构，不是具体网关实现：逻辑组映射、有序候选、候选资格条件、组内 retry、跨候选 fallback、独立的健康状态与完整 attempt trace。对 DSH 的优雅做法是插件先拥有其配置和策略，复用 `agent/request` + `agent/request-error`；只有当用户要求逻辑模型在官方 selector 中呈现，或要求状态跨重启一致时，才明确提出相应的 DSH 服务/Session 扩展。
