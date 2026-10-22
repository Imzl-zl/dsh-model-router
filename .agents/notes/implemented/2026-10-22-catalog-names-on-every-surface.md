# Agent Note: 行上写目录里的显示名，原始路由键只留在 tooltip 里

Status: implemented

## Problem

用户现场的 provider `cherry` 下，模型是 DSH 模型设置里 id/name 两栏的形状：id 是
`<uuid>:<model>`，name 是他映射的名字（`LunaRoute:deepseek-4.1-flash`）。插件所有行都
按 `candidate.provider` + `candidate.model` 渲染，于是三个候选行看起来只是三段十六进制
前缀，用户原话是"这种的看不好分辨"——而他映射名字就是为了分辨。同一份目录，"添加候选"
弹窗已经在读（`Checkbox` 标签是 `m.name`），DSH 自己的模型选择器也读
（`ui-model-selection/src/client/index.ts:52-76`：`group.name` + `model.name`）；只有链路
工作台、健康页、探测覆盖下拉、会话 chip 和失败历史停在原始 id 上。

## Decision

路由的显示名只有一个来源：`session/modelCatalog()` 的两层名字（provider 的
`group.name`、model 的 `name`），解析集中在 `src/client/naming.ts`，所有面共用；原始
`provider/model` 键保留为每行的 `title`。

准入门槛（可机械判定）：

1. 名字只来自目录，不解析 id：`cherry` → `Cherry`；模型 id 里的 `:`、`/` 不参与任何推断
   （目录里名字是空串也算"没有名字"）。
2. 缺名即回落原始那一半，不借邻名：目录没答上来 / 答了但没这条路由 / 名字空串，一律退回
   该半的 id。两半都没有名字时 `route()` 印原始 `provider/model` 键本身，与日志、配置、
   宿主 notice 里同一串字符。
3. 原始键始终可读：候选行、健康行、探测覆盖下拉的行、chip 重试行、失败历史行都把
   `provider/model` 放进 `title`。显示名不许成为唯一身份。
4. 一处解析：`pipeline.ts` / `workspace.ts` / `chip.ts` / `modals.ts` 必须从
   `./naming.ts` 取名，且行标题里 `dsh-router-provider` 那半边只许画 `names.provider(...)`
   （`tests/unit.mjs` 的源级守卫，任何一面改回裸 id 立刻转红）。
5. 目录随工作台挂载加载（`controller.loadCatalog` → `onLoadCatalog`），不再只在"添加
   候选"弹窗打开时读；会话 chip 自己读一次并缓存（`catalogPromise`），因为它与工作台是
   两个生命周期。

## Alternatives considered

1. 把目录名写进配置（保存链时把 name 一起存下来）
   - 最强的理由：宿主侧 notice、失败历史、日志一次到位，不依赖浏览器；读配置的人也能直接
     看到名字。
   - 为何被否：配置里多一份会飘的副本——用户改名后旧副本还在，显示名从此成为第二个真值源，
     与 `routes.ts` 已经收编的"路由键只写一处"直接冲突。
2. 显示 `名字 (原始 id)` 两段都印
   - 最强的理由：零歧义，名字和真实渠道一眼都在。
   - 为何被否：用户抱怨的正是看不清，行里再塞一段 UUID 等于把噪声留着；原始 id 进 tooltip
     已经够排查用，没必要常驻。
3. 连宿主侧的中文 notice 一起改
   - 最强的理由：聊天记录里那句 `[路由切换] cherry/<uuid>:...` 同样难认，一致性最好。
   - 为何被否：宿主要拿到名字得走 `ctx.llm.listModels(provider)` +
     `resolveModelInfo`（`session-controller/src/catalog.ts:24-48`），那是逐模型异步、可能
     触发发现请求的工作，塞进 failover 的同步判定路径会加延迟并可能打网络。这一版只改
     浏览器半包，notice 的显示名留作独立一步。
4. 会话 chip 复用工作台控制器的目录状态
   - 最强的理由：一次读取处处可用，不会出现两个面读到不同快照。
   - 为何被否：chip 挂在 composer 槽位、工作台关着时它仍在，共享状态得先造一个跨面单例；
     chip 自己读一次（`catalogPromise`）更小，也与"一个面一个控制器"的现状一致。
5. 保留 `shortModelName`，只把入参换成名字
   - 最强的理由：长名字也放得下，行几何不用重新量。
   - 为何被否：那套"UUID 截头去尾"的逻辑是为原始 id 写的；名字通常比 id 短，留着它只会把
     `LunaRoute:deepseek-4.1-flash` 截成 `LunaRoute:dee…4.1-flash`——用户要的正是完整可读。
     CSS 的 `overflow-wrap: anywhere` 与行标题的 `flex-wrap` 本来就允许换行，函数删除。

## Consequences

- 收益：链路页、健康页、探测覆盖下拉、chip 重试行、失败历史都写用户认得的名字；`format.ts`
  的 `shortModelName` 随原始 id 的显示需求一起删除，不留第二套截断规则。
- 代价：显示名依赖 `session/modelCatalog()` 这一次读——读失败或宿主还没答上来时行上是原始
  id（诚实但难看），工作台挂载时也多一次 Remote 调用。目录按 Host generation 缓存一次，
  用户改了名字要等插件重新激活（刷新页面 / 宿主重连）才在新行上生效。
