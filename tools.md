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
- 本项目独立 Git 根：`D:\sudy\myproject\dsh-model-router`。
- 插件验证命令（在项目根执行）：`node packages/dsh-model-router/tests/unit.mjs`（host 逻辑单测）；`node packages/dsh-model-router/tests/run.mjs`（真实 headless Loader 组合测试）；`node packages/dsh-model-router/tests/client-controller.mjs`（UI 半包控制器状态机：加载真实 client.js、stub ctx/store、驱动 slot inject 出的 actions + `routerPage` 快照；`CLIENT_PATH=<file>` 可对任意 Revision 跑同一套，红/绿对照用）；`node --check packages/dsh-model-router/src/client.js`（手写 createElement 深嵌套的括号检查）；`npx tsc --noEmit --skipLibCheck --strict --module nodenext --moduleResolution nodenext --target es2022 --allowImportingTsExtensions packages/dsh-model-router/src/index.ts`。
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
- **图片条件的两个隐藏来源（2026-10-14 实测）**：① `agent/pre-step` 的 messages 只是本步新 claimed 输入（`agent-loop/src/agent.ts:271,366`——第二步起 target 变 'next-step'，通常为空），图片条件必须按 turn 累积，否则带图 turn 的第二步滑回文本模型；② `read_image` 的图从 `tool/result` 事件进来（图片块嵌套在 tool-result 的 content 里，`data.message.content[].content[]`），下一步的请求才含它——`session/event` 里按 `data.turn` 归属到 agent（WeakMap<Session, Agent>）补刀。
- **发送准入门与选择状态（2026-10-14 实测，插件不可达）**：带图 prompt 的准入检查在 `api/session-controller/src/commands.ts:336-348`（选中的模型不声明 image modality 就拒收 `MODEL_DOES_NOT_SUPPORT_IMAGES`），发生在消息生成前；`ApiSessionAgentController` 在 `session-controller/src/index.ts:146` 直接 new 不进 ctx 服务，`selectForNextRequest` 不可达；`current` 无待决 pick 时回退到最后一次 request header（`agent.ts:294-310`），每次 `request/header` 事件都会 `consumeSelection` 清掉匹配的 pick（`index.ts:194-203`）。`installModelSelection` 只读内存 ref，append `model/selection` 耐久事件对活会话无效。
- **落回原路由必须推进状态**：链上无可服务候选时 `return resolved` 之前要 `states.start(agent, {...plan.state, exhausted: true})`，否则 recovery 每问一次都得到"继续"（`totalAttempts` 不动），turn 在原路由上无限空转直到进程被杀。
- **投影与设置页读取（已实测）**：`register()` 带 wire 即客户端可见；failover 标记 = `request/header` 的 `reason:'change'` + 前序失败 attempt；缓存写回 fire-and-forget（CLI 退出竞态，集成测试要调小 `writeEveryEvents`）；**远程调用解析出 `{ok,value}` 信封不是裸值**；`projections` 响应**不带 kind 字段**；catalog 要懒加载（apply 时 host 可能还没注册完 adapter）。
- **测试环境坑**：`--patch` overlay 改写某插件行 config 后，同一 boot 内该 ns 的 settings 保存被 revision 冲突拒；无 overlay 的 boot 保存正常。插件缺陷排查时先排除此项。
- **浏览器测试坑（2026-10-13）**：stub-script.json 启动时读入内存，改后必须重启服务；model-selection 记住 last-used 路由（卸载后请求可能直走 backup，测试不成立——用**新会话**拿默认选择）；模型菜单不分 provider；SPA 导航后插件列表渲染有延迟，用 `mcp wait_for` 等按钮文本出现再点，别用 sleep 猜。
- **真实 provider 测试（2026-10-13 已实测）**：`tests/real-run.mjs` 读 gitignored 的 `tests/real-providers.local.json`（两个 newapi key），经 `llm-pi-ai` 手工声明网关 provider（`apiKeyEnv` 指环境变量）打真实故障转移。**该 newapi 网关对直连做 TLS 重置（SNI/JA3 过滤，curl/node 均被 RST，浏览器因走系统代理而正常），必须走本机系统代理 `127.0.0.1:7890`**：`$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:NODE_USE_ENV_PROXY='1'`（Node 24）后再跑。模型实况：`gpt-6-astra` **间歇性 500**（上游波动非永久坏）、`kimi-k3` 的 429 瞬时、其余可用（gemini ~9s 慢）。overlay 里 `session-persistence-jsonl` 要显式 `compression: none`，否则 log 落 .zstd 读不了（Node 24 用 `zlib.zstdDecompressSync` 解）。
- **真实渠道 UI 实战（2026-10-13）**：`tests/web-real.overlay.yml`（gitignored）+ 同代理环境起 `--profile web --port 3380`；router 的 ns 不被 overlay patch，配置走 UI 保存（settings 正常）。**图片消息**：选中模型必须声明 `input:[text,image]`（Models 页面或 overlay），否则 composer 静默拦发（DSH 原生护栏，无提示）；附件上传用 MCP `upload_file` 驱动真实 file input（先 JS 把隐藏 input 显示出来进 a11y 树；**upload_file 对不存在的路径会假报成功**，文件须先真实存在，Temp 目录可传）。故障转移到纯文本模型时图片以哈希引用到达（优雅降级，模型会明说看不到图）。
- **隔离进程跑 web UI 验样式（2026-10-14 实测）**：起独立进程看新代码，别复用已在跑的服务（它早于编辑启动，浏览器还缓存旧包）。隔离 home 手搭：拷 `.credentials.yaml` + `.anonymous-user-id` + `profiles/web/{cordis.yml,cordis.patch.yml,package.json,pnpm-lock.yaml,pnpm-workspace.yaml}`，`profiles/web/node_modules` 用 **junction**（`New-Item -ItemType Junction`）指向原 home 的同一目录。**两个坑**：① 目录 symlink 提权才能建（junction 不需要），模块解析对两者都透明；② **不要 robocopy `/E /SL` 复制 `.dshhome-*`**——`profiles/web/node_modules/dsh-model-router` 是指向包目录的链接，robocopy 会跟进把它连同整个仓库 node_modules 全拷一遍（几分钟还递归）。验证闭环：改 Stepper → 顶栏出「● 未保存修改」+「放弃更改」+ 蓝色渐变保存钮（`Ctrl+S` 芯片）→ 点保存 → 徽标清零、按钮回置灰 → `cordis.patch.yml` 里 `maxAttempts` 已变。
- **settings mirror 每次发布都推订阅（2026-10-15 实测）**：`SettingsDescribeMirror.run()` 回包无条件 `store.set`（settings-mirror.ts:193），`ConfigFormController.derive()` 在 mirror 每次发布时都 `store.update`（config-form.ts:186-208），且任何 `settings/document-updated`（含别的设置页保存）都触发 `mirror.load()`（ui-settings/src/client/index.ts:43）。**客户端 `scope.subscribe` 不能无条件重投影草稿**——先 seed 再与 host 深比较，值没变就 return，否则保存被拒的恢复读会静默冲掉用户未保存的编辑。另：`scope.mutate` 返回 `Promise<boolean>`（拒写返回 false、wire 抛错会 reject），**必须同时接拒绝路径**，否则 `saving` 卡死、按钮永久转圈。
- **DSH 不存在的 design token（2026-10-15 核对 design-platform.css）**：`--dsw-alias-bg-layer-0`、`--dsw-alias-bg-layer-4`、`--dsw-alias-state-error`、`--dsw-alias-state-error-bg`、`--dsw-alias-state-warn`、`--dsw-card-shadow` 均无定义（`bg-layer-4` 在 DSH 自己代码里也有两处悬空引用）。存在的是 `bg-layer-1/2/3`、`state-error-primary/secondary`、`state-warn-primary`、`shadow-lv1`。**`--dsw-alias-brand-primary` 是品牌墨色**（亮=近黑、暗=近白），配 `#ffffff` 前景在暗色主题下白-on-近白；插件要自己的强调色就声明一个 `:root` 自定义属性，别借这个 token。
- **Modal 层栈与 z-index（2026-10-15）**：`prim.Modal`（含 `headless`）自带 `useModalLayer`：mask 点击、Escape（带组合态守卫）、焦点进入/归还、Tab 圈禁、层栈次序；官方 Modal 根层 z-index 1000。自建 body-portal 浮层（如故障转移抽屉）要么接入 `useModalLayer` 并把 z-index 抬到 1000 之上，要么在官方 Modal 里"按钮可见、浮层不可见"。`SegmentedTabs` 的 `panelId` 是**调用方契约**——不渲染对应 `role="tabpanel"` 元素，每个 tab 的 `aria-controls` 都悬空。
- **宿主 CSS 的两条耦合（2026-10-15）**：① 侧栏 `div[class*="footerActions"]` 全局覆盖——`sidebar.footer.action` 的 ownerProps 只有 `wide`，没有按条目布局的控制面，只能覆盖宿主容器；锚点 `ui-sidebar/src/client/SidebarRoot.tsx:306` 与 `SidebarRoot.module.css:587-600`。② SettingsForm 底栏抑制——用「孩子包进 `.dsh-router-form-body` + `+ div:has(button)` 结构兄弟选择器」，别猜 DSH 的 CSS-modules 类名（猜类名的失败模式是静默的：DSH 改名后底栏重新出现，出现两个保存钮且无人察觉）。**教训**：带 `!important` 的 CSS 基规则会压掉同名内联样式的状态变体——插件的约定是内联做基样式、注入 CSS 只写 hover/active/focus 伪状态。
