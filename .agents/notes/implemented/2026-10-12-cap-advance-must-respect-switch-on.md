# Agent Note: 到顶换候选必须过 switchOn 门，llm-retry 抢占时也不例外

Status: implemented

## Problem

Phase 1 组合测试的 switch-off-terminal 场景暴露了一个语义洞：用户把 `rateLimit` 取消勾选，主渠道限流后插件仍然切换到了备用渠道。根因是两个 waterfall 的位置不对称：`llm-retry` 注册在 `agent/request-error` 外层，对可重试码先自行重试，Router 的 recovery listener 只在它放弃时才被 consult；而“单渠道尝试次数到顶就换候选”的判断发生在 `agent/request`（每次 attempt 都过这里，这是压住 llm-retry 重试的唯一位置）。第一版把 switchOn 门禁只放在 recovery 侧，于是 llm-retry 抢占的路径上，换候选完全绕过了用户的失败码选择——`未勾选的异常不切换`在产品最常见的路径上失效。

## Decision

把“能否前进”提成共用判定 `isSwitchOnEligible(chain, code)`，`planFire(state, mayAdvance)` 的前进以其为门：上一次失败的码不在 `switchOn` 里就不换人，候选原地不动，llm-retry 烧自己的预算、recovery 终态。失败码来自两路记录——`session/event` feed（覆盖 llm-retry 抢占的失败，fire-and-forget）与 recovery listener（委派失败的同步权威）；码未知时 fail closed（不前进），recovery 仍是终局权威。

准入门槛（可机械判定）：

1. `planFire` 的 `advanced` 为真当且仅当 `mayAdvance && attemptsOnCandidate >= maxAttempts`；不存在绕过 `mayAdvance` 的前进路径。
2. 组合测试 switch-off-terminal 断言：未勾选的码下主渠道尝试次数 = 1 + llm-retry 策略重试次数，零 notice，终态 error。

## Alternatives considered

1. 只在 recovery 侧保留 switchOn 门禁（第一版做法）
   - 最强的理由：判定只有一处，代码最短；`agent/request-error` 本就是失败语义的归属地。
   - 为何被否：对 llm-retry 会自行重试的码（默认五个可重试码全部在 switchOn 默认集里），recovery 根本不被 consult，门禁形同虚设——测试直接抓到切换发生。
2. 让 request handler 无条件到顶换人，靠 recovery 事后补救
   - 最强的理由：前进逻辑无脑简单，不依赖失败码记录这条异步链路。
   - 为何被否：直接把“用户取消勾选的码不切换”这条产品语义废掉，等于 switchOn 对最常见失败无效。
3. 把 Router 的 recovery listener 改用 prepend 抢在 llm-retry 外层
   - 最强的理由：外层能先看到全部失败，门禁天然生效，还能在 llm-retry 之前决策。
   - 为何被否：spike 7.4 已实测——llm-retry 的放弃路径全是 `return next()`，Router 在外层且委派时永远等不到放弃信号，跨候选 failover 整体失效。位置不对称是既定事实，不是可选项。

## Consequences

- 收益：`switchOn` 在全部路径上生效；“未勾选不切换”与产品文案一致；失败码记录链路同时服务 notice 的因果说明。
- 代价：前进判定多依赖一条 fire-and-forget 的 feed；码未知时 notice 退化为“连续失败”通用措辞；`isSwitchOnEligible` 有两个调用点（request handler 与 recovery），改动时需要同时看两处。
