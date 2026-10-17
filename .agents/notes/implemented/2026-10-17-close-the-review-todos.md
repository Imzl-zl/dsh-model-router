# Agent Note: 复审待办 1-3 执行——否决分支的组合覆盖、文档卫生、I6 遗留登记

Status: implemented

## Problem

2026-10-17 独立复审（`proposed/2026-10-17-fix-batch-review.md`）判定「9 条结构线 8 条
按完成定义达成」后，剩三件必做与两件可选：

1. **「内层决定重试 + 预算已尽 → 否决」分支没有组合覆盖，且现有注释与事实相反**。
   变异实测：删掉 `index.ts` 的否决内块，20 个场景全绿——它不是死代码（探针实测：
   switchOn 未勾该码 + 总上限 5 时，它独自在挡第 6 次真实调用），是 I1 的提前决定把
   原钉子场景 `budget-cap-when-the-whole-chain-dies` 架空了（同场景 `llm/retry`
   记录为 0，证明 llm-retry 从未被咨询）。而该场景的注释还声称它钉住「llm-retry 在
   最后一条候选上自己的 5 次重试也被挡住」——与三行之隔的断言自相矛盾。
2. **文档卫生四处**：`open-questions.md` 第五节「前置说明」重复两遍（第二遍是提案
   口吻而工作已落地）；一表第 5/6 行挤在同一行；`AGENTS.md` 两处还写 18/18（实际
   20，加新场景 21）；默认值手写副本三处——`router.ts` 隐式跳 `maxAttempts: 1`、
   `controller.ts` 的 `maxAttempts: 1`、`pipeline.ts` 的 `'order'`。
3. **I6 只修了一半且没登记**：`finish-the-shared-modules` 的遗留段只记了
   `STRATEGIES`/`STRATEGY_OPTIONS`，没记「跨字段校验仍是 host 抛异常 / client 收
   问题对象双源」——下一个问「I6 修完了吗」的人会得到错误答案。

## Decision

1. **探针转正为正式场景** `veto-rejects-llm-retry-when-the-total-cap-is-spent`
   （`run.mjs`）：`switchOn.rateLimit: false` + `maxTotalAttempts: 5`，让提前决定
   不再成立、llm-retry 真的被咨询，钉住「它第 6 次决定重试时预算已尽 → 否决，
   真实调用恰好 5 次」。同步重写 `budget-cap` 的 note 与注释：它钉的是提前决定
   （llm/retry 记录为 0），否决是另一个决策点，由新场景钉。
2. **文档卫生按复审清单执行**：删第二段前置说明；第 6 行补换行；AGENTS.md
   18/18 → 21/21；两处 `maxAttempts: 1` 改引 `DEFAULT_MAX_ATTEMPTS`、`'order'`
   改引 `DEFAULT_STRATEGY`。
3. **`router.ts` 的隐式第一跳独立命名** `IMPLICIT_HOP_MAX_ATTEMPTS`，不引
   `DEFAULT_MAX_ATTEMPTS`。
4. **I6 另一半登记进** `finish-the-shared-modules` 遗留段：双源现状、为何不合并
   （产出形状不同，合并需要一次结果结构设计）、留给单独一轮。
5. **待办 4/5 本轮不做**（理由见 Alternatives 4/5）。

## Alternatives considered

1. 把 `switch-off-terminal` 的 `maxTotalAttempts` 从 6 改成 5，让否决落在边界内，
   不新增场景
   - 最强的理由：零新增成本，场景数不变；两条场景形状只差一格，改动一行。
   - 为何被否：那会改变一条既有场景的语义——它现在钉的是「llm-retry 自己的
     1+5 次在总上限 6 内全部走完、终态由 decideRecovery 的『不切换』给出」，改成
     5 之后它钉的变成否决，两条信息二损一。新增场景让「提前决定」与「否决」两个
     决策点各有钉子，代价只是约 15s。
2. 只改注释、不加场景，以复审时的变异实验为证据
   - 最强的理由：分支已被探针证明在挡上限；注释修对就不再误导人。
   - 为何被否：探针已删除，变异实验不可重跑；没有场景钉住，下一次「删掉看起来
     多余的分支」照样全绿。测试网的存在意义就是让这类删除当场打红。
3. `router.ts` 隐式跳直接引 `DEFAULT_MAX_ATTEMPTS`
   - 最强的理由：值相同（都是 1），字面上也是「一个候选的默认配额」，少一个常数。
   - 为何被否：它是另一个事实。`DEFAULT_MAX_ATTEMPTS` 是用户可配候选的 schema
     默认值，随产品决策变（`NEW_PROFILE_MAX_ATTEMPTS = 2` 已经证明同一字段可以
     有两个值）；隐式跳的「一枪」是结构性的——插件不拥有用户自己路由上的重试，
     兜底池的存在意义就是 move ON。前者若改成 2 而隐式跳跟着变，每个兜底池用户
     的故障转移都会多等一次真实调用，而这种耦合没有任何地方声明过。
4. 待办 4（否决分支终态不记熔断）本轮顺带修
   - 最强的理由：函数自己的注释说「记不记不该取决于恢复走哪条路」，代码比注释窄；
     提前决定两分支都记，批次方向本来就是「记更多」。
   - 为何被否：它改变熔断行为（switchOn 未勾该码 + 总上限较小时，为该码配的规则
     会开始落库），属决策级；且单 step boot 里观察不到跳过效应，守卫用例需要另想
     形状（提取决策函数或跨请求观测）。把它塞进文档卫生批次，等于把一次决策级行为
     改变埋在无人注意的批次里。留在 `proposed/` 复审笔记等用户决定。
5. 待办 5（`run.mjs` 共享路径按 pid 隔离）顺手做
   - 最强的理由：复审时两个实例重叠真的互相污染过（20 场景 23 失败），机制在
     代码里，修法明确（约 10 行）。
   - 为何被否：那是复审方的测量事故，不是产品缺陷；缓解（一次只跑一个实例）已写
     进操作须知；改路径要动 `HOME`/`SESSIONS`/overlay/`stub-script` 四处并重算
     全部引用，属测试基建改动，应和它自己的失败模式一起做，不搭本次便车。

## Consequences

- 收益：否决分支从此有组合覆盖——删掉否决内块，新场景精确打红在
  `expected 5, got 6`（已实测，与复审探针的 5 vs 6 一致）；`budget-cap` 注释与
  代码行为一致；三处默认值手写副本消失，改默认值只需改 `defaults.ts`；I6 的
  真实遗留状态可查。
- 代价：① `run.mjs` 20 → 21 场景（约 +15s），`AGENTS.md` 与 `memory.md` 数字
  已同步。② 新场景的形状耦合 stub 的默认重试策略（`maxRetries: 5`，对齐 DSH
  normal）——stub 或 DSH 改这个默认时，「恰好 5 次」会变，打红先查这条。③
  `IMPLICIT_HOP_MAX_ATTEMPTS` 与 `DEFAULT_MAX_ATTEMPTS` 同值 1、两个常数并存，
  后人可能想合并——合并前先读本篇 Alternative 3。④ 待办 4/5 悬置，需要时从
  `proposed/2026-10-17-fix-batch-review.md` 取上下文。
