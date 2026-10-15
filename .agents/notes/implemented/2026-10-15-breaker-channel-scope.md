# Agent Note: 熔断规则加显式 scope，渠道级故障整条 provider 冷却

Status: implemented

## Problem

熔断状态按路由键（`provider/model`）存。渠道级故障——密钥失效、网关整体挂、
当年实测那个 TLS 重置——信号说的是"这条渠道"，状态记的却是"这个模型"：链上会把
同渠道其余模型各真打一次、各写一次 block，才跨到下一个渠道。三模型的死渠道能吃掉
`maxTotalAttempts`（默认 6）的整整一半，用户看到的是"切得慢、预算莫名其妙光了"。
不记录的话，后来者会往两个反方向改：要么以为熔断天生按渠道（把模型级故障也整渠
道禁，埋掉好模型），要么把 scope 当成实现细节删掉。

## Decision

熔断规则加显式 `scope: 'route' | 'channel'`，默认 `route`（旧配置零迁移）。
`CircuitBreaker` 双桶存储：路由桶 `provider/model`、渠道桶 `provider`；
`blockedUntil` 返回两者中较晚的到期时间，并报告是哪个桶绑定的——通知据此区分
"候选 X 已被自动禁用"与"渠道 P 已整体自动禁用（该渠道下所有模型）"。客户端规则
行加范围选择器，`normalizeHealth` 给缺字段的旧规则补 `route`。

准入门槛（可机械判定）：

1. 组合测试 `breaker-channel-scope-skips-sibling-models` 端到端绿：渠道级规则命中
   后，同渠道第二个模型一次都没真打（headers 里没有它、失败尝试只有第一条），且
   通知含"渠道 stub-primary 已整体自动禁用"与"该渠道下所有模型"。
2. 单测覆盖三态：路由 block 不牵连兄弟模型；渠道 block 覆盖该 provider 下所有
   模型且不影响别的 provider；两个 block 并存时 `blockedUntil` 取较晚者并报告
   绑定方。
3. `Config()` 对带 `scope: 'channel'` 的规则原样保留，对缺字段的旧规则填 `route`。

## Alternatives considered

1. 按错误码内置推断作用域（AUTH/TRANSPORT → 渠道，INVALID_REQUEST → 路由）
   - 最强的理由：用户零配置，开箱即对常见码正确。
   - 为何被否：哪种码属于哪种粒度，provider 之间没有共识——newapi 的 429 按 key，
      别家按模型；内置映射是静默魔法，猜错就把同渠道的好模型一起埋掉，正是项目规则
      禁止的那类隐藏 fallback。
2. 干脆只按渠道键（把现状反过来）
   - 最强的理由：状态更少、实现最简单，一个 Map 搞定。
   - 为何被否：用户实测原话是"渠道内模型有的用不了、有的会卡、有的可以用"
      （real-a 三个模型两个可用）——按渠道禁会让一个坏模型埋掉好模型，10-13 那份
      实测配置直接反驳。
3. 同渠道失败计数达到阈值自动升级为渠道级
   - 最强的理由：无需用户判断，自适应。
   - 为何被否：引入隐藏启发式状态，"失败几次算渠道坏"没有可判定门槛；且升级前的
      每次失败已经烧掉了预算，治的是症状。

## Consequences

- 收益：死 key、网关整体故障时链直接跨渠道，不再每个模型烧一次真实调用；粒度由
  用户在规则上显式声明；旧配置零迁移；通知措辞与绑定方一致，不再把"整条渠道凉了"
  说成"这个模型凉了"。
- 代价：规则多一个字段（schema 一个键、UI 一个选择器、normalize 一处）；
  `blockedUntil` 语义变成"两个 block 的较晚者"，读代码的人要理解双桶。
- **本次实测发现的边界（写进测试注释）**：`breaker.note()` 只在插件自己的
  `agent/request-error` listener 里调用，而 llm-retry 的 normal 策略自己重试
  RATE_LIMIT 等常见码、从不 `next()` 委派——所以 block 的记录要等 llm-retry 让位
  （重试耗尽或适配器策略 maxRetries 为 0）。首次请求仍可能把同渠道打一次；block 的
  收益从记录成功之后的请求起。这是既有架构（llm-retry 拥有请求内重试）的后果，不是
  scope 引入的，但测试必须显式把 stub 策略设成 `maxRetries: 0` 才走得到熔断那一步。
