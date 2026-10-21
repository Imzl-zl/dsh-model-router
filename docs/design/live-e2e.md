# 隔离进程 · 双会话端到端验证（新会话提示词）

这个页面的用途：把「按会话选链 + 每路由重试次数覆盖」用**真实网关**在**隔离进程**里跑一遍，
跑完把会话与临时文件清理干净。它不进 `npm test`（真实请求要花钱/看网络），是一次性人工验证。

凭据在 `packages/dsh-models-router/tests/real-providers.local.json`（`*.local.json`，gitignored，
永不提交）。提示词里**不要**贴 key，让新会话自己读那个文件。

## 提示词正文（整段复制到新会话）

```text
目标：在隔离进程里用真实网关端到端验证「按会话选链 + 每路由重试次数覆盖」，跑完清理干净。
硬约束：不修改 DSH 源码树 D:\sudy\github\deepseek-harness；不提交任何凭据；不削弱已有测试；
不要并发跑两个 run.mjs 类套件（它们共用固定路径）。

0) 先读这几处，别凭记忆：
   - packages/dsh-models-router/tests/real-providers.local.json —— 凭据（gitignored）。channels[]：
     real-a = myovo（step-5-preview / kimi-k3 / sensenova-6.8-flash-lite / glm-5.2 / deepseek-flash），
     real-b = lightvela（只有 auto），real-c = 备用 key。suggested 里有可用的 backup / deadRoute。
   - docs/design/per-session-chains.md —— 语义：绑定是覆盖不是合并；生效次数 = 会话覆盖 ?? 候选 maxRetries；
     0 = 不重试，空 = 跟随链；首跳恒为用户选中的模型，链只排"它失败之后"。
   - tools.md 的「隔离进程跑 web UI」「真实 provider 测试」两节。

1) 构建：npm run bundle --prefix packages/dsh-models-router
   （bundle 里已是 tsdown --concurrency 1：host 先、client 后。干净 lib/ 下必须这样，否则 client 会把
   自引用 dsh-models-router/remote 退化成外部 require。）

2) 隔离环境：DSH_HOME = packages/dsh-models-router/tests/.dshhome-e2e（新建，别复用
   .dshhome-view / .dshhome-real），端口从 3492 起挑空闲的，命令带 --no-open。
   临时 overlay 写 tests/overlay-e2e.yml（已 gitignore），内容要点：
   - 关掉 llm-deepseek、llm-deepseek-account、session-title-llm；
   - session-persistence-jsonl: root './.sessions-e2e'，compression none；
   - llm-pi-ai providers：
       dead   → baseURL http://127.0.0.1:9/v1（真连接拒绝，确定性 TRANSPORT）
       real-a → myovo，apiKeyEnv REAL_A_KEY
       real-b → lightvela，apiKeyEnv REAL_B_KEY
   - agent-default-model: provider dead / model dead —— 让每一轮的**首跳**都是真失败；
   - 两条命名链（defaultChainId: dead-first）：
       dead-first: candidates [ {dead/dead, maxRetries: 0}, {real-a/step-5-preview, maxRetries: 0} ]
       real-first: candidates [ {real-a/auto, maxRetries: 0}, {dead/dead, maxRetries: 0} ]
     switchOn 至少含 transport: true。

3) 两个会话（同一个进程里两轮独立会话；用 headless CLI 各跑一轮即可，不必开浏览器）：
   - 会话 A：绑 dead-first，会话覆盖 { "dead/dead": 0 }
   - 会话 B：绑 dead-first，会话覆盖 { "dead/dead": 5 }
   绑定通过插件自己的 setSessionBinding（或设置面板/芯片）写入，**不要手改存储文件**。
   跑的时候把 REAL_A_KEY / REAL_B_KEY 注入环境。

4) 断言（全部读 durable 会话日志，不靠观感）：
   - 会话 A：dead/dead 的 assistant/attempt 恰好 1 次，failure.code = TRANSPORT；
     随后 request/header 切到 real-a/step-5-preview；有一条中文 failover notice；有 assistant/message。
   - 会话 B：dead/dead 的 attempt 恰好 6 次（1 + 5），全部 TRANSPORT；然后切到 real-a。
   - 两者配置完全相同，唯一差别是会话覆盖 —— 这就是"覆盖生效"的证据。
   - $DSH_HOME/storages/model_router_sessions.json 里两条绑定：键是 sessionId，值是 { chain, retries }。
   - 反向检查：把 B 的覆盖改回 0 再发一轮 → attempt 回到 1 次（证明读的是覆盖，不是链上默认值）。
   - 链绑定：把某个会话改绑 real-first，重跑一轮 → notice/header 里的备胎变成 real-a/auto（而不是
     step-5-preview），证明"选链"真的换了候选集合。

5) 可选（要 UI 证据才做）：web profile + Chrome MCP 隔离上下文页面，验芯片位置/文案，以及切换链之后
   下一次请求的 request/header 真的换了候选（结论见 memory.md 的浏览器实测条目）。

6) 清理（必须）：
   - 删 tests/.dshhome-e2e、tests/.sessions-e2e、tests/overlay-e2e.yml、本轮生成的 log/临时脚本；
   - 若动过某个 profile 的 cordis.patch.yml，从备份恢复；
   - git status --porcelain 必须为空；git check-ignore 确认 real-providers.local.json 仍被忽略。

7) 报告格式：先给结论（几条断言通过/失败），再贴原始证据行（attempt 计数、header 序列、notice 文本），
   最后贴清理后的 git status 输出。失败就直说失败在哪一条，不要用"应该"。
```

## 验证要点（这几条不可省的原因）

- **首跳必须是真失败**：链只排"选中模型失败之后"，所以让 `agent-default-model` 指向死端口，
  比找一个"会 500 的模型"可靠得多（不依赖网关脾气），失败码恒为 `TRANSPORT`。
- **两个会话共用一条链**：链上 `dead` 的 `maxRetries` 固定为 0，A/B 的差别**只**来自会话覆盖；
  如果两条链各配一个次数，就无法区分"链预算"和"会话覆盖"。
- **反向检查**（B 改回 0）是这条验证的防伪点：没有它，6 次 attempt 也可能来自链上配置。
- **绑定走插件方法**：手改 `storages/*.json` 会让"写入路径是否真的落盘"这条事实无人验证。
