# 2026-10-13 真实渠道全功能实战（web UI + 活网关）

## 状态

已实现（2026-10-13 实测，`tests/web-real.overlay.yml` + gitignored 凭证；
服务曾留驻 3380 端口供人工复验）。

## 实测矩阵（全部真实发送，断言依据 durable log / 轨迹 / UI）

| # | 场景 | 结果 |
|---|---|---|
| 1 | 用户选 gpt-6-astra（真 500）发文字 | 500×2（同渠道重试=maxAttempts）→ 切 kimi-k3 成功；notice、候选序号、两层预算全部正确 |
| 2 | 凭证失效安全（链中插 real-c 错 key） | 500 → 切 real-c → **"API 密钥无效 AUTH"终态，不盲切**后续候选 |
| 3 | needs.images 跳过方向（纯文字） | deepseek-v4-flash 被跳过（notice"使用条件不满足（需图片输入）"）→ sensenova 回答 |
| 4 | needs.images 合格方向（带图） | **deepseek 被选中（候选 2/3）**→ 它也 500 → 再切 sensenova（**一轮两跳**） |
| 5 | 原生模态配置 | gpt-6-astra 声明 `input:[text,image]` 后 composer 解除拦截（DSH 原生保护：纯文本模型拒收图片） |
| 6 | UI 配置全流程 | 真实目录 7 路由、建链、needs 面板、删除二次确认、保存，全部通过 |

## 真实世界发现（与设计假设的差异）

- **gpt-6-astra 的 500 是间歇性的**（上游波动），不是永久坏；早前"持续 500"的观察只在那个时间窗成立。kimi-k3 的 429 同样瞬时。故障转移测试捕获的都是真实发生的失败，但"哪个模型坏"不可作稳定假设。
- **图片降级为哈希**：故障转移到纯文本模型时，图片以持久化引用（哈希）到达，模型明说"只收到哈希值看不到图"——优雅降级，不崩。对应 `pi-ai` convert 的 durable image reference 解析按目标模型能力内联。
- **composer 原生护栏**：往未声明图片能力的选中模型发图会被静默拦截（无提示、按钮不 disabled），正解是在 Models 页面配 `input`，不是绕它。

## 原生配置面（源码证实，用户指正后复核）

- Settings → Models 页面（`ui-settings-models`）原生提供：每模型**输入类型**（text/image，`ModelInputTypes.tsx`，写 `input`/`inputModalities`）、**contextWindow**、**maxTokens**（`ModelRow.tsx`）；自定义网关走 `CustomProviderCard` + `ModelListEditor`，落 `llm-pi-ai` 的 `providers` 配置。测试 overlay 写的 `input/contextWindow/maxTokens` 就是这套字段（`llm-pi-ai/src/config.ts` 的 `PiAiModelProfile`），非私货。

## 未覆盖

- 全局兜底池的**失败触发**：池已配好（接管开 + sensenova），但唯一坏模型上游恢复，触发不了；池逻辑由组合测试 default-pool 场景覆盖。
- RATE_LIMIT / TIMEOUT 真实路径仍不可稳定复现（kimi 429 瞬时；带图请求会让 gpt-6-astra 挂死，DSH 流空闲超时 5 分钟，等不起）。
