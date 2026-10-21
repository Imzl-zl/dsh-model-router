# 恢复裁决与页面壳的语义修正（2026-10-19）

## Context

用户复审提出三类问题，逐条核实后都成立：

1. **`pendingAdvance` 把"改道"和"同路由重试"混成一个信号**。`decideAfterInner` 的每个
   `retry` 都被写成 `pendingAdvance = true`，而该裁决来自 `decideRecovery`，后者用
   `canFireAgain` 判"本候选还有额度"——于是 llm-retry 放弃后，Router 会跳过本候选剩余
   额度（有下一条时）或在末位候选上盲打一次并置 `exhausted`（没有下一条时）。实测
   2 候选 × `maxAttempts=3`、llm-retry 拒绝该码：只打 2 次，且末位候选的 `exhausted`
   是在没到上限时置的。
2. **旧配置迁移丢掉首跳的 `maxAttempts`**。`effectiveChain` 把 profile 的
   `candidates[0]` 丢成隐式首跳，却只丢不带走它的 `maxAttempts`；今天新增的
   `firstHopMaxAttempts` 正是这个语义，老用户配的 3 次会被静默重置成 1。
3. **组合测试的 happy path 是空转**。`primary-success` 的 profile 只有一条候选，
   迁移后 fallback 为空、`resolveChain` 返回 `undefined`，插件根本不接管；这条用例在
   路由器整个坏掉时也会绿。

同时，工作台的 260px 内部侧栏、重复标题、卡片套娃、双重添加按钮、弹窗高度跳变与
自建抽屉都已由用户指出多次；一条 `implemented/` 笔记声称已修，但树里没有任何对应
改动（测试还钉着侧栏），该笔记已删除。

## Decision

1. **恢复裁决只授权"落在另一条候选"的前进**。`decideRecovery` 的最后一个判据从
   `canFireAgain` 换成 `hasNextCandidate`；`canFireAgain` 整个删除。`RecoveryDecision`
   与两个 ruling 的 `retry` 改名为 `advance`，让词汇本身说明它不会重打当前路由。
   llm-retry 放弃且没有下一条候选时，末位候选直接终态——没有退避的盲重试与
   "exhausted 代表配额已尽"两件事都不再成立。
2. **迁移带走首跳尝试次数**：`effectiveChain` 把 `candidates[0].maxAttempts` 写进
   `firstHopMaxAttempts`；组合测试的 overlay 生成器（`chainOf`）镜像同一规则，否则
   测试会绕开产品迁移、看到默认 1。
3. **`primary-success` 补一条真实降级候选**，让插件真的接管，断言才有意义。
4. **汇总文案进字典**：检查/探测的四个桶标签改由 `t()` 提供；英文界面不再出现
   "可达 3"。
5. **默认值单源**：删 `IMPLICIT_HOP_MAX_ATTEMPTS`；两个总上限常量合成一个
   `DEFAULT_MAX_TOTAL_ATTEMPTS = 3`；策略清单移到 `defaults.ts`，客户端不再手抄；
   UI 的 `?? 1` 改读 `DEFAULT_FIRST_HOP_MAX_ATTEMPTS`。
6. **页面自己拥有 chrome**：删除 `SettingsForm` 外框与压制底栏的结构选择器，页面按
   DSH 面板页契约（`.page → .pageScroll → .pageContent(960) → .pageHead(28px)`）自己
   布局；顶部 `SegmentedTabs` 取代内部侧栏；唯一保存条在底部；`panel.ts` 退成纯载体。
7. **探测可取消**：浏览器侧 probe 传 `AbortSignal`，卸载时与连通性检查一起 abort。
8. **起点策略只作用于降级候选（2026-10-20 修订）**：第一跳永远是用户选中的模型、
   永远先试；`order` / `weight` / `round-robin` 只决定第一跳失败后从哪条降级候选开始。
   `startStep` 保留链首、只旋转降级候选，`resolveStartIndex` 只收降级候选，因此
   首跳不再需要权重，也不会被 weight 静默跳过。

## Alternatives considered

### A1. 保留 `canFireAgain`，只在 `index < last` 时置 `pendingAdvance`

**最强理由**：改动最小，C2 的谓词不动。

**为何被否**：`canFireAgain` 与 `pendingAdvance` 描述同一件事（"还能不能发"），两处
判据必然再次漂移；而它把"本候选还有额度"当成"还能发火"，正是本次 bug 的形状。
删掉它、让 `decideRecovery` 只回答"有没有下一条"，不变量只剩一处。

### A2. llm-retry 放弃后仍允许 Router 用掉本候选剩余额度

**最强理由**：用户配了 `maxAttempts=3`，看起来应该打满 3 次。

**为何被否**：那 3 次是"允许 Router 放行的发火次数"，同路由重试归 llm-retry；它已经
拒绝，再打一次就是没有退避的盲重试，而且会把 `exhausted` 置在一个没到上限的候选上。
真要更多同路由重试，应该调 DSH 的 provider retry policy，而不是让插件另造一套。

### A3. 给首跳一个可配权重，让 weight 也能分摊首跳流量

**最强理由**：支持"免费 30% / 稳定 70%"式分摊，weight 语义完整。

**为何被否**：它把"我选了这个模型，就先试它"变成可被权重覆盖的默认值——用户选模型
的第一心智就是先用它；而且 UI 要多一个只对 weight 有意义的输入，配置面变大。
需要分摊流量时，正确做法是把渠道都放进降级候选、把首跳当成固定入口。

### A4. 保留 `SettingsForm` 外框，继续用 `hidden`/`inert` 压掉它的底栏

**最强理由**：复用 DSH 的可用/只读/保存状态，少写一套。

**为何被否**：那个外框是"插件设置卡片"的形状，不是工作台；压掉底栏需要结构选择器
与 `hidden`/`inert` 双写，还要在 Tab 圈禁上做文章。页面自己拥有页头、页签和唯一
保存条之后，这些补丁全部消失——这是结构性修法，不是换一种压法。

## Consequences

- **行为变化**：旧配置里首跳配过 >1 次尝试的用户，迁移后保留该次数（此前被重置为 1）；
  组合场景 `failover-rate-limit` / `breaker-does-not-break-failover` 的失败次数从 1 变 2，
  `total-cap` 改成"llm-retry 放行重试、上限精确截断"的形状。**起点策略只作用于降级
  候选**：weight/round-robin 不再移动第一跳；`weight-strategy-picks-the-fallback-start-
  after-the-first-hop` 场景钉住"第一跳先试、零权重候选不会被抽中"。
- **测试**：unit 149、client-controller 51、remote 15、组合 23 场景全绿；
  `tsc -p`、`npm run bundle`、`node --check` 均 0。策略语义与信息密度改动后**又跑了
  一次浏览器实测**（端口 3403）：分区头两端对齐（hint 右边缘 = 区头右边缘）、策略
  文案已更新、第一跳不再有"起点可能不是它"标签；健康视图每行 hint 数为 0。
- **样式清理**：`styles.ts` 1995 → 319 行；`S` 对象整个删除（内联只剩动态值：色调、
  柱高），注入 CSS 只剩 class；每个 class 都有引用（源级审计 0 无引用）。
- **信息密度（2026-10-20）**：分区头改成标题左、说明右的两端对齐（`section-hint` 用
  `margin-left:auto`）；健康视图行内只留数据——删掉每行重复的时间轴图例、延迟/吞吐
  说明、长副标题与"单条渠道也能单独探测"提示，说明统一进 tooltip。依据：用户指出
  "渠道健康搞那么多说明性文字，信息密度全是说明了"。
- **浏览器实测（2026-10-20，隔离 `.dshhome-view` + Chrome MCP，端口 3401）**：
  侧栏面板行在「插件」之下；页面壳为固定页头/页签/保存条 + 只有内容区滚动
  （实测 `scrollHeight 899 > clientHeight 664`，页头不随滚动）；起点策略在首位；
  「添加候选渠道」为页签级 primary 按钮；保存条常驻（干净时显示"所有修改已保存"、
  保存禁用）；权重策略下弹出"没有任何候选权重大于 0"并阻止保存；识图粘滞为
  0/1/2/3/5 分段控件；尝试预算显示"最多 4 次真实调用：第一跳 2 + 候选共 3 = 5，
  受总上限 4 截断"与 DSH 原生重试的说明；健康视图为扁平行（无内层卡片）；
  两个弹窗均 560×560、内容区滚动、熔断规则内嵌（无第二层子弹窗）；转移历史为
  居中 Modal。**实测抓到并修掉两个真问题**：① 字典批量替换把同一个键写进两个
  语系，重复键后写覆盖前写，中文界面出现英文说明；② 健康设置弹窗的分区标题与
  开关行标签重复、长 hint 被挤成窄列——改为"分区标题 + 右侧开关"和标签在上、
  控件在下的堆叠字段。
- **字典清理**：删掉 82 个旧 UI 的键（`navHealth*`/`subTab*`/`policySummary*`/
  `probeFirstToken*`/`code*` 等，zh/en 各 164 行），两份字典各 243 键、零重复、零缺失；
  动态键族（`labelKey + 'Name'|'Desc'`、`strategy*`、`strategyDetail*`、`problem*`、
  `breakerPreset*`）保留。钉住旧键的单元测试改成当前页面/分区/预算/时间轴的键表。
- **未完成**：`weight` 下第一跳是否参与抽签仍是产品待决（`open-questions.md` 第八节）。
