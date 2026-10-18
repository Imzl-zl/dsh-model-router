# Agent Note: 策略收编进决策核——恢复监听的两裁决点与跨字段校验各一处表达

Status: implemented

## Problem

`2026-10-17-close-the-review-todos` 执行完毕后，产品代码没有已知缺陷，剩下两处
「同一事实的第二表达」，而且**各自已经造成过真实漂移**：

1. **`agent/request-error` 的五分支是长出来的，副作用各挂各的**：A 透传 / B、C 提前
   决定（记熔断 + warn）/ D 否决（只 warn、**不记**——待办 4）/ E 放行（什么都不做，
   正确）/ F 内层放弃（记 + 恢复决策）。函数自己的注释声明「记不记不该取决于恢复走
   哪条路」，代码结构表达不了这条不变量——D 与 B/C 的差别不是规则，是历史上谁记得加。
   I1 的第一次 patch 已经在这栽过（提前返回跳过熔断记录，`breaker-channel-scope`
   立刻打红），当时用 `noteBreaker()` 闭包两分支共用糊上；分支继续增长，同一个坑
   还在。
2. **跨字段校验双源**：host `assertStructural` 抛英文 Error，client `validate()` 收
   `{key, vars}`，同一规则集两处表达、三句人工注释对齐。漂移已发生两起：① 默认兜底池
   的重复渠道，host 从第一天就拒（`unit.mjs` 既有用例钉着），浏览器漏检——用户存得下
   一个加载即被拒的配置；② en 字典从来没有 `problemDuplicateRoute` 键（zh 有），
   英文用户撞到重复渠道时字典缺键。

## Decision

1. **恢复监听收编为两个纯裁决函数**（`router.ts` 的 `decideBeforeInner` /
   `decideAfterInner`），返回 `{ kind, record, log }`——裁决与副作用声明在一起，
   `index.ts` 的 handler 退化成解释器（调决策、按声明应用、返回决策）。record 规则
   一句话：**把当前候选拿出轮换的失败（换走 / 凉住 / 终态）才记；失败尚未定论的
   （delegate / honor）不记。** 规则由判别联合在类型层钉住——只有 `delegate` 和
   `honor` 能带 `record: false`，「终态而不记」的裁决编译期就造不出来。日志文案随
   裁决走（本项目 recurring 的 C4 类漂移就是文案与行为两张皮），单测连消息一起钉。
2. **跨字段规则收编为 `src/rules.ts` 的 `structuralViolations()`**，返回
   `Violation[] = { key, vars, message }`：host 抛第一条（`assertStructural` 变成
   两行），浏览器收全部（`validate()` 把 violation 映射成问题对象）。产出顺序保持
   host 旧抛出序，第一条消息逐字不变。草稿态检查（空 provider、越界 maxAttempts 等
   6 项）**留在** `validate.ts`——host 故意不做单字段边界（schema 拥有它们，
   `assertStructural` docstring 划了这条线），那是设计边界不是遗漏。权重判定统一取
   `!(weight > 0)`（host 旧式 `<= 0` 对草稿里 undefined 的 weight 会漏判）。host 的
   profile 权重违规消息从泛化的 `profile` 改成点名 id。
3. **新增字典键 `problemDuplicateRouteInPool`（zh/en），并补上 en 缺失的
   `problemDuplicateRoute`**——后者是双源时期漏掉的，字典覆盖测试当场抓到。

## Alternatives considered

1. **只给否决分支补一行 `noteBreaker()`（待办 4 的最小修法）。**
   最强的理由：一行对齐注释，立刻关掉复审待办，行为变化面最小。
   为何被否：补丁式——五分支仍靠记性维持，下一次加分支或改早决条件照样漏；I1 已经
   栽过同一次。注释钉得住一时钉不住一世，类型层才钉得住「哪个裁决记」。展开的理由
   与被否过程见提案篇 `archived/2026-10-17-policy-into-the-decision-core.md`，此处
   不重复。
2. **两边各留一份校验 + 对账测试。**
   最强的理由：零契约变更，成本最低。
   为何被否：对账测试是第二个不变量（测试成为真相源），规则本身仍是两份，漏改时打红
   在测试层不在编译层；且本次两起漂移（兜底池重复渠道、en 缺键）都发生在「有对账
   注释」的前提下——注释没有拦住过任何一次。
3. **规则模块连草稿态检查一起收编。**
   最强的理由：字面上「校验只有一个家」更彻底。
   为何被否：那 6 项是 host 明确不做的（schema 拥有单字段边界）；收编过去等于把
   `finish-the-shared-modules` 刚删掉的「guard 比 schema 弱」矛盾请回来。共享的只能
   是没有争议的跨字段集。
4. **Violation 只带 `{key, vars}`，host 消息表留在 config.ts。**
   最强的理由：规则模块更纯粹，不带英文文案。
   为何被否：消息表是规则的第二个表达——加一条规则忘加消息，host 就抛 key 字符串；
   `message` 随 violation 走（一处产出、两种渲染）才是完成定义里的「旧表达被删除」。

## Consequences

- 收益：① 「记不记熔断」从注释承诺变成类型 + 单测事实——穷举全表的用例任一分支
  漏记即红（已实测：把否决裁决的 `record` 改回 `false`，分支用例与不变量表用例
  同时打红，后者还点名单元格 `after RATE_LIMIT/false/retry`）。② 跨字段规则一处
  表达；加一条规则不可能只加一边，字典覆盖测试把「漏字典」一并钉住。③ 两起真实
  漂移按构造修复。④ 待办 4 的守卫形状问题（单 step boot 观测不到熔断跳过效应）
  随之消失——`record` 字段就是可断言的观测面。
- 代价：① `index.ts` 主路径重写——21 场景 + 四套件兜底；轮 A 唯一的行为变化是
  否决分支开始记熔断（即待办 4 的修复），其余分支逐条对账（日志逐字不变）。
  ② 轮 B 的行为变化：兜底池重复渠道从此浏览器侧也拦；en 补上缺键；host 两条权重
  违规消息改了形状（点名 id / 统一措辞）；客户端问题列表排序变了（跨字段在前、
  草稿态在后——用例按 key 查找不受影响，UI 上是纯排序差异）。③ 新契约 `Violation`
  三字段（key/vars/message）首版即按两种消费者的需要定稿。
- 数字：`unit.mjs` 114 → **117**（+3：同源一致性 / 兜底池漂移 / 字典覆盖）；
  client-controller 41 / run 21 场景 0 失败 / remote 14 / tsc 0 均不变。

**给轮 C 的输入**：M3（两个 `noteFailure` 写入方）与 M7（两套重排）现在可以对照
本轮「裁决声明副作用」的形状判断归属；M9（绕过 `profileOf`）不在此形状内，仍按
删除第二表达处理。
