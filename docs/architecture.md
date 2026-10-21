---
title: "DSH Model Router — 架构"
status: "implemented"
kind: "architecture-overview"
last_updated: "2026-10-21"
---

# DSH Model Router — 架构

## 摘要

本项目是 DeepSeek Harness（DSH）上的一个独立 Cordis 插件，提供模型渠道选择与跨渠道失败切换。它复用已注册的 provider adapters，并让一次请求使用的实际渠道、重试与恢复状态都可以从 durable 日志解释。

## 设计页面

- [产品形态与配置面](design/product-plan.md)：用户视角这是什么、能配什么、看得到什么、做不了什么、分期。
- [详细架构与行为提案](design/architecture.md)：请求路径、路由配置、失败策略、Session 与 UI 影响。
- [工作台布局重构](design/ui-layout-redesign.md)：DSH 原生页面契约、分区/行/弹窗的布局规格、落地状态与同步修的逻辑语义。
- [DSH 能力边界](design/dsh-capability-boundary.md)：DSH 原生支持什么、不支持什么、每个缺口的最优雅补法、外置插件须遵守的社区规范。
- [DSH 源码地图](design/source-map.md)：已核实的扩展点与消费者。
- [未决问题](design/open-questions.md)：仍需产品 owner 决定或技术 spike 验证的事项。
- [构建管线与插件自有 Remote](design/build-pipeline-and-plugin-remote.md)：让插件拥有自己的 Remote 服务（主动探测档位的前提）所需的构建改动；提案待确认。
- [按会话选择降级链](design/per-session-chains.md)：命名链 + 会话绑定；DSH 原生提供什么、缺什么，以及绑定存哪、熔断归谁。
- [每个渠道到底能重试几次](design/retry-budget-ownership.md)：`1 + min(插件配置, 渠道策略)` 的来历与三种修法。
- [建议实施阶段](design/implementation-plan.md)：从技术验证到可选核心扩展的次序。
- [主流产品先例](references/prior-art.md)：LiteLLM、Portkey 和 OpenRouter 官方文档对照。

## 当前形态

插件不改 DSH 核心。实际候选选择在 `agent/request`，失败切换在 `agent/request-error`；已由 `prepareCall()` 捕获 adapter 之后，不能靠后续 `llm/stream` 改路由。

产品模式是**透明物理故障转移**：用户照旧选真实模型，插件在第一跳失败后按配置的有序候选切换。逻辑模型不进官方选择器（那要改 DSH 核心的 catalog/selection/projection），候选索引也不跨重启（进程内存，重启即重置）。能力边界的两条结论：**attempt lineage 可由插件自有 session projection 折叠核心事件 durable 重建，无需新事件类型或 plugin record**；**每次尝试的总量只能由 Router 自己持有**，因为 Agent step 循环本身没有上限。详见[能力边界](design/dsh-capability-boundary.md)第七节。
