# DSH Model Router — 项目规则

## 常驻军规

- 未经用户明确要求，不修改 DSH 源码树 `D:\sudy\github\deepseek-harness`；仅将其作为只读事实来源。
- 将已核实的源码事实、路由方案和用户待决事项分别写入 `docs/design/` 对应文档，不互相伪装。
- 非平凡改动须记录决策笔记；实现代码与笔记同批提交，格式及判定见 `decision-notes` 技能。
- 不将 provider 重试、跨渠道 failover 和跨请求健康状态混成同一个次数或状态。

## 0. 实施基线

- 环境：Windows；参考 DSH checkout 为 `D:\sudy\github\deepseek-harness`（只读）。
- 语言/运行时：设计文档以中文为主；插件技术栈遵循 DSH 当前 Cordis/TypeScript 包规范（schemastery Config、函数插件形态、`Volatile` 配置访问）。
- 当前交付：Markdown 设计 + Phase 1 插件实现（`packages/dsh-model-router/`，host 侧最小闭环：选路、两层交接、候选索引、预校验、中文通知；8 个真实 Loader 组合测试通过）。
- 配置根目录：插件经 cordis overlay（开发）或 `dsh.bundle`（交付）安装；配置 ns = bundle patch 行 id（`model-router`）。
- 标准验证命令：`node packages/dsh-model-router/tests/run.mjs`（组合测试）；`npx tsc --noEmit --skipLibCheck --strict --module nodenext --moduleResolution nodenext --target es2022 --allowImportingTsExtensions packages/dsh-model-router/src/index.ts`（类型检查）；交付前逐项核对 Markdown 本地链接、官方来源和 DSH 源码引用。

## 1. 作用

本文件只保留长期适用的项目约束。当前技术方案见 [`docs/architecture.md`](docs/architecture.md) 与其设计细页。

## 2. Source of Truth

- 已核实的 DSH 当前行为：[`docs/design/source-map.md`](docs/design/source-map.md)，实现前仍需回到 DSH 当前分支复核。
- 本项目提案与待决事项：[`docs/design/`](docs/design/)；用户未确认的问题以 [`open-questions.md`](docs/design/open-questions.md) 为准。
- 因果取舍：`.agents/notes/`；本目录不替代设计现状或用户决定。
- `tools.md` 和 `memory.md` 是协作辅助，不覆盖正式设计资料。

## 3. 架构与项目结构

- 插件实现在 `packages/dsh-model-router/`（host `src/` + 测试 `tests/`）；`docs/design/` 保存路由提案、源码地图与计划，`docs/references/` 保存外部先例，`.agents/notes/` 保存决策理由；`spike/` 保留 Phase 1 spike 实证产物。
- DSH 当前实现仅从 `D:\sudy\github\deepseek-harness` 只读核对；未经用户明确授权，不在该 checkout 创建、删除或修改文件。

## 4. 协作文件与决策笔记

- 开工先读 `tools.md`、`memory.md`、`.agents/notes/AGENTS.md` 与当前任务相关设计；旧 `memory/archive/` 仅按需读取，不批量载入。
- `tools.md` 记录稳定命令、路径、模式和陷阱；写入前先读，不写一次性日志；`memory.md` 只保留当前状态与最近窗口，闭环后整体更新，目标 ≤120 行。
- 非平凡设计/实现选择使用 `decision-notes` 技能记录；笔记状态与冻结规则见 `.agents/notes/AGENTS.md`。

## 5. 验证、入口与关键路径

- 设计入口：[`docs/architecture.md`](docs/architecture.md)。
- 技术事实：[`docs/design/source-map.md`](docs/design/source-map.md)。
- 外部先例：[主流方案对照](docs/references/prior-art.md)。
- 用户待决问题：[未决事项](docs/design/open-questions.md)。
- DSH 参考 checkout：`D:\sudy\github\deepseek-harness`。
- Phase 1 组合测试已实跑（8/8，`packages/dsh-model-router/tests/run.mjs`）；不得声称运行过尚未编写的测试。

## 6. 项目特定规则

- Agent 主请求路由提案使用 DSH `agent/request` 与 `agent/request-error` 扩展点；不得把已由 `prepareCall()` 绑定 adapter 的 `llm/stream` 当成 Agent route selector。
- 实现产品可见插件时，遵守 DSH 根与 `packages/AGENTS.md` 规则；必须以真实 Cordis Loader composition 验证，不以手造 Context 单测代替。
- 外部先例只从官方文档引述；区分产品事实、设计建议和未确认事项。
- 候选 provider/model 必须是实际已注册并由 adapter 解析的物理渠道；逻辑 profile 与执行渠道不可混写。

## 7. 维护原则

本文件保持短、小、硬。当前状态放 `memory.md`，稳定协作知识放 `tools.md`，当前提案与事实放 `docs/`，决策理由放 `.agents/notes/`；解释性长文不堆在本文件。
