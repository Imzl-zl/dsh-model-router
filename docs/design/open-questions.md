---
title: "DSH Model Router — 决策登记簿"
status: "open"
kind: "decision-register"
last_updated: "2026-10-19"
---

# DSH Model Router — 决策登记簿

## 摘要

第一至四节为历史裁定，均已关闭并注明落点。第五节是 2026-10-17 实现层审查复核后
新开的 5 项修法取向；第六节（接管开关与时间轴）与第七节（一条全局降级链）是
2026-10-19 用户实际上手后的裁定，**第七节取代第六节里的「主模型」部分**。
每条裁定注明落点文档；源码证据见[能力边界](dsh-capability-boundary.md)，产品边界见
[product-plan.md](product-plan.md)，UI 规范见[ui-design.md](ui-design.md)，取舍理由见
`.agents/notes/`。本文件不重复上述文档的现状描述。

## 一、基础决策（已关闭）

| # | 问题 | 裁定 | 落点 |
|---|---|---|---|
| 1 | 第一版产品形态 | **选项 A：透明物理故障转移**。用户照旧选真实 provider/model，插件按有序候选切换；逻辑模型进官方 selector（选项 B）不做——需改 DSH 核心 catalog/selection/projection。三个必然后果（英文 notice、`next` 停留未兑现 pending、`request/header` 记 `reason:'change'`）已核实并接受 | product-plan §一、§4.3 |
| 2 | 候选索引跨重启 | **不跨重启**。进程内 `WeakMap<Agent, …>` 按 (agent, turn, step) 键控，重启即重置，README 写明；lineage 经插件自有 projection 可重建是另一件事。跨重启延续列 Phase 3，默认关 | product-plan §五 |
| 3 | 同渠道重试与 failover 的预算归属 | **两层**：同 route 重试归 `llm-retry`（含退避与 `llm/retry` durable 记录）；跨候选 failover 归 Router。候选的次数由 `maxRetries`（失败后重试几次，0..99）决定，**没有整请求总上限**——一个 step 的上界 = Σ(`maxRetries + 1`)。`agent/request-error` 用 `prepend: true` 注册在**最外层**（内层位置实测让 llm-retry 自己的同路由重试越过候选次数：配 2 打 7 次）；候选次数用尽且该切换时在 `await next()` 之前直接决定，不进 llm-retry。声明 `always` policy 的候选 provider 配置加载时拒绝 | 能力边界 §三 G2；.agents/notes/implemented/2026-10-20-retries-per-candidate.md |
| 4 | 两个 waterfall 的位置 | **都**用 `prepend: true` 拿最外层：`agent/request` 压过 `installModelSelection` 写回；`agent/request-error` 注册在 root ctx 一次、agent 从 payload 取。**2026-10-17 修订**：原"`agent/request-error` 注册到 `agent.ctx`、不用 prepend（位于 llm-retry 内层接放弃交接）"被实测推翻（同一"整条链都死"场景：内层 7 次 vs 外层 2 次真实调用），旧结论作废 | 能力边界 §三 G2 |
| 5 | 什么失败切渠道 | **默认全切 + 表外兜底**：八个具名码（`EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`INVALID_REQUEST`/`AUTH`/`QUOTA`）默认全开，另加 `other` 覆盖表外一切码；`ABORTED`/`NO_ADAPTER` 永不切换。取消勾选 = 交给 DSH 收尾。表外码与 `CONTEXT_WINDOW_EXCEEDED`/`IMAGE_OFFLOAD_REQUIRED` 永远先问内层（DSH 的 compaction），内层放弃后才换候选。旧配置按 `policyVersion` 一次性迁移。分类用 `LlmFailure.code`，不解析错误文案 | product-plan §2.2；.agents/notes/implemented/2026-10-22-failover-by-default-and-max-token-continue.md |
| 6 | 部分流输出后重试的 UI/日志语义 | Router 直接 retry 不产生 `llm/retry` records；用户可见性由中文 notice + Trajectory 既有 attempt 渲染承担。first-token 保留与 turn-process evidence 不作 MVP 要求 | product-plan §4.1-4.2 |
| 7 | 辅助模型调用 | **不路由**。compaction 与 session-title 由 DSH 各自插件配置管，本插件只覆盖 Agent 主请求，README 写明 | product-plan §十一 |
| 8 | attempt lineage 持久化 | 插件自有 session projection 折叠 `request/header` + `assistant/attempt`（+ `llm/retry-started`）：key 带插件命名空间、wire view 守 UI-scale、state plain JSON。零新增事件类型、零 plugin record | 能力边界 §三 G3 |
| 9 | 跨模型族兼容性 | **不推断等价**。候选资格 = 用户显式配置 + 运行时预校验（推理档位，自动维度）+ 条件路由（图片/上下文）。工具能力不做前置条件 | 见二.1 |

## 二、本轮新增裁定（源码核查后）

> **第 4–8 项描述的是 `profiles`/`default` 旧形状，已被第七节取代**（现行 schema 是 `enabled` + 一条 `chain`，见 product-plan §三）。第 1–3、9 项仍然有效。

| # | 裁定 | 结论 | 理由落点 |
|---|---|---|---|
| 1 | `needs.tools` 砍掉 | DSH 无任何机器可读的工具能力元数据；工具不兼容在运行时规范化为 `INVALID_REQUEST`/`PI_AI_ERROR` 并进入 `agent/request-error`，由 Router 按 `switchOn` 承接；`INVALID_REQUEST` 成 switchOn 可选项（默认不勾）。分类依赖 provider，README 声明不保证精确 | `.agents/notes/implemented/2026-10-12-drop-tools-eligibility-condition.md` |
| 2 | reasoningEffort 必须插件预校验 | `UNSUPPORTED_REASONING_EFFORT` 是 preparation error，直接终止 step+turn、不进 recovery waterfall（有测试断言）。Router 在 `agent/request` 返回候选前先过 `ctx.llm.resolveCallConfig()`，不过即跳过该候选；UI 候选节点展示 catalog 档位徽标 | `.agents/notes/implemented/2026-10-12-router-prevalidates-reasoning-effort.md` |
| 3 | 遥测抽屉 | 只保留“最近故障转移历史”：客户端 `ctx.remote.session.list()` 取会话（list 行自带 cached 投影提示）→ 对最近 N=20 个会话调 `projections({sessionId})` 取权威值。健康度/延迟/成功率/冷却倒计时**不做**（无数据来源，与全局熔断同批） | ui-design §2.3(5) |
| 4 | canonical schema | `enabled` 总闸 + `chain`（`candidates` 每条带 `maxRetries`/`weight`/`needs`、`switchOn`、`firstHopMaxRetries`、`stickyTurns`、`strategy`）。没有 `profiles`/`default`/`maxTotalAttempts`；旧形状在 `src/chain.ts` 的 `effectiveChain` 迁移 | product-plan §三 |
| 5 | primary 钉死 | `candidates[0]` 必须等于 `when` 模型：不可删、不可换序、~~不适用 needs~~。**2026-10-14 修订**：显式配置的 `needs` 条件对 primary 同样生效（用户意图不是静默改路）；primary 只豁免自动机制（熔断冷却、能力预校验）。跳过留 notice。见第四节 | ui-design §2.2(1) |
| 6 | 条件全部不满足 | 备用全被过滤且 primary 失败 → 终态报错 + 中文 notice“没有可用备用候选”；不忽略条件回退 primary | ui-design §2.3(3) |
| 7 | 配置校验分级 | 结构错误（ID 重复、上限非法、候选为空）硬失败（zod schema + `validateConfig()`，`fiber.update()` 先校验再重启）；provider 未注册（环境漂移）降级为该 profile 停用 + warn + UI 徽章 | product-plan §九 |
| 8 | 两个全局开关 | 总闸“启用渠道路由”（默认开，管插件整体）+ “接管未配置的模型”（默认关，管未配规则的模型）。命名与文案按此区分 | ui-design §四 |
| 9 | 退避不可配置 | 退避归 `llm-retry`，插件不另设一套；UI 只读展示，hint 披露“切换前会先等待一次退避” | product-plan §2.3 |

## 三、剩余待实测（非决策，不阻塞开工）

1. notice 在浏览器的实际折叠行样式（源码路径已确认）。
2. 设置页读自有投影（`list` → `projections`）无同型先例；机制已核实（guard 放行 + 值含插件 key），组合测试覆盖。
3. 插件热卸载：listeners、投影注册、UI slot 全部清除（宿主侧定时器已有 remote.mjs 断言）。
4. **投影 fork/resume 一致性**（2026-10-16 已实测关闭）：`tests/run.mjs` 的
   `assertFoldIsForkSafe` 用每个场景真 boot 产生的 durable 日志验证——一次 fold 与
   「分三段 fold + 每段边界 JSON 往返（= checkpoint 的 detached clone）」的持久形态一致、
   wire view 一致、持久形态过单元自己的 stateSchema、且 apply 从不就地修改入参
   （red-check 证实：把 apply 改成就地写会立刻报红）。

## 四、识图路由裁定（2026-10-14，源码核查后）

| # | 裁定 | 结论 | 理由落点 |
|---|---|---|---|
| 1 | 发送准入门边界 | **插件够不着发图前的拦截**：`session-controller/src/commands.ts:336-348` 在 prompt 准入时查"选中的模型"的 `inputModalities`，不含 image 拒收，消息从未生成。选择状态是 session-controller 私有字段（`ApiSessionAgentController` 直接 new 不进 ctx 服务），`installModelSelection` 只读内存 ref 不听耐久事件——两条偏门均实测死路 | `.agents/notes/implemented/2026-10-14-image-route-conditions-and-admission-gate-boundary.md` |
| 2 | 闭环形态 | 用户在 DSH 模型配置里给文本模型勾选 `input:[text,image]`（门禁只查声明），路由器用互斥条件保证 API 收不到图：primary `needs.images: false`、识图候选 `needs.images: true`。零点击；路由器没接管时撞 API 报错是响亮失败，已明确并接受 | 同上 |
| 3 | `images` 三态 | `true`=仅带图轮 / `false`=仅无图轮 / 不填=不限；一对互斥条件即"一条链拆成识图/文本两条路" | product-plan §2.4 |
| 4 | 条件作用于 primary | 修订二.5：显式条件是用户意图，跳过 primary 不留 silent reroute；自动机制仍豁免 | 本节一.5 |
| 5 | `hasImages` 按 turn 累积 | 取数 = 本步 claimed 用户消息 ∪ 本轮 `tool/result` 嵌套图片块（`read_image` 的图下一步才进请求）；`projectedTokens` 仍按 step | product-plan §2.4 |
| 6 | `stickyTurns` | profile/default 各一个数字，默认 0 = 无图轮立即切回；N>0 = 追问图片时识图模型多粘 N 轮。不做布尔、不做会话级常驻（会把用户锁在弱模型上） | product-plan §2.4 |
| 7 | 专门识图候选列表 | **不做**：在"选中识图模型过门禁"形态下，链顺序+互斥条件已表达全部意图，独立列表是同一事实的第二个来源 | 同上 |
| 8 | 自动 modality 门 | **不做**：用户给文本模型勾选识图后声明层面即"能识图"，自动门控永不触发；显式条件是唯一还能表达意图的机制 | 同上 |
| 9 | 已知限制 | 历史残留 retained 图片的纯文本后续轮会撞 API 报错（路由器在路由时机看不到请求历史：`agent/request` payload 不带 messages、`pre-step` 只给 claimed 输入）；DSH offload 最终把老图转文本，报错暂时；聊图开新会话可规避。不藏，写进文档 | product-plan §2.4 |
| 10 | 落回原路由的空转 bug | 修复：链上无可服务候选落回用户原路由时记 `exhausted`，否则 recovery 永远得到"继续"、turn 无限空转（实测 33716 次尝试） | 决策笔记 |
| 11 | DSH 上游诉求（未提） | 准入门基于"选中模型"在路由插件时代过时；最合理诉求是"选择回退从 header 改成记住最后一次显式 pick"——该改动能让勾选识图也不再必要。等用户决定何时提，不作为实现前置 | — |

## 五、实现层审查复核后新开（2026-10-17）

背景：四路只读审查 + 主代理逐条执行级复核（改回去看测试转红、构造可复现事件序列），
4 Critical / 11 Important / 22 Minor / 8 Nit 全部有处置。本节 5 项**修法取向已全部定案**
（无业务分歧，按 DSH 源码支持度与成熟方案裁定；其中 C2 与 I1 的修法已实改实测通过）。
现象本身都已验证，不重复列。

| # | 定案 | 依据与实测 | 影响面 |
|---|---|---|---|
| 1 | **C2：可服务性提成独立谓词，由 `decideRecovery` 在授权下一次发火之前判**（已实测通过） | 根因：可服务性判断藏在 `planFire` 的"顺带前进"里（`router.ts:135-142`），只在**发火当时**算一次；第一个能阻止这次发火的决策点 `decideRecovery` 在**下一次失败后**才跑，等它看到 `exhausted` 时多打的那一次已经打完。`agent/request` 必须返回一个 config，所以"在 handler 里拦"只能 redirect 不能 cancel——原文最小修法实测把多打的那次从末位候选搬到 primary，**总数仍是 4**。修法：`canFireAgain(state)`（当前候选还有预算，或还有下一个候选），`decideRecovery` 在 `return 'retry'` 之前判它。实测：3 次真实调用、health fold 每候选恰好一次、unit 99 / run.mjs 18 / client-controller 37 全绿。附带：不需要 notice（没有隐藏的调用）、`totalAttempts` 不被污染、`maxAttempts` 成为真不变量。**遗留清理**：`planFire` 的 `exhausted` 标记与 `decideRecovery` 的 `state.exhausted` 守卫都要留——后者还服务 `outgoing === undefined` 的落回路径，两者不可互相取代；同一次提交里写明分工 | `router.ts` 的 `planFire`/`decideRecovery` |
| 2 | **I1：留外层 + 本候选配额已尽时不让 llm-retry 插手**（第三选项，已实测通过，两者都要到） | 留外层是硬前提：删 `prepend` 后 `run.mjs:372` 打 7 次（上限 2）。但外层不必付内层的代价——在 `agent/request-error` 里、`await next()` **之前**判"本候选配额已尽 && 这个错该切换"，成立就直接决定（换得动返回 `{kind:'retry'}` 让 `planFire` 前进，换不动返回 `undefined` 终态），**根本不进 llm-retry**。实测：budget-cap 场景 boot **8547ms → 2227ms**、`llm/retry` **2 → 0**、`llm/retry-started` **2 → 0**、真实调用仍 2、18 场景 + 99 单测 + 37 client 全绿。语义依据：`maxAttempts` 的文案是"这条渠道最多真实调用多少次"，候选配额已尽时 llm-retry 想给同一条路由第二次本身就是越权——不让它做是执行分层不是破坏分层。附带修掉一个既有谎报：当前实现里 `llm/retry`/`llm/retry-started` 记录的 provider 往往不是真正被打的那一条（llm-retry 记"重试 primary"而 `planFire` 把这次重试改道到了 backup）。**实现陷阱（第一次 patch 实测踩到）**：熔断记录原本只在"内层放弃"分支，提前返回会跳过它 → `breaker-channel-scope-skips-sibling-models` 打红；修为提 `noteBreaker()` 闭包两分支共用，复验全绿 | `index.ts:325-362`、`run.mjs:372` |
| 3 | **I10：分三档，不是两档**（定案；验收用例需先扩 stub） | 可达性已核：`resolveCallConfig`（`llm/src/index.ts:871-872`）→ `registration()`(:940→995) → `resolveModelInfoFor`(:880 → pi-ai `adapter.ts:268`/`:271` → `normalizeModelInfo` :766/:773) → `resolveCallWithInfo`(:881→:897)，五类全可达。DSH 自己的分层支持三档：`agent.ts:603-610` 只吞 `NO_ADAPTER`、其余 preparation error 直接终态；`resolveCallConfig` 的 JSDoc(:864-866)把它定义为"对确切模型能力的校验"。① **请求形状不匹配** `UNSUPPORTED_REASONING_EFFORT` → 现有 `skipped` notice；② **路由不存在/配错** `UNKNOWN_MODEL`/`INVALID_CONFIG`/`NO_ADAPTER` → 独立 notice，措辞指向"去 Models 页 / 装 provider"而不是"改这条链"；③ **适配器契约违规** `INVALID_MODEL_INFO`/`INVALID_MODEL_CONTEXT` → `ctx.logger.error` + 明说"这是适配器缺陷"的 notice。**不 rethrow**：一个坏 adapter 会掀掉整条链，与插件目的相反；`logger.error` + durable notice 已经响，不构成静默兜底。验收：stub 的 `script[route].model` 返回不匹配的 `id` 即可触发 `INVALID_MODEL_INFO`（`normalizeModelInfo` 校验 `resolved.id === model`），新增组合场景断言三档文案可区分 | `index.ts:254-263`、`notice.ts`、`tests/stub-adapter.mjs` |
| 4 | **I7 滚动钩子：插件自己当滚动容器，零类名猜测**（定案） | 现状是两层猜测叠加：注入 `[class*="body"]{overflow-y:auto}` 把 DSH 的 body 改成滚动容器，再用 `closest('[class*="body"]')` 去找它。定案：删 `styles.ts:234-249` 的 `[class*="body"]` 整块；插件自己的 `#dsh-router-health-modal-body` 升级成滚动容器（`flex:1; min-height:0; overflow-y:auto`，它本来就是 flex 列的孩子）；`contentClassName` 用在 DSH 的 `css.content` 上给它 `flex:1; min-height:0`，让插件容器拿到有界高度；effect 改读自己的 id。依据：项目自己的教训（`tools.md`「别猜 DSH 的 CSS-modules 类名——猜类名的失败模式是静默的」）；`[hash]_[local]` 虽受构建保证（`tsdown.client.ts:562`），但 hash 随内容变，猜具体类名仍然脆。同时把四重变体收敛：`div[class*="dialog"]` 前缀是冗余的——插件传的 `className` 与 `css.dialog` 落在同一元素上（`Modal.tsx:64` `clsx(css.dialog, className)`），`.dsh-router-settings-modal` 单选择器即可 | `modals.ts:40-50`、`styles.ts:211-249` |
| 5 | **I7/M20 常数：内容链零 vh 算术；z-index 值本来就对，缺的是引用**（定案） | **70px 删掉**：`.content` 变成正规 flex 孩子后，内容链高度全部由容器链推导，`calc(84vh - 70px)` 连同魔数一起消失（实测 DSH 头高 22+28+12=62px，`Modal.module.css:71-77`，且两个弹窗的 `footer` prop 与 `.dialog` 的 `gap:20px` 完全没被 70px 考虑）。全文件只保留 `max-height: 84vh` 一个 vh 常数在 dialog 根上——"载体本身不超过视口 84%"是合法常数。守卫随之从 `calc\(100vh[^)]*\)` 改成"内容链不允许任何 vh 算术"——2026-10-20 重写后这条链是 `.dsh-router-page → .dsh-router-content` 与弹窗的 `.dsh-router-modal-content → 其最后一个孩子`，不再有 `masterList`/`detailWorkspace`/`workspaceScroll`/`modalContentArea` 这些旧类。**z-index 值不用改**：DSH 自己没有 z-index token 量表（`ui-dockkit/src/components/dockkit.module.css:544` 明写 "No z-index token layer exists to draw from"），而 **1100 是 DSH 自己"压在 Modal(1000) 之上一层"的既定值**——`Tooltip.module.css:25`、`Toast.module.css:12`、`Menu.module.css:45`、`ContextMeter.module.css:48`、`ModelSelect.module.css:93`、`PluginManagerPage.module.css:786`、`PickerPopover.module.css:8`、`TaskMenu.module.css:46`、`stat-dialog.module.css:12` 共 9 处。缺的只是引用：加注释点名 `Modal.module.css:10`=1000 与那 9 处先例，并把 1100/1101 提成命名常量（overlay/panel 一对） | `styles.ts:217,230,1259-1260`、`client-controller.mjs` 的 vh 守卫 |

**前置说明**：第 1、2 项改同一段代码（`index.ts:317-362`、`router.ts`），同一次提交落地；
第 3、4、5 项互相独立，可并行。

## 六、接管开关与主模型同步（2026-10-19）

背景：用户首次安装后提出"什么时候接管/有没有开关/开启后是否自动改模型"、"近期记录是
多久的"、"探测端点为什么有吞吐"、"名字挤压与只能抓握把拖动"。其中三条经源码核查是
缺陷（`onEnabled` 是死入口、时间线是"最近 24 次观测"而非时间桶、探测与被动吞吐混印）。
裁定：接管开关可见且**默认关**；时间轴 24 格固定 + 桶长可配（默认 10 分钟）；探测与
被动指标分开表述；整卡可拖（交互控件除外）；名字统一可压缩 + title + 中间省略。

**其中「主模型」部分已被第七节取代并删除**（没有主模型，也没有默认模型同步）；接管
开关默认关、时间轴时长桶、吞吐拆分、整卡拖拽与名字截断仍然有效。

## 七、一条全局降级链（2026-10-19，全部关闭）

背景：用户实际上手后提出"配置主模型是不是没啥用？我这个本来就是降级自动熔断切换
的……不管我选啥模型，有问题就都根据这个配置路由才对吧？分啥主次干啥？"，同时指出顶栏
开关"这么乱"、UI"描述的字太多"。

| # | 定案 | 依据与实测 | 影响面 |
|---|---|---|---|
| 1 | **只留一条全局降级链**：第一跳永远是用户当前选中的模型（只打一次），失败后按配置的降级候选顺序走 | 用户明确"不管我选啥模型……都根据这个配置路由"。分规则形态要求他为每个想降级的模型各配一条链，实际用法只有一条 | `config.ts` 的 `chain`；删 `profiles`/`when`/`default` |
| 2 | **删掉主模型与默认模型同步** | 没有主模型就没有"新会话从哪开始"要同步；插件因此不再写 DSH 的全局配置（`agentDefaultModel.saveSelection` 整块删除） | `src/default-model.ts` 删除；两个 `@Remote` 删除 |
| 3 | **迁移**：旧配置按「链 → 默认兜底池 → 第一条规则」认领，规则的 `candidates[0]`（钉死的 when 模型）丢弃；多条只认第一条并 `logger.warn` 报告 | 合并多条规则会拼出一条没人排过的顺序，比丢安静 | `src/chain.ts` 的 `effectiveChain`（host/浏览器共用） |
| 4 | **空链是一种配置**：`chain` 键存在就赢，哪怕没有降级候选；此时插件整个不接管 | 当成"没配"会回头过旧形状，把用户清空的链填回旧规则、覆盖他改过的预算 | `effectiveChain` 的判定；`resolveChain` 返回 undefined |
| 5 | **开关挪到链路页头的设置行**，标题栏回单行 | 标题栏是单行定高容器，塞第二行只会互相挤（用户实测截图） | `chain.ts` 的 `takeoverRow`；`footer.ts` 回单行 |
| 6 | **文案瘦身**：策略提示改短语 + tooltip，图例进 tooltip，长 hint 全部砍到一行 | 用户："描述的字太多了……搞的有的位置不够，有的很 low" | `locales.ts` 的 `strategyHint*`/`strategyDetail*` 等 |
| 7 | **拖拽守卫必须止于本卡** | 浏览器实测：卡外还有一层 `role="tabpanel"`，`closest` 拿文档当边界时每张卡都被判"在面板里"，拖拽一次也发不起来 | `pipeline.ts` 的 `card.contains(hit)` + 源级守卫 |

取舍、被否方案（含每案最强理由）与代价见
`.agents/notes/implemented/2026-10-19-one-global-fallback-chain.md`。

背景：用户首次安装后提出四类问题——什么时候接管/有没有开关/开启后是否自动改模型、
"近期记录"是多久的、探测端点为什么有吞吐、模型名挤压与只能抓握把拖动。其中三条经源码
核查是缺陷（`onEnabled` 是死入口、时间线是"最近 24 次观测"而非时间桶、探测与被动吞吐
混印），一条是设计缺口（拖拽起点只有 20px 握把）。

| # | 定案 | 依据与实测 | 影响面 |
|---|---|---|---|
| 1 | **接管开关可见，且默认关** | `config.enabled` 原本默认 true，而 `apply.ts` 的 `onEnabled` 从未被渲染——顶栏徽标不可点，"建好规则即接管"没有任何确认步骤。接管会改请求实际打到的渠道（资金/限流后果），默认值必须是显式选择。存量已存 `enabled: true` 的配置不动 | `config.ts` 的 `enabled` 默认值；顶栏 `Switch` |
| 2 | **开启时把新会话默认模型写成主模型，并跟随变化** | 唯一机制是 DSH 的 `agentDefaultModel.saveSelection()`：`currentSelection()` 只在会话没有 request header、没有 pending pick 时被读（`api/session-controller/src/agent.ts:299-304`），所以影响的恰好只有新会话，运行中的会话留在自己的 header/pick 上。代价：DSH 每次手动换模型都会把默认改掉（`commands.ts:177`），所以插件显示同步状态并给「重新同步」，不在每个请求上重断言 | 新模块 `src/default-model.ts`；`index.ts` 加载时同步；两个 `@Remote` |
| 3 | **主模型 = 显式标记，默认第一条，悬空回落第一条** | 多条规则时"谁是主"必须看得见；把"第一条"同时当候选链起点与新会话默认，会让改排序顺带改掉新会话从哪开始 | `config.ts` 的 `primaryProfileId`；列表小点 + 详情页徽标与按钮 |
| 4 | **时间轴 24 格固定 + 桶长可配（默认 10 分钟）** | 旧口径"最近 24 次观测、一格一次调用"没有时间含义：一天调两次与一分钟调两次画出同一张图。新口径柱高=该桶成功率（healthy 1 / degraded 0.5 / unhealthy 0），颜色 ≥99% 绿 / ≥90% 黄 / <90% 红，空桶=无数据。观测点按时间戳保留 24h + 600 条，改桶长不丢历史 | `src/timeline.ts` 重写；`health.ts` 裁剪规则；`health-ui.ts` 仪表盘；`health.timelineBucketSeconds` |
| 5 | **探测与被动指标分开表述，吞吐只在有真实输出时出现** | 探测只测首字（`probe.ts` 首字节即 abort），不产生输出也就没有吞吐；被动的 `usage.outputTokens ÷ 本步耗时`含首字等待，是端到端输出速率不是解码速率。混印在同一行会被当成同一次测量 | `HealthSignalDot`、`ChannelMetricsDashboard`、三条 hint 字典 |
| 6 | **整卡可拖，交互控件除外** | `draggable` 原本只挂在 20px 握把上。HTML5 拖放自建指针方案的替代被否（要重做拖影/放置/自动滚动）；触屏仍不可用，上下按钮保留 | `pipeline.ts` 的 `dragstart` 守卫 + 注入 CSS |
| 7 | **行名用 DSH 模型目录里的显示名，原始 `provider/model` 进 title** | 网关模型的 id 常是 `<uuid>:<model>`（可读的是用户在「模型」页映射的 `name`），末尾截断后同一网关下一堆模型共用前缀。显示名取 `session/modelCatalog` 的 `group.name` / `model.name`，缺名回落该半的 id，两半都缺则印原始键；长名由行内换行兜住，不做截断 | `src/client/naming.ts`；候选行/健康工作台/探测覆盖下拉/chip 重试行/失败历史 |

取舍、被否方案（含每案最强理由）与代价见
`.agents/notes/implemented/2026-10-19-takeover-switch-primary-sync-and-timeline-buckets.md`。

## 八、起点策略与连通性超时（2026-10-20）

| # | 问题 | 结论 | 出处 |
|---|---|---|---|
| 1 | weight / round-robin 下第一跳是否参与抽签 | **不参与（定案 2026-10-20）**：第一跳永远是用户选中的模型、永远先试；策略只决定它失败后从哪条降级候选开始。`startStep` 保留链首、只旋转降级候选，`resolveStartIndex` 只收降级候选。被否方案：给首跳加一个可配权重（新字段）——它把"我选了它就先用它"的承诺变成可被权重覆盖的默认值，且 UI 要多一个只对 weight 有意义的输入。代价：weight/round-robin 不能把首跳的流量分摊到别的渠道；需要分摊时把渠道都放进降级候选、把首跳当成固定入口。 | `router.ts` 的 `startStep` / `resolveStartIndex`；`tests/unit.mjs`、`tests/run.mjs` |
| 2 | 连通性检查缺少超时 | **2026-10-21 已修**：只接受取消、不设 deadline 时，一个"接受 TCP 但永不应答"的端点会让 `ui.checking` 永久锁死，之后手动与定时检查全部 no-op。现为每条路由 10s 硬上限 + `Promise.race`，超时判 `unreachable`/`TIMEOUT`；deadline 与取消共用 `src/deadline.ts` 的 `fuseDeadline`（探测已同步收编）。 | `connectivity.ts`、`deadline.ts`；`.agents/notes/implemented/2026-10-21-connectivity-deadline-and-honest-history.md` |

## 九、按会话选链与重试上限（2026-10-21，待决）

| # | 问题 | 定案（2026-10-21 用户裁定） | 备注 |
|---|---|---|---|
| 1 | 不同会话不同任务需要不同模型 | **命名链 + 面板按会话选**：工作台列出全部会话（`session.list` + `title` 投影给名字），选一条命名链；绑定存 `ctx.storageDomain` 会话侧车（`bundle/base` 已挂载 storage 家族），写操作走插件自有 Remote。不需要 slash 命令。熔断规则跟链、状态仍全局。见[按会话选择降级链](per-session-chains.md) | 绑定开关注释：无 storage 时内存 + 可见 notice；fork 默认不继承 |
| 2 | 配 10 次只发生 6 次（`1 + min(10, 5)`） | **已实施（2026-10-21）**：插件独占重试。勾选的码由插件自己退避（曲线照抄 DSH：`initialDelayMs`/`maxDelayMs`/`jitterRatio`/`Retry-After`）并返回 `{kind:'retry'}`，次数就是 `maxRetries + 1`；未勾的码仍 `next()` 交给 DSH。见[重试预算归属](retry-budget-ownership.md)、`.agents/notes/implemented/2026-10-21-plugin-owns-retries.md` | 不伪造 `llm/retry`：轨迹里没有 `llm/retry` 行，但每次尝试的 `assistant/attempt` 一条不少 |
