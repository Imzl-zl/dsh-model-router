# 评审发现与修复（2026-10-16 整体评审）

Status: implemented

## Problem

2026-10-16 对 HEAD（be8d5e1）做整体评审：三路独立评审员（宿主逻辑 / 客户端 UI /
DSH 原生能力挖掘）+ 主代理逐条复核，共提出 2 Critical、12 Important、约 12 Minor。
每条都回到源码求证（不采信评审员转述），被证伪的也记录证据，防下轮重提。

本批次已落地：两个 Critical，以及 Important 中的 breaker 开关、always 拒绝、sticky
时序、定时探测、通知去重、账本归属、快照过滤、时间线合并、弹窗草稿、快捷键原生化、
footerActions 收窄、文档刷新；Minor 中的探测取消分类、文案归位、timeoutMs 命名、
signal dot 单源、HMR 卸载断言、假 design token、错误码字典、候选重复校验、
discover 定时器语义、以及 `src/routes.ts` 共用模块。未落地项见文末"仍未处理"。

修复总原则：能用 DSH 原生能力的就不自建。深读确认并使用的原生设施——
`Modal.shortcutModal` + `ctx.shortcuts.register()`（client/shortcuts）、
`ctx.llm.providerRetryPolicy()`、`sessionProjections.snapshot(session, keys?)`、
`SettingsForm` 的卸载契约、`ui-primitives` 的 StateDot 族。

## Decision

### 一、已证伪（不要再当问题）

| 指控 | 判定 | 证据 |
|---|---|---|
| 投影注册 disposer 被丢弃 → fiber 重启泄漏 | **假** | `register()` 内部 `this.ctx.effect(...)`（session-projection/src/index.ts:273）；Cordis 的 traceable 代理把 `this.ctx` 绑定回**调用方** context（utils.ts:176 `if (prop === tracker.property) return ctx`、reflect.ts:234 `getTraceable(this.ctx, ...)`），注册表自带 HMR 测试证明 disposer 随调用方 fiber（registry.spec.ts:511-526）。插件裸调 `register()` 与树内消费者一致，正确 |
| 单测 119 个（39+80） | **假** | 同一累加器先打印 39 后打印 80，总数是 80（已计入 memory/tools） |
| 「Router 在外层永远等不到放弃信号」因此只能内层注册 | **已证伪并改位置** | 实验证明外层 `await next()` 能拿到内层放弃信号（undefined），且能否决 llm-retry 的重试：同一场景内层注册打 7 次、外层打 2 次（上限 2）。见"预算位置"节 |

### 二、Critical（必修）

**C1 `health.breaker.enabled` 在宿主侧被完全忽略。**
判定：真。index.ts:311 只读 `.breaker.rules`；全 src 仅 config.ts:403（校验）与客户端
validate.ts:87 读 `enabled`。连锁：空规则的校验被 `enabled` 门控（config.ts:403、
validate.ts:87），而 normalizeHealth（validate.ts:124-133）在关闭时**仍保留 rules**；
breaker.ts:53-57 对 code/message 全空的规则直接命中每一次失败。
后果：关着开关规则照样生效；若曾在关闭态存入空白规则 → 每次失败都禁掉所有候选 → failover
静默失效 + 每步刷通知。
修法（不新增第二处真相）：`enabled` 的读取点与 `rules` 同址——request-error 里
`(config.health?.get())?.breaker` 整体取出，`enabled !== true` 即不调用 `breaker.note()`；
同时把空规则校验从"enabled 时"改为**无条件**（空白规则在任何状态下都是配置错误，host 与
client 两侧同步）。补 `enabled:false` 组合场景（现有两场景都是 true）。

**C2 手动新增候选的单渠道尝试数被静默丢弃。**
判定：真。modals.ts:587-596 有输入框 → modals.ts:501 传出 → controller.ts:407 写死
`maxAttempts: 1`。目录选择路径本来就没有该字段，1 是它的默认值；手动路径的用户输入被吞。
修法：`Object.assign({ maxAttempts: 1 }, entry)` 后再 push，默认值与覆盖不再互相打架；
补 `addCandidates` 控制器用例（草稿里 maxAttempts 为用户填的值）。

### 三、Important（应修，均为就地小改）

1. **`always` 重试策略未按既定决策拒绝，"硬上限"文案不真实。**
   真：插件无任何 `retryPolicy` 读取；DSH 允许用户在 Models 页设（llm-deepseek config.ts:100
   `RetryPolicySchema.volatile()`，always 无上限 retry-policy.ts:49-54）；而
   dsh-capability-boundary.md:93 与 open-questions 一.3 写明"加载时拒绝"。
   修法：在 `install()` 的 provider 体检里（warnUnregisteredProviders 同一次遍历）读
   `ctx.llm.providerRetryPolicy(provider)`，命中 `always` 的候选 provider **加载即抛**
   ——与已记录的决策一致，不做运行时 veto；同时把 config.ts:87-88 的字段文案改成 README
   已披露的两层口径（总上限管插件发起的 attempt，llm-retry 的同路由重试另算）。
2. **被动健康时间线重复累加。**
   真：controller.ts:150-155 `concat` 不去重不截断；loadPassive 在挂载/打开健康页/每轮检查后
   反复重读同样 20 个会话 → 同一批点被反复并入。后果：workspace.ts:249-254 的可用率与
   health-ui.ts:71 的点数随停留时间漂移，数组无界增长。测试盲区已证实：
   client-controller.mjs:433-459 每次返回**不同**记录，绕开"同记录读两次"的形态。
   修法：`mergeHealthRecord` 按 `time` 去重（同 time 同 status 视为同一点，合并后取
   MAX_TIMELINE_POINTS 截断），并补"同一记录读两次，时间线长度不变"用例。
   备选：按 (route, sessionId) 覆盖式合并（见 Alternatives）。
3. **关闭侧栏快捷弹窗静默丢弃另一面未保存草稿。**
   真：插件页与弹窗共用同一 controller（apply.ts:80），两面都渲染 `SettingsForm` 且都把
   `onDiscard` 接到 `controller.discard()`（page.ts:168-186、controller.ts:347）；DSH 的
   SettingsForm 卸载即 discard（SettingsForm.tsx:54），而弹窗关闭 = 卸载。
   修法：`isModalView` 时不渲染 `SettingsForm`——弹窗顶栏已完整承接保存/放弃，且底栏本来
   就被 `.dsh-router-form-body + div:has(button)` 压掉（styles.ts:62-69），SettingsForm 在
   该视图只剩副作用。modal 视图改读 `state.available/writable/failed` 自行渲染不可用/只读行。
4. **`stickyTurns` 在会话首个带图轮整段失效。**
   真：state.ts:168 在 `noteConditions`（pre-step）里读 sticky，而该值只在 agent/request 里
   写入（index.ts:196），pre-step 先于 request → 新会话第一条带图消息的粘滞窗口为 0，
   紧随的无图追问不会被粘住。单测均先 `setStickyTurns` 再 `noteConditions`（unit.mjs:805/814/827），
   掩盖了时序。
   修法：把 sticky 的解析从"request 时写"改为"pre-step 时按当前链解析可得"——链的解析在
   resolveChain 里，而 resolveChain 需要 `resolved`；等价做法是在 `agent/created` 后首次
   pre-step 用 `payload` 之前已知的 selection 快照预取，或在 `noteConditions` 缺失时回落
   **上一轮的 sticky**（TurnNote 已持有 stickyRemaining，语义等价且无新增状态源）。
   补"不预置 setStickyTurns"的时序用例。
5. **定时探测无重入保护、卸载不中止在飞探测。**
   真：index.ts:373-383 裸 setInterval，每 tick 新建永不 abort 的 controller；单路由默认 8s
   超时而周期最小可设 1s → 多轮叠跑、lastProbeReport 互相覆盖、fiber 卸载后飞行中的探测继续
   花钱（ctx.effect 只 clearInterval）。
   修法：`private probing = false` 守卫（周期到点仍在跑就跳过本轮，不排队不叠加）；
   timer controller 存字段，effect 里 `clearInterval` + `controller.abort()` 双清理。
6. **通知去重不一致（熔断/能力跳过无去重）。**
   真：条件跳过有 (turn, 跳过组) 去重（state.ts:206-211），熔断与能力跳过没有
   （index.ts:255-265）。这些 notice 是 durable user 消息且 llm 层无 notice 过滤
   （DSH 自己的 model-changed notice 即 model-visible），工具循环/连续失败下每步重复进模型
   上下文。项目自己的真网关记录也观察到"每轮重试都落"。
   修法：把 `shouldNoteConditionSkip` 的键从"条件跳过组"泛化为"跳过通知组"
   （熔断候选 + 能力跳过候选共用同一 (turn, key) 去重），一次链上行走一类原因只报一次。
7. **故障转移账本两处归属不精确。**
   真：lineage.ts:104-123 的判据只有"变更前有没有失败"，失败状态跨 turn 不清 →
   **用户手动换模型**会被记成插件 failover（任何 header 差异都是 reason:'change'，
   agent.ts:643-648）；lineage.ts:130-136 的 settled 不校验 turn/step，后面轮次的成功会把
   陈旧条目标成已兑现。
   修法：入账要求失败与变更同 (turn, step)（Router 的切换必然发生在同一步内）；
   `turn/start` 时清空 lastFailure 与未 settled 条目。turn/step 投影已在跟踪（state.ts 同级）。
8. **热路径每步把全部客户端投影过一遍 zod。**
   真：index.ts:451-456 每步 `snapshot(session)`，registry 对每个带 wire 的单元执行
   `viewSchema.parse(view(state))`（session-projection/src/index.ts:711）——把本插件自己的
   24 点时间线与账本整份反复解析。
   修法：改用原生 keys 过滤 `snapshot(session, ['contextPressure'])`（session-projection
   src/index.ts:339-353 现成 API，llm-retry 同款用法是 `stateOf`）。
9. **两处未用 DSH 原生能力。**
   真：① Ctrl+S 自建 window 监听（page.ts:100-111）而 DSH 有 shortcuts 客户端服务
   （packages/client/shortcuts/src/client/types.ts:83 `Shortcuts`）——自建版不可重绑定、
   不出现在快捷键页、插件弹窗打开时仍会触发保存；② 全局覆写宿主 `footerActions` 容器
   （styles.ts:16-36）会波及同席位其他注册者（ui-cordis 就在用该 slot，
   extensions/ui-cordis/src/client/index.ts:86-87）。
   修法：① 改用 shortcuts 服务注册命令（作用域限定在插件模态打开时，与 useModalLayer 的
   层栈状态联动）；② 删掉全局容器覆写，只样式化自己的按钮（ownerProps 只有 `wide`，
   单条目时该覆写本无必要）。
10. **文档漂移。** 真：product-plan.md:171/194、ui-design.md:159 仍写"全局健康度/熔断/权重
    不做"（实际已发）；architecture.md 非目标与阶段 5 自相矛盾；README:138-139 称逐渠道探测
    编辑器不存在（modals.ts:23/105 已实现且有端到端断言）。修法：按 docs/AGENTS.md「只记
    当下事实」更新三处，README 删掉该条 Known Limitation。
11. **重复实现（架构级）。** 真："配置里有哪些路由"实现 4 遍（index.ts:66-80、
    controller.ts:546-556 与 652-661、page.ts:15-29）；`provider/model` 键拼装/解析散落
    4+ 处（health.ts:61/70-73 + controller 581/623）；`label`/`routeLabel` 两份
    （notice.ts:43-45、state.ts:226-228）。修法：抽 `src/routes.ts`（routeKeyOf、
    configuredRoutes、routeLabel）供 host 与 client 两侧共用——client 已与 host 同仓构建，
    共用模块不需新增包。
12. **HMR/卸载与 fork/resume 无测试。** 真：DSH 包规则要求"注册贡献须证明可 Dispose"，
    open-questions §三.3/§三.5 自己列为待实测，目前唯一 dispose 调用（remote.mjs:280）无断言。
    修法：补两条测试——(a) `ctx.fiber.dispose()` 后 sessionProjections 不再含两个 key、
    slots 注销、定时器清零；(b) 从 checkpoint + 尾序重放重建的投影与在线值一致。

### 四、Minor（顺手修，不单独立项）

- 取消探测被记成渠道故障：probe.ts:105-113 判定顺序在 `signal.aborted` 之前，适配器对调用方
  cancel 抛 `ABORTED`（llm-deepseek/src/adapter.ts:64）→ 与三态口径（types.ts:32-34）相悖。
  修法：abort/ABORTED 判定提前到通用 code 之前。
- 中止后的部分报告覆盖 lastProbeReport（index.ts:352-354）：取消时不要把残篇当最新报告。
- 文案与实现错位：discover 是浏览器侧定时器却没写"仅界面开启时运行"，宿主侧 probe 反而写了
  （locales.ts:191 vs 195）——两段提示按实际归属互换补全。
- 6 个不存在的 design token（styles.ts:1385-1392，DSH 全量 CSS 0 命中）→ 浅色主题浅底浅字；
  改用真实同族 `--dsw-alias-state-{success,error}-*`。属 10-15 已修一批后的回归，修完加源级守卫。
- 候选卡片信号灯只看 passive、绕过 routeStatus 单源（health-ui.ts:84-85、pipeline.ts:37-42）：
  传 discover/probe 并统一走 routeStatus。
- 字典重复键 clickToJumpHealth（locales.ts:248/293、535/580）+ 历史错误码缺字典时显示键名
  （仅 6 个 code* 键）：去重、补齐 AUTH/ABORTED/QUOTA/NO_ADAPTER，缺键回落原始码。
- 候选可重复添加（host 与 client 均不校验重复渠道）：assertStructural + validate 同步拒绝。
- `armDiscoverTimer` 读未保存草稿（controller.ts:103/112-118）：改读 host 值，保存成功后重武装
  （与宿主定时器语义一致）。
- `timeoutMs` 变量实际持有秒（index.ts:336）改名；SettingsForm 底栏 `:has()` 脆（属真实边界，
  保留但在注释里写明上游契约）；日志按自订规范补 `%o`。

## Alternatives considered

1. **时间线合并：按 time 去重 + 截断（选） vs 按 (route, sessionId) 覆盖式合并**
   覆盖式最强理由：语义最干净——每个会话一份、新的盖旧的，绝不会重复。
   否决理由：会话会过期（20 会话窗口外），覆盖会让"窗口外会话最后看到的点"消失，可用率变成
   只剩最近 20 个会话的事实；而去重+截断保留全部真实观测点、只消灭重复，且与 host 侧
   `pushTimelinePoint` 的截断语义一致（同一套窗口规则，不立第二标准）。
2. **弹窗 SettingsForm：isModalView 不渲染（选） vs 给 unmount-discard 加"唯一挂载面"判断**
   后者最强理由：保住 SettingsForm 的不可用/只读框架，两份视图行为完全一致。
   否决理由：判断"是否唯一挂载面"需要控制器知道挂载计数，是把 DSH 的卸载契约绕开的第二套
   机制；而弹窗顶栏本就有保存/放弃/失败徽标（footer.ts:40-76），SettingsForm 在该视图只剩
   "卸载即 discard"这一副作用，不渲染比供养它简单。
3. **always 策略：加载即抛（选） vs 运行时降级为 normal vs 只在文档声明**
   运行时降级最强理由：不因为一个渠道的配置让整个插件加载失败，用户还能用其他渠道。
   否决理由：决策已记录为"加载时拒绝，不在运行时 veto"（open-questions 一.3、
   dsh-capability-boundary.md:93）；运行时降级会静默改变用户依赖的重试行为，正是本项目
   "不留能开但没反应的开关/不静默改语义"要避免的。
4. **熔断关闭态：enabled 与 rules 同址读取（选） vs 关闭时清空 rules**
   清空最强理由：存进配置的状态永远为真，host 不必判断。
   否决理由：清空会销毁用户配置（再开开关要重填），且让"关闭"这个动作有数据损失；
   同址读取让 host 只认一个事实源（health.breaker 整体），config.ts 的空规则校验改无条件后
   "空白规则"这个危险形态也被根治。
5. **sticky 时序：pre-step 回落上一轮 stickyRemaining（选） vs 把 resolveChain 提前到 pre-step**
   提前解析最强理由：单一入口，链的解析只发生一次。
   否决理由：resolveChain 需要 `resolved`（selection 写回之后的最终 route），pre-step 时点
   拿不到；而 TurnNote 已持有 stickyRemaining，回落它就是复用既有状态、零新增真相源。
6. **Ctrl+S：改用 shortcuts 服务（选） vs 保留 window 监听但加"弹窗打开时禁用"**
   后者最强理由：改动最小，不引入新依赖的注入面。
   否决理由：自建监听不可重绑定、不出现在快捷键设置页，用户改不了；原生服务已存在
   （packages/client/shortcuts），且 ui-settings-general 就是先例。

## Consequences

- 收益：两个 Critical 消除（failover 不再可能被静默关掉、用户输入的尝试次数不再被吞）；
  可用率/点数恢复为真实口径；未保存草稿不再被弹窗关闭吞掉；识图粘滞在会话首图即生效；
  定时探测不再叠跑与泄漏；两处 DSH 原生能力回归原生（快捷键可重绑定、footer 样式不再越界）；
  热路径少一次全量 zod 解析；文档与代码一致。
- 代价：① 空规则无条件校验会让"曾经存下空白规则"的配置在下次保存时报错（需用户在 UI 删掉该
  规则）——比静默禁用所有候选好，但确实多一次交互；② 弹窗里 SettingsForm 的卸载回调换成
  no-op，"关弹窗即放弃"的隐式行为没了，放弃只能走顶栏按钮（这正是想要的）；③ `src/timeline.ts`
  成为 host/client 共用模块，改窗口规则要同时看两边；④ always 加载即抛会让"某个渠道配了
  always"的用户在保存配置时直接被拒，需要先改渠道设置——这是既定决策的代价，不是新增代价。

## 验收（已实跑，2026-10-16）

- 单测 86/86（新增：sticky 首图时序、lineage 同 turn/step 入账、跨轮 settled、用户切换不算
  failover、恢复后不武装、通知去重一门三用、空规则无条件校验、同链重复渠道拒绝）。
- 组合 16/16（新增：`breaker-disabled-still-fails-over`、`always-retry-policy-rejected`；
  渠道块通知计数钉为 1）。
- client-controller 28/28（新增：同记录重读时间线不变、手录 maxAttempts 保留、弹窗开关不丢
  草稿、快捷键命令注册与作用域门）。
- remote 9/9（新增：卸载后定时探测停止——DSH 包规则"注册贡献须证明可 Dispose"的宿主侧断言）。
- `tsc --noEmit` 0 错误；`npm run bundle` 通过；DSH checkout 0 改动。

## 预算位置（原「待裁决」，已由实验裁决并落地）

**问题**：`maxTotalAttempts` 号称"硬上限"，实测配 2 打 7 次。根因：同路由重试归 DSH 的
`llm-retry`，插件的失败监听注册在它**内层**，llm-retry 自己的 5 次重试发生在插件看不见的
地方，插件只在它放弃后才被问到。

**实验**（2026-10-16，`tests/run.mjs` 的 `budget-cap-when-the-whole-chain-dies`）：
两候选各 1 枪、总上限 2、两条都一直 429。内层注册实测 **7 次**真实调用；改成最外层后
**2 次**，正好等于上限。

**裁决**：`agent/request-error` 改用 `prepend: true` 注册在 root ctx（一次，agent 从
payload 取——按 agent/created 逐个注册会每个 agent 漏一条 root listener）。监听先
`await next()` 让内层（llm-retry / compaction）各自决定，再处置：
- 内层返回 `retry` 且预算已尽 → 返回 `undefined`（终态），否决该重试；
- 内层返回 `retry` 且预算还有 → 原样放行（与内层注册时行为一致）；
- 内层返回 `undefined`（全部放弃）→ 才由插件做跨候选 failover。

**为何外层拿得到放弃信号**（边界文档 §G2 旧结论"外层永远等不到放弃信号"不成立）：
waterfall 里 `await next()` 的解析值就是内层结果；llm-retry 放弃时 `return next()` 一路到
默认 thunk 返回 `undefined`，外层因此看到 `undefined`。旧结论错在把"next() 只往里走"当成
"信号到不了外层"。

**为何不担心误伤 compaction 的恢复**：预算未耗尽时原样放行，只有预算已尽才否决，而预算已尽
时请求本就该终态。`CONTEXT_WINDOW_EXCEEDED` 不在 llm-retry 默认可重试集、也不在 switchOn
六码里，压缩恢复走"内层 retry"路径，未超预算时照常放行。

**代价**：预算耗尽时会连 compaction 的恢复一起否决（见上，可接受）；llm-retry 可能已写下
`llm/retry` 排程记录而被否决，durable 日志会留一条未兑现的重试排程——如实反映"排过，但
回合已结束"。

## 仍未处理（下批）

1. 渲染层其余结论（断点、间距、魔法数）未经浏览器量测，本轮未动。

## 浏览器实测（2026-10-16，隔离 `.dshhome-view` + 端口 3391 + Chrome MCP）

真 boot 下抓到并修掉两个**只有浏览器才会暴露**的缺陷，两者都曾让整个插件 web boot
激活失败（`web boot: 1 entry did not activate`，UI 显示 "Failed to load plugins"）：

1. **`routes is not defined`**：`src/routes.ts` 重构时 `checkAll` 的内层回调还在用已删除的
   `routes[key]`。客户端控制器测试没覆盖 `checkAll`（discover stub 全返回 `ok:false`，map
   体不执行），所以测试全绿而浏览器一跑就崩。修为按 `provider/model` 拆键，并补
   `checkAll walks every configured route` 回归。
2. **`Unsupported Web shortcut: model-router.save`**：快捷键默认绑定写了 Web 下的裸
   `primary+S`，而 DSH 的 `isWebBindingAllowed`（client/shortcuts/src/binding.ts:96-111）
   **不放行**——Windows/macOS 的 Web 只放行两键含 primary+alt/shift，Linux 的 Web 只认
   Slash / Comma+shift / Period+shift 三组（浏览器自己占用 Ctrl+S）。修为桌面裸
   primary+S、Web 统一 Comma+primary+shift（DSH 自己的 settings.open 在 Web 也是两键形态）。
   顺带：UI 上的 "Ctrl+S" 提示改成不写死组合（真实键位以 DSH 快捷键设置页为准）。

另确认两件事：① `ctx.inject` 的 child inject 是**显式清单、不从父继承**，`shortcuts` 必须
列在 child 里（漏列即在激活时抛 `cannot get required service shortcuts in inactive
context`）；② `dsh.client.inject` 按 DSH 源码只是加载/预取元数据、**从不决定 apply 顺序**
（ui-workspace 的 apply 注释明说），顺序靠 fiber inject 表达。

**侧栏 footer 覆写收窄已实测**：删掉全局 `div[class*="footerActions"]` 覆写（宿主容器保持
DSH 自己的 `flex row`，不再波及其他同 slot 注册者），满宽对齐改到自己按钮的
`.wide:only-child` 规则上；实测按钮 260×42、`margin:4px -2px` 与 DSH 自己的设置行对齐，
视觉与改前一致。

## 投影 fork/resume 一致性（open-questions §三.3，2026-10-16 实测关闭）

DSH 的 resume/fork 靠「checkpoint + 尾序重放」重建投影状态，所以插件侧有两条硬契约：
**apply 是纯函数**（不改入参）与 **state 是 plain JSON 且过得了自己的 stateSchema**
（持久缓存与冷读都要 parse 它）。`tests/run.mjs` 的 `assertFoldIsForkSafe` 用每个场景真
boot 产生的 durable 日志验四件事：一次 fold 与「分三段 fold + 每段边界 JSON 往返」
（= checkpoint 的 detached clone）的**持久形态**一致、wire view 一致、持久形态过单元
自己的 `stateSchema`、以及 apply 从不就地修改入参。

比较落在持久形态上而非原对象：JSON 往返会丢掉值为 `undefined` 的键、后续 apply 再把它
加到末尾，改的是插入顺序不是值——冷读时两者语义一致（都读成 `undefined`，schema 也是
`.optional()`）。第一版断言用 `JSON.stringify` 全量比较，被这个键顺序差异误报，是断言写错
不是产品缺陷。

**red-check**：把 lineage 的 `apply` 改成就地写 `state.lastRoute`，纯度断言立刻报红 7 处、
恢复后全绿——证明这道断言不是空转的。
