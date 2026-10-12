# DSH Model Router

面向 DeepSeek Harness（DSH）的可插拔模型渠道路由设计项目。目标是研究一个用户选择的模型或 profile 如何映射到多个真实 provider/model route，以及失败重试、跨渠道切换和 Session/UI 怎样正确呈现实际执行身份。当前仓库只承载设计和源码研究，不含可安装插件实现。

## 状态

- 阶段：设计提案；路由产品模式和重启恢复策略仍待产品 owner 决定。
- DSH 源码参考：`D:\sudy\github\deepseek-harness`，设计用源码索引见 [源码地图](docs/design/source-map.md)。
- 架构入口：[设计架构](docs/architecture.md)。
- 外部依据：[主流路由产品对照](docs/references/prior-art.md)。
- 待定事项：[未决问题](docs/design/open-questions.md)。
- 协作规则：[AGENTS.md](AGENTS.md)。

## 当前建议

先验证外置 Cordis 插件对 Agent 主请求的优先级路由，不先修改 DSH 核心。候选选择发生在 `agent/request`；失败恢复由 `agent/request-error` 触发下一 attempt。不能在 `prepareCall()` 已捕获 adapter 后依赖 `llm/stream` 切换 Agent route。纯插件方案还须验证失败 `assistant/attempt` settlement 对 transient stream 的清理、`llm-retry` 的 durable schedule/Chat projection 语义与 model-selection 对账；不能仅凭 hook 可以返回 `{ kind: 'retry' }` 就视为完整 failover。

## 目录

- `docs/design/`：架构、源码地图、未决事项与实施阶段。
- `docs/references/`：官方产品资料及设计对照。
- `.agents/notes/`：取舍理由及其状态。
