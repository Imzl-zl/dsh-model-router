# Agent Note: 渠道健康重构、选路策略与自动禁用

Status: implemented

## Problem

`2026-10-14-channel-health-monitoring`（已归档）实现的双引擎健康体系有三个致命缺陷，全部在生产路径上：

1. **健康配置保存不了**：`client.js` 的 `scope.mutate` 只写 `enabled/profiles/default`，漏掉 `health`。用户在健康设置里改任何东西、点保存，界面显示"配置已是最新"，磁盘上什么都没有——静默数据丢失。
2. **主动探测整个是空转**：`RouterHealthService` 走手写的 Typert descriptor + 客户端 `ctx.remote.$mount`。DSH 的远程贡献只能由构建管线从 `@Remote` 装饰器生成，`dsh-typert-loader` 明确"没有生成导出的包被静默跳过，且仅发现主机面"。这个插件是手写单文件、无构建步骤，所以那条通道从未成立——浏览器里点"探测全部渠道"零网络请求、零反馈。
3. **吞吐永远显示横线**：投影读 `event.data.message.usage`，而 DSH 的 `assistant/message` 把 `usage` 放在 `message` **旁边**（`core/session/src/types.ts:341-349`）。所以 `throughputTps` 永远是 undefined。更糟的是当时那条单测喂的就是手搓的错误形状还全绿——测试复述了实现的错误假设。

同时，用户提出三个产品需求当时没被满足：

4. **选路策略只有一种**：用户要顺序 / 权重 / 轮询都可选，把负载摊到多个渠道（免费不稳定 + 稳定付费的场景）。
5. **渠道挂了要能自动避开**：用户要按错误码配置自动禁用（403 禁、没额度禁），而不是每次都去撞。
6. **语义必须清晰**：UI 文案不能出现内部比喻（"敲门"），逻辑对但用户看不懂等于没做。

## Decision

1. **一个健康事实一个 Store**：删掉 `HealthMonitor`（内存 Map）和 `RouterHealthService`（自造 remote + 手写 descriptor + `$mount`）。健康只来自 `router/channel-health` 会话投影。内存副本活不过配置保存（fiber 整体重启），而且没有构建管线就到不了浏览器——两个理由任何一个都足够判它出局。
2. **连通性检查改用 DSH 原生接口**：`ctx.remote.llm.discoverModels` + `ctx.remote.settings.describe` + `ctx.remote.llm.listConfigurableProviders`，与 `ui-settings-models/src/client/operations.ts:96-107` 同一套。客户端 `inject` 补 `remote.llm` / `remote.settings`。provider 端点映射可缓存（是配置事实），但 Host 推送新配置必须作废，否则后加的 provider 一直查不到。
3. **四档健康配置，全部用户可选**：`passive`（运行时记录）/ `discover`（连通性检查）/ `probe`（发送测试消息）/ `breaker`（自动禁用）。周期一律用**秒**、默认 0，用户按自己渠道的限流承受能力设——限流是每渠道各自的，插件不替用户判断多密算太频。
4. **选路策略只管起点**：`order` / `weight` / `round-robin` 三种策略只决定从哪条候选开始，失败之后的前进逻辑完全不变（`planFire` 因此感知不到策略存在）。链旋转后 `StepChain.order` 携带原始下标，通知里说的"第几条"仍是用户自己排的编号。轮询游标按会话计（`WeakMap<Session, number>`），重启归零。
5. **自动禁用（熔断）**：规则按错误码精确匹配和/或错误信息包含匹配，逐条配冷却秒数；**禁用永远过期**，冷却到的下一个请求真去试，又失败再禁。**用户自己选的那一条永远不跳过**——禁用名单不该能覆盖人的显式选择。状态在内存，保存配置时重置（已告知用户并接受）。
6. **手动候选不再允许打错 provider**：provider 改成从已注册列表里选（`<select>`），model 保留自由输入 + 目录建议（`datalist`）。理由：写错的 provider 不报错、只在运行时被静默跳过，比不给输入更糟；而模型 ID 常不在任何目录里，必须能自由输。
7. **错误码只用 DSH 自己的**：`AUTH` / `QUOTA`（`llm/src/error.ts` 的 `QUOTA_EXCEEDED_CODE`），DSH 全树没有 `AUTH_FAILED`。`classifyHealth` 收窄：只有渠道自身故障（RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT/AUTH/QUOTA）影响健康，请求级错误（INVALID_REQUEST/EMPTY_RESPONSE）和用户主动中断（ABORTED）不影响——把好渠道刷红是本插件最不该有的谎言。
8. **UI 只说人话**："敲门"全部改名为"连通性检查"；删掉假数字 `availabilityPct`（四种数据混算百分比没有意义）；硬编码色换 DSH `--dsw-alias-state-*` token。

## Alternatives considered

1. **保留内存健康 Map + 自造 remote，把通道修对**
   - 被否原因：通道修不了。Typert 贡献必须由构建管线生成，而给这个插件加构建步骤（tsdown + `./typert` 导出）是独立的大决定，不该为了一个健康显示顺手做掉。且内存状态活不过配置保存，与"跨请求健康状态"的需求本身矛盾。
2. **定时检查放 host 侧，让它在 DSH 起着时总跑**
   - 被否原因：host 跑完结果送不回界面（同一个通道问题）。放客户端半包至少让配置变成真的，代价是"只在 DSH 界面开着时生效"——这一点在设置文案里写明，不假装是后台常驻。
3. **禁用状态持久化**
   - 被否原因：每次失败写盘，且和"配置保存会重启 fiber"打架；重置的代价只是保存后第一个请求重试一次。已在交互中明确告知用户并取得认可。
4. **按错误信息做正则匹配**
   - 被否原因：误伤风险高。改为"错误码精确 + 信息包含"两种规则，填几个按几个匹配；常用码只做快捷 chips，码本身永远可手输任意值（`LlmFailure.code` 是开放字符串）。
5. **保留手输 provider**
   - 被否原因：见 Decision 6。用户原话"输错会跳过那他妈为啥不直接选"。

## Consequences

- 收益：
  - 三个静默故障（保存丢失、探测空转、吞吐恒空）全部消失，且有对证；`usage` 那条加了"错误形状必须产出 undefined"的防回归用例。
  - 健康数据单一来源，配置保存/重启不再让同一事实有两个版本。
  - 选路策略与自动禁用都做成用户可选，插件不替用户排优先级。
- 代价（明确记录，不隐瞒）：
  - **连通性检查只认设置页加过的渠道**：手输的候选选路正常，但定时检查问不到它。这是 DSH 发现接口的要求，不是缺陷。
  - **发送测试消息仍未实现**：开关禁用并写明原因（需要构建管线）。没有留一个能开但没反应的开关。
  - **熔断的跨 step 跳过只有单测覆盖**：测试 harness 一次 boot 只产一个 step（stub 不调工具），造过端对端场景跑出来是假的就撤了，没让它假绿。
  - **熔断状态不跨配置保存**。
- 验证：
  - 35 单测全绿（含客户端保存形状往返、旧分钟→秒迁移、`AUTH`/`QUOTA` 码、熔断规则四组合、策略旋转保持用户编号）；
  - 10 组合测试全绿（真实 Cordis Loader + stub）；
  - `tsc --noEmit` 0 错误；浏览器实测熔断 UI 全链路与 `health.breaker` 落盘；
  - 一次独立代码审查（`zhanggui-requesting-code-review`）查出 3 个 Critical（breaker 存错层级、定时器作用域、虚构错误码）与 7 个 Important，全部修复后复检通过。
