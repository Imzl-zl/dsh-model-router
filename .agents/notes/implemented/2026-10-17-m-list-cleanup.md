# Agent Note: M 清单清扫——十五条的处置、两个根因、一条重新登记

Status: implemented

## Problem

复审笔记（`proposed/2026-10-17-fix-batch-review.md`）「剩余未修项」里 15 条开放的
Minor（M10 已证伪、M2/M6/M8/M16/M20 上轮已修），逐条回核后分三类：

1. **「同一事实的第二表达」七条**：M1（`assertNoAlwaysPolicy` 与
   `warnUnregisteredProviders` 同骨架各写一遍）、M3（两个 `noteFailure` 写入方）、
   M7（两套重排）、M9（三个 setter 绕过 `profileOf`）、M12（键序敏感的
   `deepEqual`）、M15（路由清单两份 wrapper）、M18（借 DSH 语义令牌的色点）。
2. **从未接线的裸资源两条**：M11（控制器定时器）、M4（连通性检查的取消缝——
   `discoverModels` 一直收 signal，插件没传）。
3. **文案/文档四条**：M5（emptyResponse 与 llm-retry 的碰撞未点名）、M13（非
   更新器形式）、M14（写死 ⌘S）、M19（六个中文 desc）。

两个根因都比条目本身深：

- **M11 的真根因**：`controller.dispose()` 从来没有被接线到 fiber 生命周期——不是
  登记说的"dispose 后复活"，是 dispose 从未被调用；巡检 interval 对着卸载了的
  fiber 空转、继续打端点。
- **M3 是疑似冗余**：handler 的 `noteFailure` 与 durable-log observer 写同一个
  per-session 单槽，唯一的读者（failover notice 的失败码）在下一次请求才读——
  observer 是可靠路径。用套件实证而不是猜测。

M17 经回核**不成立**：全树只有一处 `TimeoutError`（probe.ts 内三处使用），没有
第二表达可删；DSH 的 `deadline()` 清理是 `using` 语法，源码模式解析不了，手搓融合
是有记录的等价物（tools.md 有锚点）。

## Decision

- **M1**：抽 `eachConfiguredCandidate`（ profiles 序 + 默认池的一次走）与
  `registeredProviderIds`，两个加载期审计共用。加载序盲区（后注册的 always 策略
  逃过加载校验）写进 docstring 成为显式边界——运行时拦截是行为变更（跳过候选 +
  新通知形状），属另一轮决策。
- **M3**：删掉 handler 侧的 `noteFailure`，observer 成为唯一写入方。实证：删除后
  21 场景全绿，其中 `failover-rate-limit` 正钉着「notice 带失败码」。
- **M4**（全缝）：host `@Remote checkConnectivity` 声明 `signal` 末参（Typert 的
  cancellation 通道，与 probeAll 同一机制）→ `checkConnectivity()` 透传
  `discoverModels` → 中止时**原样抛回**（取消不是"端点没应答"）；client 每轮一个
  `AbortController`（`checkAborts` 集合），卸载时全部 abort。
- **M7**：`moveCandidate` 委托 `controller.reorderCandidates`——相邻移动与拖拽
  同一条路径，边界守卫只有一份。
- **M9**：`setStickyTurns`/`setMaxTotalAttempts`/`toggleSwitchOn` 改走
  `profileOf`——未知 id 从 TypeError 变响亮的 "no profile"。
- **M11**：`dispose` 接线进 `ctx.effect` 的清理（先摘 slot 再收控制器）+ `disposed`
  守卫迟到发布（在飞回调、忙态下限的 setTimeout 不能再复活定时器）。
- **M12**：`deepEqual` 改递归、键序无关；数组仍按序（顺序是数组的语义）。
- **M13**：目录多选的 `setSelected` 改更新器形式。
- **M14**：`saveShortcutKey` 拆 `saveShortcutKeyMac`/`saveShortcutKeyOther` 两个
  字典键（中英各一对），`isMacPlatform()` + `saveShortcutKeyKey(isMac)` 纯函数选键。
- **M15**：`configuredRouteList` 适配器进 `routes.ts`，controller 与 page 都引它。
- **M18**：footer 未保存色点从 `--dsw-alias-state-warn-primary` 改
  `--dsh-router-tone-warn`。
- **M19**：`BREAKER_CODE_PRESETS` 的 `desc` 改 `descKey`，文案进字典（中英），
  渲染侧 `t(preset.descKey)`。
- **M21**：page 渲染 `HealthSettingsModal` 时传 `disabled`。
- **M5**：emptyResponse 的 schema 描述补上"llm-retry 默认策略同样重试它，切换
  发生在那些重试之后"。
- **M17**：重新登记为不成立（见 Problem）。

## Alternatives considered

1. **M11 只加 `disposed` 守卫、不接 dispose。**
   最强的理由：改动最小，"复活"路径确实堵住了，测试也能绿。
   为何被否：守卫防的是复发性泄漏，首次泄漏（dispose 从未被调用、interval 永久
   空转）原样存在——修的是症状的第二次发作。接线与守卫都要，且接线才是根。
2. **M3 保留两个写入方、加注释说明时序差异。**
   最强的理由：observer 与 handler 的时序（durable log 提交时点）可能有未预见
   路径，双写是 belt-and-suspenders。
   为何被否：双写正是本轮要消灭的"注释维持的第二真相"。用套件实证代替猜测：
   删除后 21 场景全绿（含钉 notice 带码的 failover-rate-limit），读者由场景继续守。
3. **M4 只做 host 侧透传，client 继续不传 signal。**
   最强的理由：host 侧 typed 之后未来可用；client 侧远程调用的信号形状未经真实
   浏览器验证。
   为何被否：缝的一半仍然开着——浏览器卸载时在飞的发现调用没人取消。probeAll 的
   描述符（`cancellation: {parameter: 'signal'}`）已证明同一生成契约在本项目
   可用，client 传 signal 走的是同一条契约，不是新机制。
4. **M21 用组件级行为测试（挂弹窗、切 tab、断言 disabled）。**
   最强的理由：行为测试比接线守卫强。
   为何被否：熔断 tier 在弹窗本地 tab 状态后面，harness 是有意的 one-pass 渲染
   （useState 是 no-op stub）；为它把 stub 升级成交互式 React 是测试基建的活，
   超出本条范围。改钉接线本身（生产方传 + 消费方读，双向断言），与 hidden/inert
   守卫同类。
5. **M17 抽到共享模块，或改用 DSH 的 `deadline()`。**
   最强的理由：字面上更"统一"。
   为何被否：单一模块、单一消费者集，没有第二表达可删；`deadline()` 的清理是
   `using`，源码模式（Node strip-only）解析不了——`probe.ts` 的手搓融合是工具书
   里记过的等价物。

## Consequences

- 收益：① M11 的定时器泄漏与 M4 的孤儿发现调用从"没人收"变成"fiber 卸载即收"
  （unload 测试：停表 + abort 在飞 + 迟到发布不复活，三个断言一串）。② 三个
  setter 的未知 id 从 TypeError 变响亮错误。③ deepEqual 不再把键序不同的同一份
  值误判为变化（宿主重发布不再冲掉未保存草稿的可能入口）。④ en 用户第一次能在
  熔断预设上看到说明（M19）。⑤ M1 的两个审计从此同走同守。
- 代价：① `apply.ts` 的 effect 现在返回组合 disposer（先摘 slot 再收控制器），
  顺序固定。② deepEqual 语义收紧：undefined 值键现在算键（旧 JSON 比较会忽略）——
  配置值全走 JSON 克隆，无 undefined 值键存活，无影响。③ M21 是接线守卫不是
  行为测试（tab 状态所限，理由见 Alternatives 4）。④ M4 的浏览器→宿主取消 riding
  在 probeAll 已声明的同一契约上，但本项目的浏览器侧此前未实际使用过该通道——
  真实浏览器会话是最后一块未铺的验证（隔离 home 冒烟）。
- 数字：`unit.mjs` 117 → **121**（+4：取消缝 / deepEqual / 快捷键键 / 预设覆盖）；
  `client-controller.mjs` 41 → **46**（+5：未知 id / 卸载 / 目录更新器 / 路由清单
  单源 / 弹窗接线）；`run.mjs` **21 场景 0 失败**不变（M3 的删除由它实证）；
  `remote.mjs` 14 不变；`tsc` 0 不变。

**给下一轮的输入**：M1 的运行时拦截（后注册 always 策略）是唯一从"修"降级为
"登记"的一条，形状已写进 docstring；M4 的真实浏览器取消路径值得一次隔离 home
冒烟补上；M22/N1–N8/待办 5 仍明确不做。
