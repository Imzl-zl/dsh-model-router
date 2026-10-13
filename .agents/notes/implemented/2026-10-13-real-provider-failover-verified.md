# 2026-10-13 真实 provider 故障转移实测通过

## 状态

已实现（2026-10-13 实测）。

## 背景

此前全部验证使用确定性 stub adapter（组合测试 9/9 + 单测 23/23）。stub 的失败码是
按设计注入的，真实世界的错误分类、传输形态、两层预算的实际节奏都没有证据。用户
提供了 newapi 免费渠道（两个 key、六个模型）用于实测，并明确要求不得触碰官方
DeepSeek 适配器。

## 实测设置（`tests/real-run.mjs`，凭证在 gitignored 的 `real-providers.local.json`）

- `llm-pi-ai` 手工声明两个网关 provider（`real-a`/`real-b`，同 baseURL 不同 key，
  `api: openai-completions`，`apiKeyEnv` 指向环境变量）。官方 `llm-deepseek` /
  `llm-deepseek-account` / `session-title-llm` 全部禁用——不花用户一分钱。
- 场景：用户所选模型 = `real-b/gpt-6-astra`（该模型对每个请求返回真实 HTTP 500
  "upstream error"），备份 = `real-a/sensenova-6.8-flash-lite`（正常）。跨渠道、
  跨 key 的真实故障转移。

## 实测结果（durable session log 直证）

```
RETRY retry=1, retry=2                      ← llm-retry 同渠道重试（candidate maxAttempts=2）
NOTICE [路由切换] 主模型 real-b/gpt-6-astra 失败（服务端错误），已切换至
       real-a/sensenova-6.8-flash-lite（候选 2/2）
FINAL route=real-a/sensenova-6.8-flash-lite
```

- 真实 500 被 DSH 映射为 `SERVER`，命中 `switchOn.server`——失败码分类链路在真实
  provider 上成立。
- 两层预算在真实 log 里可见：同渠道恰好 2 次（candidate 上限），随后跨候选 1 次。
- notice 文案、候选序号、最终路由全部正确。总耗时 10.4s。

## 关键环境事实（已入 tools.md）

- 该 newapi 网关对本机直连做 TLS 重置（SNI 阻断/JA3 过滤）：curl 与 node 均在
  ClientHello 后被 RST，浏览器因走系统代理而正常。
- 本机系统代理 `127.0.0.1:7890`（Clash 类）。node 侧需
  `HTTPS_PROXY=http://127.0.0.1:7890` + `NODE_USE_ENV_PROXY=1`（Node 24）才能
  复现浏览器的连通性。
- 模型实况（2026-10-13）：`gpt-6-astra` 持续 500；`kimi-k3` 429 是瞬时的（rpm
  恢复后可用）；`sensenova-6.8-flash-lite`/`step-5-preview`/`deepseek-v4-flash`/
  `gemini-3.5-flash-lite` 可用（gemini 慢，~9s）。

## 代价与未覆盖

- 只覆盖了 SERVER 一条真实失败码路径；RATE_LIMIT（kimi-k3 的 429）瞬时不可复现，
  TIMEOUT/TRANSPORT 无稳定复现手段。RATE_LIMIT 路径仍只有 stub 证据。
- 真实测试花钱（免费额度）且依赖本机代理，定位为手动验证工具，不进 hermetic 套件；
  `run.mjs` 保持零网络。
