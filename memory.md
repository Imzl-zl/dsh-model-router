# DSH Model Router 项目状态

> 当前状态快照 + 最近活跃窗口；决策理由见 `.agents/notes/`，稳定协作知识见 `tools.md`，设计现状见 `docs/`。

## 当前基线

- 完整插件项目（`packages/dsh-model-router/`：宿主 + UI 半包 + 条件路由 + lineage 投影 + 遥测抽屉 + 双引擎渠道健康监控 + 识图路由），GitHub 仓库 `Imzl-zl/dsh-model-router`（公开）。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`（严格只读）；项目根：`D:\sudy\myproject\dsh-model-router`。
- 最后更新：2026-10-14（识图路由闭环：images 三态条件 + turn 累积 + stickyTurns + 准入护栏边界裁定）。
- 验证状态：单测 66/66（node strip-types 直导 .ts，含三态条件/turn 累积/tool-result 取数/sticky 窗口）+ 组合测试 12/12（真实 headless Loader + stub）+ 真实 provider 1/1（活网关真 500 跨 key 切换）+ 浏览器全链路；`tsc --noEmit` 0 错误；DSH checkout `status --porcelain` 0 行。

## 已完成能力

- 建立路由架构提案、源码地图、未决问题、实施阶段和官方先例对照，确认 Agent 主请求 `agent/request` prepend 最外层，`agent/request-error` 置于 `llm-retry` 内层。
- 确定两层 attempt 边界与条件路由（图片 pre-step 精确检测、上下文 tokenMeter contextPressure 投影估算；用户路由豁免）。
- **Phase 1~2 宿主与 UI 闭环**：有序备份链 + switchOn 策略 + 单渠道次数与硬总上限 + 中文 notice + 预校验跳过 + default 纯备用池 + 加载时结构校验 + failover 历史抽屉。
- **UI 与入口重构实测落地**：`sidebar.footer.action` 侧栏自适应入口（CSS 弹性纵向列排布，与 `dsh-toolbox-ui` 完美自适应堆叠并存，绝不抢位挤占）；吸顶 Header 与 Modal Top Bar 为唯一主保存入口，去除冗余悬浮条与重复底栏按钮，支持 `Ctrl+S` 与防换行状态反馈；CandidateNode 引入 Stepper 步进器与科技感流向视觉。
- **双引擎渠道健康监控（Health Monitoring）与时间轴仪表盘闭环**：
  1. *架构决策*：坚守 Profile -> 候选链单一入口，不分拆新页面，符合 LiteLLM/Portkey 行业标准；
  2. *被动零成本观测*：`session/event` 自动采集成功请求端到端延迟标记 `healthy` 🟢，`agent/request-error` 拦截 429/500/TIMEOUT/TRANSPORT 分类标记 `degraded` 🟡 / `unhealthy` 🔴，经 `channelHealthProjection` 折叠持久化至 Session 投影，0 额外 Token 消耗；
  3. *真实 tok/s 测算机制*：主动探测设定 `maxTokens: 1` 并在首字（TTFT）到达时立即 `abort()`，仅测存活与首字延迟，绝不拿 1 个 token 虚假除算；真实的 `161.1t/s` 吞吐量源自 DSH 日常会话原生 `assistant/message` 真实输出 tokens 与耗时解算；
  4. *时间轴波动仪表盘（Sparkline Timeline Bars）*：各候选渠道卡片直观内嵌 3 列仪表盘（对齐截图）：状态可用率（如 `99.96%`）+ 24 根竖向胶囊状态条（支持悬浮缩放高亮与详细时间/延迟/吞吐 Tooltip）、延迟自适应展示（`140ms` 或 `8.39s`）、真实吞吐（`161.1t/s`）；
  5. *主动极速探测*：支持自定义探测内容（避开渠道违禁词）、探测超时（默认 8s）与自动轮询周期（默认 0 关闭防偷跑资费）；
  6. *控制中心与远程接入*：吸顶顶栏与弹窗顶栏配备「⚡ 探测全部渠道」与「⚙️ 健康设置」弹窗；实现 `RouterHealthService` 继承 `TypertRemoteService`（namespace: `'routerHealth'`），安全兼容 Node 24 原型描述符与 client 侧 `$mount` fail-open 保护。
- **识图路由闭环（2026-10-14）**：`needs.images` 三态（true=仅带图轮 / false=仅无图轮 / 不填=不限）+ 显式条件可作用于 primary（修订 open-questions 二.5）+ `hasImages` 按 turn 累积（取数 = 本步 claimed 用户消息 ∪ 本轮 tool/result 嵌套图片块）+ `stickyTurns` 粘滞窗口（默认 0）+ 条件跳过 notice 按 (turn, 跳过组) 去重 + 修掉落回原路由路径不推进状态导致的无限空转 bug。边界裁定：DSH 发送准入门（`session-controller/src/commands.ts:336-348`）在路由之前且查"选中的模型"，插件够不着；闭环形态 = 用户在 DSH 模型配置里给文本模型勾 `input:[text,image]`（门禁只查声明）+ 互斥条件保证 API 收不到图。
- 决策笔记状态：`implemented/` 9 篇（含本次 `2026-10-14-image-route-conditions-and-admission-gate-boundary.md`）。

## 仍需注意的坑点

- waterfall 数组首个 listener 是最外层、其返回值即最终值；`await next()` 之后改写覆盖内层。Router 必须 `prepend: true`。
- `agent/request` 在重试时再次触发且解析回同一条 route（`installModelSelection` 每次 attempt 写回用户选择）。Router 必须自持 per-(agent, turn, step) 索引。
- adapter 不声明 policy 时 llm-retry 仍以默认 normal `maxRetries=5` 重试；总边界由 Router 第一层提供。
- 仓库外插件新增 durable 事件类型实际封闭；durable lineage 走插件自有 session projection。
- `agent/pre-step` 在 `agent/request` 之前触发且 `decision.messages` 可读，是条件路由取数的稳定时机；但 messages 只是本步新 claimed 输入（工具循环后续步为空），图片条件必须按 turn 累积，且 tool/result 里嵌套的图片块（read_image）要在 session/event 里补刀。
- `UNSUPPORTED_REASONING_EFFORT` 是 preparation error，直接终止 step+turn，不进 recovery；Router 必须在 `agent/request` 返回前用 `ctx.llm.resolveCallConfig()` 预校验。
- Node 24 `--experimental-strip-types` 无法解析 Stage 3 装饰器语法，Typert 远程方法描述符必须直接在 Prototype 上通过静态属性挂载。
- 探测大模型存活切勿等待完整生成回复；捕获首字 chunk（TTFT）必须立即 `controller.abort()`，以将 Token 消耗压至极限。
- 严格遵循常驻军规：绝不把 provider 重试、跨渠道 failover 和跨请求健康状态混成同一个次数或状态。
- **DSH 发送准入门在路由之前**：带图 prompt 若选中模型不声明 image modality，`session-controller/src/commands.ts:336-348` 直接拒收，消息从未生成——插件无缝可修。选择状态是 session-controller 私有字段，`installModelSelection` 只听内存 ref。闭环只能靠"用户在 DSH 给文本模型勾 input:[text,image]（门禁只查声明）+ 互斥 images 条件"。
- **链上无可服务候选落回用户原路由时，必须记 `exhausted`**：否则 recovery 永远得到"继续"、turn 在原路由上无限空转（实测 33716 次尝试/180s）。
- `agent/request` 的 payload **不带 messages**（`core/agent/src/runtime-types.ts:337`）；路由器在路由时机看不到请求历史，"历史残留图的纯文本轮次"是已知限制（撞 API 响亮报错）。

## 最近活跃窗口

- **四路并行深挖 DSH 能力边界**并关闭九项未决问题，Phase 1 spike 实跑通过。
- **Phase 1~2 host + UI 落地**（2026-10-12~13）：组合测试 9/9 + 单测 12/12 + 浏览器全链路；抓到并修 10 个真 bug。
- **真实 provider 实测 + 开源门面**（2026-10-13）：活网关真 500 → SERVER → 跨 key 切换全对；GitHub 公开仓库与同构图标落成。
- **UI 与入口重构实测落地**（2026-10-13）：`sidebar.footer.action` 侧栏自适应入口（纵向自适应堆叠，与 `dsh-toolbox-ui` 完美并存），吸顶主保存与快捷键去重，微交互打磨。
- **渠道健康监控实测落地**（2026-10-14）：双引擎设计落地（被动零消耗 + 主动 1-Token TTFT 中断，自定义 Prompt 避违禁词），`RouterHealthService` + `channelHealthProjection`，UI 直观徽标与控制中心快捷探测/设置；16/16 单测 + 9/9 组合测试 + tsc 0 报错全绿。
- **时间轴波动仪表盘与原生吞吐闭环**（2026-10-14）：24 柱时间轴波动条（绿/黄/红/灰）与可用率计算落地，解耦主动探测延迟与原生被动会话真实 tok/s，18/18 单测 + 9/9 组合测试 + tsc 0 报错全绿。
- **识图路由闭环**（2026-10-14）：用户场景「强文本日常 + 突然发图」驱动，四轮设计迭代。关键源码事实：DSH 发送准入门在路由前且查选中模型（`session-controller/src/commands.ts:336-348`）；选择记忆回退到最后一次 request header（`agent.ts:294-310`）；`agent/request` payload 不带 messages；`installModelSelection` 不听耐久事件。裁定：用户给文本模型勾 `input:[text,image]` + 互斥 images 条件，零点击闭环。实现三态条件/turn 累积（含 tool/result 取数）/stickyTurns/notice 去重，并修掉落回原路由不推进状态的无限空转（33716 次尝试对证）。66/66 单测 + 12/12 组合 + tsc 0 全绿；文档（product-plan/ui-design/open-questions/README）+ 决策笔记同步落地。
