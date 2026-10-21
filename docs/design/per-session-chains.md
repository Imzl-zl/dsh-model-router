---
title: "DSH Model Router — 按会话选择降级链"
status: "implemented"
kind: "design"
last_updated: "2026-10-21"
---

# 按会话选择降级链

## 摘要

不同会话承担不同任务，需要不同的降级顺序。现在的形态是**一组命名链 + 一个默认链**：
没有绑定链的会话走默认链（与 2026-10-19 的单链行为完全一样），绑定了的会话走它自己那条。
入口只有一个：composer 工具行里的会话路由 chip。

本文**部分取代** 2026-10-19 的「只留一条全局降级链」：那条决定否掉的是"为每个模型各配一条
规则"，没有否掉"按会话在少数几条链之间选"。

## 一、DSH 原生有什么

| 能力 | 事实 | 出处 |
|---|---|---|
| 会话身份 | `agent/request` 的 payload 带 `agent`，`agent.session.id` 是稳定的 `SessionId`，跨重启不变 | `packages/core/agent/src/runtime-types.ts:337`；`packages/core/session/src/index.ts:546` |
| 会话列表 + 名字 | 宿主 `session.list` 给 `{ sessionId, updatedAt }`；名字是 `title` 投影（`values.title`） | `packages/api/session-controller/src/types.ts:183`；`packages/session/session-title/src/index.ts:269` |
| 会话级 UI 槽位 | `conversation.input.left`/`.right`、`conversation.session.header.utilities` 等是 `scope: 'session'` 的 list 槽；占位组件**直接收到 `sessionId`**（还有 `useSession`、`useProjection`、`useAccess`） | `packages/client/ui-conversation/src/client/contract/slots.ts:276-298`；`packages/client/ui-session/src/client/index.ts:166-175` |
| 会话侧车存储 | `ctx.storageDomain.open(spec)`：schema 校验的 KV，**写入即持久**、不进会话日志、对模型不可见；DSH 的 `bundle/base` 已挂载 storage 家族。名字受 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` 约束（**不能带点和横线**） | `packages/storage/storage-domain/README.md:28`；`packages/storage/storage/src/backend.ts:10`；`packages/bundle/base/cordis.patch.yml:180-188` |
| 插件自有 Remote | 浏览器半包已有一个 `routerHealth` Remote；会话绑定的读写挂在同一个命名空间下 | 本项目 `src/index.ts` 的 `@Remote` |
| 选路时机可读会话 | `agent/request` 在 `prepareCall` 之前，返回的 `LlmCallConfig` 决定这一跳打到哪 | 本项目 `src/index.ts` 的 `agent/request` handler |

## 二、DSH 原生没有什么

1. **没有"会话级配置"这个原生概念，也没有设置页可读的当前会话。** 插件的配置面是一个
   全局 namespace。会话级槽位存在，挂进去的组件自带 `sessionId`——所以入口不是"猜前台"，
   而是"在会话里就地配"。缺的只是**存哪**：DSH 没有会话级 KV，得用 `storageDomain` 侧车。
2. **不能新增 durable 事件类型。** `plugin:<owner>/<record>` 命名空间存在，但只对
   `@deepseek-ai/dsh-experimental-<owner>` 开放（`packages/core/session/src/types.ts:519-533`）。
3. **不能改 DSH 的按会话模型选择。** 选择状态是 session-controller 私有字段，插件只能
   在 `agent/request` 里覆盖这一跳实际打到哪条路由，改不了选择器里显示的模型。
4. **会话 fork 不继承会话侧车。** fork 建的是新 `sessionId`、只继承事件日志；按 sessionId
   键控的绑定不会跟过去。
5. **`schemastery` 给每个声明过的字段盖上默认值**（`chain` → 一条空链、数组 → `[]`，
   `src/index.ts:914-918`），所以"写过没有"在**校验后**的值上不可区分。形状判断必须读原始
   配置（`ctx.fiber._config`）。

## 三、配置形状

```
enabled: true
defaultChainId: default            # 没有绑定（或绑定指向已删链）的会话用它
chains:
  - id: default                    # 稳定标识，会话按它绑定；改名只改 name
    name: ""                       # 留空 = 界面显示「默认链」
    candidates: [...]
    switchOn: {...}
    firstHopMaxRetries: 0
    stickyTurns: 0
    strategy: order
  - id: coding
    name: 写代码
    candidates: [...]
chain: {...}                        # 旧形状：只在 chains 缺失时读取，首次保存后被移除
```

- **绑定是覆盖，不是合并**：绑定到 `coding` 的会话整条链用 `coding`，不与默认链拼。
- **迁移**：形状由**原始配置里有没有这个键**决定（schemastery 给每个声明过的字段盖默认值，校验后的值分不出"没写过"）：`chains` → `chain` → `profiles` → `default` 池；旧形状
  折成一条 `id: 'default'`、`name: ''` 的链。行为等价，因为第一跳（用户当前选中的模型）
  本来就不在配置里。`profiles` 先于 `default` 池：profile 才是"选中这个模型时的那套备胎"，
  池子只在没有 profile 命中时生效。显式写 `chains: []` 按"一条空链"归一（插件不接管），
  不回头读旧键。
- **绑定的键是 `sessionId`**，值是 `{ chain, retries }`。绑定指向不存在的链时按"未绑定"
  路由并在下一次请求里留一条 notice；**写入阶段就拒绝**未知链 id，避免存下一个永不生效的选择。
- **重试次数的取值**：`会话覆盖 ?? 候选的 maxRetries`，解析点唯一（`resolveChain` 的
  `attemptBudget`）。覆盖按路由（`provider/model`）键控，值 0..9；`0` 是"这条路由不重试"，
  与"没有这个键"（跟随链）是两件事。
- **熔断规则与状态仍然是全局的**：状态全局是既有语义（渠道的 429 是渠道的事实，不是会话
  的），规则跟着链走是另一个决定，尚未实施。

## 四、会话内控件：composer 工具行的 chip

注册照 `ui-jobs` 的最小先例（`packages/client/ui-jobs/src/client/index.ts:35-52`）：

```ts
ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
  name: 'conversation.input.left',
  id: 'model-router-session',
  locale: NS,
  // 普通对象走普通 prop。`hooks` 是保留键：装 observable source，运行时转成 use* 选择器。
  inject: () => ({ sessionChip }),
}, SessionChainChip))
```

**位置**：左组（`.tools`）的渲染顺序是固定的——`conversation.input.permission` → `.plan` →
`.left` → `.right`，然后才是右组的模型选择器与发送（`InputBar.tsx:464-479`）。所以 chip
落在「只读」「Plan」之后、模型选择器之前。`order` 只在 `.left` 这个 list 内部排序；本插件是
唯一占用者，因此不写（默认即 0）。

**几何**（全部取自 DSH 相邻控件，不另起一套）：

| 项 | 值 | 出处 |
|---|---|---|
| chip 高 | **28px**（与模型/权限/Plan 选择器同高） | `ModelSelect.module.css:18`、`PermissionSelect.module.css:6` |
| chip 内边距 | `0 4px 0 8px` | `ModelSelect.module.css:19` |
| 圆角 | `--dsw-radius-sm` | `ModelSelect.module.css:22` |
| 字体 | 13 / 20 / 400，`--dsw-alias-label-secondary` | `ModelSelect.module.css:25-28` |
| hover / focus | `--dsw-alias-interactive-bg-hover` / `0 0 0 2px var(--dsw-focus-ring-color, …)` | `ModelSelect.module.css:32-38` |
| 内部间隙 | 4px，chevron 12px `--dsw-alias-label-caption` | `ModelSelect.module.css:12,78-82` |
| 宽度上限 | `min(220px, 40cqw)`（比模型选择器的 360px 窄：路由是次要信息） | 参照 `ModelSelect.module.css:16-17` |
| 窄容器折叠 | `@container (max-width: 460px)` 只留图标（权限 chip 同一刀口） | `PermissionSelect.module.css:92-96` |
| 弹层 | `Menu` 原语（`portal`），`z-index 1100`、`var(--dsw-elevation-prominent)` | `ModelSelect.module.css:91-117`；`ui-primitives/src/index.ts:26` |
| 弹层行 | DSH `Menu` 自带（34px 行、`5px 7px`、`--dsw-radius-md`） | `ModelSelect.module.css:221-237` |

```
┌──────────────────────────────────────────────────────────┐
│ 你好，帮我改一下这个函数                                   │
│                                                          │
│ [+] [Plan] [只读] [🔀 写代码]            [DeepSeek ▾] [↑] │  ← 28px 同高
└──────────────────────────────────────────────────────────┘
```

**弹层**（点 chip 打开，`Menu` 的 portal 模式自己定位并做视口钳制）：```
┌─ 本会话的路由 ──────────────┐
│ 链            写代码  ▾     │  ← 子菜单：跟随默认链 / 默认链 / 写代码
│ ─────────────────────────── │
│ 本会话的重试次数             │  ← 12/18 tertiary 分组标题
│ stub-third/stub-model [ 5 ] │  ← 输入宽 48px；空 = 跟随链
│ 留空 = 跟随链；0 = 这条路由不重试；上限 9 次 │
│ 没有单独选择的会话使用「默认链」的降级顺序   │
└─────────────────────────────┘
```

重试行只列**本会话会走的那条链**的候选：给一条用不上的路由配次数只会写进一个永远不生效的
键。输入在失焦或回车时提交一次写入（`setSessionBinding` 带当前 chain + 整份 retries），
越界值不夹、不猜，原地报错并保留用户输入。

**交互与无障碍**

- chip 是 `<button aria-haspopup="menu" aria-expanded>`，Enter/Space 打开，Esc 关闭；
  焦点进入/归还、外部点击、定位都由 `Menu` 原语负责。
- 写失败：弹层**不关闭**，里面一行错误（`--dsw-alias-label-primary` + 
  `--dsw-alias-interactive-bg-hover-danger` 底：语义色只进底，不当文字色），用户可在原地
  重试；成功才刷新 chip 并关闭。
- 没有 `storageDomain` 的组合：绑定退回内存，弹层里明说"重启后失效"（`persistent: false`）。
- 窄容器（≤460px）只留图标，`title`/`aria-label` 提供完整文案。
- chip 文案：未绑定显示「默认链」；绑定时显示该链的 `name`（留空则字典的"默认链"）。

## 五、设置面板：链管理

链路页第一个分区是「链」——它决定下面五个分区在编辑哪一条，放最后会让表单悄悄换目标。

```
链  3                                        每条链是一套完整的降级顺序…
┌──────────────────────────────────────────────────────────────┐
│ [编辑中] 未命名（显示为「默认链」）              [默认] [删除] │
│ [编辑]   写代码                                 设为默认 [删除] │
│ [编辑]   写作                                   设为默认 [删除] │
└──────────────────────────────────────────────────────────────┘
[添加链]
```

- 行的身份是 `id`（不可编辑）：`name` 只是显示名，改名不动任何会话绑定。
- **恰好一条链是默认**：默认链上显示静态「默认」徽标，其余行是「设为默认」按钮。
- 编辑目标：没显式选过链时跟随默认链（"设为默认"之后编辑目标一起走）；点过「编辑」之后
  跟选择走，不跟默认走。
- **最后一条链不能删**：没有链的配置等于插件完全不接管，那不是用户点删除时想要的；删除默认
  链时默认移交给剩下的第一条。
- 保存写 `chains` + `defaultChainId` 并 `unset` 旧的 `chain` 键（存储里只剩一种形状）。

## 五之二、「会话路由」页签：按会话直接配

设置面是全局的，DSH 不告诉插件"现在前台是哪个会话"，所以面板不能靠"当前会话"这个输入——
它把会话列出来让用户挑。chip 是"当前会话"的快捷入口，这一页是"所有会话"的总览，两者写同一份
侧车，所以永远一致。

```
会话绑定  1            给某个会话单独指定链：聊天里的路由 chip 改的是当前会话，两边写的是同一份数据   重新读取
┌───────────────────────────────────────────────────────────────────────────┐
│ STUB_AUX_OK                  [ 写代码 ▾ ]                                 │
│ 7b1b5326                     stub-third/stub-model [ 5 ]                  │
└───────────────────────────────────────────────────────────────────────────┘
```

| 项 | 规则 |
|---|---|
| 数据 | `routerHealth.sessionBindings()`（全部绑定一次读回）+ `remote.session.list({})`；按 `updatedAt` 倒序，最多 20 条 |
| 标题 | title 投影（与健康页同一条读法）；读不到显示 sessionId 末 8 位 |
| 行 | 链 = 原生 `<select>`（跟随默认链 + 每条链）；下面是**该链候选**的重试行，空 = 跟随链、0 = 不重试 |
| 写入 | 仍是 `setSessionBinding`（整份 `{ chain, retries }`）；成功才更新那一行，失败把宿主错误显示在分区里 |
| 被删会话 | 绑定还在、`session.list` 里没有的行：虚线边 + 「清除绑定」（`deleteSessionBinding`，幂等） |
| 未绑定行 | `chain: null` 显示**默认链**的候选——不显示任何行会被读成"这个会话不能配" |

## 六、未实施 / 待决

- **熔断规则属于链**（本文三.6 的边界）。
- 绑定指向已删除的链时，面板按"跟随默认"显示候选；请求时的那条 notice 仍会发。
- 新增一条链时给的是空候选表（不复制默认链）：复制会让"两条链一样"变成默认状态，而用户
  往往只改一半就忘了另一份。

## 七、被否方案

1. **恢复 per-model profiles（选中模型 → 规则）。** 最强理由：零新入口，用户每会话选模型
   就是选链。被否：用户 2026-10-19 明确拒绝过按模型分规则；而且会话换模型（临时试一个）
   会连带换掉整条降级顺序。
2. **把绑定写进插件 config（`sessions: { <id>: <chain> }`）。** 被否：配置无界增长、id 对
   人不可读、删会话不会删绑定；配置是"用户意图"，绑定是"运行时状态"。
3. **用会话标题/标签推断任务类型。** 被否：标题是模型生成的自由文本，把路由建立在其上
   属于猜意图。
4. **只做内存绑定，不做持久化。** 被否（作为唯一形态）：重启后静默回到默认链，用户会以为
   选择还在。保留为无 storage 时的可见降级形态。
5. **保留 `chain` 当默认链、另加 `chains[]` 存"其它"链。** 被否：同一条链两种表示，默认链
   与命名链的编辑路径必然分叉。
