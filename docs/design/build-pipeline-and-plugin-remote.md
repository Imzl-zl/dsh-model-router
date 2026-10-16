---
title: "DSH Model Router — 构建管线与插件自有 Remote（含主动探测档位恢复）"
status: "proposed"
kind: "design-proposal"
last_updated: "2026-10-15"
---

# DSH Model Router — 构建管线与插件自有 Remote

## 摘要

本提案要求把包移到 DSH 标准的 `tsc` + `tsdown` + Typert 生成器构建管线上，使插件拥有自己的 Remote 服务，并在此基础上恢复「主动端到端测速」档位。

当前包是手写单文件、无构建步骤，因此插件自有 Remote 的注册通道不存在：`dsh-typert-loader` 跳过没有生成 `./typert` 导出的包。主动探测需要浏览器触发宿主执行一次模型调用，恰好撞在这条边界上。

> 提案时的状态：探测档在 UI 中为禁用态加说明。Phase 3 落地后该档位已恢复，
> 构建管线与该边界的事实结论仍如下述（见文首验收处的落地说明）。

工程量不是本提案的约束；约束是**必须用 DSH 的 sanctioned 机制**，不能用手写 manifest 或提交生成物等方式绕过验证器。

## 当前边界（已核实事实）

1. 插件自有 Remote 的存在前提是包导出 `./typert`，且该文件必须是 Typert 生成器的产物。
2. 本包 `package.json` 的 `exports` 只有 `.`、`./client`、`./package.json`，没有 `./typert`，也没有构建步骤产生它。
3. 浏览器侧同样需要生成的 `./remote` 投影：`@deepseek-ai/dsh-api-gateway/client` 拥有 descriptor 校验，`ctx.remote.$mount()` 是唯一挂载入口。`dsh-api-remotes` 的客户端装配挂载的是一份**固定名册**，不含树外插件，因此插件必须在自己客户端半包内挂载。
4. 结论：无构建 → 无插件自有 Remote → 主动探测档位不可达。这不是开关被关闭，是通道不存在。

## DSH 实现定位

源码根目录 `D:\sudy\github\deepseek-harness`（只读）。行号为核对时定位提示。

**Typert 产物契约**

- [`packages/typert/loader/src/index.ts:40`](file:///D:/sudy/github/deepseek-harness/packages/typert/loader/src/index.ts#L40) 定义 `TYPERT_HOST_EXPORT = './typert'`；[`packages/typert/loader/README.md:12`](file:///D:/sudy/github/deepseek-harness/packages/typert/loader/README.md#L12) 说明没有该导出的包会被跳过，因此把 loader 挂进任何组合都是安全的。
- [`packages/typert/generator/README.md:88`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/README.md#L88) 规定 `WorkspaceTypertGenerator` 会校验每个贡献方的 `package.json`：`./typert` 与 `./client/typert`（存在 Remote 方法时还有 `./remote`）必须精确指向生成文件，且 `files` 清单必须包含它们。
- [`packages/typert/generator/src/tsdown-plugin.ts:43`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/tsdown-plugin.ts#L43) 是 `typertPlugin()`；`mode: 'package'` 只发当前被打的包，`mode: 'workspace'` 发每个显式贡献方一次。树外包用 `package` 模式。

**根构建如何串起来**

- [`tsdown.config.ts:33`](file:///D:/sudy/github/deepseek-harness/tsdown.config.ts#L33) 在 host face 挂 `typertPlugin({ mode: 'workspace', faces: ['host'] })`；[`tsdown.config.ts:25`](file:///D:/sudy/github/deepseek-harness/tsdown.config.ts#L25) 的 entry 是 `lib/types/{index,startup}.js`——即 tsdown 消费的是 **tsc 先发出的 JS**，构建是两段式。
- 根 `package.json` 的 `build:lib:host` 先 `tsc -b tsconfig.host.json` 再 `tsdown --env.DSH_BUILD_FACE host`，与该两段式一致。

**客户端如何拿到 Remote**

- [`packages/client/tsdown.client.ts:109`](file:///D:/sudy/github/deepseek-harness/packages/client/tsdown.client.ts#L109) `clientBundle()` 是客户端半包的构建预设；[`:117`](file:///D:/sudy/github/deepseek-harness/packages/client/tsdown.client.ts#L117) 约定客户端入口为 `src/client/index.ts`（或 host face 下的 `lib/types/client/index.js`）。
- [`packages/api/remotes/src/client/index.ts:189`](file:///D:/sudy/github/deepseek-harness/packages/api/remotes/src/client/index.ts#L189) 是 `ctx.remote.$mount(contribution)` 的固定名册装配；[`packages/api/remotes/README.md:14`](file:///D:/sudy/github/deepseek-harness/packages/api/remotes/README.md#L14) 说明客户端入口以运行时值导入生成的 `/remote` 产物并逐项 `$mount`。
- [`packages/client/modules/src/index.ts:195`](file:///D:/sudy/github/deepseek-harness/packages/client/modules/src/index.ts#L195) 解析 `exports["./client"]`（字符串或 `{default}` 均可）；[`:221`](file:///D:/sudy/github/deepseek-harness/packages/client/modules/src/index.ts#L221) 的 `artifactRevision` 按文件 mtime/ctime/size 算版本号，因此重新构建后浏览器自动取新字节，不会踩旧缓存。

## 参照实现

`@deepseek-ai/dsh-experimental-client-ui-cot-translation` 是唯一同时具备**客户端半包 + 自有 Remote** 的形态，与本插件目标同构：

- [`packages/experimental/client-ui-cot-translation/tsdown.config.ts`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/tsdown.config.ts) 全文一行 `clientBundle(...)`。
- [`packages/experimental/client-ui-cot-translation/src/index.ts:29`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/src/index.ts#L29) 用 `export default class ... extends TypertRemoteService`，类同时是 Cordis Service、插件与 Remote 服务；[`:46`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/src/index.ts#L46) 的 `@Remote` 方法以 `signal: AbortSignal` 收尾。
- [`packages/experimental/client-ui-cot-translation/src/client/index.ts:3`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/src/client/index.ts#L3) 导入生成的 `/remote`；[`src/client/mount.ts:125`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/src/client/mount.ts#L125) 调 `ctx.remote.$mount(contribution)`，随后业务代码经 `ctx.remote.<ns>.<method>()` 调用，返回值是 `{ ok, value }` 信封。
- [`packages/experimental/client-ui-voice-input/tsdown.config.ts`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-voice-input/tsdown.config.ts) 展示不带 `hostPhase` 的 `clientBundle` 形式， standalone 构建更简。

## 方案

### 1. 构建配置

`packages/dsh-model-router/tsdown.config.ts` 自复刻 `clientBundle` 的构建契约，不引 DSH 未发布的预设：该预设位于 [`packages/client/tsdown.client.ts`](file:///D:/sudy/github/deepseek-harness/packages/client/tsdown.client.ts)，不在任何已发布包里，DSH cookbook 明确仓库外的包要自己复刻这一步构建（[`docs/cookbook/adding-a-settings-card.md:60`](file:///D:/sudy/github/deepseek-harness/docs/cookbook/adding-a-settings-card.md#L60)）。Typert 生成插件在本包配置内显式加入（[`clientLibraryConfig`](file:///D:/sudy/github/deepseek-harness/packages/client/tsdown.client.ts#L220) 本身不含它），取值 `typertPlugin({ mode: 'package', faces: ['host'] })`。

Phase 1 实跑后定案的取舍：

- **单段式**：tsdown 直接从 `src/index.ts` 打包 Node 半包，`tsc -p tsconfig.json --emitDeclarationOnly` 只发 `lib/types` 声明；产物落点（`lib/index.js` + `lib/types/*.d.ts`）与 DSH 两段式一致。两段式的收益（composite 项目图按依赖序构建全仓）只在多包 workspace 里存在，树外单包复刻纯增失败面。
- **`mode: 'package'`**：树外包没有 workspace 可扫，package 模式只发当前被打的包（[`tsdown-plugin.ts:72-93`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/tsdown-plugin.ts#L72)）。
- **`faces: ['host']`**：Phase 1~2 只需 host face；浏览器侧要用的 `./remote` 投影是 host face 的产物（[`emitter.ts:125-127`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/emitter.ts#L125)），随 Phase 3 的 Remote 方法一起出现，不需要 client face。
- **`hostPhase` 不适用**：它是 `clientBundle` 的 workspace 构建相位选项，本包不用该预设。
- **workspace 根标记**：生成器的 package 模式从包 outDir 向上找 `tsconfig.host.json` 定 workspace 根（[`tsdown-plugin.ts:154-161`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/tsdown-plugin.ts#L154)），且要求被引包位于 `<root>/packages` 下（[`analyzer.ts:488`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/analyzer.ts#L488)）。项目根因此持有一份只做 registration 聚合的 `tsconfig.host.json`，引用 `packages/dsh-model-router/tsconfig.json`。
- **surface**：生成器只为带标记声明的包产出（[`analyzer.ts:2775-2808`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/analyzer.ts#L2775)）。`Profile` 接口带 `@typert` 标签并经 `src/index.ts` 再导出，成为 host face 的唯一 surface；`Strategy` 因此改为显式联合（Zod 发射器不支持 indexed-access，见[`emitter.ts:777-788`](file:///D:/sudy/github/deepseek-harness/packages/typert/generator/src/emitter.ts#L777)）。

取舍理由与被否方案见 `.agents/notes/implemented/2026-10-15-out-of-tree-build-pipeline.md`。

### 2. 包结构

`exports` 改指 `lib/`，`files` 补上生成物。客户端半包从单个手写文件拆为 `src/client/index.ts` + 若干模块——拆分的理由不是美观，是**客户端必须能 `import` 生成的 `/remote`**，而单文件经 bundle 端点下发时做不到。

参照 [`client-ui-cot-translation/src`](file:///D:/sudy/github/deepseek-harness/packages/experimental/client-ui-cot-translation/src) 的布局：`src/index.ts`（宿主）、`src/client/index.ts`（客户端入口）、`src/client/*`（组件与挂载）、`src/types.ts`（共享类型）。

### 3. Remote 服务形态

按 DSH 惯例改为类形式：一个 `export default class ... extends TypertRemoteService`，同时承担 Cordis Service、插件与 Remote 服务三角色，`static inject` 声明依赖，`static Config` 用 schemastery 声明配置。本插件现有的函数形式 `apply(ctx)` 与独立 `Config` 对象需相应调整。

探测方法签名建议（草案）：

```ts
@Remote
async probeAll(request: ProbeRequest, signal: AbortSignal): Promise<ProbeReport>
```

`ProbeRequest` / `ProbeReport` 的具体字段在 Phase 3 定义；探测内容、按渠道覆盖、超时与周期沿用现有 [`src/config.ts:125`](../../packages/dsh-model-router/src/config.ts#L125) 的 schema，不新建第二份配置源。

### 4. 客户端挂载

客户端半包在 `apply` 内 `await ctx.remote.$mount(remote)`，再进入 UI 注册；卸载时先撤 UI 再撤 Remote，次序与参照实现一致。`ctx.remote` 已在现有 `inject` 中，无需新增依赖声明。

### 5. 主动探测档位恢复

宿主执行：对每个物理渠道发一条最小消息，首字（TTFT）到达即 `abort()`，把存活与首字延迟折进现有 `router/channel-health` 投影；浏览器照常读投影渲染，不新增数据通路。

触发两种，都与原设计一致且互不排斥：

- **手动**：浏览器调 `probeAll`，只有界面开着时才可能发生；
- **定时**：宿主按 `intervalSeconds` 自持定时器，周期 0 表示只手动。

计费语义保持默认关闭；定时周期由用户按各渠道承受力自设。

## 分阶段实施与验证闸门

| 阶段 | 内容 | 闸门 |
|---|---|---|
| 1 | 构建管线落地；`exports` 指 `lib/`；确认 `./typert` 被 loader 认到 | **单独验证**：`dsh --profile <p> --dump-config` 能看到插件行；启动无 typert 校验报错。不过闸门不进 Phase 2 |
| 2 | 客户端半包拆模块；`./client` 指 `lib/client.js`；浏览器实测页面与既有功能不回退 | 隔离 home + Chrome MCP 实测：配置页、流水线、健康徽标、保存闭环 |
| 3 | `RouterHealthService` + `@Remote` 方法；客户端 `$mount`；UI 那一档的开关与表单全恢复 | 单测 + 组合测试 + 浏览器实测：手动探测出数、定时探测按周期跑、TTFT 中断生效 |
| 4 | 交付路径改 tarball/npm（预构建 `lib/`） | `dsh plugin add <tarball>` 干净安装可用 |

## 代价

- **开发循环**：从「改完刷新」变为「改完 → `tsdown --watch` 重建 → 刷新」。这是唯一实质代价，且无法回避——产物必须从 TypeScript 程序生成。
- **一次性成本**：拆客户端单文件、新增 devDependency（`tsdown`、`@deepseek-ai/dsh-typert-generator`、`typescript`、react 类型）、交付路径从「链接源码目录」变为「链接 + 构建」或「打 tarball」。
- **架构变化**：宿主从函数形式插件改为类形式 Service，影响现有 `src/index.ts` 的组织方式。

## 待确认

1. 客户端拆模块的粒度：按现有区块拆（组件/控制器/字典/样式），还是更细？
2. 探测档位的 UI 形态：只在健康设置弹窗内配置，还是在渠道健康页也放一个「立即探测」按钮？
3. 交付是否同步改为 tarball/npm，还是继续 link + 本地构建？

## 验收

> Phase 3 已于 2026-10-15 落地，验收结论与被否方案见
> [`../../.agents/notes/implemented/2026-10-15-plugin-remote-probe.md`](../../.agents/notes/implemented/2026-10-15-plugin-remote-probe.md)。
> 与下面提案清单的唯一偏差：探测结果**没有**折进 `router/channel-health`
> 投影——投影是单会话、事件驱动的契约，探测没有会话可挂；客户端经生成的
> `./remote` 贡献读宿主持有的最近一次报告（`probeReport`），与被动快照同一套
> 读取模式。其余各项按原样成立。

- `./typert` 与 `./remote` 由生成器产出并被 loader / 客户端校验通过，无手写 manifest、无提交的生成物副本。
- `ctx.remote.<ns>.probeAll()` 在浏览器可调，返回 `{ ok, value }` 信封；取消通过 `signal` 传递。
- 手动探测：TTFT 到达即中断，Token 消耗有上限；结果折进 `router/channel-health` 并在 UI 可见。
- 定时探测：周期 0 时不跑；非 0 时按周期跑，界面关闭后行为符合 Phase 3 定义并在文档中写明。
- 单测、真实 Loader 组合测试、`tsc --noEmit` 全绿；隔离 home + Chrome MCP 端到端实测通过。
- DSH 源码树严格 0 修改。
