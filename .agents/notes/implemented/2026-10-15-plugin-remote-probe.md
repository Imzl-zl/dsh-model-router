# Agent Note: 插件自有 Remote 与端到端探测（Phase 3）

Status: implemented

## Problem

健康监控原来只有两档：被动流量观测（真实对话的折叠）和 0 Token 连通性检查
（DSH 原生 `discoverModels`）。后者证明端点应答、凭证被接受、模型 id 被广告，
但不证明这个模型现在真能出字——配额打满、上游容量不足、模型被下线但仍在清单里，
都只有真生成才暴露。用户要求把探测这一档做出来，并且**定时能力必须存在、默认关闭、
开不开由用户定**；同时要求可用率按渠道全局聚合，不能用“某个会话的观测”冒充。

## Decision

1. **插件自有 Typert Remote**：宿主类形态 `ModelRouter extends
   TypertRemoteService`，`@Remote probeAll(request, signal)` 与 `@Remote
   probeReport()`；`probeReport` 读宿主内存里最近一次运行的报告。生成物
   `lib/typert.remote-client.js` 由客户端半包 `$mount` 后经 `ctx.inject` 使用，
   与 DSH 自己的 cot-translation 客户端同一套挂载模式
   （packages/experimental/client-ui-cot-translation/src/client/mount.ts:120-128）。
2. **探测执行照 DSH 自己的会话外辅助调用范式**
   （packages/session/session-title-llm/src/index.ts:230-285）：
   `prepareCall` 之后 stream 的 options **摊薄 `call.config`**（手拼会
   `INVALID_PREPARED_CALL`），`maxTokens: 1`，首字即停；取消与超时在树内用手写
   AbortController 融合（见下“被否方案”）。失败按 provider 中立码上报
   （`unreachable` + code），超时单列 `TIMEOUT`，装不成调用才算 `unavailable`
   ——UI 永远不把“没能测”读成“有问题”。
3. **定时器归宿主**，周期来自配置、默认 0（关）。配置保存 = fiber 重启 =
   按新周期重新武装，没有第二条更新路径。定时结果不推送：客户端在打开健康视图时
   经 `probeReport()` 读一次，与被动快照同一套模式。
4. **可用率全局聚合**：客户端合并从“整记录覆盖（最新会话赢）”改为**时间线并集
   （按时间排序）+ 标量取最新**。同一个渠道这个会话用、那个会话也用，并发三个会话
   更在同时用，统计必须合在一起算。

准入门槛（可机械判定）：

- `tests/remote.mjs`：真实 headless 生产 profile 进程内组合（DSH 自己的
  `dsh-app-boot` 启动器），7 项——产物过 loader 自己的校验器、网关派发、
  严格 codec 拒错形状、活路由测得 reachable + TTFT、拒绝对应的
  unreachable + code、手动运行留下可读报告、**定时器无人调用也自己产出报告**。
- 真网关浏览器实测：手动探测三态全对（real-a 通过 3.72s / real-c 坏 key
  AUTH / real-dead 连接拒绝 TRANSPORT）；2 秒周期下定时器自己产出报告，
  打开健康视图即读得到；默认关闭、关闭路径可走。
- 组合测试 13/13、客户端 24/24、单测 0 失败、`node --check` 与 `tsc` 通过。

## Alternatives considered

1. 把探测结果折进 `router/channel-health` 投影（原设计文档的写法）
   - 最强的理由：与被动观测同一数据通路，UI 不用认第二种来源。
   - 为何被否：投影是**单会话**契约、由 session 事件驱动；探测没有会话，也没有
     可追加的持久事件。硬折要么伪造事件，要么新造一个跨会话投影源。客户端经
     Remote 读报告是协议 sanctioned 的路径（`ctx.remote.$mount`），不新增数据通路。
2. 用 `@deepseek-ai/dsh-timeout` 的 `deadline()` + `using`
   - 最强的理由：原生原语，取消与超时一条信号，代码更短。
   - 为何被否：**`using` 是源码模式加载器解析不了的语法**。组合测试按文件路径
     插入插件时走 Node strip-only 类型移除，`using` 与装饰器一样直接 parse 失败；
     改插构建产物可以绕过，但那会让 13 个路由场景全部依赖一次构建。手写融合
     （AbortController + 上游信号 + setTimeout）在两种模式下都能加载。
3. 类形态 + 参数属性 `constructor(ctx, private config)`
   - 最强的理由：DSH 自己的 `SubagentRuntime` 就这么写。
   - 为何被否：strip-only 模式**拒绝参数属性**（`TypeScript parameter property
     is not supported in strip-only mode`）。改为显式字段赋值即可，语义不变。
4. 组合测试继续按 `src/index.ts` 插入
   - 最强的理由：测的是源码。
   - 为何被否：宿主半包装了 `@Remote` 装饰器，strip-only 解析不了 `@` 令牌。
     tsdown 在构建时降级装饰器，所以组合测试改插 `lib/index.js`——那也正是浏览器
     和真实安装加载的产物，测它不比测源码弱。
5. 跨会话合并时间线（把 20 个会话的时间点拼起来再去重截断）
   - 最强的理由：可用率与波动图真正反映 20 会话窗口。
   - 为何被否：要新造一套跨会话时间线语义（排序、去重、窗口、与投影自身 timeline
     的关系），而本次要修的是“赢家不定 + 视图陈旧”两个确定性缺陷。并集 + 标量取新
     让可用率成为全局事实，同时不改变任何现有展示语义。
6. 探测结果参与路由决策（不可用就跳过候选）
   - 最强的理由：主动探测比被动观测更新，似乎更适合当选路依据。
   - 为何被否：探测是**合成**观测，一条消息说明不了渠道在真实负载下的状态；
     把它接进选路会让一次误报把用户配的候选踢出链路。选路仍只认真实对话结果与
     用户显式条件，探测只服务于“看得见”。

## Consequences

- 收益：健康监控三档齐备且都可验证；定时能力存在且默认关闭；可用率是全局事实；
  探测的三种结局（通过/未通过/没能测）在 UI 上措辞分清，不把“没能测”说成故障。
- 代价：① 探测器本身花 token，所以默认关、按钮上标明“1 Token”、周期与内容由
  用户定；② 树外 Typert 需要 `packages/dsh-typert-protocol/` 这个**仅分析器**
  的注册副本（monorepo 靠 `tsconfig.base.json` 的 paths 把协议映射到已注册包，
  树外没有那个源树）。副本只被根 `tsconfig.host.json` 的 paths 引用，tsc 与
  tsdown 都从 node_modules 解析真包；其中协议自带的 `declare module
  '@deepseek-ai/cordis'` 增补**故意不抄**——抄了 stub 就会被当成有 Typert
  surface 的包参与分析，进而走到 `TypertLookupMap` 的合并校验，而树外没有任何
  注册能拥有 DSH 那些包的增补。刷新方式写在 stub 的 README 里。
- ③ 组合测试与远程测试现在依赖构建产物（`npm run bundle` 必须先跑），两条测试
  文件头部都写明了。
