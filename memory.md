# DSH Model Router 项目状态

> 当前状态快照 + 最近活跃窗口；决策理由见 `.agents/notes/`，稳定协作知识见 `tools.md`，设计现状见 `docs/`。

## 当前基线

- 完整插件项目（`packages/dsh-model-router/`：宿主 + UI 半包 + 条件路由 + lineage 投影 + 遥测抽屉 + 双引擎渠道健康监控），GitHub 仓库 `Imzl-zl/dsh-model-router`（公开）。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`（严格只读）；项目根：`D:\sudy\myproject\dsh-model-router`。
- 最后更新：2026-10-14（渠道健康监控落地闭环，双引擎被动零消耗+主动首字中断探测，UI 直观徽标与控制中心配置）。
- 验证状态：单测 16/16（node strip-types 直导 .ts，含健康状态与投影折叠）+ 组合测试 9/9（真实 headless Loader + stub）+ 真实 provider 1/1（活网关真 500 跨 key 切换）+ 浏览器全链路；`tsc --noEmit` 0 错误；DSH checkout `status --porcelain` 0 行。

## 已完成能力

- 建立路由架构提案、源码地图、未决问题、实施阶段和官方先例对照，确认 Agent 主请求 `agent/request` prepend 最外层，`agent/request-error` 置于 `llm-retry` 内层。
- 确定两层 attempt 边界与条件路由（图片 pre-step 精确检测、上下文 tokenMeter contextPressure 投影估算；用户路由豁免）。
- **Phase 1~2 宿主与 UI 闭环**：有序备份链 + switchOn 策略 + 单渠道次数与硬总上限 + 中文 notice + 预校验跳过 + default 纯备用池 + 加载时结构校验 + failover 历史抽屉。
- **UI 与入口重构实测落地**：`sidebar.footer.action` 侧栏自适应入口（CSS 弹性纵向列排布，与 `dsh-toolbox-ui` 完美自适应堆叠并存，绝不抢位挤占）；吸顶 Header 与 Modal Top Bar 为唯一主保存入口，去除冗余悬浮条与重复底栏按钮，支持 `Ctrl+S` 与防换行状态反馈；CandidateNode 引入 Stepper 步进器与科技感流向视觉。
- **双引擎渠道健康监控（Health Monitoring）闭环**：
  1. *架构决策*：坚守 Profile -> 候选链单一入口，不分拆新页面，符合 LiteLLM/Portkey 行业标准；
  2. *被动零成本观测*：`session/event` 自动采集成功请求端到端延迟标记 `healthy` 🟢，`agent/request-error` 拦截 429/500/TIMEOUT/TRANSPORT 分类标记 `degraded` 🟡 / `unhealthy` 🔴，经 `channelHealthProjection` 折叠持久化至 Session 投影，0 额外 Token 消耗；
  3. *主动极速探测*：`ctx.llm.stream()` 设 `maxTokens: 1` 并在首字（TTFT）到达时立即 `abort()` 掐断生成，消耗 <1 Token；支持自定义探测内容（避开渠道违禁词）、探测超时（默认 8s）与自动轮询周期（默认 0 关闭防偷跑资费）；
  4. *UI 与交互*：候选卡片实时展示 `HealthBadge`（🟢 正常 140ms / 🟡 降级 / 🔴 异常 / ⚪ 未探测）；吸顶顶栏与弹窗顶栏配备「⚡ 探测全部渠道」与「⚙️ 健康设置」弹窗；
  5. *远程接入*：实现 `RouterHealthService` 继承 `TypertRemoteService`（namespace: `'routerHealth'`），安全兼容 Node 24 原型描述符与 client 侧 `$mount` fail-open 保护。
- 决策笔记状态：`implemented/` 8 篇（含本次 `2026-10-14-channel-health-monitoring.md`）。

## 仍需注意的坑点

- waterfall 数组首个 listener 是最外层、其返回值即最终值；`await next()` 之后改写覆盖内层。Router 必须 `prepend: true`。
- `agent/request` 在重试时再次触发且解析回同一条 route（`installModelSelection` 每次 attempt 写回用户选择）。Router 必须自持 per-(agent, turn, step) 索引。
- adapter 不声明 policy 时 llm-retry 仍以默认 normal `maxRetries=5` 重试；总边界由 Router 第一层提供。
- 仓库外插件新增 durable 事件类型实际封闭；durable lineage 走插件自有 session projection。
- `agent/pre-step` 在 `agent/request` 之前触发且 `decision.messages` 可读，是条件路由取数的稳定时机。
- `UNSUPPORTED_REASONING_EFFORT` 是 preparation error，直接终止 step+turn，不进 recovery；Router 必须在 `agent/request` 返回前用 `ctx.llm.resolveCallConfig()` 预校验。
- Node 24 `--experimental-strip-types` 无法解析 Stage 3 装饰器语法，Typert 远程方法描述符必须直接在 Prototype 上通过静态属性挂载。
- 探测大模型存活切勿等待完整生成回复；捕获首字 chunk（TTFT）必须立即 `controller.abort()`，以将 Token 消耗压至极限。
- 严格遵循常驻军规：绝不把 provider 重试、跨渠道 failover 和跨请求健康状态混成同一个次数或状态。

## 最近活跃窗口

- **四路并行深挖 DSH 能力边界**并关闭九项未决问题，Phase 1 spike 实跑通过。
- **Phase 1~2 host + UI 落地**（2026-10-12~13）：组合测试 9/9 + 单测 12/12 + 浏览器全链路；抓到并修 10 个真 bug。
- **真实 provider 实测 + 开源门面**（2026-10-13）：活网关真 500 → SERVER → 跨 key 切换全对；GitHub 公开仓库与同构图标落成。
- **UI 与入口重构实测落地**（2026-10-13）：`sidebar.footer.action` 侧栏自适应入口（纵向自适应堆叠，与 `dsh-toolbox-ui` 完美并存），吸顶主保存与快捷键去重，微交互打磨。
- **渠道健康监控实测落地**（2026-10-14）：双引擎设计落地（被动零消耗 + 主动 1-Token TTFT 中断，自定义 Prompt 避违禁词），`RouterHealthService` + `channelHealthProjection`，UI 直观徽标与控制中心快捷探测/设置；16/16 单测 + 9/9 组合测试 + tsc 0 报错全绿。
