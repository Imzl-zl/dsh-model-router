# Agent Note: 重试由插件独占执行

Status: implemented

## Context

用户连续追问同一件事："我配 10，实际是不是只重试 5 次？" 核到源码后确认：是。
`agent/request-error` 的两层各有一个计数器，**小的那个生效**：

- 插件（最外层）：`attemptsOnCandidate < maxAttempts` 时委托给 `llm-retry`；
- `llm-retry`：会话投影里按 `[provider, policyKey]` 计数，`previousRetry >= maxRetries`
  时放弃（`llm-retry/src/index.ts:219-240`），默认 `maxRetries` 是 **5**
  （`llm/src/retry-policy.ts:14-17`）。

所以真实调用 = `1 + min(插件配置, provider 策略)`。填 10 只发生 6 次，而 UI 允许填 99。

用户的裁定是"插件接管重试，让填的数就是真数"。核实后确认这条路 DSH 完全支持：

1. `agent/request-error` 的返回值就是 `RequestErrorAction = { kind: 'retry' } | undefined`
   （`core/agent/src/runtime-types.ts:122`）；
2. 循环拿到 `retry` 后直接 `continue`（`core/agent-loop/src/agent.ts:523-526`），
   下一次迭代重新走 `prepareRequest` → 插件的 `agent/request`；
3. **失败尝试在问恢复策略之前就已经落盘**为 `assistant/attempt`
   （`agent.ts:504-510`），所以"接管重试会丢记录"是错的——记录由循环写，与谁决定重试无关；
4. payload 自带 `retryPolicy`（`agent.ts:517`）与 `failure.providerRetryAfterMs`，
   时序参数不必自己猜。

## Decision

1. **勾选的码（`switchOn`）由插件自己重试**：`decideBeforeInner` 新增 `retry-self`
   裁决，带 `delayMs`；`index.ts` 只负责 `await waitBeforeRetry(delayMs, signal)` 后
   返回 `{ kind: 'retry' }`。次数就是 `maxRetries + 1`，不再被 provider 策略截断。
2. **没勾的码继续 `next()`**：`switchOn` 是"路由器接管哪些失败"的开关，不是"哪些失败
   值得重试"的判断。用户没交给路由器的事，DSH 按自己的策略处理，行为一点不变。
3. **退避照抄 DSH**：新增 `src/backoff.ts`，曲线与 `llm-retry` 一致
   （`initialDelayMs * 2^(retry-1)`、`maxDelayMs` 截断、`jitterRatio`、优先
   `Retry-After`）；参数取 `retryPolicy`，取不到时用 DSH 的默认值 500/10000/0.1。
4. **`Retry-After` 超过 `maxDelayMs` 就放弃重试**（换候选或终态），与 DSH normal 策略
   一致：服从服务端的显式信号，而不是压缩它。
5. **不伪造 `llm/retry`**：那是 `llm-retry` 拥有的 durable 类型，其投影按
   `[provider, policyKey]` 计数，插件写入等于冒充别人的账本。路由过的 step 因此
   **不会出现 `llm/retry` 行**，但每次尝试的 `assistant/attempt` 一条不少。

## Alternatives considered

1. **诚实收口（按 provider 策略校验、只显示实际生效值）。**
   - 最强的理由：不动已验证的两层交接，零新机制，半小时能上，也不引入第二套退避。
   - 为何被否：用户要的是"填 10 就是 10"。收口等于承认插件的输入框只是建议值，
     而且这个建议值还要用户自己去读 provider 策略才知道真假。
2. **只接管尾巴（`llm-retry` 放弃后插件补足剩余次数）。**
   - 最强的理由：保留 DSH 的退避与 `llm/retry` 记录，只补差的那几次，改动最小。
   - 为何被否：同一个 step 里出现两种退避曲线、两套计数——正是本项目反复拒绝的
     "同一事实两处表达"。要么全给 DSH，要么全给插件。
3. **让用户去调 provider 的 `retryPolicy.maxRetries`。**
   - 最强的理由：不改一行插件代码，且那是 DSH 自己的配置面。
   - 为何被否：provider 策略是全局的，为一个插件的单条候选调它，会把 compaction、
     标题生成等所有辅助调用一起改掉。

## Consequences

- 收益：配置的数字成为事实；重试次数、退避、`Retry-After` 现在只有一个 owner，
  下一轮调整只改一处；`switchOn` 的语义更清楚（"路由器接管哪些失败"）。
- 代价：插件从此维护退避实现。它必须与 `llm-retry` 的语义保持同步，否则同一 provider
  在"路由过的 step"与"未路由的调用"上表现不同。
- 代价：路由过的 step 在轨迹视图里没有 `llm/retry` 行（那些重试确实不是 `llm-retry`
  做的）。这是独占执行的必然结果，不是漏记。
- 代价：provider 的 `retryableCodes` 从此只对未路由的调用生效。README 必须写明两个
  作用域，否则下一个人会以为漏了合并逻辑。
- 已知共存面：`compaction-image-offload` 与 `compaction-basic` 也监听
  `agent/request-error`，但它们只对各自的专用码（`IMAGE_OFFLOAD_REQUIRED_CODE`、
  `CONTEXT_WINDOW_EXCEEDED_CODE`）动作，这些码不在 `switchOn` 里，因此仍然走
  `delegate` → `next()`，不受本决定影响。
- 未做：会话级的每路由重试次数覆盖（`{ sessionId, chain, retries }` 侧车）。本轮只
  落地"次数是真的"；覆盖属于按会话选链那一批。
