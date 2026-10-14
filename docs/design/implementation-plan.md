---
title: "DSH Model Router — 后续实现计划"
status: "proposed"
kind: "implementation-plan"
last_updated: "2026-10-12"
---

# DSH Model Router — 后续实现计划

## 摘要

按风险从低到高验证纯插件主请求路由、失败恢复与持久身份，再决定是否需要改 DSH 核心。本文件是建议的交付次序，不代表计划阶段已获用户批准，也未运行此处未列的未来测试。

## Phase 0：冻结产品边界

### 交付

- 确认 MVP 是透明物理模型故障转移，还是 GUI 里可选的逻辑模型。
- 确认失败次数是单个 request/step 的 attempt budget，还是 Session/global health 门槛；决定由 Router 或 `llm-retry` 拥有同候选重试计数。
- 确认关闭进程是否重置故障计数。
- 确认只覆盖 Agent loop 主请求，还是要覆盖 compaction/session-title 等直接 LLM 调用。
- 依据 DSH 开放字符串 `LlmFailure.code`、目标 adapters 的规范化映射与实际 retry policy，确定可配置的 retryable code 策略；不假设存在封闭枚举。

### Exit gate

未决问题中 P0 每项获用户确认，或书面选择限定范围的 MVP；无确认不得生成声称实现逻辑模型或 restart-safe 的方案。

## Phase 1：Loader 组合 spike

只有产品边界获用户确认后才创建最小 Cordis plugin package；对照 DSH 包规则和 `packages/AGENTS.md`。真实 Loader 组合须验证：Agent driver、llm runtime、两个确定行为的 stub provider adapter、现有 retry plugin、新 router 与 model-selection listener。

### 开发、安装与真实组合测试的既有路径

仓库外插件不需要自建工具链，DSH 已提供完整路径（均为【源码/文档证实】）：

| 环节 | 机制 | 位置 |
|---|---|---|
| 本地加载 | `cordis.yml` overlay 用 `- insert:` 指向**绝对路径**的本地 `.ts`/`.mjs` 模块，`pnpm dsh web --patch ./overlay.yml`；无需打包、无需 npm install | [`tutorial index.md:46-62`](file:///D:/sudy/github/deepseek-harness/docs/user/develop/basic/index.md#L46) |
| 可安装交付 | `package.json` 声明 `dsh.bundle`，`dsh plugin --profile <name> add ./pkg`；无 `dsh.bundle` 只作为普通依赖且不激活层 | [`publish.md:64,70-80`](file:///D:/sudy/github/deepseek-harness/docs/user/develop/basic/publish.md#L64) |
| 依赖共享 | 必须与 host 共享实例的 dsh 包同时声明在 `peerDependencies` 与 `devDependencies` | [`publish.md:103`](file:///D:/sudy/github/deepseek-harness/docs/user/develop/basic/publish.md#L103) |
| **真实组合测试** | `@deepseek-ai/dsh-loader-smoke` 的 `runLoaderSmoke()`：boot 真实 Loader 树，跑 bin script，检查持久化 session | [`keyless-smoke.e2e.ts:20-48`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts#L20) |
| stub adapter | 本地 `.mjs` 模块 `extends LlmAdapter`，`inject=['llm']`，`ctx.llm.registerAdapter([...])`；`stream()` 为 async generator，可抛 `LlmError(msg, code)` 模拟失败 | [`retry-snapshot-backend.mjs`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/tests/fixtures/retry-snapshot-backend.mjs) |
| 隔离真 adapter | patch 里 `- id: llm-deepseek` + `disabled: true`，并 `disabled` 掉真 runner；agent 指向 stub provider | [`retry-snapshot.patch.yml:1-26`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/retry-snapshot.patch.yml#L1) |
| 免 API key | `compression: none` + 本地 `.sessions` 目录，断言解压后的 `session.jsonl` 与 stdout 事件流 | [`keyless-smoke.e2e.ts:29-46`](file:///D:/sudy/github/deepseek-harness/apps/cli/tests/profiles/headless/tests/keyless-smoke.e2e.ts#L29) |

因此 Phase 1 的 spike 可在**本项目仓库内**完成：一个 test-only `cordis.yml` overlay 插入 (a) stub adapter 插件 (b) router 插件，用 `runLoaderSmoke` boot，断言 durable session 事件。**不修改 DSH checkout**。

**尚待一次执行验证的前提**：overlay 指向本项目绝对路径时，插件与 stub adapter 的 `@deepseek-ai/dsh-*` import 必须解析到 **dsh 运行时的同一实例**（否则 `LlmAdapter` 基类与事件类型身份不一致）。这是本计划唯一的执行未知量，用一次真实 boot 验证，不再是源码调研项。

### 需证明的案例

1. 首选渠道成功：只 dispatch 到首选；`request/header` 与 assistant source 记录真实 adapter provider/model。
2. 首选失败并 retry：`agent/request-error` 更新 route attempt ledger，下次 `agent/request` 选择后续配置渠道；失败次数/顺序与策略总上限精确一致。
3. request preparation failure 与 middleware/consumer error：验证它们不会被误认为 adapter stream failure 或自动 failover；Adapter dispatch/iteration throws 则应被 runtime 规范化并进入 recovery。
4. abort/backoff 中 `AbortSignal` cancellation：无备用调用启动，Agent 进入终态；另测 signal 未取消但 adapter code 为 `ABORTED` 时的显式 route policy。
5. `llm-retry` 已启用：检查 waterfall composition；验证 route candidate budget、adapter policy（含 always mode）及 `llm/retry` durable event/UI transition 的唯一 owner。
6. 部分 stream 输出后以 terminal failure 结束：确认 durable `assistant/attempt` settlement 会退役 transient rows；分别验证 Router 不写 `llm/retry` 与通过该 event 重试时 Chat assistant/turn-process 状态及 replay。
7. 两个 Agent 并行运行同一 profile：route state 不串线。
8. 热卸载：移除 listeners/UI/settings 注册并释放 state/timeout，后续请求不再由插件拦截。
9. 直接 `ctx.llm.stream()` / `purpose: compaction` 路径：确认其有意不受 Agent hook 路由，不作错误承诺。
10. Agent 配置选择先于 request waterfall：验证 model-selection listener 顺序、prompt variables、最终物理 request header、pending selection 对账及 model-switch notice。
11. 从真实 test `cordis.yml` 经 Loader 启动并断言 durable Session 事件与可见结果，满足 DSH 的 product-visible plugin test rule。

### Exit gate

只有实际 Loader composition test green 且 Session/selection 身份语义可解释，才将 package 从 spike 进入 MVP。该测试用 `runLoaderSmoke` boot 真实 Loader 树并断言 durable Session 事件与可见结果；手造 Context 单测不合格。若核心 extension point 不支持 retry attempt/UI transition 的持久一致性，暂停纯插件实现并提出窄的 DSH 扩展方案。

## Phase 2：MVP package

### 候选 package 责任

- Host service/function plugin：配置 schema、规范化配置 snapshot、`agent/request` 选择候选、`agent/request-error` 错误分类与有限恢复、operation 生命周期。
- Shared route schema/type 与纯决策函数：独立测试 configuration validation 与 attempt budget；仅含无敏感 route IDs/attempt metadata。
- 配置入口：按确认的产品模式选择 Cordis 配置或 Settings UI；只有用户决定需要 GUI 时，才评估 DSH Slots 和模型目录支持。
- Diagnostics：确定是否需要向用户或日志呈现实际 provider/model、attempt 序号与切换原因；不得记录凭证或 prompt。展示逻辑 profile 需以产品决定和身份模型为前提。

### MVP 不做

- global provider health daemon、跨 Session shared circuit breaker、auto latency 路由：未做，见 Phase 4。
- 替换 adapter、重复 provider 凭证 schema、model wire compatibility normalization。
- 未讨论就修改 `SessionEventMap` 或复用 experimental `appendPluginRecord()` 写入决定重启恢复所需的真值。

## Phase 3：逻辑模型/核心扩展（仅在产品选 B 后）

先独立撰写 DSH architecture/additional package design，再改核心。议题至少包含：

- model catalog 新增可选择 logical profile，明确它不是 adapter provider route。
- selection validation 解析 profile 并锁定配置版本；物理 candidate 在 `prepareCall()` 前仍解析具体 adapter。
- durable request intent 保存逻辑 profile id/config version；attempt facts 保存真实 provider/model、attempt 顺序、failure 分类、最终成功渠道。
- 明确 assistant message model source、usage/token metering、session projection、model switch notice、restoration 和 historical header 的兼容语义。
- 重新评估 `prepareCall()` 的绑定方式：能否由 LLM runtime 提供受限且只调用一次/每次 attempt 的候选 dispatch capability，而不是 plugin 递归调用服务。
- 更新 TypeScript/Python SDK projections 与 snapshot expectations；按 DSH persistence type-change review 及 format policy 做决定。

任何 Session event/header/SDK API 格式修改必须遵循 DSH 相关 AGENTS、`docs/session-format-status.md`、persistent-type review 与 migration rules；不在该项目设计仓库自设 DSH 持久化兼容规则。

## Phase 4：策略增强（需求触发）

已实现：起点策略（`order`/`weight`/`round-robin`）、按错误码/信息的自动禁用（熔断）、四档健康配置。见 [决策笔记](../../.agents/notes/implemented/2026-10-14-channel-health-rework.md)。

仍未做：跨进程共享的 provider cooldown 与恢复、latency/price 路由。每项都需给出故障窗口、状态 owner、请求延迟预算、隔离行为与覆盖测试。
