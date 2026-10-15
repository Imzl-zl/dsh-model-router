# DSH Model Router 项目状态

> 当前状态快照 + 最近活跃窗口；决策理由见 `.agents/notes/`，稳定协作知识见 `tools.md`，设计现状见 `docs/`。

## 当前基线

- 完整插件项目（`packages/dsh-model-router/`：宿主 + UI 半包 + 条件路由 + lineage 投影 + 遥测抽屉 + 双引擎渠道健康监控 + 识图路由 + 渠道级熔断），GitHub 仓库 `Imzl-zl/dsh-model-router`（公开）。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`（严格只读）；项目根：`D:\sudy\myproject\dsh-model-router`。
- **构建管线已落地（2026-10-15）**：`npm run bundle --prefix packages/dsh-model-router` 产出 `lib/index.js`（宿主）、`lib/client.js`（浏览器半包，CJS 工厂）、`lib/typert.host.js`（Typert host face，含 `Profile` schema）、`lib/types/*.d.ts`；`exports` 指向 lib/。构建依赖装在包内 node_modules（`--legacy-peer-deps`，peer 一律外解析）；typescript 包内 v6（classic）/ 根 v7（native）并存。改源码后必须重建浏览器才生效。
- 最后更新：2026-10-15（构建管线 + 客户端半包拆模块 + 渠道级熔断 scope）。
- 验证状态：单测 70/70 + 组合测试 13/13（真实 headless Loader + stub，含渠道级熔断端到端场景）+ client-controller 22/22（对构建产物 lib/client.js）+ `node --check lib/client.js` + `tsc --noEmit` 0 错误；**真网关实测**（隔离 `.dshhome-real-web` + Chrome MCP + 本机代理）：渠道级规则命中后「渠道 real-dead 已整体自动禁用（该渠道下所有模型），约 200 秒后自动重试」通知落账，同渠道 sibling 一次未打，链从候选 1 直达候选 3，由 real-a/kimi-k3 真实答出；DSH checkout `status --porcelain` 0 行。
- **侧栏 footer 行几何不是自己拍的**（2026-10-15 实测）：`sidebar.footer.action` 的 ownerProps 只有 `wide`（`ui-sidebar/src/client/contract/slots.ts:108`），DSH 明确「Each occupant owns its button geometry」（`SidebarRoot.module.css:572-589`）。要与上方 DSH 自己的设置行对齐，必须照抄 `.trigger`（`ui-settings-general/src/client/SettingsRoot.module.css:16-36`）：`height:42 / fontSize:14 / lineHeight:22 / padding:0 10px 0 8px`，外层 `margin:4px -2px; width:calc(100% + 4px)`（悬浮底色与导航行对齐），rail 态 `margin:8px 0 10px`。
- **图标与字典文案不要各写一份**（2026-10-15 二次踩坑）：`addCandidateBtn` 字典值带 `'+ '` 前缀、渲染又前置 `ICON_PLUS`，出现双加号。与「需求按钮标签双齿轮」同类。约定：字典只放文字，图标归渲染侧。
- **React 受控状态必须用更新器形式**（2026-10-15 实测）：`setRules(rules.concat(...))` 读渲染期闭包，同 tick 多次点击互相覆盖——同步连点 8 次只进 1 条规则，用户看得见却存不上。四个写入点已全部改 `setRules(current => ...)`，并有源级回归测试守着。

## 已完成能力

- 建立路由架构提案、源码地图、未决问题、实施阶段和官方先例对照，确认 Agent 主请求 `agent/request` prepend 最外层，`agent/request-error` 置于 `llm-retry` 内层。
- 确定两层 attempt 边界与条件路由（图片 pre-step 精确检测、上下文 tokenMeter contextPressure 投影估算；用户路由豁免）。
- **Phase 1~2 宿主与 UI 闭环**：有序备份链 + switchOn 策略 + 单渠道次数与硬总上限 + 中文 notice + 预校验跳过 + default 纯备用池 + 加载时结构校验 + failover 历史抽屉。
- **UI 布局重构与分段式控制台（Segmented Console，2026-10-15）**：
  1. *分段导航架构*：在 Profile 与 Default Pool 顶层引入 `SegmentedTabs`，将臃肿的 3000px 长单页解构为「`🔄 降级流水线`」、「`⚡ 异常策略与预算`」、「`📊 渠道遥测与监控`」三大清晰专注视窗；
  2. *候选卡片视觉瘦身*：候选节点中的 24 柱 Sparkline 提炼为紧凑的现代科技感药丸徽标（`CompactHealthBadge`，如 `[🟢 正常 · 140ms · 161.1t/s]`），卡片高度从 >200px 直降至 ~64px，支持一键点击直达遥测面板；
  3. *顶栏工具组收拢*：吸顶顶栏与弹窗顶栏内的次要诊断动作（`checkAll`、`healthModal`、`drawer`）收拢为统一的幽灵态轻量工具组（`.dsh-router-tool-btn`），彻底消除窄屏下的水平折行与拥挤；
  4. *折叠式识图指南*：将 100 余字的零点击识图路由指南设计为优雅的折叠说明卡片（`💡 零点击识图路由指南`），消除链路与添加按钮间的阻断。
- **双引擎渠道健康监控（Health Monitoring）与时间轴仪表盘闭环**：
  1. *架构决策*：坚守 Profile -> 候选链单一入口，不分拆新页面，符合 LiteLLM/Portkey 行业标准；
  2. *被动零成本观测*：`session/event` 自动采集成功请求端到端延迟标记 `healthy` 🟢，`agent/request-error` 拦截 429/500/TIMEOUT/TRANSPORT 分类标记 `degraded` 🟡 / `unhealthy` 🔴，经 `channelHealthProjection` 折叠持久化至 Session 投影，0 额外 Token 消耗；
  3. *真实 tok/s 测算机制*：主动探测设定 `maxTokens: 1` 并在首字（TTFT）到达时立即 `abort()`，仅测存活与首字延迟，绝不拿 1 个 token 虚假除算；真实的 `161.1t/s` 吞吐量源自 DSH 日常会话原生 `assistant/message` 真实输出 tokens 与耗时解算；
  4. *时间轴波动仪表盘（Sparkline Timeline Bars）*：各候选渠道卡片直观内嵌 3 列仪表盘（对齐截图）：状态可用率（如 `99.96%`）+ 24 根竖向胶囊状态条（支持悬浮缩放高亮与详细时间/延迟/吞吐 Tooltip）、延迟自适应展示（`140ms` 或 `8.39s`）、真实吞吐（`161.1t/s`）；
  5. *主动极速探测*：支持自定义探测内容（避开渠道违禁词）、探测超时（默认 8s）与自动轮询周期（默认 0 关闭防偷跑资费）；
  6. *控制中心与远程接入*：吸顶顶栏与弹窗顶栏配备「⚡ 探测全部渠道」与「⚙️ 健康设置」弹窗；实现 `RouterHealthService` 继承 `TypertRemoteService`（namespace: `'routerHealth'`），安全兼容 Node 24 原型描述符与 client 侧 `$mount` fail-open 保护。
- **识图路由闭环（2026-10-14）**：`needs.images` 三态（true=仅带图轮 / false=仅无图轮 / 不填=不限）+ 显式条件可作用于 primary（修订 open-questions 二.5）+ `hasImages` 按 turn 累积（取数 = 本步 claimed 用户消息 ∪ 本轮 tool/result 嵌套图片块）+ `stickyTurns` 粘滞窗口（默认 0）+ 条件跳过 notice 按 (turn, 跳过组) 去重 + 修掉落回原路由路径不推进状态导致的无限空转 bug。边界裁定：DSH 发送准入门（`session-controller/src/commands.ts:336-348`）在路由之前且查"选中的模型"，插件够不着；闭环形态 = 用户在 DSH 模型配置里给文本模型勾 `input:[text,image]`（门禁只查声明）+ 互斥条件保证 API 收不到图。
- 决策笔记状态：`implemented/` 12 篇（含 `2026-10-15-ui-layout-and-ia-redesign.md`、`2026-10-15-ui-refactor-hardening.md` 与 `2026-10-15-host-draft-baseline-independence.md`）。

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

- **渠道级熔断 scope + 真网关实测（2026-10-15）**：熔断规则加显式 `scope: 'route' | 'channel'`（默认 route，旧配置零迁移），`CircuitBreaker` 双桶存储，`blockedUntil` 取两桶较晚者并报告绑定方，通知按绑定方措辞；客户端规则行加范围选择器。动因是实测：一个网关渠道密钥失效/整体挂时，按路由禁会让链上把同渠道其余模型各真打一次才跨渠道，白吃 attempt 预算。组合测试新增 `breaker-channel-scope-skips-sibling-models`（单 step 内可观测：sibling 一次未打 + 渠道通知）。**实测发现**：`breaker.note()` 只在插件自己的 `agent/request-error` listener 里，而 llm-retry 的 normal 策略自己重试 RATE_LIMIT/TRANSPORT 等码、从不 `next()` 委派——block 的记录要等 llm-retry 让位（耗尽或策略 maxRetries=0），所以该场景的 stub 必须显式 `policy: {maxRetries: 0}`。真网关（隔离 `.dshhome-real-web` + 代理 + Chrome MCP）两轮实测：第一轮全死链路让 llm-retry 耗尽、记录渠道块；第二轮 dead-kimi 失败一次后 sibling 被渠道块跳过（通知含"该渠道下所有模型"与剩余秒数），链直达 real-a/kimi-k3 真实答出。取舍见 `.agents/notes/implemented/2026-10-15-breaker-channel-scope.md`。
- **构建管线 + 客户端半包拆模块（2026-10-15）**：实施 `docs/design/build-pipeline-and-plugin-remote.md` 的 Phase 1+2。① 新增 `packages/dsh-model-router/tsdown.config.ts`（自复刻 `clientBundle` 契约——预设不在任何已发布包里，cookbook 明说仓库外要自己复刻；`typertPlugin({ mode: 'package', faces: ['host'] })` 显式加入）、包 `tsconfig.json`（只发声明）、项目根 `tsconfig.host.json`（generator 的 workspace 标记 + registration 聚合）；`exports` 改指 lib/，`files` 补生成物，devDependencies 换成构建工具链（装包内、`--legacy-peer-deps`）。② `Profile` 接口打 `@typert` 标签并经 index.ts 再导出，成为 host face 唯一 surface（无标记声明 generator 不产出）；`Strategy` 因此改显式联合（Zod 发射器不支持 indexed-access）。③ 客户端半包从单个 4576 行 `src/client.js` 拆为 `src/client/index.ts` + 15 个模块（dom/locales/icons/format/styles/validate/controller/health-ui/pipeline/workspace/chain/modals/page/footer/apply），tsdown 以 DSH 预设同款 CJS 工厂契约构建，`./client` 指 `lib/client.js`。④ 三个文本守卫改读源码模块（rolldown 重印 AST：单引号变双引号、`function (current)` 丢空格、三元条件行合并，bundle 上的定位串全失配），行为测试仍跑 bundle。⑤ 闸门全过：dump-config 有行、启动无 typert 报错、loader 校验函数认到 `./typert`、Chrome MCP 五场景（含保存落盘 `cordis.patch.yml`）。取舍见 `.agents/notes/implemented/2026-10-15-out-of-tree-build-pipeline.md` 与 `2026-10-15-client-half-module-split.md`。
- **信息架构关注点解耦与全局渠道健康工作台闭环（2026-10-15）**：彻底根治控制台“关注点混叠”（配置意图与运行时观测挤在同一层）的结构性病症。
  1. *导航架构升级*：左侧导航栏形成 `[搜索+新建] -> [🌐 全局默认兜底] -> [模型规则垂直列表] -> [── 分隔线 ──] -> [📊 渠道健康监控]`，全局健康常驻左下角，实时聚合全部渠道最差状态与总数；各 profile 列表项展示候选微小健康灯；
  2. *规则视图纯净化*：规则视窗子 Tab 收拢为纯粹声明式配置的 2 档（`['pipeline', 'policies']`），彻底剔除臃肿的遥测子 tab；候选人卡片采用极简呼吸信号灯（`HealthSignalDot`），悬浮即现可用率与延迟，点击一键联动跳转至全局对应物理渠道并平滑滚动高亮（`focusRoute`）；
  3. *全局渠道健康与遥测工作台 (`GlobalHealthWorkspace`)*：以物理渠道（`provider/model`）为唯一粒度去重聚合展示所有 profile、默认兜底池及历史留痕渠道（消除观测死角）；支持 4 档状态筛选（全部/正常/异常/未调用）与即时模糊搜索；
  4. *顶栏脱水与操作语义治理*：将原与保存并列的全局诊断动作移至渠道健康页，明确标注范围与资费（如 `刷新连通性 · 0 Token`）；单渠道行内提供连通性检查（0 Token），**测速档（1 Token）只作说明并禁用**——手写单文件无构建管线、生成不了 Typert 远程贡献，可点只弹提示的按钮与"保存了但没存上"是同一种谎言（处理与健康设置模态一致）；吸顶与模态顶栏只留保存/放弃/开关等配置生命周期动作；
  5. *全量验证*：20/20 client-controller + 35/35 unit + 12/12 composition + tsc 0 报错全绿；DSH 严格 0 修改。
- **IA 审查修复批次（2026-10-15）**：对当日 IA 重构做完整审查并逐项修复。① **Critical 假按钮**：工作区「⚡ 测速 (1 Token)」原是 `alert(tooltip)` 桩，与健康设置模态里同档的诚实禁用自相矛盾——改为禁用 + 同一份原因说明；② **健康状态语义**：`routeStatus` 单源化（原 5 处内联重复派生），`unavailable`（发现接口不可用/provider 不可配置）从误报红色"异常"改回 `unknown`（旧 `HealthDots` 本来正确，全局工作台一度改坏）；③ **a11y**：去掉 `role="tabpanel"` + 悬空 `aria-labelledby`（nav 项是 role=button 不是 tab）；④ **Icon 不转发 props.style**：两处搜索框放大镜掉在输入框外，修 Icon 合并 props.style；⑤ **移动端裁剪**：媒体查询补 masterList 高度约束（侧栏 260px vs 列表 380px 被剪）；⑥ **checkRouteSingle 补测试**（忙态/verdict 落库/失败清理/重复调用丢弃）；⑦ 健康设置模态确认按钮「保存配置」改名「应用更改」（与顶栏真保存同名会误导）；⑧ 死代码清扫（HeaderTools/HealthDots/HealthDot/activeProfile()/showPassive-showDiscover 死链 + 约 20 个死字典键/样式/1 条死 CSS）；⑨ 焦点跳转治理（focusRoute 对象化支持重复跳转，导航进入清除高亮）+ 新控件 hover/focus CSS + 空态文案区分 + 搜索框 aria-label。**实施事故**：修复中途一度"整个页面只有左侧可用"——侧栏 `h('aside'` 少闭一个括号，工作区 div 静默变成侧栏第三个孩子（括号总数配平、node --check 照过）；补回闭括号并新增结构回归测试（对"配平但错位"形态精确报红），tools.md 记坑。隔离进程端到端复测全部通过。
- **dirty 信号回归修复（2026-10-15）**：审查 UI 重构时在隔离进程实测发现保存链路全断——`scope.subscribe` 重播种写成 `host = next; draft = next`，两个名字共享一个对象；生产启动路径（控制器先于 settings mirror 构建）必然经过一次值变化重发布，此后每次编辑都同时改掉宿主基准，`deepEqual(draft, host)` 恒真、dirty 永远为假（保存钮永灰、放弃按钮不出现、Ctrl+S 失效）。根因证据：浏览器侧给 `JSON.stringify` 打补丁捕获 deepEqual 实参（编辑后 draft/host 同时变 false 变体）+ Node harness 红/绿。修复 = `draft = clone(next)` 一行 + 回归测试（先红后绿，锁定"loading 首帧 → 值变化重发布 → 编辑"的生产顺序；旧两个 subscribe 测试都是先编辑再重发布，恰好绕开别名路径）。替代方案（恢复无条件重播种 / freeze(host) / 与保存快照比较）及否决理由见 `.agents/notes/implemented/2026-10-15-host-draft-baseline-independence.md`。隔离 `.dshhome-view` 端到端闭环验证通过。
- **Master-Detail 左右分栏工作台与星轨枢纽 Logo 彻底重构（2026-10-15）**：推翻原有「双层横向 SegmentedTabs + 纵向瀑布流」卡片堆叠布局，构建现代 Master-Detail 架构：
  1. *左侧规则导航（Master Sidebar, 260px）*：即时模糊搜索框（过滤模型 ID 与 Provider）、常驻置顶的独立虚线「🌐 全局默认兜底」卡片（带就绪/空置状态徽章）、模型规则垂直卡片流（Provider Tag、候选数角标、🖼️ 识图标签、健康指示点、选中高亮光环与悬浮微动效）、底部「+」新建规则按钮；
  2. *右侧流水线工作区（Detail Workspace, flex: 1）*：专属头部卡片（模型名/Provider/接管中状态/删除与启用开关），下方彻底收拢为单层三段视窗切换（「🔄 降级流水线」、「⚡ 策略与预算」、「📊 渠道遥测」），流水线采用垂直拓扑流，空间通透不拥挤；
  3. *星轨枢纽 · Nexus Mesh 矢量徽标*：完全弃用简陋的旧圆点线条，基于 48x48 坐标系重绘全新高精度 Logo（外围六边形韧性护盾 + 内部智能核心 + 三向流光分流轨道与候选端点，深科技蓝 `#4A65E8` 至深青 `#06B6D4` 渐变），已同步部署至包根 `icon.svg` 与 `client.js`（动态适配暗色/亮色/禁用灰度，16px~64px 锐利无失真）；
  4. *响应式与全量验证*：`ROUTER_CSS` 支持 768px 断点自动降级为垂直布局；14/14 controller + 66/66 unit + 12/12 composition + `tsc --noEmit` 全绿；DSH 严格 0 修改。
- **UI 重构审查修复批次（2026-10-15）**：对当日 UI 重构做完整审查并逐项修复。行为缺陷：`save()` 补 mutate 拒绝路径（原来 `saving` 永久卡死）；`validate()` 补 per-profile 权重校验与 host `assertStructural` 对齐；`scope.subscribe` 加深比较闸（mirror 任何发布——含保存被拒的恢复读、别处设置保存——不再静默冲掉未保存草稿）；默认兜底池第一个候选解除 primary 钉死。DSH 规范对齐：7 类不存在的 design token 全部换成真实 token（亮色主题深色吸顶栏、暗色主题白-on-白保存钮随之消失）；抽屉失败行进字典；5 处 `SegmentedTabs` 的 `panelId` 接到真实 `role="tabpanel"`；识图指南折叠改键盘可操作；快捷控制中心改用 `prim.Modal headless`（焦点/Escape/Tab 圈禁来自 `useModalLayer`），故障转移抽屉接入同一层栈并抬 z-index；工具按钮组三处合一（`HeaderTools`）；健康色调统一 `healthToneStyle`；插件蓝收进 `--dsh-router-accent`；删 13 个死字典键。复查阶段又抓到一个当时漏掉的真 bug：重构给 4 个控件补了带 `!important` 的 CSS 基规则，与同名内联样式重复且 CSS 恒赢，导致「高级路由条件」按钮的已配条件高亮完全失效——删掉这 4 个基规则（插件页面内控件约定=内联基样式 + CSS 伪状态），高亮恢复。**第二轮优雅优化**：`ProfileView`/`DefaultView`（~110 行、85% 重复）合并为按 `isDefault` 参数化的 `ChainView`；SettingsForm 底栏抑制从「猜 DSH CSS-modules 类名」改为结构兄弟选择器（孩子包进 `.dsh-router-form-body`，上游改类名会响亮失败而非静默失效）；快照去掉重复的 `catalog` 字段；`setStrategy` 分支化简；侧栏全局覆盖补上 DSH 源码锚点注释。**深查修复**：抓出 `actions.onWeight` 漏参导致默认池调权崩溃抛错（已补参并新加单测）、`actions.onStrategy` 参数化；修掉快捷控制中心 Modal 因 className 未直接挂在原语上导致外层卡片被 380px 挤压切边的问题；抽屉补空白处点击退出；子 Tab 弃用 Emoji 改用矢量 SVG 图标。**第三轮复查**：用户提交后复查其自有优化——`setStrategy` 的 `arguments.length === 1` 兼容分支已无调用方（三个调用点全部传 3 参）且死分支里把第一形参当值用，删除；未知 profile id 的策略编辑从静默 no-op 改为抛错（与 `listOf` 一致，抽出 `profileOf` 复用）；`HeaderTools` 的 `checkTitle/healthTitle/historyTitle` 三分支嵌套三元无人传参、且让遥测视图 tooltip 变成标签复读，改为 `??` 默认值。**浏览器实测（隔离 `.dshhome-view` + 端口 3391 + Chrome MCP）**：Modal 1000px 无裁切、单保存钮（`.dsh-router-form-body + div` 结构性抑制生效）、子 tab 无 Emoji、需求面板 aria 双向解析、Escape 层栈次序（先抽屉后 Modal）、抽屉 1100 压在 Modal 1000 上且可见、亮色主题吸顶栏纯白、dirty→保存→clean 全流程、建 profile 后 ChainView profile 分支+指南键盘可操作。实测中又抓出两个真 bug 并修掉：① 需求按钮标签双齿轮（字典值带 ⚙️ 而渲染又前缀一个）；② `S.needsBtnActive` 的 border/color 用 `--dsw-alias-brand-primary`（暗色近白/亮色近黑）配硬编码蓝背景，激活态三色撕裂——改指向 `--dsh-router-accent`。client.js 3545 行，client-controller 14/14 绿。
- **四路并行深挖 DSH 能力边界**并关闭九项未决问题，Phase 1 spike 实跑通过。
- **Phase 1~2 host + UI 落地**（2026-10-12~13）：组合测试 9/9 + 单测 12/12 + 浏览器全链路；抓到并修 10 个真 bug。
- **真实 provider 实测 + 开源门面**（2026-10-13）：活网关真 500 → SERVER → 跨 key 切换全对；GitHub 公开仓库与同构图标落成。
- **UI 与入口重构实测落地**（2026-10-13）：`sidebar.footer.action` 侧栏自适应入口（纵向自适应堆叠，与 `dsh-toolbox-ui` 完美并存），吸顶主保存与快捷键去重，微交互打磨。
- **渠道健康监控实测落地**（2026-10-14）：双引擎设计落地（被动零消耗 + 主动 1-Token TTFT 中断，自定义 Prompt 避违禁词），`RouterHealthService` + `channelHealthProjection`，UI 直观徽标与控制中心快捷探测/设置；16/16 单测 + 9/9 组合测试 + tsc 0 报错全绿。
- **时间轴波动仪表盘与原生吞吐闭环**（2026-10-14）：24 柱时间轴波动条（绿/黄/红/灰）与可用率计算落地，解耦主动探测延迟与原生被动会话真实 tok/s，18/18 单测 + 9/9 组合测试 + tsc 0 报错全绿。
- **识图路由闭环**（2026-10-14）：用户场景「强文本日常 + 突然发图」驱动，四轮设计迭代。关键源码事实：DSH 发送准入门在路由前且查选中模型（`session-controller/src/commands.ts:336-348`）；选择记忆回退到最后一次 request header（`agent.ts:294-310`）；`agent/request` payload 不带 messages；`installModelSelection` 不听耐久事件。裁定：用户给文本模型勾 `input:[text,image]` + 互斥 images 条件，零点击闭环。实现三态条件/turn 累积（含 tool/result 取数）/stickyTurns/notice 去重，并修掉落回原路由不推进状态的无限空转（33716 次尝试对证）。66/66 单测 + 12/12 组合 + tsc 0 全绿；文档（product-plan/ui-design/open-questions/README）+ 决策笔记同步落地。
