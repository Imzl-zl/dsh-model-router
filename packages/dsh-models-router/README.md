# dsh-models-router

<p>
  <a href="https://www.npmjs.com/package/dsh-models-router"><img src="https://img.shields.io/npm/v/dsh-models-router?color=4A65E8" alt="npm"></a>
  <a href="https://github.com/Imzl-zl/dsh-models-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
  <a href="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml"><img src="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
</p>

<p>
  简体中文 | <a href="README.en.md">English</a>
</p>

为 DSH Agent 主请求做跨渠道透明故障转移，支持按会话选降级链。

你照常在官方选择器里选模型。它失败时，插件按你配置的物理 provider/model 候选顺序重试，并告诉你发生了什么、为什么（中文通知，落在「轨迹」里）。没有配链的模型，请求行为与没装插件完全一样。

## 安装

```bash
dsh plugin add dsh-models-router
```

需要 DSH `0.2.0-rc.2` 或更新。`@deepseek-ai/*` 与 `zod` 的 peer 从你的 DSH 安装里解析，不会重复打包。

## 工作原理

插件只接管 Agent 循环的两个缝：

- **`agent/request`**（`prepend: true`）为每次尝试选物理路由。它在 `installModelSelection` 之外运行，所以它的覆盖优先于你这次选择的回写。
- **`agent/request-error`**（`prepend: true`，最外层）先看到每次失败。对你链上勾选切换的码，插件**自己**等待并重试——填几次就是几次，不再被 provider 的策略封顶。其它码交给 DSH，`llm-retry` 继续拥有那些重试与自己的上限。

两个缝都注册在插件自己的 context 上，agent 从 payload 取，所以卸载/重载插件（任何配置保存）会摘掉并替换它们；活会话不会握着一个已死实例的句柄。

另外两件事：

- **能力预检**：返回候选前，路由配置走 `ctx.llm.resolveCallConfig()`（与 `selectModel` 同一条路径）。不能服务这次请求的候选——例如不支持所选 reasoning effort——在真实调用前就被跳过。没有它，`prepareCall` 会抛 `UNSUPPORTED_REASONING_EFFORT`，直接终止 step，任何恢复插件都接不住。
- **原因通知**：每次切换往 durable 日志追加一条中文 `form: 'notice'` 消息；它在「轨迹」里渲染（当前 DSH 版本的对话不展示上下文行——DSH 自己的 model-selection 通知也是同样呈现）。DSH 自己的英文 "model changed" 通知也会出现，两者都是事实。

## 链

一条链是一套完整的降级顺序：候选、哪些失败码切换、首跳的重试预算、起点策略与识图粘滞窗口。首跳永远是你选中的模型——它不在配置里——所以链只回答「失败之后去哪」。

```yaml
enabled: true
defaultChainId: default          # 没有单独选链的会话走这条
chains:
  - id: default                  # 稳定 id：会话按它绑定，改名不影响绑定
    name: ""                     # 留空 = 界面显示「默认链」
    candidates:                  # 降级候选；用户选中的模型是隐式第一跳
      - { provider: deepseek-official, model: deepseek-v4-flash, maxRetries: 1, needs: { images: false } }
      - { provider: pi-ai-gpt, model: gpt-5, maxRetries: 0, needs: { images: true } }
      - { provider: pi-ai-claude, model: claude-sonnet-5, maxRetries: 0, needs: { minContextTokens: 120000 } }
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false, auth: true, quota: true }
    firstHopMaxRetries: 0        # 第一跳首发之后还能重试几次
    stickyTurns: 0               # 带图轮之后，继续按识图路由的无图轮数
    strategy: order
  - id: coding
    name: 写代码
    candidates: [...]
```

- `maxRetries` / `firstHopMaxRetries` 数的是**首发之后**的重试；0 = 第一次失败就切走。首跳永远是你选中的模型。
- 显式配置的 `needs` 条件对所有候选生效，包括首跳（跳过它是尊重你的配置，并会通知）；首跳只豁免自动闸门（熔断冷却、能力预检）。
- 没有请求级总上限。一个 step 最多花各候选自身预算之和；候选内部的每次重试都由本插件执行（见「已知限制」的重试条）。
- 切到下一个候选是立即的：候选之间不插退避。同一候选两次尝试之间的等待复制 provider 的 `retryPolicy`（`initialDelayMs`、`maxDelayMs`、`jitterRatio`，以及失败携带的 `Retry-After`）。
- **什么算失败由 `switchOn` 决定。** 默认跟随 DSH 自己的可重试集合（`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`）再加 `AUTH` 和 `QUOTA`；`EMPTY_RESPONSE` 与 `INVALID_REQUEST` 需要手动勾选。`ABORTED`（你按了停止）与 `NO_ADAPTER` 永不切换；`INVALID_REQUEST` 是 opt-in，因为能力分类依赖 provider。分类只看 `LlmFailure.code`，从不匹配 message 文本。

设置面板管理链：编辑「编辑中」那条、改名、复制（候选、失败切换与预算整份带走）、设为默认、删除。最后一条不能删；改名不影响会话绑定，因为绑定指向 id。

## 按会话选链

会话可以走自己的链，而不是默认链：

- **在 composer 里**：工具行左侧的 chip（Plan 与权限控件之后、模型选择器之前）写着这个会话当前走的链。点它切换链，或设置本会话每条路由的重试次数。
- **在设置面板里**：「会话路由」页签列出所有会话及其链（和重试覆盖），不必逐个打开会话。会话已被删除但绑定还在的行，提供「清除绑定」。

需要知道的语义：

- **绑定是替换，不是合并。** 绑到 `coding` 的会话整条用 `coding`，绝不与默认链拼接。
- **绑定存在 `storageDomain` 侧车**（`model_router_sessions`），按 `sessionId` 键控：不在插件配置里、不进会话日志、对模型不可见。没有 storage domain 时退回进程内存，界面会说明；那种情况重启会丢。
- **重试覆盖按路由**：`会话覆盖 ?? 候选 maxRetries`，键是 `provider/model`，范围 0..9。空 = 跟随链；**0 = 这条路由不重试**——两者是不同答案。
- 绑定指向已删除的链时按默认链路由，并在「轨迹」里留一条通知，而不是静默改道。fork 不继承绑定（按 `sessionId` 键控，fork 是新会话）。

### 把图片路由到视觉模型

DSH 在**发送准入**处就会拒收图片 prompt：选中的模型没有声明 image modality 时会报 `MODEL_DOES_NOT_SUPPORT_IMAGES`（`api/session-controller/src/commands.ts:336-348`）——这道检查在任何请求存在之前就跑，插件无法绕过。路由能做的是按请求形状给**降级候选**加条件，利用准入只看**声明**、不看真实能力这一点：

1. 在 DSH 的模型设置里给常用的文本模型勾上 `input: [text, image]`，让图片 prompt 先过准入。
2. 把视觉模型放进链里，加 `needs: { images: true }`，并把 `invalidRequest` 加进 `switchOn`，这样拒图的文本模型会把请求交给它。

**首跳不能被条件拦下**：它是你自己的选择，插件不拥有，所以永远先试。由此有一个值得知道的后果：选中文本模型时，图片请求只有在文本模型失败后才到视觉候选——所以实际用法仍是「处理图片时选视觉模型」，或按任务分链。`stickyTurns` 则让你在刚发过图后的几轮无图追问里继续走视觉路由。

图片条件是 turn 级的，并且覆盖通过 tool result（`read_image`）在回合中途到达的图片，不只是本步新 claimed 的消息。

## 已知限制与暂缓项

- **工具能力不预检。** DSH 没有机器可读的「支持 function calling」元数据（`LlmModelInfo` 只有 `inputModalities`）。拒绝请求工具的候选会在运行时以 `INVALID_REQUEST`（deepseek）或 `PI_AI_ERROR`（pi-ai）失败；把 `invalidRequest` 加进 `switchOn` 才能让链继续越过它。分类依赖 provider，不保证精确。
- **被路由的 step 上，重试只属于本插件。** 对 `switchOn` 里列出的码，插件自己等待并重试同一路由，返回 `{ kind: 'retry' }`——配置的 `maxRetries` 就是真实次数，不再叠加 provider 策略上限。等待曲线复制 DSH：取自 provider 的 `retryPolicy`（`initialDelayMs`、`maxDelayMs`、`jitterRatio`，以及失败的 `Retry-After`；超过上限的 `Retry-After` 直接放弃而不是等待）。**没在 `switchOn` 里**的码原样交给 DSH，`llm-retry` 继续拥有那些重试与自己的上限。两个后果：路由过的 step 在轨迹里没有 `llm/retry` 行（那些重试不是 `llm-retry` 的），但每次失败尝试仍记为 `assistant/attempt`；声明 `always`（无上限）重试策略的 provider 会在加载时被拒绝。
- **候选游标是进程内存。** 重启会重置；durable 的尝试谱系从会话日志重建，不依赖游标。跨重启续跑暂缓。
- **转移账本。** 每次路由切换都从 durable 日志（`request/header` 的 `reason: 'change'` 加前一条失败 attempt）折叠进插件自己的会话投影（`router/failover-history`），上限最近 20 条。配置页的抽屉通过 `ctx.remote.session.list()` 加逐会话 `projections()` 读取。用户主动换模型（没有前序失败的 `change` header）故意不算一条。
- **渠道健康是三档，都在一个工作台里。** 被动观测按物理路由折叠真实对话结果（`router/channel-health`，跨最近 20 个会话合并，所以可用率是渠道的全局事实）；连通性检查向 DSH 自己的 `discoverModels` 要模型清单（0 Token）；端到端探测发一条极小消息、出字即停（`maxTokens: 1`，成本有界），测首字耗时。探测周期是用户配置，默认关闭——每轮都花 Token，多久一轮由你决定。探测结果是三种不同的事：可达（带 TTFT）、不可达（带 provider 中立错误码）、以及无法进行（检查根本没跑），界面不会把最后一种读成故障。探测永远不影响路由：一条合成消息说明不了渠道在真实负载下的表现，路由选择仍只读真实对话结果和用户显式条件。按路由的探测内容（`health.probe.prompts`）在健康设置弹窗里编辑（渠道选择器 + 内容字段）；Host 按路由应用，`tests/remote.mjs` 断言每条路由实际收到的文本。
- **只管 Agent 主请求。** 压缩与会话标题调用仍走 DSH 自己的模型配置，不由本插件路由。
- **`needs` 条件：图片是 turn 级，token 是 step 级。** `images` 按 turn 累积（工具循环的后续 step 不会 claim 新输入），并计入通过 tool result（`read_image`）到达的图片；`minContextTokens` 读上下文压力投影对下一次请求的估算，只在第一次用量采样之后才存在——没测过的请求算「不满足」，而且估算会系统性低估中文。显式条件同样作用于 `candidates[0]`。
- **图片路由绕不过 DSH 的发送准入。** 见上面「把图片路由到视觉模型」：支持的形态要求先在 DSH 模型设置里给文本模型勾 `input: [text, image]`。一个已知缺口：会话历史里还留着图片块时，无图轮仍会路由到文本模型，API 会响亮地拒图——路由时看不到请求历史（`agent/request` 不携带 messages）。DSH 的 offload 最终会把旧图变成文本引用；图片话题开新会话可以避开。
- **条件路由不覆盖工具支持。** DSH 没有机器可读的工具能力，不兼容的候选在运行时失败（`INVALID_REQUEST`/`PI_AI_ERROR`），由 `switchOn` 处理。
- **配置后被卸载的 provider 会优雅降级**：它的候选在运行时被跳过并记一条 warning；结构性配置错误（重复 id、同一条链里重复路由、重试次数越界、默认链指向不存在的链、按权重但没有任何正权重、自动禁用里一条既无错误码也无错误信息的空规则）会在加载时响亮失败。

## 开发

```sh
npm install                       # 仓库根：装 DSH CLI 与 peer
npm test                          # 四套件：unit、client-controller、remote、run
npm run bundle --prefix packages/dsh-models-router   # 构建 lib/（host + client + typert）
node packages/dsh-models-router/tests/unit.mjs    # 纯决策逻辑
node packages/dsh-models-router/tests/run.mjs     # Loader 组合测试
node packages/dsh-models-router/tests/client-controller.mjs   # 浏览器半包控制器（跑构建产物 lib/client.js）
npx tsc --noEmit --skipLibCheck --strict --module nodenext \
  --moduleResolution nodenext --target es2022 --allowImportingTsExtensions \
  packages/dsh-models-router/src/index.ts
```

浏览器半包与 host face 都从构建产物消费，所以任何源码改动后必须先 `npm run bundle`，浏览器或 `--dump-config` 才看得到。组合测试启动真 headless Loader + 确定性 stub adapter，对 durable 会话日志断言——这是 DSH 包规则要求的真 Cordis Loader 组合，不是手搭 Context。web profile 的验证方式是安装 bundle（`dsh plugin --profile web add <dir>`）后在浏览器里驱动插件页。真网关检查（`tests/real-run.mjs`，凭据在 gitignored 的本地文件里，本机需要系统代理）已对一个真实的上游 500 做过端到端验证：两次同路由重试、一次跨渠道切换、一条中文通知、一个完成的回合。
