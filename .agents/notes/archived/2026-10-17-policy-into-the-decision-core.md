# Agent Note: 把策略收编进决策核——handler 的副作用表与跨字段校验各一处表达

> 状态：**archived / 已被同名落地篇取代**（2026-10-19）。轮 A、B、C 均已落地，
> 落地记录见 `.agents/notes/implemented/2026-10-17-policy-into-the-decision-core.md`
> （轮 A/B）与 `.agents/notes/implemented/2026-10-17-m-list-cleanup.md`（轮 C）。
> 本篇是**动手前的提案**，结论与措辞不改写；两者同名同日期，按「取代而非改写」的规则
> 移入 `archived/`，实施现状一律以 `implemented/` 那两篇为准。
> 归档前复核（2026-10-19）：`router.ts:344/371` 的 `decideBeforeInner`/`decideAfterInner`
> 在位、`rules.ts:48` 的 `structuralViolations` 在位、字典键 `problemDuplicateRouteInPool`
> 存在，与落地篇一致。

## Problem

`fix-batch-review.md` 的待办 1-3 执行完毕后，产品代码没有已知会静默出错、丢数据或
不生效的地方；剩下的债务全是「同一事实的第二表达」。其中两处还在犯，是本篇范围：

1. **`agent/request-error` 的五个分支是长出来的，副作用各挂各的**：A 纯透传（不记
   失败/不记熔断）；B/C 提前决定两分支都 `noteBreaker()` + warn；D 否决只 warn、
   **不** `noteBreaker()`（= 待办 4）；E 放行什么都不做（正确——llm-retry 还在重试
   同一条路由，失败尚未定论）；F 内层放弃 `noteBreaker()` + `decideRecovery`。函数
   自己的注释声明「记不记不该取决于恢复走哪条路」，但代码结构表达不了这条不变量，
   只能靠每次改分支时记起。**待办 4 是这个病的症状，不是独立问题**——补一行
   `noteBreaker()` 只是让记性负担换一个位置。
2. **跨字段校验双源**：host `assertStructural`（`config.ts:362-410`）抛英文 Error，
   client `validate()`（`validate.ts:55-107`）收 `{key, vars}` 问题对象；同一个规则集
   （重复 ID / 空链 / 未钉 primary / 重复 route / weight 无正权重 / 空白 break rule）
   两处表达，靠三句人工注释对齐（`validate.ts:73-74`、`:92-93`、`:97-99`）。已登记在
   `finish-the-shared-modules.md` 遗留段。

其余 M 清单大半同病（M3 两个 `noteFailure` 写入方 / M7 两套重排 / M9 绕过
`profileOf` / M15 `configuredRouteList` 两份……），定位为轮 C。

根因一句话：项目已建成「共享纯模块 + 接缝薄适配」模式（`routes.ts` / `defaults.ts` /
`timeline.ts` / `router.ts` 纯函数核），但策略还有两处住在接缝里——一处 host 内部
（handler 分支表），一处跨半边（校验）。上两轮「按结构线排、不按清单排」的思路不变：
继续收编，不开新架构。

## Decision

**轮 A — 决策核（根治待办 4）**

- 从 `index.ts` 的 handler 抽两个纯函数进 `router.ts`（或新 `decisions.ts`，实施时
  按依赖定）：
  - `decideBeforeInner(state, failure, aborted)` → `{ kind: 'delegate' } |
    { kind: 'retry' } | { kind: 'terminate' }`
  - `decideAfterInner(state, failure, aborted, inner)` → `{ kind: 'honor' } |
    { kind: 'veto' } | { kind: 'retry' } | { kind: 'terminate' }`
- 两个返回值都带副作用声明：`record: boolean`（是否 `noteBreaker`）与 `log: string`。
  判定规则一句话，写进模块 docstring：**一次失败若把当前候选拿出轮换（换走 / 凉住 /
  终态）就记；失败尚未定论（放行内层继续重试同一条路由）就不记。** 待办 4 的
  `record: true` 由规则派生，不靠记性。
- handler 退化成解释器：调决策 → 按声明应用副作用 → 返回决策。五分支的副作用对账表
  从「读代码人肉对」变成单测可穷举的一张表（无 boot）。
- 守卫：决策核单测覆盖全表（含 aborted / exhausted / 边界 cap）；`run.mjs` 现有 21
  场景兜底端到端；revert 抽样——让任一分支跳过 `noteBreaker` 必须打红。
- 实施顺序「先移后删」：新函数就位 → handler 改调用 → 旧内联防环代码最后删；一个
  提交内完成，但 diff 分块清晰可评审。

**轮 B — 校验单源（根治 I6）**

- 新建纯规则模块 `rules.ts`：跨字段规则集返回 `Violation[]`，
  `Violation = { key, vars }`——**client 的现有形状作为规范形**（它要带 i18n，host
  的消息从它渲染）。
- `assertStructural` 变成「跑规则 + 抛第一条」，保留现有英文文案质量（消息模板随
  violation 走，一处）。
- `validate.ts` 删掉复制的检查，直接消费同一份 `Violation[]`；三句同步注释连同它们
  守的风险一起删。
- 守卫：单测断言「同一违规形状，host 抛的消息与 client 的问题对象同 key」；验收标准
  机械可判——**往规则模块加一条违规，不可能只加一边，因为只有一边。**

**轮 C — M 清单清扫（后续轮次，本篇只定边界）**

- 多数 M 项是「删第二表达」小手术（M3 / M7 / M9 / M15 / M11 / M12……），在 A/B 定完
  边界后批量做，验收仍是「删重复必须打红」。
- 三条不混批、各需单独看：M4（connectivity 无取消缝，接缝设计问题）、M17（私有
  `TimeoutError`）、M18（三态借语义色）。
- 明确不做：M22（客户端 `var/function` 风格，纯风格零行为）、N1–N8、待办 5
  （`run.mjs` 共享路径——正常使用碰不到，缓解=不并发跑两个实例）、客户端对称重构
  （routes/defaults 已证明共享纯模块足够跨半边，不为对称而对称）。

## Alternatives considered

1. **只修待办 4（否决前补一行 `noteBreaker()`）。**
   最强的理由：一行对齐注释，本轮就能关掉复审的一条待办；熔断行为变化面最小。
   为何被否：补丁式。五分支的副作用仍靠记性维持，下一次加分支或改早决条件照样漏——
   I1 的第一次 patch 已经这么栽过（提前返回跳过熔断记录，`breaker-channel-scope`
   立刻打红），当时用 `noteBreaker()` 闭包两分支共用糊上了，但分支继续增长的话同一个
   坑还在。治症状不治病。
2. **大爆炸重构：host/client 所有策略重写成一套框架或状态机。**
   最强的理由：一次性最彻底，不留中间态。
   为何被否：两个半边的运行模型不同（Typert 服务 vs 浏览器半包），routes/defaults/
   timeline 已证明「共享纯模块 + 两边薄适配」足够；重写成对称架构是为对称而对称，风险
   与收益倒挂。且两个 waterfall 的本质是「先问内层再处置」的两个决策点，不是一个状态
   空间——硬套状态机会把 `await next()` 的时序藏进类里，而那正是本插件最需要显式的东西。
3. **先清 M 清单（轮 C 先行）再动 A/B。**
   最强的理由：M 条目多、单条都小，先清可见债务有进度感，且不碰主路径、风险低。
   为何被否：M3（`noteFailure` 写入方）、M7（重排路径）的修法形状会被轮 A 的决策核
   影响（哪些副作用归决策管、哪些归 handler 管），先清可能白清。A/B 定边界，C 才是
   纯删除。
4. **轮 B 保留两处、只加一个对账测试。**
   最强的理由：零契约变更，成本最低；「host 抛的消息与 client 的问题对象同 key」的
   对账测试能抓住漂移。
   为何被否：对账测试是第二个不变量（测试成为真相源），而规则本身仍是两份——加规则
   仍要改两处，漏改时打红在测试层不在编译层。项目的完成定义是「旧表达被删除」，
   不是「旧表达被测试捆住」。

## Consequences

**收益**：待办 4 与 I6 从「靠注释和记性」变成「结构上只有一处」；决策核可无 boot
单测，handler 只剩适配逻辑；M 清单大半有明确归属与修法形状；「加一条规则 / 加一个
分支」从此是单点操作。待办 4 此前悬置的一个理由（单 step boot 观测不到熔断跳过效应、
守卫用例要另想形状）也随之消失——决策核单测可以直接断言 `record: true/false`。

**代价**：

- 轮 A 动 `index.ts` 主路径——有 21 场景 + 四套件兜底，但 review 成本真实存在；
  缓解 = 「先移后删」的分块顺序。
- 轮 B 的 `Violation` 形状是新契约，两个适配器首版可能迭代一次（host 消息渲染的
  粒度）。
- 轮 C 分散在多文件，单条 review 负担高——用「删重复必须打红」把每条的成本压到
  可评审。

**给实施轮的输入**：轮 B 落地时，`validate.ts` 三句注释的删除就是 I6 关闭的标志；
轮 A 落地时，`index.ts` 五分支对账表的消失就是待办 4 关闭的标志（不需要再等一个
端到端形状）。
