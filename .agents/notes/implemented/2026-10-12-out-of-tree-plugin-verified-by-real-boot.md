# Agent Note: 外置插件方案经真实 boot 验证，Router 必须自持候选索引

Status: implemented

## Problem

"能否不改 DSH 核心、用外置 Cordis 插件做渠道路由"一直只有源码推理，没有执行证据。三个具体的未知量阻碍开工：一是 checkout 外的插件能否被 Loader 加载并与 host 共享 `@deepseek-ai/dsh-*` 实例；二是 `agent/request` 在失败重试时到底给 Router 什么输入；三是**外层 listener 能否压过 `installModelSelection` 的 provider/model 写回**——第三条是整个设计的地基，若不成，插件根本拿不到 route 决策权。缺少执行证据时，任何一方都可以把设计往"需要核心扩展"的方向推。

## Decision

外置插件方案成立，用 `--patch` overlay 指向绝对路径的本地模块即可加载，无需打包、无需安装进 profile。Router **必须**自持 per-(agent, turn, step) 候选索引，不能从 waterfall 输入推断当前候选。Router 用 `prepend: true` 注册即可压过 `installModelSelection` 拿到最终 route，且 durable 归因跟着真实 route 走。

准入门槛（可机械判定）：

1. `spike/run.ps1` 一次运行的退出码为 0，且 `probe.log` 含 `apply` 与至少一条 `agent/request`。
2. 同时注册两条 route 并在 `agent/request` 换 provider 时，durable `request/header` 与 `assistant/message` 的 provider 都等于**被换后的** route，而非 agent 自己请求的那条。
3. 失败注入一次时，durable session 含 `assistant/attempt`（`finish=error`）→ `llm/retry` → `llm/retry-started` → `assistant/message` 完整链，且 `agent/request` 出现两次。
4. 安装后 `node_modules` 中 `@deepseek-ai/dsh-llm` 恰有 1 份。

## Alternatives considered

1. 先把插件装进 profile（`dsh plugin add`）再验证
   - 最强的理由：`publish.md:103` 说 peers 在 profile 的 node_modules 查找位置解析到运行中 dsh 的副本，是文档背书的最可靠路径，也最接近最终交付形态。
   - 为何被否：这一轮的目标只是证伪"能不能加载"，`--patch` 更少步骤且不需要 profile 生命周期管理。装进 profile 留到交付阶段；若那时出现双副本，再按 publish.md 处理。
2. 在 DSH checkout 内建 scratch 插件（照 `docs/user/develop/basic/index.md` 的做法）
   - 最强的理由：教程原文如此，import 解析必然落到 checkout 的 node_modules，最不容易出意外。
   - 为何被否：项目军规禁止在 `D:\sudy\github\deepseek-harness` 创建文件。本轮特意用 checkout 外的路径，正是为了同时证伪这一点。
3. 用 `runLoaderSmoke` 而非 `dsh --profile headless` 跑
   - 最强的理由：是 DSH 自己的测试基建，断言 durable session 的写法现成。
   - 为何被否：它需要 test-only `cordis.yml` 加自定义 bin script，而本轮要证的是"发布态 CLI 能否加载外置插件"——用 `dsh --profile headless --patch` 更接近真实使用，且顺带验证了 CLI 的 `--patch` 入口。
4. 让 Router 从 `agent/request-error` 的 payload 或 `assistant/attempt` 推断失败候选
   - 最强的理由：若可行，Router 无需维护任何状态，实现最简。
   - 为何被否：`agent/request-error` payload 只有 `provider` 没有 `model`；`assistant/attempt` 只有 `turn`/`step`/`stream`。而 `agent/request` 两次都解析回同一条 route，说明 `installModelSelection` 每次 attempt 都写回用户选择，推断无依据。只能自持索引。
5. 不改 route，让 `llm-retry` 或 adapter 内部承担故障转移
   - 最强的理由：完全不碰 waterfall 次序，规避与 host listener 的竞争。
   - 为何被否：adapter 内部重试违反 DSH "one adapter call is one SDK attempt" 的分工（`llm-pi-ai/src/adapter.ts:140-142` 显式 `maxRetries: 0`），且 attempt 对 Agent 不可见；`llm-retry` 只重试同一条 route。两者都无法跨候选。

## Consequences

- 收益：Phase 1 的准入闸门打开，11 个验证案例可以开始写；"重试时 Router 拿到什么"和"Router 能否赢"都从推断变成实测；顺带证实 adapter 不声明 policy 时 llm-retry 仍以默认 normal（maxRetries=5）重试，预算设计必须把第二层算进去。技术可行性到此没有剩余未知量。
- 代价：`spike/` 目录带进一个 536 包的 `node_modules`（已 gitignore），且 `.sessions` 会相对进程 cwd 落地——运行器必须 `Set-Location`，否则写进调用方目录（本轮第一次运行就踩到，污染了项目根并混入了 harness 自己的会话数据）。此外 `--patch` 路径只是加载手段，交付形态仍待确定为 profile 安装。
