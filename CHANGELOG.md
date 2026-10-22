# 更新日志

本文件记录所有值得注意的变更，格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

`1.0.0` 之前 minor 位是交付里程碑，插件对 DSH 的 peer 范围（`0.2.0-rc.2`）
随之移动。

## [0.3.3] — 2026-10-22

行名改用你在「模型」页映射的名字，原始 id 退到 tooltip。

### 修复

- **链路、健康、探测下拉与 composer 的行名都写映射名。** 之前一律渲染配置里的原始
  `provider` / `model`：网关渠道的模型 id 常是 `<uuid>:<model>`，三行看过去只有前缀
  不同。现在名字来自 DSH 的模型目录——与「添加候选」和 DSH 自己的模型选择器同一份
  来源；读不到目录或目录里没有这条路由时仍显示原始 id，不会借用别的名字。
- **原始 `provider/model` 仍在每行 tooltip 里**（候选行、健康行、探测覆盖下拉、chip
  重试行、失败历史），排查时照着它就能对上日志与配置。

## [0.3.2] — 2026-10-22

弹层与链管理的可读性修正。

### 修复

- **弹层标题像标题了。** 「本会话的路由」与「各路由的重试次数」改为 11px 加粗、
  主文字色；之前它们和说明文字同字重，读起来只是两行正文。
- **弹层不再跟着长路由变宽。** 卡片固定 280px，长 `provider/model` 在行内省略
  （悬停 title 看全名），三行输入框固定右对齐。之前不同长度的路由会把卡片撑成
  不同宽度，输入框位置也跟着跳。
- **链行输入框等长。** 「编辑/编辑中」固定 68px，「默认」徽标与「设为默认」按钮
  共用 92px 槽位，改名输入框因此左右对齐；「添加链」改成带加号的 outline 按钮，
  不再像一行普通文字。
- **会话重试覆盖上限从 9 改成 99。** 与链预算共用同一个 sanity bound；`10` 现在
  是合法值，`100` 仍原样拒绝（不夹值）。上限只是防呆，真实重试次数仍由 provider
  策略决定。

## [0.3.1] — 2026-10-22

文档修正，无运行时变化。0.3.0 的 README 还挂着已删除的「会话路由」页签截图，npm 页面
会因此展示一个已经不存在的入口；这一版把它换成更新日志弹窗的截图。

### 文档

- 截图区把「会话绑定列表」换成「更新后弹一次更新日志」。
- npm 包内 README 重新从根 README 生成，和仓库首页保持一致。

## [0.3.0] — 2026-10-21

更新提示与更新日志版本：DSH 的插件市场负责发现和安装新版本，插件负责在新版本
跑起来后告诉用户改了什么。

### 新增

- **更新后弹一次更新日志。** 工作台在版本变化后（以及全新安装后）自动打开当前
  版本的更新说明，页头保留「更新日志」按钮，随时可以重看。说明在构建时从本文件
  生成，所以弹窗描述的永远是实际安装的产物，而不是手抄的旧文案。
- **更新仍走 DSH 原生路径。** 插件不启动包管理器，也不复制安装算法：DSH Market
  的更新行（npm 版本检查、一键更新、「更新了什么」）负责安装，插件只负责更新后的
  那一步说明。

### 修复

- **点弹层外部现在会提交重试草稿。** DSH 的 `Menu` 在 `pointerdown` 就关闭，输入框
  的 `blur` 来不及跑，之前会把用户输入的重试次数丢掉；现在关闭回调先写入待提交的
  按路由重试次数，宿主接受后才关闭。Escape 仍是取消路径，不写任何东西。
- **README 弹层截图改为 3 倍设备像素**（696×555），两列画廊不再把旧的 348×278
  元素截图放大发糊。

### 移除

- **设置页的「会话路由」页签。** 日常选链就在 composer 的 chip 里；这个页签只是
  事后总览，用户明确说不会用。绑定仍按 `sessionId` 保存，chip 与路由行为不变。
  只为它存在的 `sessionBindings` / `deleteSessionBinding` 两个 Remote 一并删除。

## [0.2.1] — 2026-10-21

Packaging and process only; no runtime behaviour changed. The first release
published by CI through the npm trusted publisher (OIDC) rather than a manual
`npm publish`.

### Changed

- **Releases are tag-driven.** Pushing `v*.*.*` runs
  `.github/workflows/release.yml`: it refuses a tag that differs from the package
  version, builds, publishes with provenance, and opens the GitHub release from
  this file's matching section.
- **CI** runs on every push to `master` and every pull request: the build, the
  host type-check, and each of the four suites as its own step.
- npm metadata (`keywords`, `homepage`, `bugs`, `author`, `engines`) and the
  README badges; `dsh-models-router` replaces `dsh-model-router` everywhere,
  including the repository name.

### Fixed

- The client bundle no longer leaves its own `./remote` artifact as an external
  `require` on a clean checkout (the host face now builds first).
- The legacy-config composition scenario generates its overlay at run time
  instead of shipping Windows absolute paths.

## [0.2.0] — 2026-10-21

The release that makes routing per-conversation: several named chains, a session
that can pick one, and retry counts that can be overridden per session. Published
under the name `dsh-models-router` (`dsh-model-router` on npm belongs to another
publisher).

### Added

- **Named chains.** `chains[]` + `defaultChainId`; a chain carries its own
  candidates, switch-on rules, first-hop budget, sticky window and start
  strategy. The settings page can add, rename, copy (candidates and budgets come
  along), make default and remove chains; the last one cannot be removed.
- **Per-session chain binding.** A chip in the composer tool row (after the Plan
  and permission controls, before the model selector) picks the chain for the
  current conversation, and a "session routing" tab lists every session so
  several can be assigned without opening them. Bindings live in the
  `model_router_sessions` storageDomain sidecar, keyed by `sessionId`; without
  the storage domain they fall back to process memory and the UI says so.
- **Per-route retry overrides** in the session popover and the session tab:
  `session override ?? candidate maxRetries`, keyed by `provider/model`, 0..9.
  Empty follows the chain; `0` means "do not retry this route".
- **Batch binding read/write Remotes** (`sessionBindings`,
  `deleteSessionBinding`) for the session list and its cleanup of deleted
  sessions.

### Changed

- **Retries on a routed step are executed by this plugin.** For a code listed in
  `switchOn`, the configured `maxRetries` is the real number, with no
  provider-policy ceiling on top; the wait copies DSH's curve. Codes outside
  `switchOn` still go to `llm-retry`.
- A chain's `needs` gates the fallbacks; the first hop is the user's selection
  and is never gated (README documents the consequence for image routing).

### Fixed

- **Legacy configs are actually adopted.** The shape is now read from the raw
  config (`chains` → `chain` → `profiles` → `default`), so a user whose config
  predates the named chains keeps routing instead of silently being read as an
  empty chain.
- **A reloading or disabled plugin no longer breaks turns.** The per-agent seams
  are owned by the plugin fiber and take the agent from the payload, so they are
  removed on unload and replaced on reload; a closed storage domain now answers
  "no binding" on reads and a plain retryable error on writes instead of leaking
  `DomainError('closed')`, and a restart retries a transiently `already-open`
  domain.

## [0.1.0] — 2026-10-19

First tagged release. The plugin has been feature-complete since 2026-10-16 and
is published here as one baseline rather than a running count of pre-release
commits: everything below landed between the first commit (2026-10-13) and this
tag, verified against a real DSH Loader and, where behaviour is visual, a real
browser session.

### Added

- **Transparent cross-provider failover for Agent main requests.** `agent/request`
  (`prepend: true`) selects the physical route for every attempt; when a model
  fails, the request moves along an ordered chain of physical
  `provider/model` candidates. Models without a configured rule behave exactly
  as they do without the plugin.
- **Two-layer attempt budget.** Same-route retries and their backoff stay owned
  by DSH's `llm-retry` (durable `llm/retry` records included); cross-candidate
  failover and the hard total cap belong to this plugin. Neither layer can
  starve or duplicate the other.
- **Pre-fire validation.** Before a candidate is returned, its route config is
  resolved through `ctx.llm.resolveCallConfig()` — the same path `selectModel`
  uses — so a candidate that cannot serve this exact request is skipped before
  any real call. Pre-check failures are tiered by who can fix them
  (request shape / route missing / adapter defect).
- **Conditional routing.** Per-candidate `images` and `minContextTokens`
  conditions, plus per-`switchOn` failure-code switches. The image condition
  exists so a text-first route can hand a sudden image turn to a vision
  candidate with no extra click.
- **Chinese, in-conversation notices** for every switch: the failure code, the
  candidate that answered, and why the switch was allowed. Notices ride the
  durable log into the trajectory view.
- **Channel health workspace** in the sidebar footer dialog: passive zero-token
  observation of real latency and throughput, opt-in 1-token TTFT probes,
  per-channel circuit breakers (route- and channel-scoped, with cooldown), a
  24-point timeline, and a failover-history drawer that rebuilds itself through
  session forks.
- **Bilingual configuration UI** (zh/en) with the full settings surface inline:
  chain ordering and drag-reorder, per-candidate attempt caps, switch-on codes,
  breaker rules, probe settings, and an unsaved-changes save bar.

### Changed

- **The UI has exactly one carrier**: a sidebar footer entry that opens a
  dialog. The `plugins.bundle.config` page registration was removed on
  2026-10-16 — measurement showed a page cannot fit DSH's settings column
  (868.9px min-content against a 647.1px column at a 768px viewport).
- **Semantic colour has one source.** Tone colours enter dots and borders only;
  badge text is always `label-primary`. `--dsh-router-accent` is defined once,
  and accent-as-text resolves per theme (`--dsh-router-accent-text`) so contrast
  stays above AA in both themes.
- **Height comes from the container chain**, never from `calc(100vh …)`; a
  source-level guard rejects the latter.

### Verified

- Composition (real headless Loader, stub adapter, assertions on the durable
  log): **21 scenarios, 0 failures**.
- Unit (pure decision logic): **121 tests**.
- Client controller: **48 tests**.
- Remote service: **14 tests**.
- `npm run bundle` (including `tsc -p tsconfig.json`) and `node --check`: clean.
- The DSH reference checkout is strictly read-only across the whole history:
  `git -C <checkout> status --porcelain` is 0 lines.

### Known limitations

- **Agent main requests only.** Compaction and session-title calls keep their
  own DSH configuration and are not routed.
- **Tool capability is not pre-checked.** DSH exposes no machine-readable
  "supports function calling" metadata.
- **Not on npm.** The name `dsh-model-router` on the public registry belongs to
  an unrelated package; this plugin is installed from this repository.

[0.1.0]: https://github.com/Imzl-zl/dsh-models-router/releases/tag/v0.1.0
