---
title: "DSH Model Router — 架构"
status: "proposal"
kind: "architecture-overview"
last_updated: "2026-10-15"
---

# DSH Model Router — 架构

## 摘要

本项目研究 DeepSeek Harness（DSH）是否能通过独立 Cordis 插件支持模型渠道选择与失败切换。设计目标是复用已注册 provider adapters，并让一次请求使用的逻辑模型身份、实际渠道、重试和恢复状态都可解释。

## 设计页面

- [产品形态与配置面](design/product-plan.md)：用户视角这是什么、能配什么、看得到什么、做不了什么、分期。
- [详细架构与行为提案](design/architecture.md)：请求路径、路由配置、失败策略、Session 与 UI 影响。
- [DSH 能力边界](design/dsh-capability-boundary.md)：DSH 原生支持什么、不支持什么、每个缺口的最优雅补法、外置插件须遵守的社区规范。
- [DSH 源码地图](design/source-map.md)：已核实的扩展点与消费者。
- [未决问题](design/open-questions.md)：仍需产品 owner 决定或技术 spike 验证的事项。
- [构建管线与插件自有 Remote](design/build-pipeline-and-plugin-remote.md)：让插件拥有自己的 Remote 服务（主动探测档位的前提）所需的构建改动；提案待确认。
- [建议实施阶段](design/implementation-plan.md)：从技术验证到可选核心扩展的次序。
- [主流产品先例](references/prior-art.md)：LiteLLM、Portkey 和 OpenRouter 官方文档对照。

## 当前建议

先验证 Agent 主请求插件方案，不先改 DSH 核心。实际候选选择在 `agent/request`，失败切换在 `agent/request-error`；已由 `prepareCall()` 捕获 adapter 后，不能依赖后续 `llm/stream` 改路由。逻辑模型选择器和跨进程恢复状态是否纳入产品范围，仍需用户决定。

产品模式取**透明物理故障转移**：用户照旧选真实模型，插件按配置切到有序真实候选。逻辑模型进入官方选择器不做——需改 DSH 核心，且非必需。能力边界的两条已定结论：**attempt lineage 可由插件自有 session projection 折叠核心事件 durable 重建，无需新事件类型或 plugin record**；**总 attempt 上限只能由 Router 拥有**，因为 Agent step 循环本身没有上限。两者均已实测，详见[能力边界](design/dsh-capability-boundary.md)第七节。
