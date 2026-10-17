# Agent Note: 实现层审查的修复按「把抽象建完」排，不按条目清单排

> 状态：**proposed / 待评审**。本篇定排序、完成定义与每条结构线的修法取向。
> 5 项修法决策已全部定案并记在 `docs/design/open-questions.md` 第五节，其中 C2 与 I1
> 已实改实测通过（数据在该节），本篇只引用不重复。**实施前先读那一节。**

## Problem

2026-10-17 四路审查 + 逐条执行级复核（见同目录
`2026-10-17-implementation-audit-findings.md` 文末结论表）后，4 Critical / 11 Important /
22 Minor / 8 Nit 全部有处置，其中 3 条证伪或部分证伪、**3 条原文的「最小修法」或问题框架
被实测推翻**（C2 的修法、I1 的"外层/内层二选一"框架、I7 的 `contentClassName` 方向）。

清单自己的总结论已经点到病根：**抽象建到一半就停手，然后用字符串常量和注释把另一半
粘起来**，并且在八处重复出现。所以真正的修复单位不是「一条 finding」，而是「一条被
建到一半的抽象」。

按清单顺序逐条修，每一条都是局部最优，而且会**再生产一次同一个病**：

- 修 C1 不修 I10：两者是同一条病的两条路径——`probe.ts` 和 `connectivity.ts` 都建了
  封闭码集并分类，唯独主路径 `index.ts:254-263` 是全兜。只修 C1 等于把「finish 分支
  漏了一类」补上，却在 catch 分支留下一整类。
- 修 C2 不定 I1 的注册层：两者都改 `index.ts:317-362` 与 `router.ts`。C2 的修法依赖
  「末位候选被 cap 之后这一次打给谁、可不可见」，而 I1 的注册层决定 llm-retry 的重试
  会不会走到那里。先改后决策 = 改两遍。
- 修 I5 不动 I6：项目已经为 route key（`routes.ts`）和时间线窗口（`timeline.ts`）建立了
  「共享纯模块」模式，却没用在校验和默认值上。只收编键格式、不动校验双源，会留下一个
  「共享模块只覆盖了一半字段」的新漂移，比不建更难发现。

## Decision

**修复按 9 条结构线排。每条线的完成定义是「不变量只有一处表达 + 旧表达被删除」，
不是「这条不报了」。任何一条线没走完不提交。**

排序由依赖决定，四个阶段：

**阶段 0 — 决策（已清零，不写代码）**
`open-questions.md` 第五节 5 项修法取向已全部定案。其中 **C2 与 I1 已实改实测通过**：
C2 提 `canFireAgain` 谓词由 `decideRecovery` 在授权下一次发火前判（3 次调用、每候选恰好
一次、三套件全绿）；I1 在 `await next()` 之前判"本候选配额已尽 && 该切换"直接决定，
根本不进 llm-retry（budget-cap 场景 boot 8547ms→2227ms、`llm/retry` 2→0、真实调用仍 2、
三套件全绿）。I10/I7/M20 三条已定案待实施。

**阶段 1 — 共享模块收编（纯函数，无行为变化，可整体 revert）**
- 线 1 `routes.ts`：补 `routeParts()`，host 8 处编码 + browser 18 处编码 + 9 处解码全部
  收编，`routeOf`/`notice.ts:45` 的局部 `label()` 要么全用要么删。守卫：`src/` 里
  `provider + '/'` 与 `indexOf('/')` 出现次数为 0（`routes.ts` 自身除外）。
- 线 2 `defaults.ts`（新）：收编 `maxAttempts`/`maxTotalAttempts`/`stickyTurns`/
  `prompt '1'`/`timeoutSeconds 8`/`cooldownSeconds 300`/`scope route`/`strategy order` 与
  `SWITCH_ON_CODES` 码清单；`config.ts`、`validate.ts`、`controller.ts:390-397`、
  `pipeline.ts:455`、`modals.ts`（6 处）各写一遍的现状收成一处。
  同时删掉 `assertStructural` 的 8 个数值 guard（实测全部被 schema 挡在前面）与 2 个
  存在性判断，docstring 写明「只做跨字段校验；单字段边界由 schema 拥有」。
- 线 3 `timeline.ts`：`health-ui.ts:24,28` 的硬编码 24 改读 `MAX_TIMELINE_POINTS`。

**阶段 2 — 行为修复（每条线一个组合/单测场景，先红后绿）**
- 线 4 失败分类：`probe.ts` finish 分支放开 `aborted` 并按「超时 → 取消 → 封闭码集」
  排序；主路径 `index.ts:254-263` 按 `open-questions.md` 第五节第 3 项的三档分类；
  fake 一律照真实 adapter 形状（C1 + I10 + M2 的死码清扫 + `unit.mjs:1056-1061` 的 fake 修正）。
- 线 5 attempt 预算模型：`canFireAgain` 谓词 + `decideRecovery` 前置判（C2）；`agent/request-error`
  在 `await next()` 之前判"本候选配额已尽 && 该切换"直接决定、熔断记录提成 `noteBreaker()`
  闭包两分支共用（I1）。两条修法均已实测通过，照记录实施即可，注意 `planFire` 的
  `exhausted` 标记与 `decideRecovery` 的 `state.exhausted` 守卫分工要在同一次提交里写明。
- 线 6 健康延迟锚点：`request/header` → `step/start`，按 `(turn, step)` 门控归属，仿
  `session-stats/src/projection.ts:133-149`。连带修 `lineage.ts:150` 的 settle 缺 step
  门控（同一类「跨 step 归属」错，一起修）（I3 + 待核实 7）。
- 线 7 配置加载期挂载与快捷键门：`page.ts` effect 首行 `if (!wrap) return`；删
  `footer.ts:24-27` 的 retain/release，`surfaceCount` 的计数理由随之消失，注释一起清
  （C3 + I4 + M8）。
- 线 7b 弹窗滚动与高度链：删 `styles.ts:234-249` 的 `[class*="body"]` 整块，插件自己的
  `#dsh-router-health-modal-body` 升级成滚动容器，`contentClassName` 给 DSH 的 `css.content`
  补 `flex:1; min-height:0`，effect 改读自己的 id；`calc(84vh - 70px)` 连同魔数一起删，
  只留 dialog 根上 `max-height: 84vh` 一个 vh 常数；vh 守卫从匹配 `calc(100vh…)` 改成
  "内容链不允许任何 vh 算术"；z-index 1100/1101 值不改（DSH 自己有 9 处同值先例），
  补引用注释并提成命名常量（I7 + M20）。

**阶段 3 — 文档、字典、死代码（无行为变化）**
- 线 8 文档与文案：`index.ts:11-13`、`router.ts:8-17`、`capability-boundary.md` 的 6 处
  陈旧陈述全部改写并指向 `index.ts:317-324` 的实测依据；`open-questions.md` 一.3/一.4
  的旧裁定同步；I2 的 6 处退避文案改实话；I9 的两个硬编码中文恢复字典键。
  `--dsh-router-accent` 收编 14 处 + `rgba(74,101,232,x)` 改 `color-mix`（I8）；
  `AGENTS.md` 的 8/8 改 18（M16）；z-index 1100/1101 补 DSH 先例引用（值不改，理由见
  `open-questions.md` 第五节第 5 项）。

**阶段 4 — revert 抽样**
每阶段结束至少一次「把生产代码改坏，看本阶段新增的场景是否转红」。C2 已经证明过现有
18 场景在这个形状上是空的——阶段 2 的每条线都必须先补场景再修，否则又是假绿。

## Alternatives considered

1. **按清单严重度顺序修（C1→C2→C3→C4→I1→…）。**
   最强理由：Critical 先修符合风险直觉；C1 和 C3 各是一行，能立刻拿到用户可见收益；
   评审者已经按严重度排好，执行时不用再想。
   为何被否：C1 与 I10 是同一条病的两条路径，只修 C1 会在主路径留下同类全兜；C2 的修法
   依赖 I1 的注册层决策，而两者改同一段代码。结果是第 3 条又要回头改第 1 条——正是本项目
   自己要消灭的「抽象建一半」。

2. **一次性全修（一个分支 45 条）。**
   最强理由：没有中间态、没有半迁移窗口，也不会出现「改了一半的共享模块」。
   为何被否：diff 大到不可评审；其中 5 条是设计决策而非修复，没有决策就没有「修完」的
   定义；项目军规要求决策笔记与代码同批提交，45 条同批等于一次写完 45 篇笔记，质量必然塌。
   且工作树里已经躺着 +767/−293 的未提交拖拽重排改动，叠上去之后任何 revert 抽样都做不了。

3. **只修 Critical + Important，Minor/Nit 另议。**
   最强理由：成本收益比最好，Minor 确实多数是死代码与魔数。
   为何被否：M2（死代码）/ M6（硬编码 24）/ M15（重复定义与死样式键）与 I5 / I6 / I8 是
   同一条结构线的不同切面。拆开会把「收编」做两遍，而第二遍往往因为第一遍改了名字而对不上。

## Consequences

**收益**：每条线的完成都是可验证的（守卫 + 回归 + revert 抽样），不会再用「注释声明这是
有意的」代替机制；「注释声称与实现矛盾」（C4）和「docstring 断言为假」（I5）这类同一病
的复发点被一次清掉。

**代价**：
- 前两个会话看不到用户可见改进——C1/C3 这种一行修复被排到阶段 2。若产品上等不起，
  可单独落地线 4 的 C1 部分，但必须在同一次提交里把 `unit.mjs:1056-1061` 的 fake 改成
  真实 adapter 形状，否则新增的用例继续保护不到生产路径（已实测：改形状后两条单测转红）。
- 线 2 新建 `defaults.ts` 会动 `config.ts` 的导出面，`typert.host.js` 的生成物需要重建后
  重新核对（`Profile` schema 是 host face 唯一 surface）。

**本篇自己的教训（写下来防止下一轮重犯）**：C2 的「最小修法」在审查记录里看起来成立，
实测却不达成目标——它把多打的那次从末位候选搬到用户原路由，总数没变。根因是审查时只
推演了"拦不拦得住"，没有问"拦下来之后 seam 要求必须返回一个 config，那一个 config 从
哪来"。**任何"在 handler 里拦"的修法都要先回答这个问题**，否则只是在搬代价。真正的根因
修法出现在另一个位置：让 `decideRecovery` 在授权下一次发火之前判可服务性，这样那次发火
根本不会被请求，seam 约束完全不触发。同一条思路在 I1 上又兑现了一次（在 `await next()`
之前直接决定，llm-retry 的退避与 durable 记录完全不发生）。

**I1 实现的第二个陷阱（第一次 patch 实测踩到）**：在 `await next()` 之前提前返回，
会跳过原本只在"内层放弃"分支里的熔断记录——`breaker-channel-scope-skips-sibling-models`
立刻打红（headers 多出 sibling、block notice 不出现）。修为把熔断记录提成 `noteBreaker()`
闭包供两个分支共用。**教训：在一个 waterfall 里提前返回时，要把"这个分支原本会做的副作用"
逐条列出来，而不是只搬你想保留的那一句。**
