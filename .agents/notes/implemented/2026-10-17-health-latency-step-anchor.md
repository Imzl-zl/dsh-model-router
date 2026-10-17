# Agent Note: 健康延迟锚在 step/start，lineage 的结算按 step 门控

Status: implemented

## Problem

同一个病因的两个出口：**用"当时恰好到来的事件"当锚点，而不是用"这一步从哪里开始"**。

1. **I3（健康延迟）**：`health.ts` 的 `lastStart` 只在 `request/header` 时更新。而 DSH 的
   `requestHeaderLogged` 置 true 后永不重置（`agent.ts:642`，全文仅 4 处引用），`startsSeries`
   又依赖 surface generation 变化——工具循环的 step 2..N **不出 header**。于是那些步的
   `latencyMs` 含 step 1 的模型时间 + 工具执行时间（实测 4400ms 对真值 500ms，吞吐虚高
   8.8×），sparkline 混合了正确与膨胀的点，而 UI 只有一个"延迟"标签，用户无从得知自己看的是
   哪个时间范围。
2. **待核实 7（lineage 结算）**：`assistant/message` 的 settle 只按 `last.turn !== state.turn`
   过滤，没有 step 门控——而同 turn 跨 step 的成功会把上一步的条目标成"已兑现"。实测：turn 1
   step 1 记下 a→b 未结算条目且 b 也失败，step 2 同 turn 在 **c** 成功 → 条目
   `settled: true`。账本声称"切到 b 成功"，而 b 从未应答。记录路径（`request/header` 的
   change 分支）本来就按 step 门控，settle 漏了。

## Decision

1. **锚点移到 `step/start`，按 `(turn, step)` 门控归属**——照 DSH 自己的
   `session-stats/src/projection.ts:133-149`：`openStep` 由 `step/start` 开，`:140`/`:147`
   用事件自身的 `(turn, step)` 显式门控。一个开着的步都不属于的事件不产出测量值（记录照建：
   这条路确实应答了，只是代价无从计算）。
2. **`request/header` 重新锚定开着的步**：header 命名的是"这条路由上的一次新请求"，所以一步
   之内的 failover 不会把前一个候选的失败时间记到应答的那个路由头上。没有 header 的后续步
    therefore 用本步的 `step/start`。一条规则：**锚点是本步内最近一次"请求开始"**。
3. **步内退避留在本步成本里**：DSH 自己的模型时间定义包含它（session-stats 文件头明写
   "model time is `step/start` → `assistant/message` ... survives an in-step `llm/retry`"）。
   不为它单设锚点——按事件类型各用一个锚点是第二条规则。
4. **lineage 的 settle 改用事件自身的 `(turn, step)`**，与记录路径和 session-stats 同形状。
5. **`stateVersion` 2 → 3**：`lastStart: number` 换成 `openStep: {turn, step, start}`，
   `.strict()` schema 会拒掉带 `lastStart` 的旧行——版本 bump 让 registry 丢弃它们，
   与 v1→v2 的先例一致。代价是升级前会话的健康时间线不再可见（观测性数据，非正确性问题）。
6. **仪表盘标签跟着语义改**：`healthMetricLatency` 从「整轮耗时 / Turn cost」改成
   「本步耗时 / Step cost」——锚点变了而标签不变，就是这条线要消灭的那种谎。

## Alternatives considered

1. 保留 header 锚点，只加 (turn, step) 门控
   - 最强的理由：改动最小，"归属"确实是 finding 点名的问题。
   - 为何被否：门控会挡住 step 2..N 的全部测量（它们的锚属于 step 1），结果是这些步
     **没有**延迟而不是**正确的**延迟——把错误数据换成缺失数据，UI 从"说谎"变成"空白"，
     而锚点一移两者都对。finding 的最小修法原文就是"把锚点从 request/header 改成
     step/start"，门控是配套不是替代。
2. 锚在 `llm/retry-started` 以排除退避等待
   - 最强的理由：审计记录把"带 llm/retry 的步含退避等待"列为虚高症状，这个锚能消掉它。
   - 为何被否：DSH 自己的模型时间定义明确包含步内重试（session-stats 文件头），插件的
     健康数字与宿主统计对同一段时间给出两个口径，比含退避更糟；且"按事件类型选锚点"
     是第二条规则，下一种事件（compaction、tool 等待）又要第三条。
3. settle 门控用跟踪的 `state.step` 而不是事件自己的
   - 最强的理由：与记录路径的写法（`failure.step !== state.step`）逐字一致。
   - 为何被否：记录路径比的是"attempt 发生时记下的步"，那里用跟踪值自有其一致性；settle
     问的是"**这条消息**属于条目的那一步吗"，消息自己带着 turn/step（agent.ts:539-545），
     用事件自身的值是权威，折叠从半路开始（冷读）时跟踪值已经过期。
4. 旧行兼容：schema 里保留 `lastStart` 可选字段
   - 最强的理由：不丢升级前会话的健康时间线。
   - 为何被否：一个永不被读的字段躺在 `.strict()` schema 里，是"为兼容而兼容"的兼容路径；
     项目先例（v1→v2）对形状变化的选择就是 bump + 丢弃，且丢的是观测数据。

## Consequences

- 收益：工具循环的后续步拿到自己的成本（step 2 = 500ms / 200 t/s，修复前 4400 / 22.7）；
  一步内的 failover 不把前一个候选的失败记到应答路由头上（既有 pinned 用例 400ms 不变）；
  lineage 不再把跨 step 的成功结算成旧条目的"已兑现"。`unit.mjs` 106→108。
- 代价：① 升级前会话的健康时间线随 v3 bump 被丢弃。② 仪表盘标签语义变化（整轮→本步），
  用户如果记得旧文案会看到数字变小——那是修复前的虚高，不是数据丢失。③ 让步内退避留在
  本步成本里是一个明确选择：健康数字因此不等于"纯模型时间"，与 session-stats 同口径。
