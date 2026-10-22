# Agent Note: 失败默认就动（全切 + 兜底），截断默认续跑并在续满后换候选

Status: implemented

## Problem

用户现场两件事，根子上是同一个形状：**默认什么都不做，只有被枚举到的场景才动。**

1. 一轮对话直接以 `402 {"message":"Upstream request failed: Endpoint is unavailable.","type":"invalid_request_error",...}` 失败，链上明明还有候选，一次都没试。
   - pi-ai 适配器把错误拍平成 `error.message` 再按文案分类（`llm-pi-ai/src/stream.ts:34-49`），报文里的 `"type":"invalid_request_error"` 命中 `/invalid.?request/i`，HTTP 状态已经丢了 → 这个 402 在 DSH 眼里是 `INVALID_REQUEST`，不是 `QUOTA`。
   - `switchOn.invalidRequest` 当时默认 `false` → 插件 `delegate`；`INVALID_REQUEST` 不在 DSH 的默认可重试集（`llm/llm/src/retry-policy.ts:18-24`）→ `llm-retry` 一句 `next()`；回到插件仍是"不可切换" → `terminate`。两层都不管，整轮失败（`agent-loop/src/agent.ts:523-525`）。
   - 表里 8 个码之外的任何码（`PI_AI_ERROR`、网关自造的 `HTTP_xxx`、以后新增的码）更彻底：`switchOnKeyOf` 返回 `undefined` 时插件永远不接管。
2. 输出撞上 `max-tokens` 时，DSH 直接结束本轮（`agent-loop/src/agent.ts:547`）并在界面上提示用户自己发"继续"（`ui-chat/src/client/locale.ts:174-175`）。这不是错误，走不到 `agent/request-error`，所以路由器连被问到的机会都没有——"不动了"。

用户的判据很直白：「报错就重试或者切换」「枚举根本不行，总有场景覆盖不了」。他还追问了续跑用尽之后的行为：「次数用完你会自动切换模型吗？要知道我们这个插件的目的是啥」。

## Decision

**默认动作是"动"；不动必须是一条显式配置。** 具体三条：

1. `switchOn` 的八个码默认全部为 `true`；新增 `other` 兜底键（表外的一切码）默认也是 `true`。取消勾选 = "这个码交给 DSH 收尾，插件既不重试也不切换"。
2. 表外的码**永远先问内层**（`delegate`），内层放弃后才由插件换候选；`CONTEXT_WINDOW_EXCEEDED` / `IMAGE_OFFLOAD_REQUIRED` 这两个由 DSH 自己的 compaction 插件拥有的码同样先问内层。`ABORTED` / `NO_ADAPTER` 永不切换（没有"切换"这个动作可言）。
3. **同渠道重试的默认次数改成 5**，与 DSH 自己的 provider 策略一致（`llm/llm/src/retry-policy.ts:14`）。插件接管重试之后，默认值比 DSH 小就等于"升级让韧性变差"：旧行为是选中模型先自己重试 5 次，不能变成一失败就换模型。开箱行为因此是用户描述的那句——先自己重试，重试还不行才按配置的链路切，每一条候选都有自己的重试预算。旧配置里存的 0（当时的默认值）随同一次 `policyVersion` 迁移改写；保存后带标记，刻意填 0 不再被覆盖。
4. `max-tokens`：挂 `agent/turn-stopping`（DSH 官方给 `/loop` 用的口子，`agent.ts:361-365`，官方用例 `agent-loop/tests/loop.spec.ts:1234-1255`），命中就 `agent.steer()` 补一句"继续"；同一候选续满 `maxTokens.continues`（默认 2）次后，下一次截断**换下一条候选接着写**——这正是这个插件的用途，不能停在"续两次然后放弃"。

两条自审时补上的修正（同一决定内的收口，不是新决定）：

- **表外的码不能用"内层放弃"当成候选定性**：它们永远先 `delegate`，于是 `decideAfterInner` 一返回就等于"这一击定论"，用户给候选填的 `maxRetries` 对这类码完全失效——与表内的码不一致。现在只有"内层真的为这个码重试过"（`retryPolicy` 的可重试集包含它，或 `mode: 'always'`）才放过；否则路由器用自己的退避补上那几次重试。判据是组合场景 `an-unclassified-code-is-not-a-dead-end`（首发 + 2 次重试都落在第一跳，且 `llm/retry` 一条都没有）。
- **截断记录必须来自本轮的最后一个 step**：辅助调用（会话标题、压缩）也写 assistant 消息，用它们的 `max-tokens` 去 `steer` 会把一句话塞进不相干的一轮。现在记录里带 `step`，`turn-stopping` 只认与最近 step 状态一致的那条。

准入门槛（可机械判定）：

1. 旧配置一次性迁移：原始配置里没有 `policyVersion: 2` 时按"全 true"读（旧配置里的 `false` 是当时的默认值，读不出用户是否选过）；保存后带标记落盘，此后用户的取消勾选不再被覆盖。通过的样子：用户那份只存了 `invalidRequest: false` 的配置升级后能切换 402；不通过的样子：改完 schema 默认值却仍读回 `false`。
2. 组合测试里必须有一条"表外码（`PI_AI_ERROR`）端到端换渠道"与一条"截断 → 续 2 次 → 第三条仍截断 → 换候选"的真实 boot 场景，且截断那条不产生任何 `assistant/attempt`（截断不是错误）。
3. 内层优先必须可观测：`CONTEXT_WINDOW_EXCEEDED` 在 `decideBeforeInner` 必须返回 `delegate`，即使 `other` 开着。

## Alternatives considered

1. 只把 `invalidRequest` 默认改成 `true`
   - 最强的理由：改动最小，正好命中这次的 402，不碰任何结构。
   - 为何被否：死区原样保留——`PI_AI_ERROR`、网关自造的码、以后 DSH 新增的码仍然"两层都不管"。用户的问题不是"少勾了一个码"，是"没勾就等于什么都不做"这个形状。
2. 继续往表里补码（把 `PI_AI_ERROR`、`HTTP_402` 等逐个加进去）
   - 最强的理由：语义精确，用户看得懂每一格的后果，也不会误切"根本不该切"的码。
   - 为何被否：枚举永远滞后于 provider 与 DSH 的新码，而漏掉一个码的代价是"整轮卡死"；这个方向每次都要等事故发生再补一格。
3. 把所有码都当成"插件自己接管"（连内层优先也不留）
   - 最强的理由：最简单，一条规则覆盖全部失败，行为最好预测。
   - 为何被否：会抢在 `compaction-basic` / `compaction-image-offload` 前面——上下文溢出本该压缩历史、图片超预算本该卸载图片，被换成"换渠道"是把可修的故障换成一次重撞（还可能撞到窗口更小的候选）。
4. 截断时不续跑，直接换候选
   - 最强的理由：一次调用就换，最省事，也避免"续跑烧额度"。
   - 为何被否：截断常常只差最后一段，同候选续跑更便宜也更快出结果；用户原话是"续两次可以"，他只是不接受续完就停。
5. 重试默认沿用 0（"一次失败就换"），把次数交给用户自己填
   - 最强的理由：换渠道比在同一家死渠道上等待更快；对"端点不可用"这类要几十秒才恢复的
     中转，500ms 后重试几乎必然再失败一次，纯属拖慢切换。
   - 为何被否：插件接管重试之后，"默认 0"意味着它比 DSH 原来更不耐心（DSH 的 provider
     策略默认 5 次），升级反而让韧性变差。用户的判据也直接：「你起码默认 5 吧，人家 dsh
     默认都 5」。等待的代价可以由用户按候选调小到 0，锐气不该由默认值替人决定。
6. 续跑用尽就停（交给 DSH 的截断结束）
   - 最强的理由：不做额外决定，行为与 DSH 原生一致。
   - 为何被否：用户当场否掉了——"次数用完你会自动切换模型吗？要知道我们这个插件的目的是啥"。停在一条写不完的候选上是这个插件存在的反面。

## Consequences

- 收益：402 这类"上游临时不可用"不再需要事后补码；表外码从死区变成"先问内层、再换候选"。截断不再需要用户手动发"继续"，也不会卡在同一条写不完的候选上。
- 代价：默认切得更激进——`INVALID_REQUEST` / `EMPTY_RESPONSE` 这类以前默认不切的失败现在会真的换渠道，一次真正的请求形状错误会按链长多花几次调用，最后由用户取消勾选来止血；迁移会覆盖旧配置里那两个 `false`（无法区分"默认值"与"用户选择"），这一点在 CHANGELOG 与配置项描述里写明。续跑与换候选共享 `max-tokens` 这一个结束原因，配置上多两格（`maxTokens.autoContinue` / `continues`），工作台的重试分区因此多一行控件。
- 取代关系：本篇只取代 `2026-10-12-drop-tools-eligibility-condition.md` 里「`INVALID_REQUEST` 默认不勾」与 `2026-10-16-switch-on-auth-and-quota.md` 里「表外码永不接管」这两句；两篇关于 `needs.tools` 与 AUTH/QUOTA 切换的结论仍然有效，已在这两篇顶部各加一行指向本篇。
