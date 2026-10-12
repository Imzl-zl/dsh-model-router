# Agent Note: 两个 waterfall 位置不对称——request 最外层、request-error 在 llm-retry 内层

Status: proposed

> **本篇结论已被 2026-10-12 的 spike 修正**：原标题写作"Router 用 prepend 固定最外层并独享总 attempt 上限"，实测后 `agent/request-error` **不能**用 prepend。修正后的结论见下方 Decision；原文的"总上限由 Router 独有并自己计数"仍成立，但"两个 waterfall 都 prepend"作废。保留原文结构以便追溯这次修正。

## Problem

早前文档把 listener 次序方向写反了——写成"Router 注册在 `installModelSelection` 外侧时会被 selection 覆盖，注册在内侧时才能拿到最终 route"。按这个结论去实现，Router 会被安排到内层并被静默覆盖，表现为"插件装了但路由不生效"，且原因不在插件自身代码里，极难定位。同时"唯一预算 owner"被写成待 spike 验证，掩盖了 Agent step 循环本身没有 attempt 上限这一事实。

第三轮 spike 又暴露出下一个错误：最初推断"Router 也在 `agent/request-error` 用 prepend 拿最外层，委派给 llm-retry，等它放弃再接上"。**这个推断是错的**，且错得很隐蔽——不实测就不会发现。

## Decision

两个 waterfall 的位置**不对称**：

- `agent/request`：**最外层**，用 `prepend: true`。必须压过 `installModelSelection` 在 `next()` 之后对 provider/model 的写回。
- `agent/request-error`：**`llm-retry` 内层**，不用 prepend；把注册推迟到 `agent/created` 时、注册到 `agent.ctx`。让 llm-retry 先管同 route 重试（含退避与 `llm/retry` durable 记录），它放弃时 `return next()` 正好交给 Router 做跨候选 failover。

准入门槛（可机械判定）：

1. `agent/request` 的 `ctx.on` 带 `prepend: true`；`agent/request-error` 的 `ctx.on` **不带** `prepend`，且注册发生在 `agent/created` 处理函数内、作用于 `agent.ctx`。
2. 真实组合测试中，一个 llm-retry 可重试的 code（如 `RATE_LIMIT`）不得触发 Router 的 recovery listener；一个不可重试的 code（如 `AUTH`）必须触发它。
3. Router 的 recovery listener 返回 `{kind:'retry'}` 后，`agent/request` 在同一步内再次触发，且 durable `request/header` 记的是 Router 选定的 route。
4. 插件内不得出现自己的退避实现（初始/最大延迟、jitter、指数增长）——那属于 llm-retry。

## Alternatives considered

1. 两个 waterfall 都用 `prepend: true`（本篇原标题的做法）
   - 最强的理由：机制统一，一个规则记住就行；且 `agent/request` 上确实必须如此。
   - 为何被否：`llm-retry` 的全部"放弃"路径都是 `return next()`（`llm-retry/src/index.ts:198,216,223,231`），而 waterfall 的 `next()` 只往内走、不往回走。若 Router 在最外层且委派，llm-retry 放弃时 `next()` 直达默认 thunk 返回 `undefined`（终态），**Router 永远等不到放弃信号，再也无法 failover**。已由 spike 从代码路径推定，未实测但路径明确。
2. Router 在 `agent/request-error` 最外层且对自有 code 不调 `next()`，自己实现同 route 重试与退避
   - 最强的理由：完全自主，不依赖 llm-retry 的行为；总 attempt 数的控制最直接。
   - 为何被否：退避逻辑与 llm-retry 重复，形成第二处真相源；且 llm-retry 对这些 code 完全失效，用户原来依赖的同 route 重试行为会静默改变。DSH 的既有分工是"adapter 一次调用一次 attempt，attempt 归属 Agent 恢复层"，复制它的退避等于违背这个分工。
3. 依赖插件加载次序让 Router 恰好落在 llm-retry 内层
   - 最强的理由：不用 `agent/created`，代码更直白。
   - 为何被否：两者都注册在 root ctx 且都不用 prepend，谁内谁外由 `apply()` 执行次序决定，而 cordis.yml 书写顺序不决定该次序。把正确性交给加载细节不可接受。
4. 不改 route，让 `llm-retry` 或 adapter 内部承担故障转移
   - 最强的理由：完全不碰 waterfall 次序，规避与 host listener 的竞争。
   - 为何被否：adapter 内部重试违反 DSH "one adapter call is one SDK attempt" 的分工（`llm-pi-ai/src/adapter.ts:140-142` 显式 `maxRetries: 0`），且 attempt 对 Agent 不可见；`llm-retry` 只重试同一条 route。两者都无法跨候选。

## Consequences

- 收益：两层各有一个 owner，不形成第二处退避真相源；内置恢复（同 route 重试、上下文溢出压缩、图片 offload）全部优先于 Router，Router 是终态前最后一道，产品语义干净；注册到 `agent.ctx` 顺带解决生命周期，不会每个 agent 漏一条 listener。
- 代价：两个钩子规则不同，必须分别记住"哪个要 prepend、哪个不能"；`agent/request-error` 的正确位置依赖"agent 创建时注册晚于插件加载时注册"这一时序事实，若 DSH 将来改变 agent 创建与插件加载的相对时序，位置会静默翻转——真实组合测试第 2 条门槛就是防这个。此外 spike 还暴露：stub adapter 的调用计数器会被 session-title 等辅助调用消耗，测试必须按 `options.purpose` 过滤，否则失败脚本打错 attempt、测试无效。
