---
title: "DSH Model Router — 产品形态与配置面"
status: "proposal"
kind: "product-plan"
last_updated: "2026-10-12"
---

# DSH Model Router — 产品形态与配置面

## 摘要

本页定义这个插件**从用户角度是什么、能配什么、看得到什么、做不了什么**。技术事实与能力边界见[DSH 能力边界](dsh-capability-boundary.md)，本页不重复；本页是产品形态的唯一权威说明。

产品模式取**选项 A（透明物理故障转移）**：用户照旧在官方选择器里选一个真实模型，插件按配置在该模型失败时切换到有序的真实候选。逻辑模型进入官方选择器（选项 B）不做——它需要改 DSH 核心的 catalog / selection / projection，而选项 A 已被实测证明纯插件可交付。

**范围只限 Agent 主请求**：压缩上下文与会话标题由 DSH 各自的插件配置管，本插件不碰（见第九节）。四个产品决定已定，见第八节。

## 一、用户视角：这是什么

一句话：**「我选这个模型，它不行就按我定的顺序换，而且告诉我发生了什么。」**

三个动作：

1. **选模型**——完全照旧，用 DSH 官方选择器，选的是真实 provider/model。
2. **配备份链**——在 Plugins 页给"选了这个模型"配一条有序候选列表。
3. **看结果**——请求实际走了哪条渠道、失败了几次、为什么换，在 Trajectory 视图和会话里能看到。

不装这个插件，行为与现在完全一致。装了但没给某个模型配规则，那个模型的行为也完全一致——**只接管配了的**。

## 二、用户能配什么

### 2.1 备份链（核心）

```yaml
- when: { provider: deepseek-official, model: deepseek-v4-flash }
  candidates:
    - { provider: deepseek-official, model: deepseek-v4-flash, maxRetries: 1 }
    - { provider: pi-ai-gpt,        model: gpt-5,           maxRetries: 0 }
    - { provider: pi-ai-claude,     model: claude-sonnet-5, maxRetries: 0 }
```

- 第一个候选**必须**就是用户自己选的那个（`candidates[0]` 钉死为 `when` 模型，不可删、不可换序、不适用条件）——让它先试，符合直觉；跳过它就是无失败也静默改路。
- 顺序即优先级，行内上移/下移调整（DSH 设置表单无拖拽先例）。
- 每个候选可单独设「失败后重试几次再往下走」（`maxRetries`，0 = 首发失败即切）。

### 2.2 什么情况算失败（`switchOn`）

哪些失败码触发切换到下一个候选。**默认全部切换**：

- 八个具名码：`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`、`INVALID_REQUEST`、`AUTH`、`QUOTA`；界面给中文别名（空回复 / 限流 / 服务端错误 / 超时 / 网络传输 / 请求被拒绝 / 凭证被拒 / 额度用尽），用户不需要懂 `LlmFailure.code`。
- `other`：上表之外的一切码（`PI_AI_ERROR`、网关自造的 `HTTP_xxx`、DSH 以后新增的码）。枚举不可能覆盖全部失败，未知不等于不该动。

取消某一格的含义是"这个码交给 DSH 收尾"——插件既不重试也不切换它。

**明确不切换的**：取消（`ABORTED`）、无适配器（`NO_ADAPTER`）。取消是用户主动中断；`NO_ADAPTER` 对候选在调用前就被预校验拦掉（`resolveCallConfig` 抛错即跳过），对用户自己的路由意味着链上无人能服务，切换没有对象。

**永远先问内层**：表外的码，以及 `CONTEXT_WINDOW_EXCEEDED` / `IMAGE_OFFLOAD_REQUIRED`（由 DSH 自己的 `compaction-basic` / `compaction-image-offload` 拥有）。压缩历史或卸载图片才是这两类失败的正确修法；内层放弃之后才轮到插件换候选。

`INVALID_REQUEST` 的归属值得单独记一笔：pi-ai 适配器按错误文案归一（`llm-pi-ai/src/stream.ts:34-49`），上游网关的 402「端点不可用」会命中 `invalid_request_error` 而被归成这个码——它看着像请求形状错误，实际是临时故障，所以默认必须切。依据与代价见[决策笔记](../../.agents/notes/implemented/2026-10-22-failover-by-default-and-max-token-continue.md)。

### 2.3 重试次数与退避

```yaml
  firstHopMaxRetries: 5   # 默认值；每条候选各自 0..99，填多少就真的执行多少次
  candidates:
    - { provider: pi-ai-gpt, model: gpt-5, maxRetries: 2 }
```

- 字段是**失败后重试几次**（`0..99`），首发不计入；0 = 首发失败即切下一条。每条候选各自独立，没有整请求总上限——一个 step 的花费上界就是各候选 `maxRetries + 1` 之和。
- **默认 5，与 DSH 自己的 provider 策略一致**（`llm/llm/src/retry-policy.ts` 的 `DEFAULT_MAX_RETRIES = 5`）。插件接管重试后默认值不能比它小，否则升级会让韧性变差。开箱行为因此是：首发失败 → 同渠道退避重试（最多 5 次）→ 仍失败才换下一条候选，下一条同样先用自己的重试预算。
- 重试由 DSH 的 `llm-retry` 执行，插件只数次数并在额度用尽时切走；因此实际次数还受该 provider 的 `retryPolicy.maxRetries` 限制，填得比它大也没人执行。设置入口在 Models 页，插件不复制这个配置。
- 未勾选 `switchOn` 的失败码不归插件切：插件不介入，由 DSH 按自己的策略重试并收尾。
- **输出被截断（`max-tokens`）不是错误**，走不到 `agent/request-error`：DSH 直接结束本轮并提示用户自己发"继续"。它由链上的 `maxTokens` 管辖——`autoContinue`（默认开）先在同一候选上自动续 `continues` 次（默认 2），续满仍截断就换下一条候选接着写；链上没有下一条时交给 DSH 的截断结束。
- 退避**不可配置、UI 只读**：同渠道重试之间的退避归 `llm-retry`（500ms 起步、10s 封顶、0.1 jitter），插件不另设一套；跨候选切换是立即的，不插入退避。

### 2.4 条件路由（images 三态 + 上下文门槛 + 推理档位自动维度）

候选可以带条件，只有条件满足才轮到它。`images` 是**三态**：`true` = 仅带图轮，`false` = 仅无图轮，不填 = 不限——一对互斥条件就是把一条链拆成「识图路 / 文本路」的表达方式：

```yaml
    - { provider: deepseek-official, model: deepseek-v4-flash, maxRetries: 1, needs: { images: false } }
    - { provider: pi-ai-gpt,        model: gpt-5,           maxRetries: 0, needs: { images: true } }
    - { provider: pi-ai-claude,     model: claude-sonnet-5, maxRetries: 0, needs: { minContextTokens: 120000 } }
```

| 维度 | 判断依据 | 精确度 |
|---|---|---|
| `images: true` | 本**轮** admitted 用户消息里的 `ImageBlock`，按 turn 累积（见下） | **精确**（附件引用在不在内容块里） |
| `images: false` | 同上取数的否定 | **精确** |
| `minContextTokens` | `tokenMeter` 的 `contextPressure` 投影，`projectedTokens` 即"下一个请求会花多少" | **估算**，token-meter 自述系统性低估 CJK，不能当精确阈值 |
| 推理档位（自动，不占条件位） | 请求 config 的 `reasoningEffort` 对比候选 `resolveModel()` 的 `reasoning.efforts` | **精确**；不支持时 Router 经 `resolveCallConfig` 预校验自动跳过该候选 |

**条件对 primary 同样生效**（含 `candidates[0]` 与兜底池的隐式第一跳）：显式条件是用户意图，跳过它才是无视配置；跳过留 notice，不静默。primary 仍然豁免的只有自动机制——熔断冷却与能力预校验，那些 DSH 在选择时已校验过。此裁定修订了[未决事项](open-questions.md)二.5。

**`hasImages` 按 turn 累积，取数 = 本步 claimed 用户消息 ∪ 本轮 `tool/result` 事件里嵌套的图片块**。两个来源都不可省：`agent/pre-step` 的 messages 只是本步新 claimed 的输入，工具循环的第二步之后基本为空（不带累积，带图 turn 的第二步会滑回文本模型，而图片还在请求历史里）；`read_image` 的图从工具结果进来，下一步的请求才含它。`projectedTokens` 仍按 step。

**`stickyTurns`（profile/default 各有，默认 0）**：带图轮之后继续按「有图」路由的无图轮数。追问刚发过的图片（不带新图）时设 2~3，识图模型多粘几轮；0 = 无图轮立即切回。真带图的轮次补满窗口，被粘滞的轮次消耗一格。

**识图路由的完整形态依赖 DSH 侧一次配置**：给文本模型在模型设置里勾选 `input:[text,image]`。发送准入门只查这份声明、不查真实能力（`api/session-controller/src/commands.ts:336-348`），勾选后带图消息永远过门禁；路由器用上面的互斥条件保证 API 永远收不到它处理不了的图。路由器没接管时（关闭/配错/候选全挂）撞 API 报错是响亮的失败。完整理由与代价见[决策笔记](../../.agents/notes/implemented/2026-10-14-image-route-conditions-and-admission-gate-boundary.md)。

**工具能力不做前置条件**：DSH 没有任何机器可读的"模型支持 function calling"元数据（`LlmModelInfo` 唯一能力字段是 `inputModalities`）。工具不兼容在运行时由 provider 拒绝、规范化为 `INVALID_REQUEST`（deepseek）或 `PI_AI_ERROR`（pi-ai），进入 `agent/request-error` 由 Router 按 `switchOn` 承接；`INVALID_REQUEST` 是 switchOn 可选项（默认不勾）。理由见[决策笔记](../../.agents/notes/implemented/2026-10-12-drop-tools-eligibility-condition.md)；推理档位自动跳过的理由见[决策笔记](../../.agents/notes/implemented/2026-10-12-router-prevalidates-reasoning-effort.md)。

取数时机：`agent/pre-step` 给本步用户消息，`system-prompt/assemble` 给本步工具列表，两者都跑在 route 决策**之前**；且**重试不会重跑这两个钩子**，所以条件在一步之内的多次 attempt 之间稳定——语义上正好，「这一步的请求长什么样」是确定的。

能力的最终权威是 adapter 的 `resolveModel()` 与 `imageRequestPricing()`，插件不自己推断兼容性。

### 2.5 范围

一条全局降级链，对所有模型生效（`enabled` 开着时）：

- **第一跳是用户当前选中的模型**，重试次数由 `chain.firstHopMaxRetries` 配置（默认 0），不在候选列表里；
- 失败后从 `chain.candidates` 里按起点策略开始（`order` 按顺序 / `weight` 按权重抽 / `round-robin` 轮询）；第一跳永远先试、不参与抽签；
- `chain.candidates` 为空 = 没有降级可走，插件整个不进入请求路径（不接管）。

## 三、配置示例（canonical schema，已定稿）

```yaml
enabled: false                # 接管总闸：关掉后所有模型绕过插件（默认关）
chain:                        # 唯一的降级链
  candidates:                 # 降级候选；第一跳是你当前选中的模型，不在这里配置
    - { provider: pi-ai-gpt,        model: gpt-5,           maxRetries: 0, needs: { images: true } }
    - { provider: pi-ai-claude,     model: claude-sonnet-5, maxRetries: 0, needs: { minContextTokens: 120000 } }
    - { provider: deepseek-official, model: deepseek-chat,  maxRetries: 0 }
  switchOn: [RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE]
  firstHopMaxRetries: 0       # 第一跳失败后重试几次；由 DSH 原生重试在该额度内执行
  stickyTurns: 0              # 带图轮之后粘几个无图轮；0 = 无图轮立即切回
  strategy: order             # 降级起点策略：第一跳永远先试；它失败后按 order / weight / round-robin 从降级候选开始

health:
  timelineBucketSeconds: 600  # 健康时间轴一格代表多少秒；格数固定 24，窗口 = 24 × 它
```

配置走 DSH 的 `Config` + `Volatile<T>`，改完即时生效，不用重启。校验分级见第九节。

旧配置（`profiles` 按模型分规则 + `default` 兜底池）加载时迁成这一条链：规则被钉死的
`candidates[0]`（= 用户选中的模型）成为隐式第一跳，其余成为降级候选；多条规则只认第一
条，忽略的条数由宿主日志报出。迁移规则见 `src/chain.ts` 的 `effectiveChain`。

## 四、用户能看到什么

### 4.1 尝试链：DSH 已经画了，不用插件做

Trajectory 视图本来就把 `assistant/attempt`、`llm/retry`、`request/header` 渲染成节点，带 `providerMetadata: { provider, model }` 和"上次尝试错误"字段。每次 failover 都会产生一条新的 `request/header`（reason `change`），所以**哪条渠道、什么错、最后哪条成功，开箱即见**。

缺的只有一样：**「这几次尝试是同一个请求的备份链，按什么顺序」**——候选序号是插件的私有状态，durable log 里没有这个关联。

### 4.2 补上"为什么换"：一条通知

插件在该步骤失败转移时，往会话追加一条 `user/message`，带 `form: 'notice'`：

> 主模型 deepseek-official/deepseek-v4-flash 限流，已切换到 pi-ai-gpt/gpt-5（候选 2/3）

**已实测可行**（见能力边界 7.7）：外置插件用自定义 `kind`（如 `model-router`）+ `form: 'notice'` append 的消息完整落进 durable log，运行未被破坏。客户端读 `form` 不读 `kind`，未知 kind 有既定 fallback，故渲染成折叠行；文案可控、可中文。摘要经 `boundContextSummary()` 限 120 字符。浏览器实际样式未过，上线前建议过一次。

### 4.3 一条去不掉的英文通知

DSH 在自己的 `agent/pre-step` listener 里比较 `selection.assembled` 与 `session.requestHeader()?.config`，不同就追加一条英文 notice（"assistant turns above this point were generated by X; the session continues with Y"）。failover 后 last header 必然是候选渠道，所以**每次 failover 必然触发一条，删不掉**：改 live 选择的接口在 private 字段后面，抢在它之前删又违反 DSH「listener order is not enforcement」的规矩。

所以一次 failover 用户会看到两行：一条英文说"模型变了"（事实），一条中文说"因为限流所以换了"（原因）。信息互补，接受。

### 4.4 更丰富的视图（第二版，可选）

若后续用户要求"展开看完整尝试链含耗时和候选序号"，插件可注册自己的 `ConversationNodeDefinition` + keyed renderer。代价是要额外发布一个客户端半包并自复现其构建格式，属另一摊工作，默认不做。

## 五、已知限制（纯插件路线下做不了）

| 限制 | 原因 |
|---|---|
| 逻辑模型进入官方选择器 | 需要 DSH 核心的 catalog、selection validation、Session projection 同时认识非物理条目 |
| 去掉那条英文通知 | 见 4.3。不影响主要功能，接受 |
| 候选游标跨重启延续（默认关） | 可经 `ctx.storageDomain` 的 JSON KV 持久化，但它不在 Session log 里，fork/resume/replay 不携带；多实例并发要自己处理。做成开关，默认关 |
| 路由压缩上下文 / 会话标题 | **不做**，DSH 已自带且更完整，见第九节 |
| `minContextTokens` 当精确阈值 | token-meter 是估算且自述低估 CJK |
| 工具能力前置判断 | DSH 无机器可读的工具能力元数据；不兼容在运行时以 `INVALID_REQUEST`/`PI_AI_ERROR` 出现，分类依赖 provider，靠 switchOn 承接（默认不勾） |
| 渠道健康度 / 延迟 / 成功率 / 冷却倒计时 | 无数据来源且不做全局健康度；故障转移历史经只读投影展示，见 [ui-design](ui-design.md) |

以上全部写进包 README 的 `## Known Limitations and Deferred Work`（DSH 包规范要求），不留"配了不生效"的开关。

## 六、技术方案要点

细节与证据见[DSH 能力边界](dsh-capability-boundary.md)，此处只列结论：

- **选路**：`agent/request` waterfall，`prepend: true` 注册以位于 `installModelSelection` 外层。已实测：外层返回的 provider/model 成为最终 route，durable `request/header` 与 `assistant/message` 都记真实 route。
- **恢复**：`agent/request-error`，在 root ctx 用 `prepend: true` 注册，因此位于 `llm-retry` 外层：`await next()` 拿到它的决定再处置（放行 / 换候选 / 终态）。候选额度用尽且该切换时，插件在 `await next()` 之前直接决定，llm-retry 的退避与 durable 记录都不会发生。见[能力边界](dsh-capability-boundary.md)。
- **候选索引**：进程内 `WeakMap<Agent, …>`，按 (agent, turn, step) 键控。**必须自持**——已实测 `agent/request` 在重试时再次触发且解析回用户选择，无法从 waterfall 推断当前候选。
- **两层 attempt 边界**：同 route 重试归 `llm-retry`（不复制退避、不复制 durable 记录）；跨候选 failover 归 Router。每条候选的次数由配置决定，没有整请求上限：一个 step 的花费上界 = Σ(`maxRetries + 1`)。声明 `always` policy 的候选 provider 在配置加载时拒绝（无上限重试会让没勾切换的码永不收尾）。
- **条件路由取数**：`agent/pre-step` 取本步用户消息，`system-prompt/assemble` 取本步工具，`ctx.sessionProjections.stateOf(session, 'contextPressure')` 取上下文占用；与候选索引放进同一个 per-(agent, turn, step) 状态桶。
- **durable lineage**：插件自有 `ctx.sessionProjections.register()` 折叠 `request/header` + `assistant/attempt` + `assistant/message`，零新增事件类型、零 plugin record。
- **包形态**：函数插件，命名导出 `name`/`inject`/`Config`/`apply`；可选服务用 `ctx.get()`；产品可见插件必须有真实 Loader 组合测试。

## 七、分期

| 期 | 内容 | 准入 |
|---|---|---|
| **Phase 1** | 有序备份链 + `switchOn` + 每候选重试次数 + 退避；只接管配了的模型；一条中文通知说明为什么换 | 产品边界已定（已定，见第八节） |
| **Phase 2** | 条件路由（图片 / 工具 / 上下文）；durable lineage 投影；诊断日志 | Phase 1 真实组合测试绿 |
| **Phase 3** | 候选游标跨重启（显式开启，经 KV 存储） | 有真实用户需求触发 |
| **不做** | 逻辑模型进选择器；路由压缩/标题（DSH 已自带）；按延迟/价格自动调度 | 需改核心、重复既有能力或另一子系统（全局健康度、熔断、权重/轮询已在插件内实现） |

## 八、已定的产品决定

| # | 决定 | 结论 |
|---|---|---|
| 1 | 条件路由进哪个 Phase | **Phase 2**。Phase 1 先交付最小可用的有序链，条件路由要多听两个 waterfall |
| 2 | 第一版就要中文通知 | **要**。成本低，见 4.2 |
| 3 | ~~`default.enabled` 默认~~ | **已作废**（2026-10-19）：单链下没有"未配置的模型"这一说，见第 9 条 |
| 4 | 辅助调用选路 | **不做**。DSH 已自带且更完整，见第十一节 |
| 5 | `enabled`（接管总闸）默认 | **关**。接管会改请求实际打到的渠道（资金/限流后果），默认值必须是用户的显式选择；开关在链路页头一行设置里 |
| 6 | ~~开启接管时自动改新会话默认模型~~ | **已作废**（2026-10-19）：没有主模型就没有要同步的目标；插件因此完全不写 DSH 的全局配置 |
| 7 | ~~主模型怎么定~~ | **已作废**（2026-10-19），见第 9 条 |
| 8 | 健康时间轴口径 | **固定 24 格 × 可配时长桶**（默认 10 分钟）。一格是一段时间，柱高是该桶成功率，空桶是无数据；观测点按时间戳保留 24 小时，改桶长不丢历史 |
| 9 | 产品结构 | **一条全局降级链**。第一跳永远是用户当前选中的模型（重试次数由 `firstHopMaxRetries` 配置，不在候选列表里），失败后按起点策略从降级候选开始（第一跳永远先试、不参与抽签）；不按模型分规则、不分主次。旧配置加载时迁移（`src/chain.ts`） |
| 10 | 空链 | **是一种配置**：`chain` 键存在就赢，哪怕没有降级候选；此时插件整个不接管，UI 用空状态说明 |
| 11 | 重试次数的单位 | 用户配置的是**失败后重试几次**（`maxRetries` / `firstHopMaxRetries`，0..99，不含首发；0 = 首发失败即切）。不设整请求总上限：一个 step 的花费上界 = Σ(`maxRetries + 1`)。旧配置的“调用次数”按 `-1` 迁移 |

## 九、Schema 与界面设计的三个硬约束

1. **备份链顺序必须用 array，不能用 dict**——顺序是本插件的核心语义，dict 无序。
2. **跨字段校验走 `validateConfig()`**（DSH 插件范式：zod schema 管字段级 + `apply()` 里 `validateConfig()` 管跨字段、加载即抛，见 `llm-retry/src/index.ts:30,123-124`；Cordis `fiber.update()` 先校验再重启，`vendor/cordis/src/fiber.ts:731-751`，保存时即被拒）。分级：结构错误（同一条链重复配置同一渠道、权重策略没有正权重）硬失败；provider 未注册（环境漂移，如用户事后卸载 provider）降级为该候选运行时跳过 + `ctx.logger.warn`——硬失败会得到"卸载一个 provider、整个路由器莫名全死"的脆弱性。客户端可用 `modelCatalog().routableProviders` 对 provider 做实时提示；model ID 不校验（catalog 成员是 advisory，核心路由接受未列出 ID）。
3. **`.description()` 不会显示在任何 UI 上**——DSH 无 Config→表单生成器，见第十节。

## 十、配置界面设计

**DSH 完全支持插件带 UI**——slot 系统、`SettingsForm`/`SettingsValueField` 原语、locale 字典、form model、schema 自查询一应俱全，写 UI 就是 DSH 插件的常规形态，不是额外负担。2026-10-12 已用真实安装 + 浏览器渲染验证：Plugins 页 → 已安装 → 插件详情，中文配置表单完整出现（字段清单见 10.2，九个打包/渲染坑见[能力边界](dsh-capability-boundary.md) 7.9）。

**但没有"声明 Config 就自动出表单"这回事。** 每个插件自己写表单 JSX。最像"生成"的 Models 页也是手写编辑器 + 读 schema：`ProviderEditor` 按 `layoutOf(ns)` 在 `deepseek`/`pi-ai` 等**手写布局**间选择，用 `schema.nodeAtPath/getPath/setPath` 取选项、默认值与校验（[`ProviderEditor.tsx:184-196`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-models/src/client/ProviderEditor.tsx#L184)），字段组件是 `CustomProviderCard`/`ModelListEditor`/`ModelRow` 等手写组件。注释明说 schema 是"让这里和新建卡片给的选项不会漂移"的**共同事实源**，UI 仍是手写。

因此 `.description()` 写的中文标签不会出现在任何地方——`packages/client` 全树没有代码读 schema 的 `meta.description`，DSH 自己的 src 也一处都没用 `.description()`。标签取自插件**自己的** locale 字典。

### 10.1 客户端半包的形态

一个包两个半侧，都是 Cordis 插件：

| 半侧 | 形态 |
|---|---|
| Host | `src/` 下 `apply(ctx)`，挂 listener、projection |
| Browser | `src/client.js`，`window.__ModuleLoader__.load({id, factory})`；自己也是 `name`/`inject`/`apply`，`apply` 里 `ctx.slots.inject('plugins.bundle.config', …)` 注册页面 |

范式：[`ui-settings-web-search/src/client/index.ts`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-web-search/src/client/index.ts)（注册）+ [`WebSearchCard.tsx`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-web-search/src/client/WebSearchCard.tsx)（`SettingsForm` + `SettingsValueField`）+ [`web-search-card-controller.ts`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-web-search/src/client/web-search-card-controller.ts)（`SettingsFormModel` 接 `ctx.configForms.get(ns)`）。

**factory 格式可手写，不必搭 tsdown**；JSX 用 `React.createElement` 避开 transform。打包/安装的五个坑见[能力边界](dsh-capability-boundary.md) 7.9。

### 10.2 Phase 1 的 UI 范围

配置页要有的东西（中文标签来自本插件字典）——**已实测渲染成功**，见[能力边界](dsh-capability-boundary.md) 7.9.1：

页面按 DSH 原生面板页排版（页面自己滚动，页头与页签吸顶、保存条吸底，四条行共享一条 960 列；契约见 [工作台布局重构](ui-layout-redesign.md)）：

| 区块 | 字段 |
|---|---|
| 接管总闸 | 「接管路由」开关，页面头右侧（默认关）。关闭时插件不进入请求路径 |
| 起点策略 | order / weight / round-robin 分段控件 + 当前策略说明；weight/round-robin 下第一跳可能不是起点（如实说明） |
| 第一跳 | 一行：「你当前选中的模型」+ 「失败后重试」步进器（`firstHopMaxRetries`，默认 0）+ 该额度内由 DSH 原生重试执行的说明 |
| 降级链 | 分区标题右侧 primary「添加候选渠道」；有序扁平行：provider / 模型 ID、健康 Tag、失败后重试、权重（weight 策略）、高级条件、上下移与删除 |
| 候选高级条件 | 图片三态（不限 / 仅带图 / 仅无图）+ 最小上下文门槛 |
| 切换条件 | 限流 / 服务端错误 / 超时 / 网络传输 / 空回复（复选框，默认对齐 DSH 自己的 normal policy）+ 请求被拒绝（默认不勾） |
| 尝试预算 | 整条请求最多调用次数 + 识图粘滞（0/1/2/3/5）+「最多 N 次真实调用」计算式 + DSH 原生重试的层次说明 |
| 渠道健康 | 时间轴 24 格 × 每格时长（1/5/10/30/60 分钟，默认 10 分钟）；柱高=该桶成功率，空槽=无数据 |

Chat 侧零自建成本：一条 `form:'notice'` 的中文通知 + 复用 DSH Trajectory 视图（已实测通知可发、Trajectory 本就渲染 attempt 链）。

**正式实现要修的两处保真度**（spike 探针的遗留）：布尔字段应改用 `settingsBooleanField` 渲染成开关/复选框而非文本输入；`candidates`/`switchOn` 必须注册进 `SettingsFormModel` 的 specs，否则改动后保存按钮不变 enabled。

## 十一、范围边界：只做 Agent 主请求

本插件只覆盖 **Agent 主请求**。压缩上下文与会话标题这两个内部模型调用**不由本插件路由**——DSH 已为它们各自提供模型固定配置，且比本插件能做的更完整：

| 内部调用 | DSH 自带配置 | 位置 |
|---|---|---|
| 压缩上下文 | `summarizationProvider` + `summarizationModel`；另有 `modelPolicies` 按会话模型分别指定总结模型 | [`compaction-basic/src/config.ts:31-32,81`](file:///D:/sudy/github/deepseek-harness/packages/compaction/compaction-basic/src/config.ts#L31) |
| 会话标题 | `provider` + `model`（必须成对）；不配则用会话当前 route | [`session-title-llm/src/index.ts:72-75,182-188`](file:///D:/sudy/github/deepseek-harness/packages/session/session-title-llm/src/index.ts#L72) |

用户想"标题用便宜模型"或"压缩用另一个模型"，配那两个插件自己的 config 即可。本插件再提供同一能力会形成两处真相源，违反 DSH "one home per fact" 原则，故明确不做。

另需说明：这两个调用走未 prepare 的 `ctx.llm.stream()`，`llm/stream` 虽能改其路由，但**没有** `agent/request-error` 可接，即只能选路、不能失败恢复。即使将来要做，也只能是"固定到某模型"，不能是"失败换下一个"——而那正是 DSH 已提供的部分。
