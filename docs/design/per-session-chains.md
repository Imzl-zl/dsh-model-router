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
| 会话级 UI 槽位 | `conversation.input.left`/`.right`、`conversation.session.header.utilities` 等都是 `scope: 'session'` 的 list 槽；占位组件**直接收到 `sessionId`**（还有 `useSession`、`useProjection`、`useAccess`），不需要猜当前会话 | `packages/client/ui-conversation/src/client/contract/slots.ts:276-298`；`packages/client/ui-session/src/client/index.ts:166-175` |
| 会话侧车存储 | `ctx.storageDomain.open(spec)`：schema 校验的 KV，**写入即持久**、不进会话日志、对模型不可见；DSH 的 `bundle/base` 已挂载 storage 家族。名字受 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` 约束（**不能带点和横线**） | `packages/storage/storage-domain/README.md:28`；`packages/storage/storage/src/backend.ts:10`；`packages/bundle/base/cordis.patch.yml:180-188` |
| 插件自有 Remote | 浏览器半包已有一个 `routerHealth` Remote；新增会话绑定读写不需要新机制 | 本项目 `src/index.ts` 的 `@Remote` |
| 选路时机可读会话 | `agent/request` 在 `prepareCall` 之前，返回的 `LlmCallConfig` 决定这一跳打到哪 | 本项目 `src/index.ts` 的 `agent/request` handler |

## 二、DSH 原生没有什么

1. **没有"会话级配置"这个原生概念，也没有设置页可读的当前会话。** 插件的配置面是一个
   全局 namespace，DSH 不提供"这个会话的设置"面板，设置页拿不到"现在前台是哪个会话"。
   **但会话级槽位存在**（见上表），挂进去的组件自带 `sessionId`——所以入口不是"猜前台"，
   而是"在会话里就地配"。缺的只是**存哪**：DSH 没有会话级 KV，得用 `storageDomain` 侧车。
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
- **绑定的键是 `sessionId`**，值是 `{ chain, retries }`；绑定指向不存在的链时按"未绑定"
  处理并在下一次请求里留一条 notice（不静默回退到别的链）。
- **重试次数的取值**：`会话覆盖 ?? 候选的 maxRetries`。覆盖按路由（`provider/model`）键控，
  只对绑定链里存在的候选有效；0..9 是校验边界，不是第二个"最大值"配置项。

### 会话侧配置：挂进 composer 工具行的会话级控件

DSH 的会话级槽位就是为这种需求准备的。注册照 `ui-jobs` 的最小先例
（`packages/client/ui-jobs/src/client/index.ts:35-52`）：

```ts
ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
  name: 'conversation.input.left',
  id: 'model-router-session',
  order: -10,                    // 排在模型选择器之前
  locale: NS,
  inject: (sessionId) => ({ /* 读绑定/写绑定的业务面 */ }),
}, SessionChainChip))
```

注册时槽位若未声明会抛（`packages/client/ui-slots/src/index.ts:1207-1210`），`inject`
就是等它声明——跨包注册是标准做法，不需要改 DSH。

**为什么是 `conversation.input.left` 而不是会话头**：模型选择器就在 composer 工具行
（`conversation.input.model`，已被 `ui-model-selection` 占位），路由设置与它是同一类
"这一轮打到哪"的决定，放一起用户不用在两个地方找。会话头
（`conversation.session.header.utilities`）留给只读状态。

**控件形态**：一个 chip + 一个 popover。

```
[ 默认链 ]        ← 未绑定；或 [ 写代码 · 重试 5 ]
┌─ 本会话的路由 ─────────────────┐
│ 链    [ 跟随默认 ▾ ]           │
│ 重试  deepseek/chat   [ 5 ]    │  ← 空 = 跟随链；填了 = 覆盖
│       openrouter/x    [ 0 ]    │
└───────────────────────────────┘
```

| 层 | 机制 |
|---|---|
| 读身份 | 槽位组件自带 `sessionId`，不用 `session.list`、不猜前台 |
| 读绑定 | 挂载时一次 `routerHealth.sessionBinding(sessionId)`；写入后重读（宿主内存权威、读是同步的） |
| 读链与候选 | 已有的配置读口；本会话的健康数据走槽位自带的 `useProjection` |
| 写 | `routerHealth.setSessionBinding({ sessionId, chain, retries })` → 宿主写 `storageDomain`，落盘成功后才刷新 chip |
| 生效 | 下一次 `agent/request`；进行中的 step 不换链 |

**存储**（宿主侧，`ctx.storageDomain` 可选服务）：

```ts
const routerBindings = defineDomain({
  name: 'model_router_sessions',        // UNIT_NAME_RE 只允许小写字母/数字/下划线
  version: 1,
  tables: {
    bindings: domainTable(z.object({
      chain: z.string().nullable(),                                  // null = 跟随默认
      retries: z.record(z.string(), z.number().int().min(0).max(9)), // 键 = provider/model
    })),
  },
})
```

三个必须说清的边界：

- **没有 storage 的 composition**：绑定退回进程内存，chip 标"临时（重启失效）"。
  不因此隐藏入口——隐藏等于假装这个功能不存在。
- **fork 不继承**（按 `sessionId` 键控）；fork 出来的会话显示"跟随默认"，用户再选一次即可。
- **会话被删**：侧车留下孤儿记录；打开设置面板时用 `session.list` 对一次并删掉不存在的 id，
  不为此加后台任务。

### 熔断与重试的归属

- **规则属于链**：`switchOn`、重试次数、熔断规则都跟着链走。不同任务对"什么算失败"的
  容忍度不同，这是绑定一条链而不是只换候选列表的理由。
- **状态全局，不按会话**：渠道的 429/额度耗尽是渠道自己的事实，不是会话的事实。按会话拆
  熔断状态会让 A 会话刚凉住的渠道被 B 会话继续打，等于把冷却变成摆设。这条与本项目
  "跨请求健康状态"的既有语义一致。

## 三之二、UI 规格：与 DSH composer 控件同一套几何

数值全部取自 DSH 自己的相邻控件，不另起一套：

| 项 | 值 | 出处 |
|---|---|---|
| chip 高 | **28px**（与模型/权限/Plan 选择器同高） | `ModelSelect.module.css:18`、`InputBar.module.css:318-324` |
| chip 内边距 | `0 4px 0 8px`（带 chevron）/ `0 8px`（纯文本） | `ModelSelect.module.css:19` |
| 圆角 | `--dsw-radius-sm` | `ModelSelect.module.css:22` |
| 字体 | 13 / 20 / 400，`--dsw-alias-label-secondary` | `ModelSelect.module.css:25-28` |
| hover / focus | `--dsw-alias-interactive-bg-hover` / `0 0 0 2px var(--dsw-focus-ring-color, …)` | `ModelSelect.module.css:32-38` |
| 内部间隙 | 4px（图标/文字/chevron），chevron 12px `label-caption` | `ModelSelect.module.css:12,78-82` |
| 宽度上限 | `min(220px, 40cqw)`（比模型选择器的 360px 窄：它是次要信息） | 参照 `ModelSelect.module.css:16-17` |
| 工具行间距 | 12px，容器 ≤560px 时 8px | `InputBar.module.css:261,310-316` |
| 窄容器折叠 | `@container (max-width: 460px)` 只留图标（权限 chip 同一刀口） | `PermissionSelect.module.css:92-96` |
| 弹层 | `Menu` 原语（`portal`），`z-index 1100`、宽 `min(240px,100vw-32px)`…`min(420px,100vw-32px)`、高 `min(360px,100vh-96px)`、`box-shadow: var(--dsw-elevation-prominent)` | `ModelSelect.module.css:91-117`；`ui-primitives/src/index.ts:26` |
| 弹层行 | 34px 高、`5px 7px`、`--dsw-radius-md`、hover 同上 | `ModelSelect.module.css:221-237` |

**布局**：左组（`.tools`，gap 12px）的渲染顺序是固定的——`conversation.input.permission`
→ `.plan` → **`.left`** → `.right`，然后才是右组的模型选择器与发送
（`InputBar.tsx:464-479`）。所以我们的 chip 落在「只读」「Plan」之后、模型选择器之前：
路由和模型是同一类"这一轮打到哪"的决定，挨着放；`order` 只在 `.left` 这个 list 内部
排序（本插件是唯一占用者，取 `order: 0` 即可）。

```
┌──────────────────────────────────────────────────────────┐
│ 你好，帮我改一下这个函数                                   │
│                                                          │
│ [+] [Plan] [只读] [🔀 写代码 · 5]        [DeepSeek ▾] [↑] │  ← 28px 同高
└──────────────────────────────────────────────────────────┘
```

**弹层**（点 chip 打开，锚在 chip 下方左对齐）：

```
┌─ 本会话的路由 ──────────────────┐
│ 链                   写代码  ▾  │  ← 34px 行，value 右对齐 tertiary
│ ─────────────────────────────── │
│ 重试次数                        │  ← 12/18 tertiary 分组标题
│ deepseek/deepseek-chat   [ 5 ]  │  ← 输入宽 48px，空 = 跟随链
│ openrouter/claude-sonnet [ 0 ]  │
│ ─────────────────────────────── │
│ 跟随链的默认次数                │  ← 12/18 tertiary 脚注
└─────────────────────────────────┘
```

**交互与无障碍**

- chip 是 `<button aria-haspopup="menu" aria-expanded>`，键盘 Enter/Space 打开，Esc 关闭，
  打开后焦点进弹层（`Menu` 原语已实现焦点与 Esc）。
- 数字输入 `inputMode="numeric"`、`aria-label` 带路由名；**空值即"跟随链"**，不是 0。
- 写失败：弹层内一行错误（`--dsw-alias-state-error-primary` + `interactive-bg-hover-danger` 底），
  **不关闭弹层**，让用户能重试；成功才更新 chip 并关闭。
- chip 文案：未绑定显示「默认链」；绑定时显示「链名 · 重试 N」（N 取该链里最大值，
  用户一眼看到"这条会话最坏会打几次"）。
- 窄容器（≤460px）只留图标，`title` 提供完整文案；`aria-label` 不变。

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
3. **无 storage 时**：允许绑定但只在本进程有效，chip 与 notice 都要说明"重启后失效"；
   不因此禁用入口。
4. **链数量**：不设硬上限，靠配置校验（id 唯一、至少一条候选、候选路由不得重复）约束。
