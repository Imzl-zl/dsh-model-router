---
title: "DSH Model Router — 按会话选择降级链"
status: "proposal"
kind: "design"
last_updated: "2026-10-21"
---

# 按会话选择降级链

## 摘要

不同会话承担不同任务，需要不同的模型与降级顺序。本项目当前只有一条全局链
（见 `.agents/notes/implemented/2026-10-19-one-global-fallback-chain.md`）。本文界定：
DSH 原生提供哪些会话级能力、哪些没有，以及"命名链 + 会话绑定"的实现边界。

本文**部分取代** 2026-10-19 的「只留一条全局降级链」：那条决定否掉的是"为每个模型各配一条
规则"，没有否掉"按会话在少数几条链之间选"。一条默认链 + N 条命名链，与当时的用户原话
（"不管我选啥模型……都根据这个配置路由"）不冲突——默认链仍然是那个行为。

## 一、DSH 原生有什么

| 能力 | 事实 | 出处 |
|---|---|---|
| 会话身份 | `agent/request` 的 payload 带 `agent`，`agent.session.id` 是稳定的 `SessionId`，跨重启不变 | `packages/core/agent/src/runtime-types.ts:337`；`packages/core/session/src/index.ts:546` |
| 会话列表 + 名字 | 宿主 `session.list` 给 `{ sessionId, updatedAt }`；名字是 `title` 投影（`values.title`），浏览器半包本来就在逐会话读投影 | `packages/api/session-controller/src/types.ts:183`；`packages/session/session-title/src/index.ts:269` |
| 会话侧车存储 | `ctx.storageDomain.open(spec)`：schema 校验的 KV，**写入即持久**、不进会话日志、对模型不可见；DSH 的 `bundle/base` 已挂载 storage 家族 | `packages/storage/storage-domain/README.md:28`；`packages/bundle/base/cordis.patch.yml:180-188` |
| 插件自有 Remote | 浏览器半包已有一个 `routerHealth` Remote；新增会话绑定读写不需要新机制 | 本项目 `src/index.ts` 的 `@Remote` |
| 选路时机可读会话 | `agent/request` 在 `prepareCall` 之前，返回的 `LlmCallConfig` 决定这一跳打到哪 | 本项目 `src/index.ts` 的 `agent/request` handler |

## 二、DSH 原生没有什么

1. **没有会话级配置的官方 UI 槽位，也没有"当前活动会话"可读。** 插件的配置面是一个全局
   namespace，DSH 不提供"这个会话的设置"面板，设置页也拿不到"现在前台是哪个会话"。
   所以入口不能是"给当前会话配"，只能**在插件自己的面板里列会话、按 id 配**——id 稳定、
   名字可读（`title` 投影），选谁都不会选错。
2. **不能新增 durable 事件类型。** `plugin:<owner>/<record>` 命名空间存在，但只对
   `@deepseek-ai/dsh-experimental-<owner>` 开放，且不进入已发布的持久化 schema
   （`packages/core/session/src/types.ts:519-533`）。所以"把选择写进会话日志"这条路
   对第三方插件是关着的。
3. **不能改 DSH 的按会话模型选择。** 选择状态是 session-controller 私有字段，插件只能
   在 `agent/request` 里覆盖这一跳实际打到哪条路由，改不了选择器里显示的模型。
4. **会话 fork 不继承会话侧车。** fork 建的是新 `sessionId`、只继承事件日志；按 sessionId
   键控的绑定不会跟过去。

## 三、方案：两条路线，原生那条先做

DSH 已经有一个**按会话保存、按会话生效、fork 自动继承、重启不动**的选择：模型选择器。
它写在 `request/header` 里，`session.requestHeader()` 折得出来，插件在每个
`agent/request` 上都会拿到当前这一步要用的 provider/model。

### 路线 1（零新机制）：链跟着选中的模型

每条链声明它匹配哪些路由（`match: [{ provider, model }]` 或 provider 通配）。请求进来时：
命中某条链 → 用那条；没有命中 → 默认链（今天的行为）。

- **不需要**新存储、新命令、新面板；DSH 的选择器就是"按会话选"的界面。
- fork 天然继承（header 是事件日志的一部分），重启天然保留。
- 代价：同一模型下要两套链做不到——那时才需要路线 2。

这条路是 2026-10-19 "只留一条链"的真正延伸：链仍然是"备胎怎么排"，只是**按用户当前选的
模型**挑一套备胎，而不是让用户再配一套"主次"。

### 路线 2（显式绑定）：命名链 + 面板按会话选

当两条任务用同一个模型、却需要不同降级顺序时，才需要它。见下面"配置形状"与
"会话侧配置"两节。

### 配置形状

```
enabled: true
defaultChainId: coding            # 没绑定的会话用它（= 现在的全局链）
chains:
  - id: coding
    name: 写代码
    candidates: [...]
    switchOn: {...}
    firstHopMaxRetries: 0
    stickyTurns: 0
    strategy: order
    breaker: { enabled: true, rules: [...] }   # 规则属于链
  - id: writing
    name: 写文档
    candidates: [...]
```

- **绑定是覆盖，不是合并**：绑定到 `writing` 的会话整条链用 `writing`，不与默认链拼。
  合并两条链会拼出没人排过的顺序——与 2026-10-19 拒绝合并多条规则的同一个理由。
- **绑定的键是 `sessionId`**，值是 `chainId`；绑定指向不存在的链时按"未绑定"处理并在
  下一次请求里留一条 notice（不静默回退到别的链）。

### 会话侧配置：在工作台里按会话选

设置面本来就有一个面板，直接在它里面做，不需要 slash 命令。

| 层 | 机制 |
|---|---|
| 列表 | 浏览器半包沿用健康页已经在做的 `session.list` + 逐会话 `projections({sessionId})`，取 `values.title` 当名字；显示"名字 · 更新时间 · 当前绑定链" |
| 选择 | 面板里一行一个会话，选择器列出命名链 + "跟随默认"；写操作走插件自己的 `@Remote setSessionChain({sessionId, chainId \| null})` |
| 持久化 | 宿主侧 `ctx.storageDomain` 的会话侧车，键 = `sessionId`；写成功即持久，不追加会话事件 |
| 生效时机 | 下一次 `agent/request`：宿主读绑定 → 选链；进行中的 step 不换链（与"选择在下一步生效"的语义一致） |
| 降级 | composition 里没有 `storageDomain`（可选服务）时退回进程内存，并在面板与下一次请求的 notice 里说明"重启后失效" |

三个必须说清的边界：

- **没有"当前会话"这个概念可用**：面板列出的是全部会话，用户按名字/id 选，不猜前台。
- **fork 不继承**（存储按 `sessionId` 键控），选中 fork 出来的会话就是"跟随默认"，除非
  用户再选一次。若用户要求继承，在 fork 命令里复制一次绑定即可，不改变本设计。
- **`storageDomain` 缺失时必须可见降级**——"重启后悄悄变回默认链"是这插件最不能做的事。

### 熔断与重试的归属

- **规则属于链**：`switchOn`、重试次数、熔断规则都跟着链走。不同任务对"什么算失败"的
  容忍度不同，这是绑定一条链而不是只换候选列表的理由。
- **状态全局，不按会话**：渠道的 429/额度耗尽是渠道自己的事实，不是会话的事实。按会话拆
  熔断状态会让 A 会话刚凉住的渠道被 B 会话继续打，等于把冷却变成摆设。这条与本项目
  "跨请求健康状态"的既有语义一致。

## 四、被否方案

1. **恢复 per-model profiles（选中模型 → 规则）。** 最强理由：零新入口，用户每会话选模型
   就是选链，且 DSH 已经按会话保存了选择。被否：用户 2026-10-19 明确拒绝过按模型分规则；
   而且会话换模型（临时试一个）会连带换掉整条降级顺序，副作用比收益大。
2. **把绑定写进插件 config（`sessions: { <id>: <chain> }`）。** 最强理由：零新依赖，
   保存链路已经存在。被否：配置无界增长、id 对人不可读、且删会话不会删绑定；配置是
   "用户意图"，会话绑定是"运行时状态"，混在一层会让两边都读不清。
3. **用会话标题/标签推断任务类型。** 被否：标题是模型生成的自由文本，把路由建立在其上
   属于猜意图；猜错的代价是把请求打到贵或弱的渠道。
4. **只做内存绑定，不做持久化。** 最强理由：零依赖、零迁移，第一天就能用。被否（作为
   唯一形态）：重启后静默回到默认链，用户会以为自己的选择还在。可作为无 storage 时的
   降级形态保留，但必须配可见 notice。

## 五、已定的默认值（实施时按此写，改动需说明）

1. **绑定粒度**：一个会话 → 一条链。层内再按轮次覆盖不做，那与现有 `needs` 条件重叠。
2. **fork 继承**：默认**不继承**（存储按 `sessionId` 键控，零额外逻辑）。用户要求时再在
   fork 路径上复制。
3. **无 storage 时**：允许绑定但只在本进程有效，面板与 notice 都要说明"重启后失效"；
   不因此禁用入口。
4. **链数量**：不设硬上限，靠配置校验（id 唯一、至少一条候选、候选路由不得重复）约束。
