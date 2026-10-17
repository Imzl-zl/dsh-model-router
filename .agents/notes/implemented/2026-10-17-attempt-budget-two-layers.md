# Agent Note: attempt 预算的两层修法——可服务性谓词与"不问 llm-retry"的提前决定

Status: implemented

## Problem

两条 finding 改同一段代码（`index.ts` 的 `agent/request-error` 与 `router.ts`），且第一条
的"最小修法"被实测否定：

- **C2**：`planFire` 在末位候选被 cap 时置 `exhausted = true`、`attemptsOnCandidate` 仍
  `+1` 并返回一个可执行 state，而 `agent/request` 只按 `plan.state.index` 走候选 Walk，
  没有任何地方在读 `plan.state.exhausted`。于是末位候选被打 `maxAttempts + 1` 次，
  `advanced === false` 连 notice 都不发——用户为一次看不见的调用付钱。
  审查记录的"最小修法"（给 `FirePlan` 加 `servable`、不servable 就落回用户原路由）实测
  只是把多打的那次从末位候选搬到用户原路由，**总数仍是 4**：`agent/request` 必须返回一个
  config，"在 handler 里拦"只能 redirect 不能 cancel。
- **I1**：插件注册在 llm-retry 外层，`await next()` 拿到 `{kind:'retry'}` 时 llm-retry
  已经写了 `llm/retry`、睡完退避（实测 3000ms 退避下 boot 8179ms）。否决只能阻止"效果"，
  阻止不了成本；且 `llm/retry` 记的 provider 可能不是真正被打的那一条。

根因是一个：**可服务性判断藏在 `planFire` 的"顺带前进"里，只在发火当时算一次**；而第一个
能阻止这次发火的决策点在**下一次失败后**才跑。

## Decision

1. **C2：可服务性提成独立谓词 `canFireAgain(state)`（当前候选还有预算，或还有下一个
   候选），由 `decideRecovery` 在 `return 'retry'` 之前判。** 不是加一个 `servable` 标记
   让 handler 去读——那样 seam 仍必须返回一个 config；而是让授权下一次发火的决策点自己
   知道"这一发到底能不能发生"，于是那一发根本不会被请求。
2. **I1：`agent/request-error` 在 `await next()` 之前判"本候选配额已尽 && 这个错该切换"，
   成立就直接决定**——换得动（还有下一个候选且总预算没尽）返回 `{kind:'retry'}` 让
   `planFire` 前进，换不动返回 `undefined` 终态。llm-retry 的退避与两条 durable 记录因此
   完全不发生。语义依据：`maxAttempts` 的文案是"这条渠道最多真实调用多少次"，候选配额已尽
   时 llm-retry 想给同一条路由第二次本身就是越权——不让它做是执行分层，不是破坏分层。
3. **熔断记录提成 `noteBreaker()` 闭包，提前返回的两个分支与"内层放弃"分支共用。**
   一次失败就是一次失败，记不记不该取决于恢复走哪条路。
4. **`planFire` 的 `exhausted` 与 `decideRecovery` 的 `state.exhausted` 分工写明**：
   前者是"末位候选刚被 cap"这个**转移事实**的标记；后者还服务"整条链都服务不了、落回用户
   原路由"那条路径（`outgoing === undefined` 时置位，不消耗任何候选配额），
   `canFireAgain` 看不见那一步。两者不可互相取代。

## Alternatives considered

1. C2 原文最小修法：`FirePlan` 加 `servable`，不 servable 就 `states.start(...); return resolved`
   - 最强的理由：改动最小，且复用了已经存在的"落回用户原路由"路径，不新增决策点。
   - 为何被否：实测把多打的那次从末位候选搬到用户原路由，总数仍是 4——`agent/request`
     必须返回一个 config，handler 里只能 redirect 不能 cancel。修法把代价搬了个位置，
     没有消灭它。真正的修法在另一个决策点：让授权发火的人先问"这一发能不能发生"。
2. 删 `prepend`、把 `agent/request-error` 注册进 llm-retry 内层（I1 原文选项一）
   - 最强的理由：能在 `backoff()` 之前看到内层决定，三项未记录的代价（孤儿记录、晚 10s
     终态、吃掉 llm-retry 额度）全部消失。
   - 为何被否：失去硬上限——实测同一场景打 7 次（上限 2）。硬上限是本插件的立身之本，
     为省一次退避换掉它不成立。
3. 只接受"只截断效果"，把注释改成实话（I1 原文选项二）
   - 最强的理由：零代码风险；三项代价都已量化，写进注释与决策笔记即可。
   - 为何被否：代价不是"已记录的既定事实"而是可以消除的——在 `await next()` 之前判，
     两项都要到了（硬上限 + 零退避零记录）。接受一个能消除的代价，和本条线要消灭的
     "用注释声明这是有意的"是同一种病。
4. 提前决定的分支不记熔断（少改一处）
   - 最强的理由：与修复前的行为逐字一致——修复前"内层决定重试"的直通分支确实不记。
   - 为何被否：第一次实测就这么踩了——`breaker-channel-scope-skips-sibling-models`
     立刻打红（headers 多出 sibling、block notice 不出现）。恢复走哪条路是插件的内部
     选择，失败本身是事实；提前返回不能把"该分支原本会做的副作用"搬丢。

## Consequences

- 收益：C2 的末位候选不再多打（3 候选各 1 枪、总上限 6 → 真实调用 3、health fold 每候选
  恰好 1 条、两条切换通知照发）；I1 的预算耗尽不再进 llm-retry（budget-cap 场景
  `llm/retry`/`llm/retry-started` 2→0，慢退避 stub 下 boot 墙钟 8179ms→1455ms，真实调用
  数不变）；`llm/retry` 记录的 provider 与真正被打的那一条不再可能不一致（插件自己决定的
  重试不经过 llm-retry）。`unit.mjs` 105→106，`run.mjs` 19→20 场景。
- 代价：① 两层修法在已接线路径上重叠——提前决定先拦住，`canFireAgain` 在当前 handler 形状
  下不会被触到（revert 抽样证实：删掉它单测红、组合场景仍绿）。保留它因为它是**决策层的
  契约**（`decideRecovery` 不该授权一次不可能发生的发火，无论谁调用），且 C2 的修复本就
  独立实测通过；代码注释与本文写明了这个分层，避免下轮有人以"不可达"为由删掉纯层的不变量。
  ② 提前决定的终态分支比修复前多记一次熔断（修复前那条路靠 veto 分支、不记）——方向是
  "一次失败一次记录"，但是一个行为变化，已由 `breaker-channel-scope` 等场景覆盖。
  ③ RATE_LIMIT 切换的退避行为变了：候选还有余额时 llm-retry 照旧退避（直通分支），余额
  用尽后切换不再等待。I2 的退避文案（阶段 3 线 8）必须按这个新事实改写，不能再说
  "每次切换前都有一次退避"。
