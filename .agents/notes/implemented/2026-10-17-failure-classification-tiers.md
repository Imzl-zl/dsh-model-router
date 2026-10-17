# Agent Note: 失败分类收口——aborted finish 按"谁按的"判，预检抛出按"谁能修"分三档

Status: implemented

## Problem

两条路径各犯同一个错：**只按自己方便的形状分类，另一类整类漏掉**。

1. **C1（探针）**：`probe.ts` 的 finish 分支只认 `reason.kind === 'error'`。真实适配器在
   abort 时是 **yield** 一个 `kind:'aborted'` 的 finish（`adapterStream` 捕获适配器的抛出
   转成终态 chunk，`llm/src/index.ts:1111-1114,1161-1169`），于是超时路径整类落到
   `unavailable(route, now, 'empty stream')`——挂起的端点被报成"没能测"，而
   `types.ts:30-34` 划的红线是 `unavailable` = "the check could not run at all"。
   **测试是假绿的**：`unit.mjs` 的 `neverEnding` fake 在 abort 时 **reject**（抛出），走的
   是 catch 分支；照 DSH 自家规格（`llm-pi-ai/tests/adapter.spec.ts:1052-1067`：pre-abort
   时 adapter yield aborted finish）把 fake 改成真实形状后，两条用例当场转红。
2. **I10（主路径预检）**：`index.ts:254-263` 的 catch 是一句全兜
   "候选 X 不支持当前请求参数"。而 `resolveCallConfig` 的抛出至少有六种可区分的东西
   （`llm/src/index.ts:995` 的 `NO_ADAPTER`、`llm-pi-ai/src/adapter.ts:268,271` 的
   `INVALID_CONFIG`/`UNKNOWN_MODEL`、`normalizeModelInfo` 一家四个
   `INVALID_MODEL_*`、`:897` 的 `UNSUPPORTED_REASONING_EFFORT`），用户该去的地方完全不同：
   改请求、去 Models 页、还是找适配器的上游。这条 notice 是 durable user message 且进模型
   上下文——指错了就一直在会话历史里。

## Decision

1. **finish 分支放开到 `kind === 'error' || kind === 'aborted'`，分类顺序与 catch 分支
   逐字一致**：探针自己的 deadline（`controller.signal.reason instanceof TimeoutError`）
   → `unreachable` + `TIMEOUT`；调用方取消（`signal?.aborted`）→ `unavailable` +
   `cancelled`；码是 `ABORTED` → `cancelled`；`NEVER_CALLED_CODES` → `unavailable` + 码；
   其余 → `unreachable` + 码。**一条事实不因从适配器的哪一侧到达而得到不同分类**——这正是
   C1 的病灶，所以 catch 与 finish 两条路用同一个次序，而不是各写各的。
2. **fake 照真实组件形状重建**：`neverEnding` 在 abort 时 yield aborted finish。DSH 自家
   规格 `llm-pi-ai/tests/adapter.spec.ts:1052-1067` 是权威；fake 照实现建（照本插件的
   reader 建）就等于让测试保护不到生产路径。
3. **预检抛出按"谁能修"分三档，落在新的纯模块 `src/precheck.ts`**：
   `request-shape`（`UNSUPPORTED_REASONING_EFFORT`，保留现有文案）/
   `route-missing`（`NO_ADAPTER`/`INVALID_CONFIG`/`UNKNOWN_MODEL`，文案指向「模型」页）/
   `adapter-defect`（`normalizeModelInfo` 一家四个码，`ctx.logger.error` + 明说"这是适配器
   缺陷"的 notice）。认不出的码保留原通用文案——插件不知道谁能修它，编一档就是换一种
   说法的谎。**不 rethrow**：一个坏 adapter 掀掉整条链与插件目的相反，`logger.error` +
   durable notice 已经响，不构成静默兜底。

## Alternatives considered

1. aborted finish 按码分（`ABORTED` → cancelled，其余 unreachable）
   - 最强的理由：不用看 signal，finish 分支与 catch 分支的"按码"部分完全同构，读起来短。
   - 为何被否：码是适配器自己规范化出来的（llm-deepseek 把 abort 映射成 `ABORTED`，别的
     适配器可能给别的码），探针自己的超时不保证带一个可识别的码。超时是**渠道事实**，
     把它建成"依赖适配器的映射"就等于把分类的正确性外包给适配器；而"谁按的"是探针自己
     确切知道的（deadline 是不是自己武装的那个 timer）。
2. 档三（适配器违约）rethrow，让整条链响亮失败
   - 最强的理由：最响；一个返回无效元数据的适配器本来就不该被继续用。
   - 为何被否：插件的目的恰恰是"一个渠道坏了不影响其余渠道"，rethrow 会把一次预检失败
     升级成整个 step/请求的失败，与产品目的相反。`ctx.logger.error` + durable notice 已经
     让该看见的人（插件使用者与适配器上游）看见，且候选照常跳过、链继续。
3. 只分两档（"请求形状"与"环境"）
   - 最强的理由：分支少一个，`NO_ADAPTER` 与 `INVALID_MODEL_INFO` 都算"不是这条链的问题"。
   - 为何被否：这正是 `open-questions.md` 第五节第 3 项明确否掉的框架——两档把"去 Models
     页装个 provider"和"去找适配器上游报 bug"压成同一句话，而这两个动作之间没有任何
     共同点。定案原文：「分三档，不是两档」。
4. 档位表放进 `index.ts`（不新建模块）
   - 最强的理由：少一个文件，分类靠近唯一的使用方。
   - 为何被否：`index.ts` import Typert 运行时，单测套件导不进来（`unit.mjs` 因此从来不
     import 它）；而这张表是一个可单测的纯事实。项目自己的模式（`routes.ts`、`timeline.ts`、
     `defaults.ts`）就是"可共享的纯事实住纯模块"。

## Consequences

- 收益：C1 的两条用例（超时、调用方取消）现在跑在真实形状上并转绿；新增一条用例钉住
  "aborted finish 按谁按的分类，不按码"（fake 带 `UNKNOWN` 码，两种归属仍分对）。I10 的
  新组合场景 `precheck-failure-tiers` 用真 boot 驱动三档（`stub-unregistered` 触发
  `NO_ADAPTER`、`stub-backup` 的 `model.id` 不符触发 `INVALID_MODEL_INFO`），断言三档文案
  两两不同且都不借用"不支持当前请求参数"。`unit.mjs` 103→105，`run.mjs` 18→19 场景。
- 代价：① 档位表是手维护的封闭集合。DSH 若新增预检抛出码，落在三档之外就走通用文案——
  可接受（通用文案不指错地方），但 `adapter-defect` 一档因此收满了 `normalizeModelInfo`
  全家四个码（定案原文只点了 `INVALID_MODEL_INFO`/`INVALID_MODEL_CONTEXT` 两个，
  另外两个 `INVALID_MODEL_MAX_TOKENS`/`INVALID_MODEL_REASONING` 是同一个校验器的同类
  抛出，漏掉它们会让"适配器返回无效推理元数据"重新伪装成链的问题）。② 三档共享一个
  `capability:` 去重键：同一路由同一轮只发一条跳过 notice，档位不会让用户收到三条。
  ③ `stub-adapter.mjs` 多注册一个 provider（`stub-no-reasoning`）——只服务新场景，
  其余场景的脚本不引用它，行为不变。
