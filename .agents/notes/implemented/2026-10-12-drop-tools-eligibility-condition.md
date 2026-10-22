# Agent Note: 工具能力不做路由前置条件，运行时 failover 承接

Status: implemented

> 其中「`INVALID_REQUEST` 默认不勾」一句已被 `2026-10-22-failover-by-default-and-max-token-continue.md` 取代（默认全切 + 表外兜底）；本篇关于"删除 `needs.tools`、由运行时 failover 承接"的结论仍有效。

## Problem

UI 原型与产品文档曾把"必须支持工具 (needs.tools)"设计成候选资格条件，暗示路由前可判定模型是否支持 function calling。DSH 没有任何机器可读的工具能力来源：`LlmModelInfo`/`LlmResolvedModelInfo` 唯一能力字段是 `inputModalities`（`packages/llm/llm/src/types.ts:330-341`），pi-ai SDK 的 `Model` 接口也没有工具能力字段，`normalizeModelInfo` 还按白名单重建、丢弃 adapter 多返字段（`packages/llm/llm/src/index.ts:805-815`）。保留一个不可判定的开关，用户会以为配了能过滤，实际配了不生效——比没有这个条件更糟。

## Decision

从候选资格条件中删除 `needs.tools`。工具不兼容由运行时 failover 承接：provider 拒绝后规范化为 `INVALID_REQUEST`（deepseek，`llm-deepseek/src/transport.ts:33`）或 `PI_AI_ERROR`（pi-ai，`llm-pi-ai/src/stream.ts:67`）终态 failure chunk，进入 `agent/request-error`；llm-retry 不重试该类（`retry-policy.ts:18-24`），Router 按 `switchOn` 决定是否切换候选。`INVALID_REQUEST` 作为可勾选项进入 switchOn，默认不勾。

准入门槛（可机械判定）：

1. 候选资格条件只有 `images`（请求侧 `ImageBlock`，精确）与 `minContextTokens`（tokenMeter 投影，估算）；任何依赖"模型是否支持工具"判定的字段不得进入 config schema。
2. 工具不兼容的切换只能经 `switchOn` 显式开启；默认集合保持 DSH normal policy 五码，不私自加码。
3. README Known Limitations 必须写明：该类失败分类依赖 provider 归一化（deepseek→`INVALID_REQUEST`、pi-ai→`PI_AI_ERROR`），不保证精确。

## Alternatives considered

1. 用户手声明候选能力（config 里加 `supportsTools` 布尔）
   - 最强的理由：用户给自己配的渠道，声明值大概率是对的；实现零成本，UI 上就是一个复选框。
   - 为何被否：制造第二处真相源且必然腐化（模型升级、用户记错），违反 DSH "one home per fact"；运行时失败已有兜底，声明值的边际价值只剩"省一次失败 attempt"，不值得用腐化风险换。
2. 请求侧语义重定义（`needs.tools` = 仅当本步带工具时才轮到该候选）
   - 最强的理由：完全可判定（`assembly.tools` 非空即真），实现零风险。
   - 为何被否：与用户意图相反——用户想排除的是"不支持工具的模型"，重定义后排除的是"不带工具的请求"，把候选从大多数请求里过滤掉，比没有这个条件更糟。
3. 探测式校验（路由前先发一次能力探测请求）
   - 最强的理由：能得到真实能力，不依赖任何元数据。
   - 为何被否：额外计费请求与延迟，探测本身也可能失败；把一次配置问题放大成持续流量。

## Consequences

- 收益：资格条件全部可判定（images 精确、context 估算），UI 不再有"配了不生效"的开关；工具不兼容的最坏结果从"step 直接死"变为"按 switchOn 切换候选"。
- 代价：默认行为下工具不兼容仍终止请求（`INVALID_REQUEST` 默认不在 switchOn），用户需自行开启；兜底可靠性依赖 provider 的错误归一化质量，跨 provider 不一致无法消除。
