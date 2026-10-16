# Agent Note: 连通性检查的「没登记 discovery」不是「端点没应答」

Status: implemented

## Problem

隔离 home 实测：`deepseek-official/deepseek-flash` 的卡片状态 pill 显示「异常」，连通性按钮
tooltip 写「连通性检查：端点没应答」，汇总行「连通性检查完成 · 不可达 1 · 没能检查 1」，
筛选计数「异常 / 降级 (1)」。真实情况是 DSH 从未为该 provider 注册 model discovery，
一次请求都没发出去。

这是上一轮 `probe.ts` 那条谎的同一个形状，只是换了个位置：`controller.ts` 的
`checkRoute` 把 `discoverModels` 的任何拒绝都判成 `unreachable`。修它撞到一层上一轮没有
的墙——`remoteDiscoverModels` 用 `RemoteError('llm/model-discovery-rejected', message)`
把失败包住，`details` 只带 `settingsNs` 与 `baseURL`，`LlmError.code` 到不了浏览器
（`packages/llm/llm/src/index.ts:639-647`）。所以「客户端怎么知道这个 ns 没有 discovery」
不是实现细节，是这条路径的分类该放在哪里的问题。

## Decision

连通性检查整体搬到宿主侧执行，在 `LlmError.code` 还活着的那一层分类，再把结构化判定发给
客户端。插件已有的 `routerHealth` host face 就是这条路径（探测当初正是为此搬过去的），
新增 `@Remote checkConnectivity(request)`；浏览器半包不再自己调
`ctx.remote.llm.discoverModels`，也不再读 `listConfigurableProviders` / `settings.describe`。

判定归到**已有的 `unavailable` 格**，不新增第三种判定。`types.ts` 给 `unavailable` 的
定义是 "the check could not run at all … the UI must read it as unknown, never as a
fault"——「DSH 没有为这个 ns 登记 discovery」正是这个意思，且它关于渠道一个字都没说。

准入门槛（可机械判定）：

1. 封闭集合只收 **`LlmRuntime.discoverModels` 自己在调用任何 discovery 之前**抛的码：
   `NO_DISCOVERY`（`llm/src/index.ts:596`）与 `INVALID_DISCOVERY`（`:601`）。判定方法是
   「这个码是 runtime 前置拒绝，还是某个 discovery 实现自己的回答」——前者入集，后者留
   `unreachable`。
2. 客户端侧只允许出现插件自己的 reason 词表：`notConfigurable` / `noDiscovery` /
   `hostUnavailable`。DSH 的原始码随行带到 `error` 字段供 tooltip 显示，但不参与分支。
3. 反向边界必须钉住：`AUTH` / `TRANSPORT` / `DISCOVERY_FAILED` / `DISCOVERY_UNSUPPORTED` /
   `INVALID_CREDENTIAL` 仍是 `unreachable`。把「真的发出去被拒」降级成「没能检查」是同一条
   谎的反方向。
4. 汇总行按「这一轮被问到的每一条」计数。宿主对每条请求都给一个判定；两条到不了宿主的
   路径（face 未挂载、调用被拒）按条补「没能检查」。少算一条就是少报一次故障。

## Alternatives considered

1. 就地按 message 匹配（`response.error.message` 里找 "no model discovery is registered"）
   - 最强的理由：不用动宿主、不用动 wire 契约，`checkRoute` 里加一个字符串判断就完事；
     `NO_DISCOVERY` 的 message 里还恰好带着 settingsNs，匹配起来很稳。
   - 为何被否：`HarnessError` 的契约写在 `llm/src/error.ts:14`——"route on this, never by
     parsing `message`"。message 是人类诊断文案，DSH 改一个措辞插件就静默失效，而且失效
     方向是回到「端点没应答」这条谎上。更糟的是它不可判别：一个网关返回 404 的文案同样
     可能含 "discovery"，按文案分流迟早把真故障判成「没能检查」。DSH 自己的 Models 页
     正是这么塌的（`ui-settings-models/src/client/operations.ts:102-107` 只分 `found` /
     `refused`），那是它没有 code 可用的结果，不是可照抄的先例。
2. 宿主只加一个「哪些 ns 登记了 discovery」的读口，客户端预检后再自己调 `discoverModels`
   - 最强的理由：检查本身留在客户端 → DSH llm remote 的原路径上，插件自有 Remote 没挂上
     时浏览器仍能检查；而且只是个小小的增量读口。
   - 为何被否：它给不了本次修复需要的判定。预检只是提示，`discoverModels` 仍可能在两次
     调用之间因 llm-pi-ai fiber 重启而变成 `NO_DISCOVERY`，那时客户端又回到按 message 猜。
     而且它把同一个事实（这个 ns 有没有 discovery）拆成两个调用点各自判一次，正是本项目
     一直避免的第二事实源。
3. 让 DSH 改 `remoteDiscoverModels`，把原始 code 带进 `RemoteError.details`
   - 最强的理由：这是根因修复——信息丢失本来就发生在 DSH 那一层。
   - 为何被否：本轮拿不到。DSH checkout 是只读事实来源，跨仓库改动需要 DSH 维护方同意；
     在它落地前插件仍然必须自己分类。已作为上游提案记在本轮报告里，不作为本轮方案。
4. 改用已有的 `session/modelCatalog`（`buildModelCatalog` → `ctx.llm.listModels`）
   - 最强的理由：插件已经在用这个 remote（`ensureCatalog`），零新增 wire 契约，且它自带
     per-provider 的 `failures` 数组，看起来正是「哪些渠道问不出来」。
   - 为何被否：`listModels` 走的是 adapter 本地 catalog，**一次网络调用都不发**。对
     `deepseek-official` 它返回静态配置的 models 列表，于是「连通性检查」会静默降级成一次
     配置读取——这正是本项目不允许的那种悄悄降级。而且 `buildModelCatalog` 同样把失败塌成
     `{id, name, message}`（无 code），并把空组整个滤掉（`catalog.ts:65`），没配 key 的
     provider 是直接消失而不是被报告。
5. 新增第三种判定（比如 `kind: 'unsupported'`）专治「没有 discovery」
   - 最强的理由：语义上最精细，「这个渠道做不了连通性检查」和「没能测」听起来确实不是
     一件事。
   - 为何被否：UI 侧已有的 `unknown` 音色与「没能检查」文案表达的正是这个意思，第三态只
     是把已经能表达的事情再买一次单，还要动 Typert codec、`summarizeChecks` 分桶、以及
     每个消费方的分支。`unavailable` 的定义本就覆盖它。

## Consequences

- 收益：`NO_DISCOVERY` 落到灰色「没能检查」，`routeStatus` 给出 `unknown`，卡片 pill、nav
  徽标、筛选计数都不再把「DSH 结构上查不了的渠道」算进「N 异常」。隔离 home 实测汇总行从
  「不可达 1 · 没能检查 1」变成「没能检查 2」，筛选「异常 / 降级」从 (1) 归零。原始码
  （`NO_DISCOVERY`）随 tooltip 显示，用户看得见该改用什么档位。
- 连带核实（逐条，均无需额外改动）：`classifyHealth` 对 `NO_DISCOVERY` 本就用 `default`
  分支返回 `undefined`，被动折叠不记账、不污染可用率；breaker 只在
  `agent/request-error` 里由真实请求失败驱动，连通性判定到不了那儿；notice 字典走
  `codeLabel` 缺键回落原始码，连通性判定不产 notice。
- 代价：① 浏览器半包多一次 Remote 往返（原来 N 个渠道 N 次 `discoverModels`，现在一轮一次
  `checkConnectivity`，实测更快）。② 插件自有 Remote 成为连通性检查的唯一通路——它没挂上时
  浏览器只能报「没能检查」，不再有退回到 DSH remote 的路。这一点用 `hostUnavailable` 这个
  reason 显式表达，不假装检查过了。③ `remote.llm` / `remote.settings` 从浏览器半包的
  inject 清单里删掉，客户端半包的依赖面收窄，但 DSH 若给这两个 face 加别的能力，本插件
  本来也没用。④ 一个手维护的两码集合：DSH 若在 `discoverModels` 里新增前置拒绝码，这里
  不会自动跟上，所以注释写明了收录标准（runtime 在调用 discovery 之前抛）。
- UI 措辞与可达性裁定：**不禁用按钮**，显示灰色「没能检查」+ 指明原因与替代档位的
  tooltip。判据是本项目自己的那条——「可点只弹提示的按钮与『保存了但没存上』是同一种谎言」，
  而谎言的定义是**点了什么都不会发生**。这个按钮会真的执行并给出真实答案（「这个渠道没有
  discovery」），它不是桩。禁用反而会隐藏原因，并且与 `checkAll` / 定时器两条入口自相矛盾
  （它们仍会跑并产出同一个判定）。历史上被禁用的「测速」档当时是 `alert(tooltip)` 的空桩，
  与这里不是一回事。
- 未修（同类，发现但不在本轮范围）：pi-ai 的 `DISCOVERY_FAILED`（无 catalog 且无 baseURL）
  在请求离开 Host 之前就抛，按「调用有没有发生」的严格口径也该算 `unavailable`。本轮把它
  留在 `unreachable`，因为它是 **被调用的** discovery 自己的回答、指向一个用户能为本渠道
  修复的动作（去设 baseURL），与「这个 DSH 装不上 discovery」不是一类。若下一轮要按字面
  口径收拢，需要连同 `DISCOVERY_UNSUPPORTED` / pi-ai 的 `INVALID_CREDENTIAL` 一起讨论，
  并接受「适配器实现的码集合」这条更宽的维护面。
