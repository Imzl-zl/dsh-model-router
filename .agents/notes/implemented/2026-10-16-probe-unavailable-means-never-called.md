# Agent Note: 探测三态的边界是"调用有没有发生"，不是"错误有没有 code"

Status: implemented

## Problem

`probe.ts` 把 catch 里任何带 `code` 的错误都判成 `unreachable`，于是 `NO_ADAPTER`
（这个 DSH profile 里根本没注册该 provider）和 `MISSING_CREDENTIAL`（该 provider 没配
key）都被渲染成红色「探测未通过」。但插件自己的类型契约 `types.ts:30-34` 写明
`unavailable` = "the check could not run at all"，`unreachable` = "the call was made
and the endpoint, the credential, or the model refused it"。

结果是一条稳定的谎：**调用从未发生，却被说成"渠道拒绝了调用"**。用户在隔离 home 上看到
两条配置好的渠道全是红叉，其中一条只是没填 key——按 UI 的说法去排查，会去查端点、查网络，
而真正该做的是去 Models 页存一个 key（`llm-deepseek-api-key/src/index.ts:30` 的报错文案
本来就写着这件事）。

同一条边界在上一轮已经修过一次：`probe.ts:111-113` 为调用方 abort 加了 `ABORTED` 特判，
注释里写明了"UI 把'没能测'读成'有问题'"。但那只覆盖了取消，没有覆盖"适配器在组装请求时
就拒绝"这一类。

## Decision

探测三态的归类只看一件事：**调用有没有真的发出去**。`unreachable` 必须留给"请求已经
离开 Host、被端点/凭证/模型拒了"；凡是 Host 根本没把请求凑出来的，一律 `unavailable`。

准入门槛（可机械判定）：

1. 码必须能指出"请求未发出"的**结构原因**，而不是"这次调用运气不好"。`NO_ADAPTER` 是
   profile 里没注册适配器（`llm/src/index.ts:995`），`MISSING_CREDENTIAL` /
   `INVALID_CREDENTIAL` 是凭证缺失或不可用（`llm-deepseek-api-key/src/index.ts:30`、
   `llm/src/index.ts:151`），三者在任何重试、任何网络状况下都不会变成"发出去被拒"。
2. 集合封闭且集中在一处：`NEVER_CALLED_CODES` 一个 `ReadonlySet`，两个分类点（in-band
   error finish 与 catch 里的抛出）都过它。不允许在调用点各写一遍 `if`。
3. `classifyHealth` 与它对账：被动折叠那侧这三个码本来就必须返回 `undefined`（不指控渠道）。
   两张表对同一组码给出相反答案，就是有一条在说谎。
4. 反向也要钉住：`AUTH` / `TRANSPORT` / `RATE_LIMIT` / `SERVER` / `TIMEOUT` 仍是
   `unreachable`。把"调用被拒"降级成"没能测"是同一条谎的反方向，一样不许。

## Alternatives considered

1. 在客户端 `routeStatus` 里按 code 分流
   - 最强的理由：不用动宿主，`probe.ts` 的分类保持"原样上报、让上层解释"，客户端已经有
     `probeVerdictText` 这一个渲染点，改一处就够。
   - 为何被否：`ProbeRouteResult` 是跨 Remote 的 wire 契约，`kind` 的三态语义就在
     `types.ts` 里定义。让每个消费者自己按 code 重新解释 `unreachable`，等于把类型契约
     降级成建议——下一个消费者（新的 nav 徽标、新的汇总行）会自然地按 `kind` 画红色，
     而它看不到客户端那一处分流。而且 `summarizeProbes` 的"没能测"计数在客户端就已经
     按 `kind` 归桶了，宿主侧不修正则计数与徽标互相矛盾。
2. 把这三个码从 `unreachable` 改成 `reachable` 的一种弱化形态（比如加 `kind: 'skipped'`）
   - 最强的理由：语义上最诚实，"没配 key"和"通了"确实不是一回事，第四态能表达"渠道没问题、
     只是这次没测"。
   - 为何被否：wire 上加一个枚举值要动 Typert 生成的严格 codec、`ProbeRouteResult`
   schema、以及所有消费方的分支；而 UI 侧已有的 `unknown` 音色与「没能测」文案表达的正是
   这个意思，第四态只是把已经能表达的事情再买一次单。
3. 只修 `NO_ADAPTER`，把 `MISSING_CREDENTIAL` / `INVALID_CREDENTIAL` 留在 `unreachable`
   - 最强的理由：`NO_ADAPTER` 是纯结构事实（profile 没注册），"没配 key"至少说明用户做了
   一个配置动作，算"渠道自身的问题"，修起来更像渠道故障的提示。
   - 为何被否：`types.ts` 的划线标准是"调用有没有发生"，不是"用户有没有做错配置"。没配 key
   时请求同样没离开 Host（`llm-deepseek-api-key/src/index.ts:20-35` 在发请求前就抛），
   报成"端点没应答"是在指认一个从未被联系的端点。用户该看到的动作是"去存 key"，红色故障
   徽标指向的是"去查网络"。
4. 让 `probeRoute` 在探测前先自己查一遍 provider 是否已注册
   - 最强的理由：可以在探测前就给出更明确的原因分类。
   - 为何被否：宿主没有"这个 provider 注册了没有"的只读查询面（`ctx.llm` 只有
     `listConfigurableProviders` 这类目录信息，且客户端已经用它做 notConfigurable 判定）；
   更重要的是这会在适配器拒绝之前复制一遍适配器的逻辑，产生第二事实源。

## Consequences

- 收益：`unavailable` / `unreachable` 的边界回到 `types.ts:30-34` 写的那条线上，且由
  `NEVER_CALLED_CODES` 一处表达。三条真实渠道形态（没注册 / 没 key / key 不可用）在隔离
  home 实测都落到灰色「没能测」，`routeStatus` 给出 `unknown`，nav 徽标与筛选计数不再
  把"没配 key"算进「N 异常」。`classifyHealth` 与探测分类对同一组码给出一致答案，补了
  两条断言把这份一致钉住。
- 代价：① 一个手维护的码集合。DSH 若新增"请求未发出"类的码（例如新的准备期失败），这里
  不会自动跟上——所以注释里写明了收录标准（结构原因、任何重试下都不会变成"发出去被拒"），
  并把 `UNSUPPORTED_REASONING_EFFORT` / `INVALID_PREPARED_CALL` 明确划在集合外：它们是
  插件自己组装请求的事实，属另一轮。② `MISSING_CREDENTIAL` 在真实适配器上是 in-band
  error finish 而不是抛出（`llm/src/index.ts:1113,1161`），所以两个分类点都必须过这个集合；
  只改 catch 那一侧的话，隔离 home 里的 `deepseek-official` 仍会报红——这正是本轮复测
  才暴露出来的形状。
- 未修（同类问题，发现但不在本轮范围）：`controller.ts:309-311` 的 `checkRoute` 兜底把
  `discoverModels` 的任何拒绝都判成 `unreachable`。对 `deepseek-official` 而言，DSH 压根
  没为它注册 model discovery（`registerDeepSeekProvider` 只 `registerAdapter`，
  `llm-deepseek/src/host.ts:55`；只有 `llm-pi-ai` 调 `registerModelDiscovery`），于是
  `discoverModels` 抛 `NO_DISCOVERY`（`llm/src/index.ts:596`）——同样是一次从未发生的调用，
  隔离 home 实测渲染成「连通性检查：端点没应答」，连带卡片状态 pill 显示「异常」。修它需要
  先决定客户端如何知道"这个 ns 没有 discovery"（Remote 信封只回 message，`NO_DISCOVERY`
  这个码到不了浏览器；DSH 自己的 Models 页也把所有失败塌成 `refused`，
  `ui-settings-models/src/client/operations.ts:102-107`），属独立一次设计决定。
