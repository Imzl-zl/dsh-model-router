# Agent Note: 删掉「自定义模型 ID」Tab——目录就是 DSH 能寻址的全部模型

Status: implemented

## Problem

「添加候选渠道」弹窗有两个 Tab：目录多选与自定义模型 ID。用户两次问同一个问题——「自定义的也必须已配置，那干嘛还要这个」。第一次（2026-10-15，见 `2026-10-15-ui-ux-design-overhaul-and-copy-cleanup.md` 第 1 条）的处理是把它降级成 Tab 并加一句引导文案，语义没动，所以第二次又问了一遍。

真实形状是：第二个 Tab 的 provider 下拉取自同一份 `modelCatalog().routableProviders`，它并不提供「另一个渠道」，只提供「同一渠道下一个目录外的 model ID」。而这个自由度在 `llm-pi-ai` 上不存在——`modelOf()` 对未在 `models` 或已装 catalog 里的 id 直接抛 `UNKNOWN_MODEL`，且路由一旦声明 `models` 列表就整体替换已装 catalog（`llm-pi-ai/src/adapter.ts:271-281`、`catalog.ts:897-899`）；本插件的预检把该错误归到 `route-missing` 档，用户看到的是「模型不在目录里，请到模型页确认」再跳过。于是手填、保存、请求、报错四步，换回一句「请去目录里选」。

## Decision

候选只从 `session/modelCatalog()` 勾选，不提供手填 model ID 的入口；要加目录外的模型，先在 Settings → Models 登记。

准入门槛：

1. 一个 model ID 能成为候选，当且仅当它以 `provider/model` 的形式出现在 `modelCatalog().groups` 里。
2. 弹窗里不存在 provider `<select>`、model 文本输入与 `datalist`：只有搜索框 + 按 provider 分组的复选框。
3. 目录多选一次加多条时，每条候选的 `maxAttempts` 落在 schema 的 1~5 内，添加后不手改也能保存。

## Alternatives considered

1. 保留 Tab，提交时用 `resolveModelInfo(provider, model)` 预校验，`UNKNOWN_MODEL` 当场拒绝
   - 最强的理由：保住 `llm-deepseek` / `llm-deepseek-account` 的透传能力。这两个 adapter 的 `modelInfo()` 对未登记 id 不抛错，按 text-only + adapter 默认上下文窗口放行（`llm-deepseek/src/model-info.ts:66-77`，测试名即 "advertises configured models without restricting arbitrary request ids"）。网关上了新模型而 DSH 目录尚未收录时，这条路径真的能用，把失败从「请求时」提到「添加时」也确实是一步改善。
   - 为何被否：它保住的能力带隐藏折扣——未登记模型被当成纯文本，图片发不出去，上下文窗口与 maxTokens 取 adapter 默认值；而用户实际渠道绝大多数是 `llm-pi-ai`，在那个 Tab 上预校验只会把同一句失败提前，没有多出任何可路由的模型。为一条只在两种 adapter 上成立、且能力打折的路径留一整块 UI，不如让「登记」成为唯一入口。

2. 保留 Tab，但 provider 下拉改成全部已注册 provider（含目录为空的）
   - 最强的理由：`routableProviders` 只含「至少有一个可用模型」的 provider，目录为空的渠道连手填都选不到，看起来是漏掉了一种正当用法。
   - 为何被否：目录为空的 provider 在 `llm-pi-ai` 上解析不出任何 model（`resolves no models` / `UNKNOWN_MODEL`），在 `llm-deepseek` 上虽然能透传，但那正是方案 1 的能力，只是更隐蔽。放宽 provider 只会把失败推得更晚。

3. 把透传升级成一等公民：在 Settings → Models 之外给「透传模型」一个正式配置项
   - 最强的理由：如果透传真的常用，它该有自己的配置形态，而不是藏在「添加候选」弹窗的一个 Tab 里。
   - 为何被否：那要改的是 DSH 的模型登记面（`llm-pi-ai` 的 `models` 语义、`llm-deepseek` 的 catalog），属于 DSH 源码范围；本插件的职责是选路，不是扩展模型登记。真要做，先在 DSH 侧定案。

## Consequences

- 收益：弹窗只剩一个列表，不再有「目录多选 / 手填」两条看似等价的路径；`modals.ts` 少了 provider、model、尝试次数三块状态与 `Field` helper，`locales.ts` 中英各少 12 个键，`.dsh-router-guide` / `.dsh-router-guide-title` 两条 CSS 一并删除。
- 代价：`llm-deepseek` 系渠道的透传能力在 UI 上没有入口了，要用目录外的模型必须先到 Settings → Models 登记，多一步且登记后该 id 会按 catalog 条目解析（模态、上下文窗口以登记值为准）。另外 provider 下拉曾是唯一能看见「已注册但目录为空」渠道的地方，这类渠道现在在添加弹窗里完全不可见——它们本来也路由不了，但用户少了一条发现线索。
