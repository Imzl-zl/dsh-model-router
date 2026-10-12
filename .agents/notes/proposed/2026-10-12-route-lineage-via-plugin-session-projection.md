# Agent Note: 用插件自有 session projection 承载 route attempt lineage，不新增事件类型

Status: proposed

## Problem

早前文档把"按 durable Session 恢复 attempt ledger"列为需要核心扩展的未决项，并暗示外置插件缺少持久化通道。这导致两个后果：一是把 `appendPluginRecord()` 当成"慎用"而非"禁用"，二是让"能否持久化 attempt lineage"长期挂在 P0 未决，掩盖了真正待决的只是"candidate 索引是否跨重启延续"。

## Decision

route attempt lineage 由插件自有 `ctx.sessionProjections.register()` 折叠 `request/header` + `assistant/attempt` + `assistant/message` 重建，不新增 Session 事件类型、不写 plugin record、不 bump `SESSION_FORMAT_VERSION`、不改 SDK projections。

准入门槛（可机械判定）：

1. 零新增事件类型：`SessionEventMap` 的 augmentation 数量为 0，`KNOWN_SESSION_EVENT_TYPES` 无变化。
2. 零 plugin record：不出现 `appendPluginRecord` 调用点；仓库外插件本就被 [`session/README.md:70`](file:///D:/sudy/github/deepseek-harness/packages/core/session/README.md#L70) 禁止调用。
3. 折叠只读核心事件：projection 的 `apply` 只 switch `request/header` / `assistant/attempt` / `assistant/message` / `llm/retry-started`，与 `token-meter` 的 [`usage-projection.ts:117-150`](file:///D:/sudy/github/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts#L117) 同构。
4. lineage 归属取该 attempt 之前最近的 `request/header`：`assistant/attempt` 不含 provider/model（[`session/types.ts:355`](file:///D:/sudy/github/deepseek-harness/packages/core/session/src/types.ts#L355)），不得从 attempt 事件本身推断 route。
5. resume/fork 一致性由真组合测试证明，不接受"理论上会一致"。

## Alternatives considered

1. 外置插件 `declare module` augment `SessionEventMap`，新增自有 attempt 事件
   - 最强的理由：类型层完全可行，`SessionEventMap` 是 merge-extensible interface，仓库内已有 40+ 处先例；新增普通事件类型按 [`persistence-changes/README.md:55`](file:///D:/sudy/github/deepseek-harness/docs/persistence-changes/README.md#L55) 属 same-version，不需要 bump 格式版本。
   - 为何被否：`KNOWN_SESSION_EVENT_TYPES` 是生成文件且只收本仓库声明，仓库外声明的未知类型若不带 `ignorable: true`，会被 [`storage-contract.ts:75-80`](file:///D:/sudy/github/deepseek-harness/packages/session/session-persistence/src/storage-contract.ts#L75) 拒读整个 log。带上 `ignorable` 就退化成 plugin record 信封，而它被 README 明确禁止仓库外调用。功能上此路不通。
2. 调用 `appendPluginRecord()` 存 attempt ledger
   - 最强的理由：API 现成，`ignorable: true` 让 reader 跳过而非失败，fork/resume 随 log 携带，且已有对称的 TS/Python expected-output 用例证明它不破坏 SDK 快照（`cot-translation-projection.json`）。
   - 为何被否：README 对仓库外插件是明文禁止，不是"慎用"。且格式迁移只 best-effort 保留，owner 可丢失状态而不改变 log 其余解释——不能承担关键恢复状态。
3. 进程内 Map 自持 lineage，不落盘
   - 最强的理由：实现最简单，没有持久化任何复杂度。
   - 为何被否：lineage 是诊断与 replay 的原料，进程一死就全丢；而它恰好可以零成本从核心事件 fold 出来，没有理由放弃。
4. 改核心，让 `request/header` 或 attempt 事件携带插件可读的 attempt 序号
   - 最强的理由：一劳永逸，Router 不必自己相关 `request/header` 与 attempt。
   - 为何被否：需要动 `SessionEventMap` 与持久化审查流程，而现有核心事件已足够重建 lineage。按"先验证外置插件，不先改 DSH 核心"的既定次序，此项留到纯插件被证明不足时再提。

## Consequences

- 收益：attempt lineage 从"需要核心扩展的未决项"变成"纯插件可交付"；P0 未决项收缩为"candidate 索引是否跨重启延续"一项；不触碰持久化格式，也就不触发 SDK expected-output 与两个 SDK 的同步成本。
- 代价：lineage 的 route 归属依赖"最近的 `request/header`"这一相关性推理，同 route 重试不产生新 header，attempt 与 route 的配对规则必须写进投影并在测试里钉住；投影的 `stateVersion` 随 fold 语义变化而 bump，旧缓存行作废而非迁移。
