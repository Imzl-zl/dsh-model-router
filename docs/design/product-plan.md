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
    - { provider: deepseek-official, model: deepseek-v4-flash, maxAttempts: 2 }
    - { provider: pi-ai-gpt,        model: gpt-5,           maxAttempts: 1 }
    - { provider: pi-ai-claude,     model: claude-sonnet-5, maxAttempts: 1 }
```

- 第一个候选**必须**就是用户自己选的那个（`candidates[0]` 钉死为 `when` 模型，不可删、不可换序、不适用条件）——让它先试，符合直觉；跳过它就是无失败也静默改路。
- 顺序即优先级，行内上移/下移调整（DSH 设置表单无拖拽先例）。
- 每个候选可单独设「在这条渠道上试几次再往下走」。

### 2.2 什么情况算失败（`switchOn`）

哪些失败码触发切换到下一个候选。**默认值直接用 DSH 自己那套**（`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`），不自己发明集合。

暴露给用户时给中文别名：限流 / 服务端错误 / 超时 / 空回复 / 网络传输。用户不需要懂 `RATE_LIMIT` 这个词。

**明确不切换的**：取消（`ABORTED`）、无适配器（`NO_ADAPTER`）、能力/请求构造错误、凭证错误。这些要么是用户主动中断，要么是配置坏了，切换只会把问题藏起来。

### 2.3 总上限与退避

```yaml
  maxTotalAttempts: 6
```

- `maxTotalAttempts` 是**硬上限**。DSH 的 Agent step 循环本身没有任何 attempt 上限，所以这个必须由插件兜住，否则一个坏请求能跑很久。
- 退避**不可配置、UI 只读**：同渠道重试的退避归 `llm-retry`（500ms 起步、10s 封顶、0.1 jitter），插件不另设一套；跨候选切换前会先经历一次这样的退避等待，UI hint 必须披露。

### 2.4 条件路由（两个用户条件 + 一个自动维度）

候选可以带条件，只有条件满足才轮到它：

```yaml
    - { provider: pi-ai-gpt, model: gpt-5, maxAttempts: 1, needs: { images: true } }
    - { provider: pi-ai-claude, model: claude-sonnet-5, maxAttempts: 1, needs: { minContextTokens: 120000 } }
```

| 维度 | 判断依据 | 精确度 |
|---|---|---|
| `images: true` | 本步 admitted 用户消息里的 `ImageBlock` | **精确**（附件引用在不在内容块里） |
| `minContextTokens` | `tokenMeter` 的 `contextPressure` 投影，`projectedTokens` 即"下一个请求会花多少" | **估算**，token-meter 自述系统性低估 CJK，不能当精确阈值 |
| 推理档位（自动，不占条件位） | 请求 config 的 `reasoningEffort` 对比候选 `resolveModel()` 的 `reasoning.efforts` | **精确**；不支持时 Router 经 `resolveCallConfig` 预校验自动跳过该候选 |

**工具能力不做前置条件**：DSH 没有任何机器可读的"模型支持 function calling"元数据（`LlmModelInfo` 唯一能力字段是 `inputModalities`）。工具不兼容在运行时由 provider 拒绝、规范化为 `INVALID_REQUEST`（deepseek）或 `PI_AI_ERROR`（pi-ai），进入 `agent/request-error` 由 Router 按 `switchOn` 承接；`INVALID_REQUEST` 是 switchOn 可选项（默认不勾）。理由见[决策笔记](../../.agents/notes/implemented/2026-10-12-drop-tools-eligibility-condition.md)；推理档位自动跳过的理由见[决策笔记](../../.agents/notes/implemented/2026-10-12-router-prevalidates-reasoning-effort.md)。

取数时机：`agent/pre-step` 给本步用户消息，`system-prompt/assemble` 给本步工具列表，两者都跑在 route 决策**之前**；且**重试不会重跑这两个钩子**，所以条件在一步之内的多次 attempt 之间稳定——语义上正好，「这一步的请求长什么样」是确定的。

能力的最终权威是 adapter 的 `resolveModel()` 与 `imageRequestPricing()`，插件不自己推断兼容性。

### 2.5 范围

```yaml
default:                        # 没匹配到任何 when 时
  enabled: false                # 默认不接管
```

- **只接管配了 `when` 的模型**，没配的行为零变化。
- `default` 可选打开，作用于所有未显式配置的模型。默认关。

## 三、配置示例（canonical schema，已定稿）

```yaml
enabled: true                 # 总闸：关掉后所有模型绕过插件（默认开）
profiles:                     # 数组；按 when 精确匹配
  - id: coding-main
    when: { provider: deepseek-official, model: deepseek-v4-flash }
    candidates:               # [0] 钉死为 when 模型：不可删、不可换序、无 needs
      - { provider: deepseek-official, model: deepseek-v4-flash, maxAttempts: 2 }
      - { provider: pi-ai-gpt,        model: gpt-5,           maxAttempts: 1, needs: { images: true } }
      - { provider: pi-ai-claude,     model: claude-sonnet-5, maxAttempts: 1, needs: { minContextTokens: 120000 } }
    switchOn: [RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, EMPTY_RESPONSE]
    maxTotalAttempts: 6

  - id: gpt-main
    when: { provider: pi-ai-gpt, model: gpt-5 }
    candidates:
      - { provider: pi-ai-gpt,    model: gpt-5,           maxAttempts: 1 }
      - { provider: deepseek-official, model: deepseek-v4-flash, maxAttempts: 2 }

default:                      # 纯备用池：primary 永远是运行时用户所选，无钉死节点
  enabled: false              # 默认不接管未配置的模型
  candidates:
    - { provider: deepseek-official, model: deepseek-chat, maxAttempts: 1 }
  switchOn: [RATE_LIMIT, SERVER, TIMEOUT]
  maxTotalAttempts: 3
```

配置走 DSH 的 `Config` + `Volatile<T>`，放在 Plugins 页，改完即时生效，不用重启。校验分级见第九节。

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
- **恢复**：`agent/request-error`，**注册在 `llm-retry` 内层**（推迟到 `agent/created` 时注册到 `agent.ctx`），**不用 prepend**。这样 llm-retry 先管同 route 重试（含退避与 `llm/retry` durable 记录），它放弃时 `next()` 正好交给 Router 做跨候选 failover。已实测，见[能力边界](dsh-capability-boundary.md) 7.4。若错用 prepend 位于最外层，llm-retry 放弃时 `next()` 直达终态，Router 永远等不到放弃信号。
- **候选索引**：进程内 `WeakMap<Agent, …>`，按 (agent, turn, step) 键控。**必须自持**——已实测 `agent/request` 在重试时再次触发且解析回用户选择，无法从 waterfall 推断当前候选。
- **两层 attempt 边界**：同 route 重试归 `llm-retry`（不复制退避）；跨候选 failover 与硬总上限归 Router。总 worst case = `候选数 × (1 + maxRetries)`。声明 `always` policy 的候选 provider 在配置加载时拒绝（它无上限且先 await 下游，行为与 normal 相反）。
- **条件路由取数**：`agent/pre-step` 取本步用户消息，`system-prompt/assemble` 取本步工具，`ctx.sessionProjections.stateOf(session, 'contextPressure')` 取上下文占用；与候选索引放进同一个 per-(agent, turn, step) 状态桶。
- **durable lineage**：插件自有 `ctx.sessionProjections.register()` 折叠 `request/header` + `assistant/attempt` + `assistant/message`，零新增事件类型、零 plugin record。
- **包形态**：函数插件，命名导出 `name`/`inject`/`Config`/`apply`；可选服务用 `ctx.get()`；产品可见插件必须有真实 Loader 组合测试。

## 七、分期

| 期 | 内容 | 准入 |
|---|---|---|
| **Phase 1** | 有序备份链 + `switchOn` + 每候选次数 + 硬总上限 + 退避；只接管配了的模型；一条中文通知说明为什么换 | 产品边界已定（已定，见第八节） |
| **Phase 2** | 条件路由（图片 / 工具 / 上下文）；durable lineage 投影；诊断日志 | Phase 1 真实组合测试绿 |
| **Phase 3** | 候选游标跨重启（显式开启，经 KV 存储） | 有真实用户需求触发 |
| **不做** | 逻辑模型进选择器；路由压缩/标题（DSH 已自带）；全局健康度 / 熔断 / 权重 / 延迟路由 | 需改核心、重复既有能力或另一子系统 |

## 八、已定的产品决定

| # | 决定 | 结论 |
|---|---|---|
| 1 | 条件路由进哪个 Phase | **Phase 2**。Phase 1 先交付最小可用的有序链，条件路由要多听两个 waterfall |
| 2 | 第一版就要中文通知 | **要**。成本低，见 4.2 |
| 3 | `default.enabled` 默认 | **关**。只接管显式配置的模型 |
| 4 | 辅助调用选路 | **不做**。DSH 已自带且更完整，见第十一节 |

## 九、Schema 与界面设计的三个硬约束

1. **备份链顺序必须用 array，不能用 dict**——顺序是本插件的核心语义，dict 无序。
2. **跨字段校验走 `validateConfig()`**（DSH 插件范式：zod schema 管字段级 + `apply()` 里 `validateConfig()` 管跨字段、加载即抛，见 `llm-retry/src/index.ts:30,123-124`；Cordis `fiber.update()` 先校验再重启，`vendor/cordis/src/fiber.ts:731-751`，保存时即被拒）。分级：结构错误（ID 重复、上限非法、候选为空）硬失败；provider 未注册（环境漂移，如用户事后卸载 provider）降级为该 profile 停用 + `ctx.logger.warn` + UI 徽章警告——硬失败会得到"卸载一个 provider、整个路由器莫名全死"的脆弱性。客户端可用 `modelCatalog().routableProviders` 对 provider 做实时提示；model ID 不校验（catalog 成员是 advisory，核心路由接受未列出 ID）。
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

| 区块 | 字段 |
|---|---|
| 总闸 | 启用渠道路由（默认开；关掉后所有模型绕过插件） |
| 全局 | 是否接管未配置的模型（默认关；开启后配纯备用池） |
| 备份链（每个 profile） | 有序候选列表：provider / 模型 ID，可增删与排序；`candidates[0]` 钉死为 when 模型 |
| 候选高级条件 | 图片 / 最小上下文门槛（仅备用候选可配）；推理档位徽标为自动维度 |
| 切换条件 | 限流 / 服务端错误 / 超时 / 网络传输 / 空回复（复选框，默认对齐 DSH 自己的 normal policy）+ 请求被拒绝（默认不勾） |
| 硬上限 | 单请求最多尝试次数 |

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
