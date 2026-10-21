# Agent Note: 会话绑定落在 storageDomain 侧车

Status: implemented

## Context

用户要"不同会话用不同的降级顺序，而且同一个模型的重试次数可以按会话各自设"。核过的事实
（出处见 `docs/design/per-session-chains.md`）：DSH 有会话级 UI 槽位（组件自带
`sessionId`），但**没有会话级 KV**，也不能把状态写进会话日志（`plugin:` durable 类型只
对仓内 `experimental` 包开放）。宿主侧唯一被认可的落点是 `ctx.storageDomain`：schema
校验、写入即持久、对模型不可见。域/表名受 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` 约束，
所以是 `model_router_sessions` 而不是带点的名字。

另一半是测试面的约束：组合测试（`tests/run.mjs`）每个场景 spawn 一个 headless CLI，
进程外够不到 Remote。要证明"会话 A 覆盖 0、会话 B 覆盖 5"，必须有一个**进程内的调用方**
去写绑定，而它能调的应该是浏览器将来调的那个方法，而不是一条测试专用后门。

## Decision

1. **一个域，一张表**：`model_router_sessions`（version 1，单表 `bindings`），记录
   `{ chain: string | null, retries: Record<route, 0..9> }`。`chain = null` 表示跟随默认链；
   `retries[route]` 表示"失败后重试几次"，0 与"没有这个键"是两件事。
2. **域用 `defineDomain` 声明，不手抄**：名字/版本/表名的加载期校验归 DSH 那一个入口，
   插件不写第二份。
3. **存储是可选服务**：`ctx.get('storageDomain')`（`packages/AGENTS.md` 的 optional-service
   规则）。打开成功时以域为权威；打不开或没有这个服务时**同一份读写代码**走进程内存，
   并在日志里说明退回（`persistent: false` 如实上报给浏览器）。不因为缺存储就隐藏入口。
4. **写入先落盘再进内存**：`table.put` 失败原样抛给调用方，内存不先写。`setSessionBinding`
   只有在 `put` 兑现后才返回落库后的视图——"看起来保存成功"是这里最不能有的兜底。
5. **两个 Remote**：`sessionBinding(sessionId)` 读（没有绑定返回默认值，不是错误）、
   `setSessionBinding({ sessionId, chain, retries })` 写。0..9 与 `provider/model` 键形状
   在宿主校验（wire 严格编解码只管形状），越界**原样拒绝**而不是夹到 9。
6. **覆盖值只在一处成为次数**：`resolveChain(resolved, chain, retries)` 里的
   `attemptBudget()` 用 `overrides[route] ?? configRetries` 再 `+1`。决策层（`planFire`、
   `decideBeforeInner/AfterInner`）仍然只数调用次数，不知道"会话覆盖"这个概念存在。
   `??` 不是 `||`：覆盖 0 是用户的选择（"这条路由别重试"），不能被当成没填。
7. **`chain` 字段本步只存与读回**：命名链与链选择是下一批（`docs/design/per-session-chains.md`
   的路线 2）。因此这一步之后存储里可以出现指向尚不存在的链的 id；读取方必须把
   "链不存在"当成未绑定处理，这条约束留给命名链那一步落实。

## Alternatives considered

1. **把绑定写进插件 config（`sessions: { <sessionId>: ... }`）。**
   - 最强的理由：零新依赖，保存链路已经存在，配置本来就是持久化的。
   - 为何被否：配置会随会话数无界增长，sessionId 对人不可读，删会话不会删绑定；更根本的是
     配置是"用户意图"、会话绑定是"运行时状态"，混在一层之后两边都读不清。
2. **只做内存绑定，不持久化。**
   - 最强的理由：零依赖、零迁移，第一天就能用，也没有 schema 版本负担。
   - 为何被否（作为唯一形态）：重启后静默回到默认链，用户会以为自己的选择还在。保留为
     "没有 storageDomain 时"的降级形态，但必须可见（`persistent` + UI 文案）。
3. **直接开 `ctx.storage` 的 KV facet，绕过 domain 层。**
   - 最强的理由：少一个 peer 依赖、少一层 schema，读口一样是同步的。
   - 为何被否：DSH 的规则是 "Product packages use domain handles instead of accessing
     storage backends directly"，绕过去等于自己实现记录校验、写入串行与变更事件；
     而这三件正是 domain 层唯一存在的理由。
4. **不引 `defineDomain`，在插件里写一个等价的 spec 字面量。**
   - 最强的理由：去掉一个运行时依赖，插件在任何 node_modules 树里都能加载。
   - 为何被否：名字正则、版本、global-null 三条加载期校验会变成第二份表达，而这个项目已经
     因为"同一事实两处表达"返工过多次。代价（新增 peer 依赖）记在下面。
5. **组合测试用预置的 storage 文件，而不是在进程内写绑定。**
   - 最强的理由：不往组合里塞测试插件，验的是"重启后读盘直接生效"这条真实路径。
   - 为何被否：sessionId 每次 boot 都新生成，预置文件写不进"这一次会话"；要写进去就得给
     CLI 加固定 session id，那是改产品面。夹具改为调插件自己的 `setSessionBinding`，
     wire 形状与严格编解码由 `tests/remote.mjs` 补上。

## Consequences

- 收益：绑定不占配置、不进会话日志、对模型不可见；写入即持久，重启不动。实测落在
  `<home>/storages/model_router_sessions.json`（两个会话各一条记录）。
- 收益：没有 `storageDomain` 的组合走的还是同一份读写代码。实测：同一份配置与同一份覆盖，
  停用 storage-domain 的组合里第一跳仍然只打 1 次，宿主回报 `persistent: false`。
- 收益：覆盖值只在 `resolveChain` 一处变成次数，`??` 让 0 与"没填"分得开；决策层的
  "只数次数"没被破坏。
- 代价：新增 peer 依赖 `@deepseek-ai/dsh-storage-domain`（保持外部解析，随宿主树）。它不
  在时插件加载失败——这是"用 DSH 的声明入口"换来的，见被否方案 4。
- 代价：组合测试多了一个夹具插件 `tests/stub-session-binding.mjs`，它直接调服务方法而不
  经网关；wire 形状与 `persistent` 字段由 `tests/remote.mjs` 的严格编解码与落盘断言补。
- 代价：`chain` 字段在本步没有消费者。一个用户此时写进去的链 id 不会改变路由——所以 chip
  与命名链必须在下一批同批落地，不能单独发布这一步。
- 边界：fork 不继承（按 sessionId 键控，零额外逻辑）；会话被删会留下孤儿记录，清理时机在
  设置面板里用 `session.list` 对账，不为此加后台任务。
