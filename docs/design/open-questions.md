---
title: "DSH Model Router — 决策登记簿"
status: "closed"
kind: "decision-register"
last_updated: "2026-10-12"
---

# DSH Model Router — 决策登记簿

## 摘要

历史未决事项已全部关闭。每条裁定注明落点文档；源码证据见[能力边界](dsh-capability-boundary.md)，产品边界见[product-plan.md](product-plan.md)，UI 规范见[ui-design.md](ui-design.md)，取舍理由见 `.agents/notes/`。本文件不重复上述文档的现状描述。

## 一、基础决策（已关闭）

| # | 问题 | 裁定 | 落点 |
|---|---|---|---|
| 1 | 第一版产品形态 | **选项 A：透明物理故障转移**。用户照旧选真实 provider/model，插件按有序候选切换；逻辑模型进官方 selector（选项 B）不做——需改 DSH 核心 catalog/selection/projection。三个必然后果（英文 notice、`next` 停留未兑现 pending、`request/header` 记 `reason:'change'`）已核实并接受 | product-plan §一、§4.3 |
| 2 | 候选索引跨重启 | **不跨重启**。进程内 `WeakMap<Agent, …>` 按 (agent, turn, step) 键控，重启即重置，README 写明；lineage 经插件自有 projection 可重建是另一件事。跨重启延续列 Phase 3，默认关 | product-plan §五 |
| 3 | 同渠道重试与 failover 的预算归属 | **两层**：同 route 重试归 `llm-retry`（含退避与 `llm/retry` durable 记录）；跨候选 failover 与硬总上限归 Router。总 worst case = 候选数 × (1 + maxRetries)；声明 `always` policy 的候选 provider 配置加载时拒绝 | product-plan §六 |
| 4 | 两个 waterfall 的位置 | `agent/request` 用 `prepend: true` 拿最外层（压过 `installModelSelection` 写回）；`agent/request-error` 推迟到 `agent/created` 注册到 `agent.ctx`、**不用** prepend（位于 `llm-retry` 内层接放弃交接）。均已实测 | 能力边界 §三 G2 |
| 5 | 什么失败切渠道 | `switchOn` 默认 = DSH normal policy 五码（`EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`）；`INVALID_REQUEST` 可勾选（默认不勾）承接工具等能力不兼容；`ABORTED`/`AUTH`/`NO_ADAPTER` 不切换。分类用 `LlmFailure.code`，不解析错误文案 | product-plan §2.2 |
| 6 | 部分流输出后重试的 UI/日志语义 | Router 直接 retry 不产生 `llm/retry` records；用户可见性由中文 notice + Trajectory 既有 attempt 渲染承担。first-token 保留与 turn-process evidence 不作 MVP 要求 | product-plan §4.1-4.2 |
| 7 | 辅助模型调用 | **不路由**。compaction 与 session-title 由 DSH 各自插件配置管，本插件只覆盖 Agent 主请求，README 写明 | product-plan §十一 |
| 8 | attempt lineage 持久化 | 插件自有 session projection 折叠 `request/header` + `assistant/attempt`（+ `llm/retry-started`）：key 带插件命名空间、wire view 守 UI-scale、state plain JSON。零新增事件类型、零 plugin record | 能力边界 §三 G3 |
| 9 | 跨模型族兼容性 | **不推断等价**。候选资格 = 用户显式配置 + 运行时预校验（推理档位，自动维度）+ 条件路由（图片/上下文）。工具能力不做前置条件 | 见二.1 |

## 二、本轮新增裁定（源码核查后）

| # | 裁定 | 结论 | 理由落点 |
|---|---|---|---|
| 1 | `needs.tools` 砍掉 | DSH 无任何机器可读的工具能力元数据；工具不兼容在运行时规范化为 `INVALID_REQUEST`/`PI_AI_ERROR` 并进入 `agent/request-error`，由 Router 按 `switchOn` 承接；`INVALID_REQUEST` 成 switchOn 可选项（默认不勾）。分类依赖 provider，README 声明不保证精确 | `.agents/notes/implemented/2026-10-12-drop-tools-eligibility-condition.md` |
| 2 | reasoningEffort 必须插件预校验 | `UNSUPPORTED_REASONING_EFFORT` 是 preparation error，直接终止 step+turn、不进 recovery waterfall（有测试断言）。Router 在 `agent/request` 返回候选前先过 `ctx.llm.resolveCallConfig()`，不过即跳过该候选；UI 候选节点展示 catalog 档位徽标 | `.agents/notes/implemented/2026-10-12-router-prevalidates-reasoning-effort.md` |
| 3 | 遥测抽屉 | 只保留“最近故障转移历史”：客户端 `ctx.remote.session.list()` 取会话（list 行自带 cached 投影提示）→ 对最近 N=20 个会话调 `projections({sessionId})` 取权威值。健康度/延迟/成功率/冷却倒计时**不做**（无数据来源，与全局熔断同批） | ui-design §2.3(5) |
| 4 | canonical schema | `enabled` 总闸 + `profiles` 数组（`id`/`when`/`candidates`/`switchOn`/`maxTotalAttempts`）+ `default` 纯备用池（`enabled`/`candidates`/`switchOn`/`maxTotalAttempts`）。ui-design 控制器的 dict 形态作废 | product-plan §三 |
| 5 | primary 钉死 | `candidates[0]` 必须等于 `when` 模型：不可删、不可换序、不适用 needs。跳过 primary = 无失败也静默改路 | ui-design §2.2(1) |
| 6 | 条件全部不满足 | 备用全被过滤且 primary 失败 → 终态报错 + 中文 notice“没有可用备用候选”；不忽略条件回退 primary | ui-design §2.3(3) |
| 7 | 配置校验分级 | 结构错误（ID 重复、上限非法、候选为空）硬失败（zod schema + `validateConfig()`，`fiber.update()` 先校验再重启）；provider 未注册（环境漂移）降级为该 profile 停用 + warn + UI 徽章 | product-plan §九 |
| 8 | 两个全局开关 | 总闸“启用渠道路由”（默认开，管插件整体）+ “接管未配置的模型”（默认关，管未配规则的模型）。命名与文案按此区分 | ui-design §四 |
| 9 | 退避不可配置 | 退避归 `llm-retry`，插件不另设一套；UI 只读展示，hint 披露“切换前会先等待一次退避” | product-plan §2.3 |

## 三、剩余待实测（非决策，不阻塞开工）

1. 完整候选链 `runLoaderSmoke` 组合测试（含预校验跳过候选用例）。
2. notice 在浏览器的实际折叠行样式（源码路径已确认）。
3. 投影 fork/resume 与 snapshot 重放一致性。
4. 设置页读自有投影（`list` → `projections`）无同型先例；机制已核实（guard 放行 + 值含插件 key），组合测试覆盖。
5. 插件热卸载：listeners、投影注册、UI slot 全部清除。
