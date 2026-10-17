# 实现层审查发现（待验证）

> 状态：**proposed / 已逐条执行级复核，修复方案待定**。
> 2026-10-17 后续会话已完成「改回去看测试转红」的执行级复核，每条给出
> **证实 / 证伪 / 部分证实 / 仍待核实** 四档处置。**下面的「问题/证据/最小修法」是
> 当时的审查记录，其中两条的「最小修法」已被实测否定（C2、I7 问题 1），引用时以
> 文末《执行级复核结论》与 `.agents/notes/proposed/2026-10-17-finish-the-abstractions.md`
> 的修复排序为准。**
>
> 本文件是四路并行只读审查（宿主选路核心、宿主健康探测投影、浏览器半包、测试）+ 主代理逐条回 DSH 源码复核的原始记录。

## 复核状态（2026-10-17 主代理补核）

按证据强度分三档，验证时从第一档开始：

- **A 档——已有执行级或硬证据，基本只剩"要不要修"**：C1（`llm/src/index.ts:1161-1169` 的 `kind:'aborted'` 分支已逐行读过，`unit.mjs:1056-1061` 的 reject 形状已比对）；C2（推演表已逐 fire 走过，`index.ts:216-264` 确认无 `exhausted` 检查）；C3（`SettingsForm.tsx:55` 已读，确认 `available` 为 false 不渲染 children）；C4（`events.ts:254-260` 与 `llm-retry/src/index.ts:243` 已读，确认 push/unshift 次序）；I2（`retry-policy.ts:18-24` 默认集已读，确认不含 AUTH/QUOTA）；I3（`agent.ts:635-651` 已读，`requestHeaderLogged` 全文仅 4 处引用、置 true 后不重置）；I4（`footer.ts:25` + `page.ts:89` 两处 retain 已定位）；I9（`t('failoverTag')`/`t('failoverNotice')` 在 `src/client/` **零调用点**，`locales.ts:73-74`/`:385-386` 确已成孤立键；`pipeline.ts:259` 的 `t` 在 `Connector` 内未使用）；I5（host 3 处 + browser 18 处 + 解码 9 处已逐处定位）；I7（`Modal.tsx:17,39,73` 的 `contentClassName` 已读；`client-controller.mjs:964` 正则已读）；I8（14 处已逐处定位）；I10（五类抛出点的 DSH 行号已逐个核对）；I11（`llm-deepseek/src/model-info.ts:70-74` 的 text-only 兜底已读）。
- **B 档——源码推演成立，但缺执行级证据**：I1（需断言孤儿 `llm/retry`）；I6（8 个死分支的不可达性依 schema 保证，建议逐条临时改严 schema 验证）。
- **C 档——纯待核实，见「待核实」8 条**：`deadline()` 是否必须 `using`、system-prompt node 0 干扰、70px 头高、`[hash]_[local]` 约定、pi-ai text-only 兜底、M1 可达性、lineage settle step 门控、`unit.mjs:1122` 锚点（该条主代理已核实为**无漂移**，`:30` 是 throw 起始行）。
> 审查范围：`packages/dsh-model-router/` 全量源码（宿主 25 个模块 + 浏览器半包 16 个模块）与 6 个测试文件。DSH 只读 checkout：`D:\sudy\github\deepseek-harness`（全程未写入，`git status --porcelain` 0 行）。
> 已实跑：`node packages/dsh-model-router/tests/unit.mjs` → 99 passed；`node packages/dsh-model-router/tests/client-controller.mjs` → 37 passed（含工作树未提交的拖拽重排改动）。

## 审查口径

用户要求：**从实现层审查，不从结果反推**。判断每处实现是"从实现上就优雅、稳定、语义清晰、用 DSH 原生能力；DSH 没有原生能力的地方是否优雅实现"，还是"为了让功能看起来 work 而硬凑"。

问题类型：硬凑/魔数；重复逻辑与多来源真相；命名与行为不符；注释声称与代码矛盾；竞态与状态机漏洞；错失或误用 DSH 原生能力；隐藏兜底/静默吞错；死代码。

## 总结论

**架构是真优雅，不是硬凑；但有一个统一的病——抽象建到一半就停手，然后用字符串常量和注释把另一半粘起来。**

这个病在八个地方重复出现（routes.ts 只有编码器、timeline.ts 常量被绕过、语义色 accent 未收编、结构校验 host/client 双源、能力边界文档停留在证伪结论、探针 fake 的 abort 形状错、能力预检 catch 全兜、模态选择器猜类名）。每一处单独看都是小疏漏，合起来是同一个习惯：**先让功能跑起来，再用注释声明"这是有意的"**。而项目自己的军规（`AGENTS.md` Debug-First Policy、不静默、单一真相源）条条指向反面。

---

# Critical

## C1. 探针超时分支不可达——hung 端点被报成"没能测"

- **位置**：`packages/dsh-model-router/src/probe.ts:135-153`
- **问题**：finish 分支只认 `chunk.reason.kind === 'error'`，而超时路径产出的是 `kind: 'aborted'`，于是落到 `probe.ts:147` 的 `unavailable(route, now, 'empty stream')`。
- **证据（DSH 源码）**：`packages/llm/llm/src/index.ts:1161-1169`
  ```js
  function adapterFailureChunk(error, signal) {
    const failure = normalizeLlmFailure(error)
    return { type: 'finish',
      reason: signal?.aborted || failure.code === 'ABORTED'
        ? { kind: 'aborted', failure }   // ← 探针走这条
        : { kind: 'error', failure } }
  }
  ```
  探针把 `controller.signal` 作为 `options.signal` 传给 `call.stream(options)`（`probe.ts:127`），超时 `controller.abort(new TimeoutError(...))`（`probe.ts:116`）→ 适配器抛错 → `adapterStream` 在 `llm/src/index.ts:1111-1114` 捕获并 yield 这个 chunk，**不向调用方抛**。`for await` 正常结束 → 走 `probe.ts:147`。
- **后果**：唯一能证明"模型现在真能出字"的档位，在端点挂起时报告"无法测量、与渠道无关"，UI 渲染成灰色"没能测"。这正是 `src/types.ts:29-34` 划定的红线（`unavailable` = "the check could not run at all ... the UI must read it as 'unknown', never as a fault"），也与 `probe.ts:91` 自己的 JSDoc（承诺 `unreachable` + `PROBE_TIMEOUT_CODE`）矛盾。
- **为何是实现层问题**：项目自己在 `tools.md:88` 记录过完全相同的陷阱——"`MISSING_CREDENTIAL` 是 in-band error finish，不是抛出……任何'读流判失败'的代码在 finish 分支就要分类，只在 catch 里分类会漏掉整类"——并为那三个码在 finish 分支做了处理，唯独漏了 `aborted`，因为超时路径是按"会抛"写的。
- **为什么测试是绿的（假绿）**：`tests/unit.mjs:1056-1061` 的 `neverEnding(signal)` 在 abort 时 **reject**（抛出）→ 走 `probe.ts:151` 的 catch → `controller.signal.reason instanceof TimeoutError` → 返回 `unreachable/TIMEOUT`。真实适配器是 **yield** 一个 aborted finish。**fake 的 abort 形状与真实 adapter 相反**，`unit.mjs:1098` `probeRoute times out as unreachable, never as a silent hang` 因此保护不了生产路径。
- **最小修法**：finish 分支放开到 `kind === 'error' || kind === 'aborted'`，并在其中先判 `controller.signal.aborted && controller.signal.reason instanceof TimeoutError`（→ `unreachable` + `TIMEOUT`）、再判 `signal?.aborted === true`（→ `unavailable` + `cancelled`）、再过 `NEVER_CALLED_CODES`。同步把 `neverEnding` 改成 yield `{type:'finish', reason:{kind:'aborted', failure:{code:'ABORTED'}}}`——**fake 必须照真实 adapter 的形状改，不是照实现改**。
- **验证方法**：① 只改 `neverEnding` 的 abort 形状为 yield，`unit.mjs:1098` 应转红（证明当前用例确实保护不到）；② 用真实 llm runtime 驱动（`tests/stub-discovery.mjs` 已登记三种形状，可扩展第四种）或真网关挂起端点复现；③ 修完后两条都绿。

## C2. `planFire` 让末位候选被 cap 之后再多打一次真实调用

- **位置**：`packages/dsh-model-router/src/router.ts:129-154`；调用方 `src/index.ts:216-264`
- **问题**：cap 命中且无下一跳时 `exhausted = true`、`index` 不变、`advanced = false`，但 `attemptsOnCandidate` 仍 `+1` 并返回一个可执行 state。`agent/request` 只按 `plan.state.index` 走候选 Walk，**没有任何地方检查 `plan.state.exhausted`**。
- **证据（推演）**：3 候选、`maxAttempts: 1`、失败码 `AUTH`（`switchOn.auth` 默认 true 故 `mayAdvance` 为真；`AUTH` 不在 llm-retry 默认重试集故 llm-retry 立即委派）：

  | fire | planFire 前 (index, attemptsOnCandidate, total) | planFire 后 | 实际打到 |
  |---|---|---|---|
  | 1 | (0, 0, 0) | (0, 1, 1) | c0 |
  | 2 | (0, 1, 1) | (1, 1, 2) advanced | c1 |
  | 3 | (1, 1, 2) | (2, 1, 3) advanced | c2 |
  | 4 | (2, 1, 3) | (2, **2**, 4) **exhausted** | **c2 再一次** |
  | — | request-error 见 `exhausted` → `decideRecovery` 返回 terminal | | |

  真实调用 c0×1, c1×1, **c2×2**。单候选链（`candidates.length === 1`，profile 合法形态）更明显：cap 1 打 2 次。
- **后果**：`src/config.ts:58-59` 承诺的"这条渠道最多真实调用多少次"在最后一条上被违反 100%；`advanced === false` 所以**连 `failoverNotice` 都不发**，用户看不到这次额外调用。多花一次真实 API 调用与 token，静默。
- **为何是实现层问题**：`src/state.ts:51-52` 的契约写"Set when the last candidate hit its cap: only a terminal decision remains"——与"再发一次请求"直接矛盾。这是把终止条件误建模成了一次转移。
- **最小修法**：给 `FirePlan` 加 `servable: boolean`；cap 命中且 `index === candidates.length - 1` 时返回 `{ state: {...state, exhausted: true}, advanced: false, fromIndex: state.index, servable: false }`（**不**递增 `attemptsOnCandidate` / `totalAttempts`）；`index.ts:227` 前加 `if (!plan.servable) { states.start(agent, plan.state); return resolved }`，走已有的"落回用户原路由让真实失败暴露"路径。同时修掉 `totalAttempts` 被一次调用污染的问题。
- **验证方法**：`tests/run.mjs` 已有 `total-cap`（:149）与 `budget-cap-when-the-whole-chain-dies`（:372），但都没有覆盖"末位候选被 cap"这个形状。新增组合场景：3 候选全 `maxAttempts:1` + `maxTotalAttempts:6` + 失败码 AUTH，断言 `assistant/attempt` 总数 = 3（当前会得 4）。先跑现行代码确认转红。

## C3. `page.ts` 把"配置未就绪"当成"seam 移动"，抛未捕获异常且不恢复

- **位置**：`packages/dsh-model-router/src/client/page.ts:120-133`
- **问题**：
  ```js
  var wrap = formBodyRef.current
  var footer = wrap ? wrap.nextElementSibling : null
  if (!footer) throw new Error('router: the SettingsForm footer is no longer the sibling ...')
  ```
  deps `[]`。
- **证据（DSH 源码）**：`packages/client/ui-primitives/src/settings-form/SettingsForm.tsx:55`
  ```js
  if (!state.available) return <p className={css.unavailable} role="status">{labels.unavailable}</p>
  ```
  `available` 为 false 时**不渲染 children**，`.dsh-router-form-body`（`page.ts:175`，在 children 里）不在 DOM，`formBodyRef.current` 为 null。
  而 `state.available = snapshot.status === 'ready'`（`client/controller.ts:85`），configForms mirror 首次回值前为 false。侧栏按钮常驻可点，用户在这个窗口点开弹窗即触发。deps `[]` 意味着抛后本次挂载永不恢复，只能关闭重开。
- **为何是实现层问题**：这个 tripwire 的本意是"seam 移动就大声失败"（注释自述），但它把两种条件混为一谈——"配置 loading/未渲染" 与 "seam 真移动"。
- **最小修法**：effect 首行 `if (!wrap) return`，只在 `wrap` 存在而 `footer` 为 null 时才抛。
- **验证方法**：`client-controller.mjs` 驱动 stub ctx/store 构造控制器，把 scope 首帧设为 `status: 'loading'`（value undefined）后挂载 `RouterPage`，当前应抛；修后不抛且 `hidden`/`inert` 仍正确挂上（`:1008-1015` 已有守卫）。

## C4. 三处注释/文档与实现对反，其中一处在"唯一权威"里

| 位置 | 说的话 | 实际 |
|---|---|---|
| `docs/design/dsh-capability-boundary.md:71` | `agent/request-error` 在 `llm-retry` **内层**，不用 prepend | — |
| 同文档 `:73` | 「为什么 `agent/request-error` 不能也用 prepend …… Router 永远等不到放弃信号，再也无法 failover」 | — |
| 同文档 `:255` | 「这一条同时推翻了『Router 也用 prepend』的想法」 | — |
| 同文档 `:79` | 「因此两个 waterfall 都必须 `prepend: true`」 | 与 `:71` 自相矛盾 |
| 同文档 `:94` | 总 worst case = 候选数 × (1 + maxRetries) | 已被 `maxTotalAttempts` 硬上限取代 |
| `src/index.ts:11-13`（文件头） | 注册在 `agent.ctx` at `agent/created` **WITHOUT** prepend，在 llm-retry 内层 | `index.ts:317-362`：root ctx + `prepend: true` |
| `src/router.ts:8-17` | 「llm-retry ... registers OUTSIDE this plugin ... The Router cannot preempt it」 | `index.ts:338-343` 在预算尽时**否决** llm-retry 的 retry |

- **证据（DSH 源码）**：`vendor/cordis/src/events.ts:254-260` `const method = options.prepend ? 'unshift' : 'push'`；`packages/llm/llm-retry/src/index.ts:243` llm-retry 用 `ctx.on('agent/request-error', …)` 无 options → push。model-router 用 prepend → unshift，与加载顺序无关地排在 index 0，即 **llm-retry 的外层**。
  `index.ts:317-324` 的行内注释已写了外层设计的实测依据（配 2 打 7 次 → 改外层后打 2 次），说明代码是有意为之，文件头是残留的旧方案。
- **后果**：`tests/run.mjs:372` 的 `budget-cap-when-the-whole-chain-dies` 钉的正是外层行为。**照任何一处旧注释/文档"修"回去，都会重新引入 7-call bug。**
  违反 `docs/AGENTS.md`「一项设计事实只保留一个权威说明；其他页面用链接引用」与项目 `AGENTS.md`「不互相伪装」——证伪记录只存在于 `tools.md:44-45`（项目规则明说"不覆盖正式设计资料"）。
- **最小修法**：删/改写 `index.ts:11-13`；重写 `router.ts:8-17` 指向 `index.ts:317-324` 的真实注册层；重写 `capability-boundary.md` §G2 的 `:71`/`:73`/`:255`/`:94`。同时把 Important-I1 的取舍正式写进决策笔记（见下）。
- **验证方法**：`run.mjs:372` 已经能红（把 `prepend: true` 去掉会打 7 次）。文档改动的验证是"读完文档的人不会得出与代码相反的 mental model"——无法自动化，需人工过一遍 §G2。

---

# Important

## I1. 外层位置的代价从未被记录下来

- **位置**：`src/index.ts:333-345`
- **问题**：插件注册在 llm-retry **外层**，所以 `await next()` 拿到 `{kind:'retry'}` 时，llm-retry 已经：① 把 `llm/retry` 写进 durable log；② 睡完整个退避。否决只能阻止"效果"，不能阻止成本。
- **证据（DSH 源码）**：`packages/llm/llm-retry/src/index.ts:188-191`
  ```js
  agent.session.append('llm/retry', eventData)              // durable 提交在先
  if (!await cancellableDelay(delayMs, fusedSignal)) return  // 再等退避
  agent.session.append('llm/retry-started', { retryId, turn, step, retry })
  return { kind: 'retry' }
  ```
  `llm-retry/src/index.ts:59-64` `localDelay` 上限 `maxDelayMs`，默认 10_000ms（`packages/llm/llm/src/retry-policy.ts:16`）。
- **三项未记录的代价**：① 日志留下一条没有配对 `llm/retry-started` 的孤儿 `llm/retry`；② "终态"比必要时间晚最多 10s；③ `llmRetry` 投影的 `retry` 计数被抬高（`llm-retry/src/index.ts:220-223` 在 backoff 之前读计数、backoff 里 +1），同 step 内下一次失败时 `previousRetry >= maxRetries` 会让 llm-retry 直接 delegate——**这次否决顺带吃掉了一次 llm-retry 的重试额度**。
- **为何是实现层问题**：`index.ts:336-337` 的注释说"用户配的『最多真实调用多少次』是硬承诺"——次数上成立，时长、durable 日志和副作用上不成立。这正是 C4 文档矛盾的真实内容：文档的"内层"位置能避开这些代价但失去硬上限，实现选了硬上限并付了代价，**而这个取舍从没被写下来**。
- **最小修法**：若要真正硬截断，必须注册在 llm-retry 内层（`agent.ctx` + 无 prepend）在 `backoff()` 之前看到它的决定——但那会失去硬上限（`run.mjs:372` 会转红）。若接受"只截断效果"，把 `index.ts:336-337` 的注释改成实话并写明三项代价，同时落一条决策笔记。
- **验证方法**：组合测试断言"预算耗尽时 durable log 里 `llm/retry` 与 `llm/retry-started` 条数相等"——当前应不相等（孤儿记录）。

## I2. 退避承诺在 AUTH/QUOTA 路径上不存在，五处文案承诺相反

- **位置**：`src/config.ts:59`、`src/client/locales.ts:105/417`、`src/client/locales.ts:358`、`src/client/pipeline.ts:265`
- **问题**：`DEFAULT_RETRYABLE_CODES = [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]`（`packages/llm/llm/src/retry-policy.ts:18-24`）——**不含 AUTH/QUOTA**。llm-retry 对不在集合内的码 `return next()` 立即委派、零延迟（`packages/llm/llm-retry/src/index.ts:215-217`），插件随后自己 `return {kind:'retry'}`（`index.ts:361`），loop 立刻重跑 step 打下一个候选。
- **证据**：`switchOnSchema` 的 `auth`/`quota` 默认都是 `true`（`config.ts:80-81`）；`config.ts:59` 描述"这条渠道最多真实调用多少次（切换前会有一次退避等待）"；`locales.ts:105/417` `backoffHint`「由 DSH 的 llm-retry 与各渠道适配器的重试策略决定——切到下一个候选前的那次等待是它俩的事」；`locales.ts:358` `attemptLimitHint` "One backoff wait ... precedes each switch"；`pipeline.ts:265`「前序重试耗尽后自动切换至此候选」。
- **后果**：`switchOn.auth/quota` 打开时（默认就是开的），跨候选切换零退避。若熔断关闭（默认关闭）且链上多条死密钥，每个请求都全速走完死候选，直到 `maxTotalAttempts`。
- **为何是实现层问题**：行为本身可辩护（死密钥等 500ms 没意义，熔断会兜住后续请求），但**五处文案 + schema 描述 + Connector 标签都在陈述相反的事实**——本项目自己要消灭的那类谎言。
- **最小修法（推荐后者）**：把五处文案改成实话（"凭证/额度类失败不等待，直接切换"）；若产品上要退避，则补一个可配的切换延迟，默认 0。
- **验证方法**：组合测试用 AUTH 失败码驱动两候选 failover，断言两次 `assistant/attempt` 的 `time` 差 < 100ms（当前成立）；再核对五处文案是否与这个事实一致（人工）。

## I3. 健康延迟锚在 `request/header`，多步轮次与重试轮次无界膨胀

- **位置**：`src/health.ts:116-118`（`elapsedSince`）、`src/health.ts:174-229`（三个 case）
- **问题**：`state.lastStart` 只在 `request/header` 时更新，而稳态会话不出 header。
- **证据（DSH 源码）**：`packages/core/agent-loop/src/agent.ts:635-651`
  ```js
  if (!this.requestHeaderLogged) { ...append('request/header'...); this.requestHeaderLogged = true }
  else if (baseline === undefined || !headerEquals(baseline, header)) { ...append(..., reason:'change') }
  else if (startsSeries) { ...append(..., reason:'series') }
  ```
  `requestHeaderLogged` 置 true 后永不重置（`agent.ts:642`，全文仅 4 处引用：:111 声明、:584 读、:635 判、:642 置）。`startsSeries` 依赖 surface generation 变化（`agent.ts:632-633`），工具循环的 step 2..N 不满足。于是：
  - 工具循环的 step 2..N：`latencyMs` 含 step 1 模型时间 + 工具执行时间
  - 带 `llm/retry` 的 step：含退避等待（500ms–10s）
  - `throughputTps = outputTokens / latencyMs` 继承同一误差
- **正确范式（DSH 自己的）**：`packages/session/session-stats/src/projection.ts:133-149`——`openStep` 按 `(turn, step)` 键控，`:140`/`:147` 显式门控 `open.turn !== event.data.turn || open.step !== event.data.step`，文件头 `:15-19` 明写"model time is `step/start` → `assistant/message`, first token ... survives an in-step `llm/retry`"。
- **后果**：`health.ts:49` 的注释承认这是 whole-turn cost，但 UI 标成"延迟 140ms"与"吞吐 161.1t/s"，用户无法得知自己看的是哪个。常规单步无重试轮次是对的；出问题的恰是 agent 有意思的那些轮次，且 sparkline 混合了正确与膨胀的点。
- **最小修法**：仿 `session-stats`，把锚点从 `request/header` 改成 `step/start`，并用 `(turn, step)` 门控归属。
- **验证方法**：单测构造一个"两 step 同 turn、step/start 间隔 5s"的事件序列，断言 step 2 的 `latencyMs` 不含 step 1 的时间（当前会含）。

## I4. `surfaceActive()` 恒真 → Ctrl+S 被全局认领

- **位置**：`src/client/footer.ts:22-27`、`src/client/apply.ts:140-145`、`src/client/controller.ts:341`
- **问题**：`footer.ts` 挂载即 `retainSurface()` 直到卸载；侧栏按钮常驻 → `surfaceCount ≥ 1` 恒真 → `resolve` 只要插件激活就返回 `handled`。而 `regions: ['page','editable','terminal']` 覆盖输入框与终端。
- **证据**：`apply.ts:142-144` `resolve: () => (controller.surfaceActive() ? { status:'handled', run: () => { controller.save() } } : { status:'pass' })`；`save()` 内部 `if (saving || !scope.getSnapshot().writable) return`（`controller.ts:360`）只让它空转，**没阻止认领**。草稿在关弹窗后仍活着（`page.ts:170` 对弹窗传 no-op discard）——在聊天里按 Ctrl+S 会把路由配置存了。
- **为何是实现层问题**：门卫本意是"有本插件界面在前台才接键"，但常驻 launcher 也计数就恒真。footer 的 retain 对"弹窗开着"这一情形是**冗余**的——`page.ts:88-91` 在弹窗挂载时已独立 retain。
- **最小修法**：删除 `footer.ts:22-27` 的 retain/release（保留 `page.ts` 的）。
- **验证方法**：`client-controller.mjs` 断言"只挂载 footer 不挂弹窗时 `surfaceActive()` 为 false"（当前为 true）。

## I5. `routes.ts` 只有编码器没有解码器，且自己的 docstring 断言已为假

- **位置**：`src/routes.ts:10-11` 及全部调用方
- **问题**：文件头写「Everything here is pure and shared: `src/index.ts` (host) and `src/client/*` (browser half) import the same functions」，并自述后果"a drifted key silently splits one channel into two records"——而 `router/channel-health` 正是按 route key 存 `records`（`health.ts:178,189-201`）。
- **host 侧违规**：`src/probe.ts:194` 手拼 `${route.provider}/${route.model}`（同一特性 Pair 里的 `connectivity.ts:34,156` 却 import 了 `routeKeyOf`）；`src/lineage.ts:97-99` `routeOf()` 自己拼；`src/notice.ts:44-46` 局部 `label()` 复制 `routeLabel` 且从未调用；`src/index.ts:259,275,279,340,358,525,542` 日志与去重 key 手拼。
- **browser 侧违规 18 处**：`client/controller.ts:578,583,602,663,671,683,717`；`client/modals.ts:385,395,461,553`；`client/validate.ts:69,80`；`client/page.ts:61,66,234,376`；`client/workspace.ts:86`。`client/format.ts:14` 的 `routeOf()` 包了 `routeKeyOf` 却只被 `pipeline.ts:64,65,79` 与 `page.ts` 用；`controller.ts:12` import 了 `routeOf` 从未调用。
- **解码被手抄 9 处**：`index.ts:75-76`、`health.ts:73-76`、`controller.ts:570-571,706-707`、`modals.ts:410-413,511-512`、`workspace.ts:122-123,129-130,136-137`。
- **为何是实现层问题**：这不是风格问题，是模块存在的理由被自己的调用方否定。`routes.ts` 是一个只为消除第二真相而建的模块，它的 docstring 是一条可验证的断言，而现在这条断言为假。
- **最小修法**：`routes.ts` 补 `routeParts(key)`（含无斜杠 / model 含斜线的口径），host 3 处 + browser 18 处编码、9 处解码全部收编；`routeOf` 要么全用要么删。
- **验证方法**：加一条源级守卫——grep `src/` 里 `provider \+ '/'` 与 `indexOf('/')` 的出现次数应为 0（除 `routes.ts` 自身）。

## I6. 校验与默认值双源，且 `assertStructural` 有 8 个死分支

- **位置**：`src/config.ts:367-433` vs `src/client/validate.ts`
- **双源**：两文件各实现同一套规则，注释多处写"与 host 的 `assertStructural` 同步"（`validate.ts:33-34,76-77,95-96,100-102,146-147`）——同步靠人记，无机制保证。默认值三到四处定义：`maxAttempts`/`maxTotalAttempts`(6 与默认池 3)/`stickyTurns`/`prompt '1'`/`timeoutSeconds 8`/`cooldownSeconds 300`/`scope route`/`strategy order` 在 `config.ts`、`validate.ts`、`controller.ts:390-397`、`pipeline.ts:455`（`|| 6`）、`modals.ts`（6 处）各写一遍。`SWITCH_ON_CODES`（`validate.ts:18-29`）是 `config.ts:319-328` + `notice.ts:28-37` 的第三份。
  项目已为 route key（`routes.ts`）和时间线窗口（`timeline.ts`）建立共享纯模块模式，却没用在校验和默认值上。
- **死分支**（被 schema 保证永不为假；两条调用路径都过 schema：`index.ts:117` 读 Cordis 已校验值，`index.ts:126` 的 `Config(raw)` 自己跑一遍）：
  - `config.ts:389-392` `candidate.maxAttempts < 1` ← `config.ts:58` `.min(1)`
  - `config.ts:397-399` `profile.maxTotalAttempts < 1` ← `:94` `.min(1)`
  - `config.ts:400-402` `profile.stickyTurns < 0` ← `:96` `.min(0)`
  - `config.ts:404-406` `default.maxTotalAttempts < 1` ← `:107` `.min(1)`
  - `config.ts:407-409` `default.stickyTurns < 0` ← `:109` `.min(0)`
  - `config.ts:421-429` 两个 `intervalSeconds < 0` ← `:123`/`:138` `.min(0)`
  - `config.ts:430-432` `probe.timeoutSeconds < 1` ← `:146` `.min(2)`（guard 比 schema 还弱）
  - `config.ts:423`/`:430` 对恒存在字段（`.default({})` × 3）的可选链
- **为何是实现层问题**：违反项目自己的 Debug-First 军规（"Do not add silent fallbacks ... or defensive guardrails just to make code run"）。这些 guard 不防任何真实输入，只让函数看起来更严密，并在 schema 收紧时变成会误导人的谎言。
- **最小修法**：删掉上列 8 个数值 guard 和 2 个存在性判断，只保留跨字段校验（空 candidates、`candidates[0]` 未钉在 `when`、重复 id、重复 route、weight 策略无正权重、空白 break rule）；在 docstring 写明"本函数只做跨字段校验；单字段边界由 schema 拥有"。同时抽 `src/defaults.ts` 收编默认值与码清单。
- **验证方法**：逐条把 schema 的 `.min()` 临时改严，确认没有 guard 会"接住"它（应当由 schema 抛）。

## I7. 猜 DSH 的 CSS-module 类名，且守卫照过去 bug 的字面量写

- **位置**：`src/client/modals.ts:46`、`src/client/styles.ts:211-245`、`src/client/styles.ts:230`、`tests/client-controller.mjs:962-966`
- **问题 1**：`modals.ts:46` `body.closest('[class*="body"]')`；在飞改动把该 div 自己的 `maxHeight/overflowY` 删了，滚动完全交给这个猜测。DSH 改名 → `closest` 返 null → 回退到无 overflow 的 body → `scrollTo` 静默失效——正是这个 effect 要防的"点了添加没反应、以为控件死了"。`Modal.tsx:17,39,73` 提供了稳定的 `contentClassName` 钩子（JSDoc 写明"optional class for a scrollable content region"）却没用。
- **问题 2**：`styles.ts:211-245` `div[class*="dialog"].dsh-router-settings-modal` / `.dsh-router-settings-modal` 四重变体并列，`[class*="content"]`/`[class*="body"]` 同理——"列 4 个总有一个中"。项目自己的结论（`tools.md:85`）是"别猜 DSH 的 CSS-modules 类名——猜类名的失败模式是静默的"，并为 SettingsForm 底栏改成了结构兄弟选择器（`.dsh-router-form-body + div:has(button)`）；这里仍是猜的。
- **问题 3**：`styles.ts:230` 的 `max-height: calc(84vh - 70px)` 正是被禁的 `calc(100vh - 292px)` 同型，而守卫正则只匹配 `calc\(100vh[^)]*\)`（`client-controller.mjs:964`），`88vh`/`84vh` 全漏。**守卫照的是过去那条 bug 的字面量，不是不变量。**
- **最小修法**：`closest` 改用 `contentClassName`；`styles.ts` 的四个变体收敛成一个稳定钩子；把守卫改成"任何 vh 算术都不许进 workbench 内容链"（正则 `/calc\([^)]*vh|\d+vh/`，并排除 dialog 根节点的 modal 级尺寸）。
- **验证方法**：把 `Modal.tsx` 的 `css.body` 临时改名，确认 `modals.ts` 的滚动行为响亮失败而非静默失效（当前会静默）。

## I8. `--dsh-router-accent` 建了但没收编

- **位置**：`src/client/footer.ts:54,96`、`src/client/styles.ts:75,127,128,191,954,1214,1223,1224,1265,1464`、`src/client/modals.ts:301,557`
- **问题**：`tools.md:83` 明确记录 `--dsw-alias-brand-primary` 是品牌墨色（亮=近黑、暗=近白），"插件要自己的强调色就声明一个 `:root` 自定义属性，别借这个 token"。`styles.ts:13-15` 确实声明了 `--dsh-router-accent` 并在约 40 处使用，但上述 14 处仍借 `var(--dsw-alias-brand-primary, #4A65E8)`。
- **后果**：token 已定义 → `#4A65E8` 回退**永不生效**，实际取近黑/近白。插件 Logo（`footer.ts:54,96` 的 `ModelRouterIcon` color）在暗色主题下渲染成近白、亮色下近黑，与 design 意图相反且完全静默。另有约 20 处非派生 `rgba(74,101,232,x)` 手算着色，而 `format.ts:100-107` 的 `healthToneBadge` 已用 `color-mix(... var(--dsh-router-tone-*) ...)`——同一件事两种做法。
- **最小修法**：14 处全换 `--dsh-router-accent`，删掉永不生效的 `#4A65E8` 回退；`rgba(74,101,232,x)` 改 `color-mix(in srgb, var(--dsh-router-accent) X%, transparent)`。
- **验证方法**：源级守卫 grep `--dsw-alias-brand-primary` 在 `src/` 出现次数应为 0；浏览器双主题截图对比 Logo 颜色。

## I9. 在飞改动把字典键换成硬编码中文

- **位置**：`src/client/pipeline.ts:264-265`
- **问题**：`'顺延 #' + String(props.toIndex)`、`'前序重试耗尽后自动切换至此候选'`；git diff 显示原为 `t('failoverTag')` / `t('failoverNotice')`。
- **后果**：en locale 显示中文；`locales.ts` 的 `failoverTag`(zh:74/en:386)、`failoverNotice`(zh:73/en:385) 成孤立键；`var t = props.t`（`pipeline.ts:259`）变未用。违反"可见字符串全在 locales.ts"的自定公约。
- **最小修法**：恢复 `t('failoverTag')`/`t('failoverNotice')`，或新增字典键；勿在组件里写死文字。顺带统一 `:386` 与 `:420` 的 `key`/`toIndex` 口径（386 用 index，420 用 index+1）。
- **验证方法**：源级守卫——`src/client/*.ts` 里中文字符串字面量应为 0（除注释与 locales.ts）。

## I10. 能力预检的抛出被无分类 catch，五类原因压成一句

- **位置**：`src/index.ts:254-263` + `src/notice.ts:71-75`
- **问题**：catch 统一 `skipNotice(candidate)` = "不支持当前请求参数"。而 `resolveCallConfig` 的真实抛出面有五类：
  - `NO_ADAPTER`（`packages/llm/llm/src/index.ts:995`，provider 未注册=环境漂移，`warnUnregisteredProviders` 已在加载时警告过）
  - `UNSUPPORTED_REASONING_EFFORT`（`llm/src/index.ts:897`，**这才是真正的"这条路服务不了这个请求"**）
  - `INVALID_MODEL_INFO`（`:766`）、`INVALID_MODEL_CONTEXT`（`:773`，adapter 契约违规=bug）
  - `INVALID_CONFIG`（`packages/llm/llm-pi-ai/src/adapter.ts:268`，provider profile 配错）、`UNKNOWN_MODEL`（`:271`，模型不在 catalog）
- **后果**：一个 provider profile 配错会让用户看到"这条候选不支持当前请求参数"——指错了修的地方。且这条 notice 是 durable user message 且进模型上下文，错了就一直在历史里。
- **为何是实现层问题**：DSH 的错误码契约明确要求按码路由（`connectivity.ts:11-13` 自己引了 `packages/llm/llm/src/error.ts` 的 "route on this, never by parsing `message`"）。同一个插件在 `probe.ts:74-78` 和 `connectivity.ts:80-83` 都为另外两条路径建了封闭的码集并分类，唯独主路径是全兜。
- **最小修法**：把 `NEVER_CALLED_CODES` 式的封闭集合搬到主路径：`UNSUPPORTED_REASONING_EFFORT`/`UNKNOWN_MODEL` → `skipped` + 现有 notice；`NO_ADAPTER`/`INVALID_CONFIG`/`INVALID_MODEL_INFO`/`INVALID_MODEL_CONTEXT` → 单独一类 notice（"候选 X 当前不可用（原因码）"）或 `ctx.logger.error` 后重抛，不让它伪装成能力不符。
- **验证方法**：`tests/run.mjs` 已有 `prevalidation-skip`（:180，stub 声明 reasoning efforts 触发 `UNSUPPORTED_REASONING_EFFORT`）。新增场景让 stub 抛 `INVALID_CONFIG`，断言 notice 文案区分于能力不符（当前相同）。

## I11. 图片能力有两个真相源，且取舍未记录

- **位置**：`src/index.ts:255`（`resolveCallConfig`）+ `src/router.ts:223-232`（`needs.images`）
- **问题**：`resolveCallConfig` 的返回是 `(await this.resolveCallFor(...)).config`，**只返回 `LlmCallConfig`，`modelInfo`（含 `inputModalities`）被丢弃**（`packages/llm/llm/src/index.ts:871-873`）。公开的 `resolveModelInfo(provider, model, signal)`（`llm/src/index.ts:733-739`）才返回 `LlmResolvedModelInfo`，其类型有 `readonly inputModalities?: readonly ModelModality[]`（`packages/llm/llm/src/types.ts:326`）。
  于是"这条路能不能收图"有两个真相：adapter 的 `inputModalities` 和用户填的 `needs.images`，二者没有任何同步机制，用户填错就静默走错路。`router.ts:174-177` 的注释说 `hasImageContent` "mirroring the llm layer's own text-model projection rule"——它镜像的是**投影规则**（`llm/src/index.ts:1078-1082`），不是**能力声明**。
- **为何只是 Important 而非直接改**：原生读法在该 adapter 上有自己的失败模式——`packages/llm/llm-deepseek/src/model-info.ts:70-74` 明写"An uncatalogued endpoint is safely treated as text-only. Declaring an unverified image capability would let the host persist input that the endpoint may reject on every later turn"，未进 catalog 的图模型会被误判为收不了图。所以插件用配置侧 `needs.images` **可能是有意的正确选择**，但这个取舍从没被写下来。
- **最小修法**：不必改实现；在 `router.ts:223-232` 或 `config.ts:62-65` 写明这条取舍（为何不用 `inputModalities`：未 catalog 端点被安全地当 text-only，会把图模型误判），并说明"能力"与"路由策略"是两层、由用户分别声明。
- **验证方法**：核实 `llm-pi-ai` 的 `modelInfo` 是否也走 text-only 兜底；若是，则结论成立。

---

# Minor

| # | 问题 | 位置 |
|---|---|---|
| M1 | `assertNoAlwaysPolicy` 盲区：加载后才注册的 provider 配 `always` 静默不生效，而 `index.ts:513-515` 声称"未注册的漂移由 `warnUnregisteredProviders` 处理"是 non-sequitur（warning 路径不覆盖 always 的后果）。**可达性未确认**（DSH provider 由 adapter 插件加载时注册，Models 页加渠道是配已有 provider） | `index.ts:517-534` |
| M2 | 死代码/死导入/死字段：`notice.ts:44-46` `label()` 复制 `routeLabel` 从未调用；`connectivity.ts:155-157` `connectivityKey()` 全树无调用方；`index.ts:97,460` `probeTimer` 只写不读；`index.ts:45` `emptyConditions` import 未用；`router.ts:204-206` `conditionsMet` 无生产调用方（仅 `unit.mjs:95-99` 测它）；`controller.ts:12` `routeOf` import 未用 | 多处 |
| M3 | 同一个 failure 事实两个写入方：`index.ts:171-172`（session/event → assistant/attempt）与 `:330`（agent/request-error）写同一 `failures` WeakMap 同一 key。`agent.ts:507-521` 显示 `assistant/attempt` 的 settle 在 `agent/request-error` 分发之前且取同一 `finish.failure.code`，值必然相同。保留 event 那条即可（它覆盖插件不接管的 step） | `index.ts` |
| M4 | `checkConnectivity` Remote 无取消缝（`index.ts:432-442` 签名无 signal，`Promise.all` 不传），而同文件 `probeAll` 有完整 signal 融合；`connectivity.ts:138` 的 `discoverModels` 是接受 signal 的（`llm/src/index.ts:589-593`）。两条 Remote 取消契约不一致。零 token 故影响小 | `index.ts` |
| M5 | `emptyResponse` 默认不切换（`config.ts:74`），但它在 llm-retry 默认重试集里——先烧 5 次同路由重试（`retry-policy.ts:14` `DEFAULT_MAX_RETRIES = 5`）再由插件终态。这是默认配置下唯一会命中的碰撞点（RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT 插件默认都切换），`router.ts:123-127` 描述了一般机制但没点名 | `config.ts:74` |
| M6 | `health-ui.ts:24,28,71` 手写 24，绕过已建立的 `MAX_TIMELINE_POINTS`（`timeline.ts:11`；`controller.ts:14,187` 正确导入）；`locales.ts` 的 `channelTableTimeline` 也写死 24 | `health-ui.ts` |
| M7 | `reorderCandidates`（`controller.ts:428`，splice-move）与 `moveCandidate`（`:437`，相邻交换）两套重排并存，±1 移动两者完全等价。`pipeline.ts:137,146` 仍调 `onMove`，`:308-309` 调 `onReorder`，`apply.ts:155-156` 两个都接 | `controller.ts` |
| M8 | 陈旧注释描述已删除的载体：`controller.ts:74-76,336`「插件页与侧栏弹窗可以同时挂着」、`footer.ts:22-23`「与插件页那一面共同决定」。page 注册已在 2026-10-16 删除（`apply.ts` 只注册 `sidebar.footer.action`）。`surfaceCount` 计数的理由没了 | `controller.ts`/`footer.ts` |
| M9 | `controller.ts:475,482,486` 绕过 `profileOf` 守卫，id 不匹配时抛 TypeError；同文件 `:490-494` 的 `setStrategy` 用 `profileOf` 抛清晰错误——两种错误口径 | `controller.ts` |
| M10 | `controller.ts:593-598` 的 catch 是防御性死代码（`runCheck` 永不 reject，`:273` 已挂 `cannotCheck` 作为 reject 分支），且 catch 里不写任何用户可见原因，`ui.checkSummary` 停在 null——"点了什么都没发生" | `controller.ts` |
| M11 | `discoverTimer` 被在飞异步复活：`dispose()`（`:739-742`）清 timer 并把 `armedSeconds` 置 -1，但 unmount 时仍在飞的 `checkAll`/`probeAll`/`loadPassive` 的 `.then` 会 `publish()`→`armDiscoverTimer()`，因 `armedSeconds = -1` 使守卫放行而**重新武装 interval**，违背 dispose 契约。窗口窄（需在途时卸载） | `controller.ts` |
| M12 | `format.ts:9-11` `deepEqual` 用 `JSON.stringify(a) === JSON.stringify(b)`，对键序敏感；`controller.ts:416` 的 `Object.assign({maxAttempts:1}, entry)` 产生的键序（maxAttempts,provider,…）与 host 读回（provider,model,maxAttempts）不同，语义相同的一处编辑可能被算成 dirty | `format.ts`/`controller.ts` |
| M13 | `modals.ts:559-563` `AddCandidateModal` 的 `setSelected` 非更新器形式，同 tick 两次勾选互相覆盖——同文件 `:67-71` 注释明确警告过此反模式，此处不一致 | `modals.ts` |
| M14 | `locales.ts:188,494` `saveShortcutKey:'⌘S'` 硬编码，仅 macOS 桌面正确；Win/Linux 桌面是 Ctrl+S、Web 是 Ctrl/Cmd+Shift+Comma（`apply.ts:136-138`）。提示与实际绑定矛盾。应按平台/运行时取 presentBinding | `locales.ts`/`footer.ts` |
| M15 | 重复与死代码：死样式键 9 个无 `S.x` 引用（`healthTierSubHint`、`discardBtn`、`addProfileBtn`、`tabBar`、`saveBtnSuccess`、`dotHealthy/Degraded/Unhealthy/Unknown`）；`configuredRouteList` 在 `controller.ts:21` 与 `page.ts:16` 重复定义；会话读取逻辑（list→sort→slice(-20)→Promise.all projections）在 `controller.ts:209-229` 与 `:523-542` 重复 | `styles.ts`/`controller.ts`/`page.ts` |
| M16 | `AGENTS.md:14,47` 写"8 个真实 Loader 组合测试 / 8/8"，实际 `tests/run.mjs` 有 18 个 scenario（:61,74,95,136,149,168,180,200,225,248,274,285,312,343,362,372,394,419） | `AGENTS.md` |
| M17 | 零碎：`probe.ts:175-186` 私有 `TimeoutError` 复刻原生 `TimeoutReason` 且 `timeoutOf` 从未被调用；`health.ts:117` 的 `Math.max(1,…)` 1ms 地板；`controller.ts:180-185` 时间线合并去重键 `time:status` 粗于点身份（同 ms 同 status 的不同观测会合并）；`connectivity.ts` 无取消路径；`lineage.ts` 的 settle 缺 step 门控（待核实） | 多处 |
| M18 | 语义色系统被借去表达"启用/未保存/失败"：`chain.ts:53-55` 用 `healthToneBadge('healthy')` 表示 default pool 启用；`footer.ts:59-61` 用 healthy/degraded/unhealthy 表示 运行中/有未存修改/保存失败。视觉成立，但把"渠道健康"三音色当通用三态色板用，下一个读者会以为徽标在说渠道的事 | `chain.ts`/`footer.ts` |
| M19 | `validate.ts:8-15` `BREAKER_CODE_PRESETS.desc` 是中文，经 `modals.ts:303` `title: preset.desc` 渲染为 chip tooltip，en 下显中文（tooltip，可见度低，非在飞） | `validate.ts` |
| M20 | `styles.ts:1259-1260` drawer `zIndex` 1100/1101 硬编码，恰好高于 DSH Modal 的 1000（`Modal.module.css:10`），但是任意值，随上游 z-index 变动而失效 | `styles.ts` |
| M21 | `modals.ts:346` `SegmentedControl` 读 `props.disabled`，而 `HealthSettingsModal` 从未被传该 prop（`page.ts:362-370`）。当前无害（按钮已 gate writable），但是读未传 prop 的潜在不一致 | `modals.ts` |
| M22 | `client/*.ts` 全篇 `var`/`function`，宿主用 `const`/箭头函数——同一个 tsconfig 下两种方言，跨 half 移动代码易错 | `src/client/` |

# Nit

| # | 问题 | 位置 |
|---|---|---|
| N1 | `router.ts:49` `return weights.length - 1`：数学上不可达（`draw = Math.random()*total ∈ [0,total)`，逐项减完必然 `< 0`），但是浮点边界的兜底，保留合理——只是该注释说明 | `router.ts` |
| N2 | `index.ts:483-485` `conditionSkipKey` 用 `:` 和 `|` 分隔；model id 含这两个字符时会碰撞（`health.ts:69-72` 自己承认 model id 可含 `/`） | `index.ts` |
| N3 | `index.ts:161-173` `session/event` 监听不过滤 session 归属，外部 session 的失败也写进 `failures` WeakMap（随 session GC，无泄漏，但属无谓写入） | `index.ts` |
| N4 | `pipeline.ts:61,78` 渲染层直接拼 emoji 前缀（`'👑 '`、`'⚙️ ● '`），其余用 `Icon` 组件——项目踩过"字典/渲染双加号"的坑（`memory.md` 记录两次） | `pipeline.ts` |
| N5 | `pipeline.ts:55` `rankBadge` 两种模式编号基准不同（profile 从 1、default 从 0），有意但是语义褶皱；CandidateNode 的 `expanded` 态按 key（位置）持有，拖拽重排后开合态"跟着槽位不跟着候选" | `pipeline.ts` |
| N6 | `controller.ts:133` `MIN_BUSY_MS = 450` 有实测依据（2ms/7ms 被 React 批进同帧，见 `holdBusy` 注释），可接受，但注释里的量测证据必须一直留着 | `controller.ts` |
| N7 | `unit.mjs:204` 权重抽样用真 `Math.random()` 400 次：统计上稳（0.7^400≈0），但引入非确定性，可注入随机源 | `unit.mjs` |
| N8 | `config.ts:413` weight 策略校验的错误信息不点名是哪个 profile（`model-router: profile uses the weight strategy but no candidate has a positive weight`） | `config.ts` |

---

# 待核实（缺证据，勿当结论）

1. **`probe.ts:104-116` 手搓 deadline vs DSH 原生 `deadline()`**：`packages/session/session-title-llm/src/index.ts:250` 用 `using callDeadline = deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE)`。手搓的理由是"`using` is syntax the source-mode loader cannot parse"（`probe.ts:105-106`）。**待核实**：`deadline()` 返回的对象是否必须配 `using` 才能释放。若是，则手搓有理，应把这条写进注释；若不是，应换原生。
2. **`system-prompt` 投影的 node 0 替换规则是否被插件 notice 干扰**：`index.ts:271,276,280` 的 notice 在 `agent/request` 内 append，时序上早于 loop 自己的 `system/message` 提交（`agent.ts:410` vs `:422-424`）。需读 `packages/core/system-prompt/src/index.ts` 的投影实现，确认 `compaction-basic/README.md:113` 描述的"node 0 文本不同则替换"是否会被干扰。
3. **`styles.ts:230` 的 `calc(84vh - 70px)` 中 70px 是否等于 DSH Modal 实际头高**（未读 `Modal.module.css` 头部高度）。
4. **`[hash]_[local]` CSS-module 命名约定是否由 DSH 构建配置保证**（据代码注释 + `Modal.tsx` 观察到的 `css.dialog`/`body`/`content` 用法推断，未读构建配置）。决定 I7 问题 2 的修法方向。
5. **`llm-pi-ai` 的 `modelInfo` 是否也走 text-only 兜底**（决定 I11 的结论是否成立）。
6. **M1 的可达性**：DSH 中是否存在"插件加载后才注册 provider"的路径。
7. **`lineage.ts` 的 settle 缺 step 门控**：`assistant/message` 只按 `last.turn !== state.turn` 过滤，未按 step。同 turn 跨 step 的成功是否会结算一个旧 entry——需构造事件序列验证。
8. **`unit.mjs:1122` 引 `llm-deepseek-api-key/src/index.ts:30`**：主代理已核实该文件 `:30-34` 正是 `throw new LlmError(..., 'MISSING_CREDENTIAL')`，`:30` 是 throw 语句起始行、`:33` 是码字面量——**引用正确，无漂移**。（审查员曾报"实为 :33"，复核后驳回。）

---

# 已确认无误（对比基准，勿重复审查）

以下均经主代理逐条回 DSH 源码核实，是实现确实优雅的原生能力用法：

1. `agent/request` + `prepend: true` 装在 `agent.ctx`：压在 `installModelSelection`（`packages/core/agent/src/model-selection.ts:96-112`，无 prepend → push）外层，post-`next()` 覆盖生效；注册在 `agent/created` 内、随 agent scope 销毁，无泄漏。与 `index.ts:7-10` 注释一致。
2. `internal/config` waterfall + `this !== ctx.fiber` 守卫（`index.ts:123-137`）与 `packages/llm/llm-pi-ai/src/index.ts:172-181` 逐字同构。
3. `ctx.get('sessionProjections')` / `ctx.get('settings')` 走可选服务规则，未为它们加 `inject`——符合 `packages/AGENTS.md` 的 ctx.get 规则，缺注册时优雅降级。
4. `ctx.llm.resolveCallConfig` 与 loop 的 `prepareCall` 走同一 `resolveCallWithInfo`（`llm/src/index.ts:948` vs `:872→881`），预检语义与真实分发一致，没有第二套校验。
5. `providerRetryPolicy` / `listProviders` 的用法与签名一致（`llm/src/index.ts:471,656`），未注册 provider 有 `registered.has()` 守卫，不会触发 `:995` 的 `NO_ADAPTER` 抛出。
6. `sessionProjections.snapshot(session, ['contextPressure'])` 用原生 keys 过滤（`packages/session/session-projection/src/index.ts:339-353`），只把一个单元过 `viewSchema.parse`；`projectedTokens` 取 canonical 值（`packages/llm/token-meter/src/usage-projection.ts:208-216`），未自行复算。
7. notice 用 `createUserMessage` + `boundContextSummary` + `MessageSourceMap` 模块扩展，与 `model-selection.ts:15-19,47-61` 同构——复用了 DSH 自己的 notice 形状，没有自造消息类型。
8. 探针走 `prepareCall` 返回的一次性 stream 句柄并 spread `call.config`，遵 `PreparedLlmCall` 契约（`llm/src/index.ts:972-989` 的 `INVALID_PREPARED_CALL` 两道检查），引用的先例（`session-title-llm/src/index.ts:250-278`）准确。
9. 两个投影单元都遵投影契约：同步纯 `apply`、plain JSON state、`wire.view` 返回 state 内持有的引用（`lineage.ts:159-163`、`health.ts:235-238`），未变状态不发布；`stateVersion` 升级处理旧行（`health.ts:167-169`）。
10. `probeInFlight` 守卫 + `ctx.effect` 清理 timer 并 abort 飞行中探测（`index.ts:461-470`）：注释里声明的两个不变量都真的实现了，没有未 abort 的定时器或监听。
11. 全部插件状态住在 WeakMap（`state.ts:106-117`、`index.ts:91`），随 agent/session 消亡；`CircuitBreaker` 用 Map + `sweep`（`breaker.ts:107-114`）而不是无界增长。无 WeakMap 泄漏、无跨 agent 共享可变状态。
12. `inject` 正确规避了"顶层声明本包才提供的 `remote.routerHealth`"致死锁（只在 `$mount` 后 child inject，同 `packages/experimental/client-ui-cot-translation/src/client/mount.ts:125-127` 范式）。
13. `useModalLayer` Tab 圈禁的 `hidden`+`inert` 双属性（`page.ts:127-128`）匹配 `packages/client/ui-primitives/src/useModalLayer.ts:73-81` 的 `button:not(:disabled)` 减 `[inert],[hidden]` 规则。
14. footer 几何契约：`styles.ts:48-52` `wide:only-child` 的 `calc(100%+4px);margin:4px -2px` = `ui-settings-general/.../SettingsRoot.module.css:7-8`；`sidebarActionWide` h42/pad0 10 0 8/font14/22 = `.trigger`(:16-36)；rail 36x36+margin 8px 0 10px = `.trigger.rail`+`railRow`(:11-14,44-52)；ownerProps 仅 `wide`（`ui-sidebar/src/client/SidebarRoot.tsx:307`）。
15. shortcuts `isWebBindingAllowed`：`apply.ts:136-138` Web 用 Comma+primary+shift，命中 `packages/client/shortcuts/src/binding.ts:107-111` 的 Linux 三组白名单，且满足 Win/macOS 的 primary+shift 两键（:104-105）。
16. 全部引用的 design token 真实存在于 `design-platform.css`（`--dsw-static-{green,amber,red}-{900,400}`、`--dsw-alias-state-{error,warn}-primary`、`interactive-bg-{hover,active}`、`radius-*`、`border-l2/l3/l4`、`bg-layer-1/2/3`、`settings-card-{fill,stroke}`、`focus-ring-width`、`ds-font-family-code`、`body[data-ds-dark-theme]`）。`format.ts:92-96` 断言"暗色 `state-error-primary` == `state-error-secondary`"经 `design-platform.css:368-369` 核实为真。
17. `scope.mutate` 拒绝路径已收尾（`controller.ts:376-380`，saving 复位）；subscribe 重投影有 `deepEqual(next,host)` 守卫（`:288-289`）非无条件；host/draft 两个独立 `seed()`（`:38-39`）+ `draft = clone(next)`（`:295`）基准不共享。
18. `NEVER_CALLED_CODES`（`probe.ts:74-78`）三码在 `classifyHealth`（`health.ts:93-103`）确为 `default → undefined`，声称属实；`NEVER_DISCOVERED_CODES`（`connectivity.ts:80-83`）两码不进会话流，集合内部一致。`splitRoute`（`health.ts:73-76`）首 `/` 切分对真实数据（provider 不含 `/`）往返精确。
19. `tests/run.mjs:497-501` 用 `spawnSync(node lib/bin.js --profile headless --patch ...)` 真 boot，读 durable 日志断言——是真实 Cordis Loader composition，不是手造 Context。
20. **测试整体不是硬凑**：`unit.mjs:696-723` 的 `throughput=200` 由夹具算（100tok/500ms）非读实现；`unit.mjs:725-742` 有显式反同义反复守卫（错误形状须得 undefined）；断言普遍是 deepEqual/精确字符串/精确计数；stub adapter 的 throw 形状与真实 `adapterStream` 一致——**但 abort 形状不一致，见 C1**。

---

# 附：审查方法与边界

- 四路并行只读审查，每路独立核对 DSH 源码锚点；主代理对全部 Critical/Important 逐条回源码复核。
- 主代理实跑：`unit.mjs` 99 passed、`client-controller.mjs` 37 passed。**未实跑** `run.mjs`（需构建产物 + boot headless）与 `remote.mjs`（需真实 profile）；**未做** revert-变红实验——所有"会红"均为源码级 trace，执行确认需一次实跑。
- DSH checkout 全程只读，`git status --porcelain` 0 行。
- 审查时工作树有未提交改动（拖拽重排 `onReorder` + UI 调整，10 个文件 +767/-293），已在审查范围内。

---

# 执行级复核结论（2026-10-17 后续会话）

处置档位与证据。所有探针留在 `packages/dsh-model-router/tests/_verify-*.mjs`，
清单与预期见同目录 `_verify-README.md`；宿主源码两次临时改动均已还原并重建，
基线回到 unit 99 / client-controller 37 / run.mjs 18 场景 0 失败，DSH checkout 0 行。

| # | 处置 | 一句话证据 |
|---|---|---|
| C1 | **证实**（比原文更糟） | 照 DSH 自家规格（`llm-pi-ai/tests/adapter.spec.ts:1052-1067`：pre-abort 时 adapter **yield** aborted finish）驱动 `probeRoute`，实得 `unavailable/empty stream`；把 `unit.mjs:1056-1061` 的 `neverEnding` 改成真实形状后 **两条** 用例转红（`:1098` 与原文没点名的 `:1173`） |
| C2 | **证实（bug）；「最小修法」被实测否定，根因修法已实测通过** | 组合层真 boot：`failedAttempts`=4（配置承诺 3），health fold 显示末位候选吸收 2 次，`request/header` 只 3 条、notice 只 2 条 → 用户完全看不见。按原文修法（加 `servable` + 落回用户原路由）实测：变成 `{"stub-primary":2,...}`，**仍是 4 次**，多打的那次被搬到用户原路由。**根因**：可服务性判断藏在 `planFire` 的"顺带前进"里，只在发火当时算一次，而第一个能阻止这次发火的决策点 `decideRecovery` 在下一次失败后才跑。**根因修法已实测通过**：提独立谓词 `canFireAgain(state)`，在 `decideRecovery` 授权下一次发火之前判它 → 3 次调用、每候选恰好一次、三套件全绿（详见 `open-questions.md` 第五节第 1 项） |
| C3 | **证实** | 自建会跑 effect 的 React stub + 照 `SettingsForm.tsx:50-73` 复刻的 `SettingsForm`；scope 首帧 `status:'loading'` → `available:false` → children 不进树 → `formBodyRef.current` 为 null → 实抛 tripwire。对照组不抛 |
| C4 | **证实** | 删掉 `agent/request-error` 的 `{prepend:true}` 重建，`run.mjs:372` → `expected 2, got 7`；还原后 18/0。文档陈旧处是 **6 处**（原文漏 `:90`） |
| I1 | **部分证实** | ① **证伪**：`llm/retry` 与 `llm/retry-started` 实测 2=2 成对（否决发生在两条都提交之后）；真实不一致是反的——有 `llm/retry-started` 无重试。② **证实**：否决场景 boot 5324ms vs 对照组 3358ms，`llm/retry` 带 `delayMs:3000` 已提交。③ 机制真但**后果为零**：否决条件与 `decideRecovery` terminal 逐字相同，且 `llmRetry` 在 `step/start`/`turn/end` 清零 |
| I2 | **证实** | 同形状对照（3000ms 退避 stub）：AUTH 切换 boot 2576ms / 0 条 `llm/retry`；RATE_LIMIT 切换 5579ms / 1 条。文案承诺处是 **6 处**（原文漏 `locales.ts:46`） |
| I3 | **证实** | 「两 step 同 turn + 一次 llm/retry」序列：step 2 实得 `latencyMs=4400`（真值 500）、`throughputTps=22.7`（真值 200.0）→ 8.8× 虚高 |
| I4 | **证实** | 驱动 stub ctx 捕获的 `model-router.save`：未挂面 `resolve()→pass`；执行 `retainSurface()`（`footer.ts:24-27` 挂载做的事）后 `resolve()→handled` |
| I5 | **证实（事实层）；后果层是假设** | grep 实测 24 处编码 + 9 处解码，`routes.ts:10-11` 断言为假。但 24 处格式一致，**今天没有实际漂移**，"silently splits one channel into two records" 是假设不是事实。host 侧是 8 处不是 7（漏 `index.ts:484`） |
| I6 | **证实** | 对 8 个 guard 各造"只违反该条件"的 config：过 `Config()` **8/8 被 schema 拒**，绕过 schema 直调 `assertStructural` **8/8 会抛**。附加：`timeoutSeconds` guard（`<1`）比 schema（`.min(2)`）还弱 |
| I7 | **证实**（修法方向要改） | 守卫正则实测 `calc(100vh...)` 匹配 `[]`，而 styles.ts 里有 `88vh`/`84vh`/`calc(84vh`。`contentClassName` 落在 `Modal.tsx:73` 的 `css.content` 而非滚动容器 `css.body`（`:83`），且 `headless:true` 时整块不渲染 |
| I8 | **证实** | `--dsw-alias-brand-primary` 在 `src/` 正好 14 处，与原文逐行相同；`styles.ts:13-15` 确认 `:root` 令牌已定义 → `#4A65E8` 回退永不生效 |
| I9 | **证实** | `git diff` 实证原码是 `t('failoverTag')`/`t('failoverNotice')`；两键在 `src/client/*.ts` 调用点 0，四键成孤立 |
| I10 | **证实（源码层）；行为层缺证据** | 五类抛出点逐个回 DSH 核对全部正确。但现有 stub 只会抛 `UNSUPPORTED_REASONING_EFFORT`，构造不出 `INVALID_CONFIG` 等码，"指错了修的地方"跑不出来 |
| I11 | **证实（文档缺口）；待核实 #5 已答** | `llm-pi-ai/src/config.ts:140-150`：`defaultInput` 在 entry 与 catalog 都没声明时默认 `[text]`——pi-ai 也走 text-only，但**可由用户在 provider 级声明 `[text,image]` 覆盖**，deepseek 的是硬编码 |
| M2/M3/M4/M5/M6/M7/M9/M10/M14/M15/M16/M20 | **证实（源码级）** | 死代码/重复/魔数无可演示的错误行为，行号与引用逐条核对无误（M16：`run.mjs` 实有 18 场景） |
| 待核实 1 | **已答：手搓有理，注释说轻了** | `timeout/src/index.ts:119`：`deadline()` 的清理**只有** `[Symbol.dispose](){clearTimeout(id)}`，没有 `using` 就没人清定时器 |
| 待核实 2 | **证伪** | `SystemPromptProjection.systemNodes()`（`runtime-context.ts:69-80`）只收 `system/message`，插件 notice 是 `user/message` 进不去；head 是第一个幸存的**系统**节点不是 surface 索引 0；插件只用 `surfaceOp:'append'`，而唯一看 node 0 的守卫（`surface.ts:501-506`）只对 replace 生效 |
| 待核实 3 | **已答：70px 不是头高** | `Modal.module.css:71-77`：22+28+12 = **62px**；且两个弹窗的 `footer` prop 与 `.dialog` 的 `gap:20px` 完全没被 70px 考虑 |
| 待核实 4 | **已确认（有源码依据）** | `packages/client/tsdown.client.ts:562`：`cssModules: { pattern: '[hash]_[local]' }` |
| 待核实 6 | **已答：可达** | `providerRetryPolicy` 对未注册 provider 抛（`llm/src/index.ts:656→995`）故守卫必要；provider 确可在加载后注册（`registerAdapter`/`registerConfigurableProviders` 是公共服务方法，llm-pi-ai 在自己配置保存时重注册）。**但未实测**"保存 llm-pi-ai 配置加 provider 并设 always"这一步 |
| 待核实 7 | **证实** | turn 1 step 1 记下 a→b 未结算 entry 且 b 也失败；step 2 同 turn 在 **c** 成功 → entry `settled:true`。账本声称"切到 b 成功"而 b 从未应答 |
| 待核实 8 | **引用正确，无漂移** | `llm-deepseek-api-key/src/index.ts:30` 是 `throw new LlmError(` 起始行，`:33` 才是码字面量 |

**审查员引用的全部 DSH 与项目行号逐个核对，没有发现一处引用错误**；只发现三处漏数
（`locales.ts:46`、`index.ts:484`、`capability-boundary.md:90`）与两处修法方向要改
（C2、I7 问题 1）。
