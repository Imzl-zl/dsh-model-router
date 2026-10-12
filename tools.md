# DSH Model Router Tools

## Concepts

- 本文件记录可复用协作知识，不覆盖正式设计文档；当前路由事实以 `docs/design/architecture.md` 与 `docs/design/source-map.md` 为准。
- 核心请求链：Agent `agent/request` → adapter `prepareCall()` → prepared dispatch → Agent failure recovery `agent/request-error`。
- 物理执行身份是 DSH provider/model；逻辑 route profile 是本项目提案中的独立身份，尚未成为 DSH selector 能识别的模型。

## Read First

- [`docs/architecture.md`](docs/architecture.md) — 项目设计总入口。
- [`docs/design/product-plan.md`](docs/design/product-plan.md) — 产品形态与配置面；用户视角的唯一权威。
- [`docs/design/dsh-capability-boundary.md`](docs/design/dsh-capability-boundary.md) — DSH 原生支持/不支持/最优雅补法/社区规范；能力边界唯一权威。
- [`docs/design/architecture.md`](docs/design/architecture.md) — 路由提案、Session/UI 语义和限制。
- [`docs/design/source-map.md`](docs/design/source-map.md) — DSH 源码定位及当前行为。
- [`docs/design/open-questions.md`](docs/design/open-questions.md) — 决策登记簿：九项已全部关闭；剩余待实测项列第三节。
- [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md) — 分阶段验证顺序。
- [`docs/references/prior-art.md`](docs/references/prior-art.md) — 官方方案先例。

DSH 侧规范入口：[根 `AGENTS.md`](file:///D:/sudy/github/deepseek-harness/AGENTS.md)、[`packages/AGENTS.md`](file:///D:/sudy/github/deepseek-harness/packages/AGENTS.md)、[`docs/architecture.md`](file:///D:/sudy/github/deepseek-harness/docs/architecture.md)（"Where new behavior goes" 表）、[`docs/cordis-primer.md`](file:///D:/sudy/github/deepseek-harness/docs/cordis-primer.md)。

## Tools

- DSH 只读参考 checkout：`D:\sudy\github\deepseek-harness`。
- 本项目为 Markdown 文档仓库，没有构建或测试脚本；验证手段是路径/链接检查与逐项源码事实复核。
- 本项目独立 Git 根：`D:\sudy\myproject\dsh-model-router`。
- 交付前检查命令（在项目根执行）：本地链接与源码锚点校验、`git -C D:\sudy\github\deepseek-harness status --porcelain` 必须为 0 行。

## Patterns

- 把 DSH 源码事实、产品提案与用户待决选择分开放置，不将假设写成当前行为。
- Agent 主请求路由使用 `agent/request` 选择物理 route；失败策略需与 `llm-retry` 和 Chat retry transition 协调。

## Pitfalls

- Agent `prepareCall()` 固定 adapter registration；Agent route 不能靠后续 `llm/stream` 改 provider。
- waterfall 数组首个 listener 是最外层、其返回值即最终值；`await next()` 之后改写会覆盖内层。Router 必须 `prepend: true` 才能位于 `installModelSelection` 与三个 `agent/request-error` 消费者（`llm-retry`、`compaction-image-offload`、`compaction-basic`）之外层。cordis.yml 书写顺序不决定 listener 次序。
- Agent step 循环 `while (true)` 没有 attempt 上限；总上限只能由 Router 拥有，且必须计入 `llm-retry` 代跑的重试。
- 仓库外插件新增 durable 事件类型实际封闭：核心拒读非 `ignorable` 的未知类型，而 `ignorable` 即 plugin record 信封，`appendPluginRecord()` 被 README 明确禁止仓库外调用。durable lineage 走插件自有 session projection 折叠核心事件。
- 透明故障转移必然产生：一条 durable "model changed" notice、UI `next` 停留未兑现 pending、`request/header` 记 `reason: 'change'`。
- 失败 settlement 会按 attempt ID 退役 transient rows；`llm/retry` 另写 durable schedule/start records、保留 Chat first-token 时间并提供 turn-process evidence；直接 retry 不会复制这些状态。
- `LlmFailure.code` 是开放 string；`llm-retry` normal policy 有默认可重试码，always mode 无重试上限。
- **`UNSUPPORTED_REASONING_EFFORT` 等 preparation error 直接终止 step+turn，不进 `agent/request-error`**（`agent.ts:603-610` 只吞 `NO_ADAPTER`；`request-reconstruction.spec.ts:438-467` 断言）。Router 必须先用 `ctx.llm.resolveCallConfig()` 预校验候选；两个自带 adapter 的 `resolveModel` 是内存快照，零网络成本。
- **工具能力没有任何机器可读来源**（`LlmModelInfo` 仅 `inputModalities`；`normalizeModelInfo` 白名单重建）。工具不兼容运行时才炸（`INVALID_REQUEST`/`PI_AI_ERROR`，分类跨 provider 不一致），由 switchOn 承接，不做前置资格条件。
- **插件配置热更新 = fiber 整体重启**（`fiber.update()` 先校验再 restart，`vendor/cordis/src/fiber.ts:731-751`）；校验失败炸插件 fiber 不炸 DSH。DSH 校验范式是 schemastery schema + `apply()` 里 `validateConfig()`，没有 `Config.check()`。
- **session projection wire 硬约束**：`snapshot()` 唯一门槛是有无 wire 块（`session-projection/src/index.ts:339-353`）；`@Remote('list')` 空请求枚举会话且行带投影 hints；client 半包 `inject ['remote','remote.session']` 可直连 `projections`。key 带命名空间、`stateVersion` 只增、view 守 UI-scale（每 tail 页带全部 client-visible key）、state plain JSON、view 对象复用引用。
- **schemastery 无 `z.infer`**：手写 interface + `Config` interface（字段 `Volatile<T>`）+ schema 值三段式，样板 `llm-pi-ai/src/config.ts`；`Fiber.entry` 是 loader 包运行时增强，外置插件勿依赖；`resolveRetryPolicy` 的 `retryableCodes` 不可为空；headless CLI 入口 `node_modules/@deepseek-ai/dsh/lib/bin.js`。
- **客户端半包（已实测）**：单文件 factory（`window.__ModuleLoader__.load`；同步 require 不支持相对路径，多模块必须内联）；slot `plugins.bundle.config` keyed=包名、只渲染 `view:'page'`、不传 form 自读 scope；配置 ns = bundle patch 行 id；文案走 `ctx.locale.bind(NS)`；`SettingsForm.labels` 五键且**帧内无 discard 按钮**（弃置走 unmount），自绘 discard 放 children。
- **`createSnapshotStore` 的 set 会 devFreeze 入参**：发布进 store 的必须是克隆快照，否则内部草稿被冻结后赋值在 sloppy 模式静默失败（UI 无反应、无报错）。控制器自持草稿 + `project()` 返回 `clone(draft)`。
- **scope 首帧可能晚于控制器构建**（status loading、value undefined）：active tab 等派生状态要用 autoActive 标志在 subscribe 里重算，只在构建时算一次会卡在默认页。
- **web profile 验证路径**：`dsh plugin --profile web add <abs pkg dir>`（link 安装，改动即时生效）；`dsh --profile web --no-open --port <p>` 起服务；启动 stdout 打印带 token URL（`connection.authenticatedUrl`），浏览器必须用它进入（围栏查 Origin+token）；`--patch` 不属于 web 子命令（端口用 `--port`）；headless 与 web 的 DSH_HOME 分开。
- **手写 createElement 深嵌套**：node --check + 括号深度跟踪定位；写完必跑 `node --check` 再上浏览器。
- **条件路由取数（已实测）**：`agent/pre-step` payload `{agent, messages, turn, step, signal}`，在 `agent/request` 前触发；图片判定 = 内容块 `type==='image'`（与 llm 层投影同规则）；`projectedTokens` 只在 contextPressure 的 **wire view** 产出且首次用量采样后才存在，host 侧读 `ctx.sessionProjections.snapshot(session).values['contextPressure']`（canonical 值，勿自行复算公式）；`ctx.get('sessionProjections')` 取可选服务。单测可直导 .ts（node 24 strip-types）：`import ... from '../src/router.ts'`。
- **投影与设置页读取（已实测）**：`register()` 带 wire 即客户端可见；failover 标记 = `request/header` 的 `reason:'change'` + 前序失败 attempt；缓存写回 fire-and-forget（CLI 退出竞态，集成测试要调小 `writeEveryEvents`）；**远程调用解析出 `{ok,value}` 信封不是裸值**；`projections` 响应**不带 kind 字段**；catalog 要懒加载（apply 时 host 可能还没注册完 adapter）。
- **测试环境坑**：`--patch` overlay 改写某插件行 config 后，同一 boot 内该 ns 的 settings 保存被 revision 冲突拒；无 overlay 的 boot 保存正常。插件缺陷排查时先排除此项。
- **浏览器测试坑（2026-10-13）**：stub-script.json 启动时读入内存，改后必须重启服务；model-selection 记住 last-used 路由（卸载后请求可能直走 backup，测试不成立——用**新会话**拿默认选择）；模型菜单不分 provider；SPA 导航后插件列表渲染有延迟，用 `mcp wait_for` 等按钮文本出现再点，别用 sleep 猜。
