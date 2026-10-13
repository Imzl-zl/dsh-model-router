# Agent Note: 渠道健康监控设计与实现（双引擎被动零消耗+主动首字中断探测）

Status: implemented

## Problem

1. **渠道状态黑盒**：用户配置了多条备用渠道后，缺乏直观手段了解各 Provider / 渠道当前是否可用及响应延迟，难以及时调整链路顺序或排查配置问题。
2. **大模型监控的高昂 Token 成本矛盾**：若采用常规对话或长 Prompt 周期轮询探测，会在后台产生大量不必要的 Token 计费。
3. **内容安全拦截与违禁词风险**：部分国内聚合渠道或托管厂商对输入设有严格的敏感词过滤系统，硬编码的探测文案（如 `hello world`、`ping`）可能在特定渠道触发拦截误报。
4. **架构取舍疑虑（同一模型不同渠道是否单独拆页面）**：用户提问“同一个模型不同渠道是单独做一个页面配置还是就还是现在这样自己添加？”需要给出专业架构分析与明确实现路径。

## Decision

1. **维持现有统一架构（Profile -> 候选渠道链路），不拆分新页面**：
   - 参考 LiteLLM、Portkey、OpenRouter 等工业级 AI Gateway 的主流设计标准，均以逻辑模型（Profile）作为对上业务入口，以有序物理渠道（Candidate Chain）作为底层执行管道；
   - 当前设计已完美支持在同一模型下配置官方直连、硅基流动、OpenRouter、Azure 等不同物理渠道，并支持优先级调整、单渠道重试上限与多模态/上下文门槛；
   - 若将不同渠道拆分为独立页面，会导致主备关系割裂、降级顺序丢失，并在配置加载与保存时产生多源冲突，因此坚定维持统一链路架构。

2. **双引擎健康监控设计（被动零消耗 + 主动极小 Token 快速探测）**：
   - **被动零成本观测（Passive Observation）**：
     - 挂接 `session/event`，在正常对话收到回复时计算实际端到端耗时，即时将渠道标记为 `healthy` 🟢；
     - 挂接 `agent/request-error`，精准捕获 429、500、TIMEOUT、TRANSPORT 等失败，分类标记为 `degraded` 🟡 或 `unhealthy` 🔴；
     - 注册 `channelHealthProjection`（`router/channel-health`），在会话间折叠持久化健康数据，日常对话过程产生 0 额外 Token 消耗。
   - **主动极速探测（Active TTFT Probing）**：
     - 通过 `ctx.llm.stream()` 发送探测请求，设定 `maxTokens: 1`；
     - 关键中断机制：监听流式 Chunk，捕获到首个有效输出（`text-delta` / `reasoning-delta` / `block-start`）即判定渠道存活，立即触发 `controller.abort()` 掐断后续流，仅消耗首字（< 1 Token）并记录 TTFT 毫秒延迟；
     - 避开敏感拦截：探测文案支持完全自定义（默认 `"hi"`），用户可自由设定安全探测词；
     - 周期与超时控制：支持自定义探测超时（默认 8 秒）；自动探测周期默认设为 0 分钟（即默认仅手动/被动观测，杜绝意外计费，用户可按需开启）。

3. **常驻军规遵守与隔离**：
   - 严格分离三种生命周期：
     1. Provider 内部重试（单次请求同渠道内重试，受 DSH adapter 托管）；
     2. 跨渠道 failover（单次请求单步降级流转，受 Router 本地 step 状态机托管）；
     3. 跨请求全局健康状态（持久化与动态探测指标，受 `HealthMonitor` 与 Session 投影托管）。
   - 三者绝不混用同一个计数器或状态。

4. **时间轴波动仪表盘与真实 tok/s 计算机制（对齐监控截图）**：
   - **响应用户关于 tok/s 的深度洞察**：
     - 用户敏锐指出：“主动探测只发 1 个 Token，根本测不出真实 tok/s”。
     - 这一判断完全属实：主动探测设定 `maxTokens: 1` 并于首字到达立即中断，只有 1 个 token，严禁拿 1 个 token 强行除算伪造吞吐。
     - 真实的 `tok/s` 吞吐量**源自 DSH 原生日常会话数据**：在 `channelHealthProjection` 中监听 `assistant/message`，从原生 `usage.outputTokens` 与耗时真实解算出 `outputTokens / ((completedTime - firstTokenTime) / 1000)` 并保留一位小数（如 `161.1t/s`）；未采样时长文本吞吐显示 `—`，绝不虚构。
   - **时间轴波动仪表盘（Channel Metrics Dashboard）**：
     - 在每个候选卡片下方呈现高质感暗黑磨砂仪表盘（对齐截图样式）：
       - **状态（Availability %）**：展示如 `99.96%`，下方排列 24 根竖向胶囊时间轴柱（绿色 `#00e599`=正常，黄色=降级，红色=失败，暗灰=闲置），支持悬浮高亮放大与详细 tooltip；
       - **延迟（Latency）**：自适应毫秒与秒，如 `140ms` 或 `8.39s`；
       - **吞吐（Throughput）**：真实会话沉淀的 `161.1t/s`。

5. **UI 视觉与交互呈现**：
   - **健康徽章与仪表盘**：在所有候选渠道卡片内直观显示状态与波动时间轴；
   - **操作入口**：在页面吸顶 Header 与侧栏弹出视窗顶栏统一放置「⚡ 探测全部渠道」与「⚙️ 健康设置」按钮；探测时带 Spinner 旋转防重入动画；
   - **健康设置弹窗（`HealthSettingsModal`）**：提供启用开关、自定义探测 Prompt、自动探测周期（分钟）及探测超时（秒）的快捷微调。

6. **Typert 远程服务与运行时兼容**：
   - 实现 `RouterHealthService` 继承 `TypertRemoteService`（namespace: `'routerHealth'`），暴露 `getSnapshot` 与 `probeAll`；
   - 规避 Node 24 `--experimental-strip-types` 无法解析 Stage 3 装饰器语法的限制，通过原型属性安全挂载 Remote 描述符；
   - Client 端通过 `ctx.remote.$mount` 与 fail-open 双重保护接入，无缝兼容 Headless 及各类宿主环境。

## Alternatives considered

1. **每次探测等待模型生成完整句子**
   - 被否原因：大模型输出 20~50 字会产生明显的输出 Token 计费，并在网络波动时耗费数秒；首字到达（TTFT）已 100% 验证了 Provider 认证、网络传输与模型服务可用性，立即中断能够节省 99% 以上的开销。
2. **将同一模型不同渠道拆分到独立页面展示与配置**
   - 被否原因：导致用户在多个页面之间反复横跳，无法一眼看到故障转移的流向与先后顺序，违背了降级链路（Pipeline）的直观心智模型。
3. **把健康探测错误直接算作一次 Failover 历史**
   - 被否原因：探测属于旁路巡检，不是真实的会话故障转移事件，混写会污染用户的会话故障转移审计记录。

## Consequences

- 收益：
  - 用户可随时直观查阅各物理渠道的实时健康状态与真实延迟；
  - 支持自定义 Prompt，彻底避开渠道敏感词误判；
  - 零额外负担，默认被动采集，主动探测极其节省 Token；
  - 架构清晰统一，保持了 Profile 降级链的紧凑完整性。
- 验证：
  - 16/16 单元测试全绿（含健康状态分类、被动记录与 Session 投影折叠）；
  - 9/9 组合测试全绿（真实 Cordis Loader 运行）；
  - TypeScript 类型检查 0 报错；
  - DSH 源码保持完全只读（0 变动）。
