---
title: "DSH Model Router — 重试次数只有插件一个执行者"
status: "implemented"
kind: "design"
last_updated: "2026-10-21"
---

# 重试次数只有插件一个执行者

## 摘要

今天数字不是真的：填 10，实际 6 次，因为 DSH `llm-retry` 的 `retryPolicy.maxRetries`
（默认 5）是第二个上限，小的那个生效。用户 2026-10-21 的裁定是：**插件自己当重试执行者**，
让配置的数字就是事实。

## 一、今天的公式（已核实）

```
每条候选的真实调用次数 = 1 + min(插件 maxRetries, 该 provider 的 retryPolicy.maxRetries)
```

两层各有一个计数器，只有较小的生效：

| 层 | 计数器 | 上限 | 超出后 |
|---|---|---|---|
| 插件（`agent/request-error`，最外层） | `attemptsOnCandidate`，按 (agent, turn, step) | `maxRetries + 1` | 不委托，直接前进到下一条候选 |
| DSH `llm-retry`（内层） | 会话投影 `llmRetry`，按 `[provider, policyKey]`，`step/start` 重置 | `retryPolicy.maxRetries`，默认 **5** | `return next()`，把决定交回插件 |

出处：`packages/llm/llm/src/retry-policy.ts:156-168`；`packages/llm/llm-retry/src/index.ts:219-240`；
`packages/core/agent/src/runtime-types.ts:353`（payload 自带 `retryPolicy`）。

## 二、定案：插件独占重试

路由过的 step，插件**不再把失败交给 `llm-retry`**，自己执行全部重试：

1. **数量**：候选的 `maxRetries` 就是真实次数。未填（`undefined`）时回落到
   `providerRetryPolicy(provider).maxRetries`（`packages/llm/llm/src/index.ts:668`）——
   DSH 的策略仍然决定"没写时的默认值"，只是不再是硬上限。
2. **时序**：插件的等待复刻 DSH 的形状——`initialDelayMs`、`maxDelayMs`、`jitterRatio`
   来自该 provider 的策略，`failure.providerRetryAfterMs` 存在时优先用它。等待必须可取消
   （`signal` 中止即放弃重试），与 `probe.ts` 的 deadline 同一个纪律。
3. **判据**：哪些失败值得重试由插件的 `switchOn` 决定（它本来就是用户对这个插件的显式选择）。
   provider 的 `retryableCodes` 不再对路由 step 生效——它就是"第二个判据"的来源。
4. **`always` 策略**：仍然在加载时拒绝。无界重试配上确定性的错误只会烧钱。

## 三、记录怎么留：原生已经记了

`agent-loop/src/agent.ts:504-526` 的顺序是决定性的：

```ts
if (finish.kind === 'error' || finish.kind === 'aborted') {
  live.settle('assistant/attempt', () => this.session.append('assistant/attempt', { turn, step, stream }))
  const action = await waterfall('agent/request-error', { …, retryPolicy: preparedCall?.retryPolicy, … })
  if (action?.kind !== 'retry') throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
  continue            // ← 立刻重来，没有延迟
}
```

三个事实：

1. **每次失败尝试都先写成 `assistant/attempt`（含完整 stream），然后才问恢复策略。**
   所以"插件接管重试会丢记录"是错的——记录由 agent loop 写，与谁决定重试无关。
   轨迹视图本来就渲染 `assistant/attempt`。
2. `{ kind: 'retry' }` 只是让循环 `continue`：**没有任何退避**。退避得插件自己等
   （可取消），这也是"插件独占"唯一真正新增的代码。
3. `retryPolicy` 由 `preparedCall` 随 payload 交进来，所以时序参数与默认次数都在手边。

**仍然不伪造 `llm/retry`**：那是 `llm-retry` 的类型，它的投影按 `[provider, policyKey]`
计数；插件往里写等于冒充别人的账本。插件自己的记录走自有 session 投影
（`request/header` + `assistant/attempt` 已够折出"第几次尝试"，`lineage.ts` 现在就这么做），
并在"额度用尽、准备换渠道"这类节点留一条中文 notice。

## 三之二、不勾选的失败码仍然交给 DSH

`switchOn` 是"路由器接管哪些失败"的开关，不是"哪些失败值得重试"的判断。所以：

- **勾了的码**：插件自己重试 `min(配置, 无上限)` 次、自己退避；额度尽了换候选。
- **没勾的码**：插件仍然 `return next()`，由 DSH 按它自己的策略重试并收尾——今天的
  行为一点不变，包括它的 5 次上限。

这条划线让"插件独占重试"不侵蚀 DSH 的既有语义：用户没让路由器管的事，路由器不碰。
README 与 UI 提示都要写这一句。

## 四、被否方案

1. **A 诚实收口**（按策略校验、只显示实际生效值，不改执行层）。
   - 最强的理由：零新机制，不动已验证的两层交接，半小时能上。
   - 为何被否：用户要的是"填 10 就是 10"。收口等于承认插件的输入框只是建议值，而这条
     建议值还必须由用户自己去读 provider 策略才知道真假。
2. **只接管尾巴**（内层放弃后插件补足剩余次数）。
   - 最强的理由：保留 `llm-retry` 的退避与 `llm/retry` 记录，只补差的那几次，改动最小。
   - 为何被否：同一个 step 里出现两种退避曲线、两套计数，正好是本项目一直拒绝的"同一
     事实两处表达"。要么全给 DSH，要么全给插件。
3. **让用户去改 DSH 的 provider 策略**（把 `maxRetries` 调到 10）。
   - 最强的理由：不改一行插件代码，且那是 DSH 自己的配置面。
   - 为何被否：provider 策略是全局的（所有插件共用），为一个插件的单条候选调它，会把
     compaction、标题生成等辅助调用一起改掉。

## 五、已知代价与待办

- 插件从此拥有退避实现。它必须与 `llm-retry` 的语义对齐（指数、上限、jitter、
  `Retry-After`），否则同一个 provider 在路由与未路由的 step 上表现不同。
- `switchOn` 与 provider 的 `retryableCodes` 从此是两个不同作用域的东西：前者对路由 step
  生效，后者对其余调用生效。README 必须写这一句，否则下一个读代码的人会以为漏了合并逻辑。
- 待决：`Retry-After` 超过 `maxDelayMs` 时，DSH 在 normal 模式下选择**放弃**；插件是否
  照抄这个行为（放弃并换渠道），还是截断到 `maxDelayMs` 再试？建议照抄——服从服务端的
  显式信号比省一次切换更不容易被限流。
