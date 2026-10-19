# 一条全局降级链：去掉主模型、按模型分规则与默认模型同步（2026-10-19）

## Context

上一轮（同日的「接管开关 + 主模型同步 + 时间轴桶化」）交付后，用户实际用下来提了三
条，每一条都指向同一个根因——**产品被做成了"按模型分规则 + 主模型"，而用户要的是
"一条降级链"**：

1. 「配置主模型是不是没啥用？我这个本来就是降级自动熔断切换的，应该是我配置降级后的
   路由，不管我选啥模型，有问题就都根据这个配置路由才对吧？分啥主次干啥？」
2. 「这个 dsh 原生都有，你又自己做还是咋了？这开关这么乱你觉得好看吗？」——顶栏被塞
   成两行，徽标、开关和一句 30 多字的说明互相挤。
3. 「UI 上描述的字太多了，好多都不需要你描述吧，搞的有的位置不够，有的很 low。」

第 1 条是产品结构决定，第 2、3 条是它的症状：主模型同步需要一行状态、按模型分规则需
要侧栏列表和搜索、每个 profile 需要页头徽标——这些都因为"主次"这个不存在的要求而存在。

## Decision

**只留一条全局降级链。** 第一跳永远是用户当前选中的模型（只打一次，不在配置里），
失败后按配置的降级候选顺序走。删掉：

- `profiles[]` / `when`（按模型分规则）与侧栏的规则列表、搜索、新建/删除规则弹窗；
- `primaryProfileId`、「主」徽标、`default-model.ts` 整块，以及**写 DSH 默认模型的
  同步**（`agentDefaultModel.saveSelection`）和两个 `@Remote`；
- `default.enabled`（"接管未配置的模型"）——它区分的正是"配过规则的模型"和"没配过
  的模型"，单链下这个区分不存在。接管只有 `enabled` 一个总闸。

配置形状：`{ enabled, chain: { candidates, switchOn, maxTotalAttempts, stickyTurns,
strategy }, health }`。

**迁移**（`src/chain.ts` 的 `effectiveChain`，host 与浏览器共用一份）：旧配置按
「链 → 默认兜底池 → 第一条规则」的顺序认领，规则的 `candidates[0]`（被钉死的
`when` 模型）丢弃——它成为隐式第一跳。多条规则只认第一条，`ignoredProfiles` 计数由
宿主 `logger.warn` 报出来，不静默丢弃用户配过的链。

**"空链"是一种配置，不是"没配"**：`chain` 键存在就赢，哪怕没有降级候选。把它当
"没配"会回头去过旧形状，把用户清空的链填回旧规则、用旧默认值覆盖他改过的预算。

**开关挪位**：从标题栏第二行改成链路页头一行正常的设置行（左标签右开关）。标题栏回到
单行，说明文字从一句 30 多字压到十几个字，其余细节进 tooltip。

**文案瘦身**：策略提示从三句长文改成短语 + tooltip（`strategyHint*` / `strategyDetail*`）；
时间轴的图例从工作台头部一行挪进 tooltip；`switchOnSubtitle`/`backoffHint`/
`maxTotalAttemptsHint`/`stickyTurnsHint` 全部砍到一行以内。

## Alternatives considered

### A1. 保留按模型分规则，只是把主模型和同步删掉

**最强理由**：改动最小，`when` 匹配、候选索引、primary 钉死这些已验证的机制原样不
动；用户配了多条规则时不会丢。

**为何被否**：用户明确说"不管我选啥模型，有问题就都根据这个配置路由"。分规则的形态
要求他为每个想降级的模型各配一条链，而他的实际用法只有一条。留着 `profiles` 就留着
侧栏列表、搜索、新建弹窗和 primary 钉死规则——正是他说"low"和"位置不够"的那部分。

### A2. 保留 default 兜底池作为唯一配置，不动 profiles

**最强理由**：default 池的语义（隐式第一跳 + 候选池）与目标完全一致，连迁移都省了。

**为何被否**：`default.enabled` 的语义是"接管**未配置**专属规则的模型"——它存在的意
义就是与 profiles 对立。单链下这个字段名和它的问题都变成谎言。而且"default"这个名字
描述的是"没有专属配置时的兜底"，不是"这条链"。

### A3. 第一跳可配置尝试次数（`firstHopAttempts`）

**最强理由**：旧 UI 的"单渠道尝试次数"对 primary 是可设的，去掉它意味着用户无法让自
己选中的模型重试。

**为何被否**：YAGI。第一跳只打一次是现有 default 池的既定规则，且它让降级发生得很快；
真有人要 same-route 重试，`llm-retry` 对未勾选的码仍然会重试（`switch-off-terminal`
场景钉着）。为一个没人要过的旋钮加一层配置不划算。

### A4. 迁移时把多条 legacy 规则的候选合并成一条链

**最强理由**：不丢任何用户配过的候选。

**为何被否**：合并会把两个不同 `when` 的链拼成一个顺序，而顺序是降级链的核心语义——
拼出来的顺序没有任何用户意图支撑。认第一条 + 响亮报告忽略了哪几条，比静默拼一条
用户没排过的序诚实。

### A5. 拖拽守卫用 `closest()` 判交互元素（初版）

**最强理由**：一行写完，语义直白。

**为何被否**：**浏览器实测抓到它是坏的**：卡片外面还有一层 `role="tabpanel"`（选路策
略面板），`closest` 拿整篇文档当边界时每张卡都被判成"在面板里"，拖拽一次也发不起来。
修为 `card.contains(hit)` 把边界收窄到本卡，并加源级守卫钉住。

## Consequences

**收益**

- 产品形态与用户心智一致：一条链，第一跳是选中的模型，失败按顺序降级。
- 插件**不再写 DSH 的全局配置**——上一轮的 `agentDefaultModel.saveSelection` 整块删掉，
   连同"被手动选择覆盖""写入被 overlay 拒绝"这些分支和两个 Remote 一起消失。
- UI 少一层：侧栏从"默认池 + N 条规则 + 健康"变成"降级链 + 健康"，新建/删除规则弹窗、
   primary 徽标、同步状态行全部消失。
- 标题栏回到单行；开关在正常的设置行里；文案普遍砍到一行。

**代价**

- **多规则用户会丢链**：只认第一条，其余由 `logger.warn` 报告。本项目 v0.1.0、单一
   用户、实际只有一条规则，所以接受；`ignoredProfiles` 的报错是为了让这个代价可见
   而不是静默。
- **第一跳不再有尝试次数旋钮**（见 A3）。
- **空链时插件整个不接管**（`resolveChain` 返回 undefined）——否则它会把自己的"一枪"
   上限强加给一个它没有任何东西可加的请求。UI 用空状态说明这一点。
- 配置形状变更：旧 `profiles`/`default` 键在保存一次之后从配置里消失（客户端只写
   `enabled`/`chain`/`health`）。

## 验证

- `unit.mjs` 121 → **142**：新增 `effectiveChain` 五个面向（链优先 / 兜底池 / 单规则
  迁移丢 primary / 多规则报告 / 空链是配置）；`resolveChain` 改全局语义三个面向；
   `failoverNotice` 文案改"降级 N/M"且不再叫"主模型"；规则表、schema 边界、字典覆盖
  全部按新形状重写。
- `client-controller.mjs` 46 → **47**：新增拖拽守卫的作用域守卫（钉住 A5 的修法）；
  接管开关的草稿与保存载荷；legacy 配置在浏览器侧读成同一条链且不写回旧键。
- `run.mjs` **23 场景 0 失败**：overlay 生成器加 `chainOf()` 适配器（场景仍按 profile
  写，生成时迁移——迁移规则因此被 20+ 个场景反复跑过）；`invalid-config-rejected` 改
  为重复渠道；新增 `no-fallback-means-no-takeover`；`total-cap`/`failover-rate-limit`/
  `breaker-*`/`precheck-*` 的期望值按"第一跳一枪"更新；`primary-condition-skip` 改名
  `fallback-condition-skip`（primary 不再是可配置候选，它的 `needs` 不复存在）。
- `remote.mjs` 14 → **15**：invocation id 表去掉两个已删方法；新增
  `takeover leaves DSH own default model alone`——反向钉住插件不再写用户默认模型。
- `npm run bundle`、`tsc --noEmit`、`node --check` 全过；DSH checkout 0 行。
- **浏览器实测**（隔离 `.dshhome-view` 端口 3397 + Chrome MCP）：侧栏两项、接管开关在
  设置行里可切、第一跳卡不可拖而两张降级卡 `draggable=true`+`cursor:grab`、从卡面发起
  dragstart 不再被取消（A5 的修复现场）、从按钮发起仍取消、上下按钮换序成功、时间轴
  24 格（1 格 26px=100% 绿，其余空槽）、scope 行与图例 tooltip、吞吐 90.9t/s 带说明。
  **实测抓到并修掉 A5 那个真 bug**。隔离实例测后已停；用户 live profile 的
  `cordis.patch.yml` SHA256 前后一致。

**未覆盖**：合成 DragEvent 驱动不了真实 HTML5 拖放（React synthetic 与浏览器drag机制
不同），重排路径由上下按钮（同一条 `reorderCandidates`）覆盖；拖拽发起/守卫由合成的
dragstart 事件覆盖。
