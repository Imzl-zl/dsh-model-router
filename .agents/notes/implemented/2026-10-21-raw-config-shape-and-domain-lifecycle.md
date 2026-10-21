# Agent Note: 形状看原始配置，域关闭不再把别人的错码抛给用户

Status: implemented

## Context

用户装上这一版后报了一个错：`domain 'model_router_sessions' is closed`，并要求先把插件停掉。
排查出两件事，都是真缺陷：

1. **旧配置根本没被认领。** schemastery 会给每个声明过的字段盖默认值（`chain` 变成一条空链、
   任何数组变成 `[]`），而 2026-10-19 起的迁移读的是**校验后**的 `config.chain.get()`，它永远
   存在。于是"只有 `profiles`"的配置被读成"一条空链"——插件从 2026-10-19 起对这类配置
   **静默不接管**，用户以为还在用。他现场的行就是这种形状（`profiles` + `default`，没有
   `chain`，也没有 `chains`）。
2. **fiber 重启会把别的包的错码抛给浏览器。** 保存配置 = fiber 整体重启：旧实例的
   `storageDomain` 被 close，而浏览器在飞的一次 `sessionBinding` / `sessionBindings` 调用
   正好落在旧实例上，`table.get()` 抛 `DomainError('closed')`，用户看到的就是那句
   `domain 'model_router_sessions' is closed`。同一个重启还会让**新**实例撞上
   `already-open`（旧域"open or still closing"），静默退回内存直到下一次重启。

## Decision

1. **形状判断只看原始配置的键是否存在**，顺序 `chains` → `chain` → `profiles` → `default`。
   Host 把 `ctx.fiber._config`（cordis 的"raw plugin config, re-resolved before each
   activation"，`fiber.d.ts:107-108`）交给 `effectiveChains`；浏览器拿到的本来就是存储值，
   同一套判据。
2. **`profiles` 优先于 `default` 池**：profile 是"选中这个模型时用的那套备胎"，池子只在没有
   profile 命中时才生效。用户两样都配过，读池子等于把他真在用的链丢掉、换成一条他从没为这个
   模型排过的顺序。
3. **域关闭 = 这个实例已经死了**：读回答"没有绑定"（UI 从新实例重读）、`list()` 空、
   `delete` 假，写则抛一句人话（"router was just restarted … retry in a moment"），不再把
   `DomainError` 的码透出去。识别方式是**只认 `code === 'closed'`** 这一种拒绝，其它错误原样
   上抛。
4. **`already-open` 最多重试 10 × 50ms**：这是 storage-domain 对"名字还开着或在关闭中"的
   瞬态拒绝，重启期间必然出现；不重试就让新实例静默变内存版。
5. 空 `chains` 列表的含义随之改回"显式的新形状"（一条空链，不回头看旧键）：键存在与否现在
   是真实的，不再需要拿"空"当"没写"。

3. **旧实例的 per-agent 监听器从不卸载。** 两个路由缝原本注册在 `agent.ctx` 上，owner 是
   **agent**：插件 fiber 重启后它们仍在，握着一个已经关闭的 storage 域。用户现场因此连续 5 轮
   （14:07–14:23）在 `agent/request` 里抛 `domain 'model_router_sessions' is closed`，且**在
   插件被禁用之后仍然失败**——因为禁用的是 fiber，不是这些 listener。修法：两个缝改挂插件 ctx、
   agent 从 payload 取（与 `agent/request-error` 一致），fiber 成为唯一 owner；加源级守卫
   （`index.ts` 里不许出现 `agent.ctx.on(`）。

## Alternatives considered

1. **继续用"空就是没写过"的推断**（第 2 步的做法）。
   - 最强的理由：不改 Host 的读法，一处推断搞定。
   - 为何被否：它把"用户显式写了一条空链"和"用户从来没写过"混成一个状态，而这正是 2026-10-19
     已经踩过的坑；更要命的是它对真实旧配置失效——就是这次用户遇到的。原始配置一直拿得到，
     没有理由继续猜。
2. **照旧让 `default` 池优先于 `profiles`**（旧迁移顺序）。
   - 最强的理由：与 2026-10-19 的"只留一条全局链"叙事一致：池子是全局行为，per-model 规则是
     被否掉的东西。
   - 为何被否：那是**产品方向**，不是**数据迁移**。用户配过 profile（钉在他选中的模型上）时，
     他实际跑的就是那套；把它换成池子等于替他改配置，而且没有任何提示。
3. **把 `DomainError('closed')` 当成"没有绑定"处理，不做任何区分。**
   - 最强的理由：读路径最简单，UI 也不会看到错误。
   - 为何被否：写路径不能这样——静默写进一个马上被丢弃的内存表，会让浏览器收到"保存成功"，
   而配置已经没了。读与写必须给出两种回答。
4. **在 `clearAll`/dispose 时把未完成的调用全部 abort。**
   - 最强的理由：从源头上取消那些在飞的读。
   - 为何被否：Remote 调用没有可用的取消句柄（`sessionBinding` 不是流式接口），而"关闭后还会
     被调用一次"是 Cordis 生命周期的常态；在 store 上把状态说清楚比重构调用栈便宜。

## Consequences

- 收益：旧配置（三种历史形状）在升级后都能被正确认领；用户现场那套 `profiles` 链恢复生效。
- 收益：fiber 重启不再给浏览器抛别的包的错码；`already-open` 不再让新实例静默失忆。
- 代价：Host 依赖 `ctx.fiber._config` 这个下划线字段。它是 cordis 类型里公开声明并写清语义的
  字段（不是私有实现细节），但升级 cordis 时要复核；浏览器端不依赖它。
- 代价：`profiles` 优先于 `default` 会让"同时配了两者"的语义偏向 per-model 规则。这是数据
  迁移的正确读法，但与 2026-10-19 的产品叙事不同，写在这里防止下一个人改回去。
- 代价：`already-open` 的重试最多占用 500ms 的启动时间（真实情况通常 1–2 次就成功）。
- 代价（踩到的坑）：**Cordis 服务方法的 	his.ctx 是调用方的上下文**。第一版在 setSessionBinding 里按需读 	his.ctx.fiber._config，拿到的是调用方（测试夹具/网关）的原始配置——于是"配置里没有 coding 这条链"的拒绝在组合测试里当场爆出来。现在在构造函数里捕获 	his.raw，并在字段注释里写清原因。

- 未做：`ctx.fiber._config` 若在未来版本消失，`rawConfigOf` 会返回 `undefined`，形状判断退化为
  "没有旧键"——届时需要换成官方读口（届时会有测试先红：`legacy-profiles-config-keeps-routing`）。
