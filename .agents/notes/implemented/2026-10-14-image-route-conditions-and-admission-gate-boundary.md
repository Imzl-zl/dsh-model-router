# Agent Note: 识图路由（images 三态条件 + turn 累积 + stickyTurns）与准入护栏的边界

Status: implemented

## Problem

用户的核心场景：日常用强文本模型，突然要发图。原设计假设"带图请求到达 `agent/request` 时切去识图模型"就能闭环，但核实 DSH 源码后发现三个此前没记录的事实，每一个都单独推翻一部分假设：

1. **发送准入门在路由之前，且查的是"选中的模型"**：`api/session-controller/src/commands.ts:336-348` 在 prompt 准入时检查 `agents.selectionFor(agent).current` 的 `inputModalities`，不含 image 直接拒收（`MODEL_DOES_NOT_SUPPORT_IMAGES`）。消息从未生成，`agent/request` 不会触发，插件无缝可修。用户自己在 tools.md 记过这个护栏（"composer 静默拦发"），但一直以为路由能绕过它。
2. **选择的记忆会被路由污染**：`current` 在无待决 pick 时回退到最后一次 request header（`session-controller/src/agent.ts:294-310`），而 header 记的是路由实际发出的模型。"无图轮切回强文本"每发生一次，下一次发图就被门禁拦。
3. **`needs.images` 是死路**：walk 里用户自己的路由（primary）豁免一切门控（原 `index.ts` 的 route-match 豁免在 conditions 之前），带图请求永远落在 primary 上，识图候选只在 primary 失败后的 failover 里、且请求带图时才可能被轮到。

同时 `hasImages` 按 step 判定是错的：`agent/pre-step` 的 messages 只是本步新 claimed 的输入（`agent-loop/src/agent.ts:271,366`），工具循环的第二步之后基本为空——带图 turn 的第二步会滑回文本模型，而图片还在请求历史里，`read_image` 也会再次撞门禁。

## Decision

1. **用户在 DSH 模型配置里给文本模型勾选 `input:[text,image]`，靠路由兜底**。门禁只查声明不查真实能力；勾选后发图永远过门禁（选中模型和 header 回退都落在声明了识图的模型上），零点击。路由器用显式条件保证 API 永远收不到它处理不了的图：primary 配 `needs.images: false`（仅无图轮），识图候选配 `needs.images: true`（仅带图轮）。路由器没接管时（关闭/配错/候选全挂）撞 API 报错是**响亮的失败**，已向用户明确并接受。
2. **`needs.images` 三态**：`true` = 仅带图轮，`false` = 仅无图轮，不填 = 不限。反向条件是本次新增的能力，它是"一条链拆成识图/文本两条路"的唯一表达。
3. **条件对 primary 生效**（修订 open-questions 二.5）。不变量从"primary 永不跳过"改为"primary 服从用户显式配置的条件；只豁免自动机制（熔断冷却、能力预校验）——DSH 在选择时已校验过那些"。显式条件是用户意图，跳过它才是无视配置；跳过留 notice，不静默。UI 同步放开 primary 的条件编辑。
4. **`hasImages` 按 turn 累积**，取数 = 本步 claimed 用户消息 ∪ 本轮 `tool/result` 事件里嵌套的图片块（`read_image` 的图从工具结果进来，下一步的请求才含它——没有这一路，下一步会漏到文本模型撞 API）。`projectedTokens` 仍按 step。
5. **`stickyTurns`（profile/default 各有，默认 0）**：带图轮之后继续按"有图"路由的无图轮数，用于追问刚发过的图片。真带图的轮次补满窗口，被粘滞的轮次消耗一格。
6. **条件跳过 notice 按 (turn, 跳过组) 去重**：工具循环轮次每步重决同一批跳过，每步发一遍是噪音。
7. **修掉一个已存在的无限空转 bug**：链上无可服务候选、落回用户原路由的路径**没有推进 StepState**，recovery 每问一次都得到"继续"（`totalAttempts` 不动），turn 在原路由上无限空转直到进程被杀（实测 33716 次尝试/180s）。修法：落回前记 `exhausted: true`。该路径在本次改动前就存在，只是此前的配置形状从未踩到。

## Alternatives considered

1. **插件在门禁之前切换选中模型**
   - 最强的理由：这才是用户第一直觉（"有图直接切"），且能实现真正的零感知。
   - 为何被否：选择状态是 session-controller 的私有字段（`ApiSessionAgentController` 在 `index.ts:146` 直接 new，不注册 ctx 服务），`selectForNextRequest` 不可达；append `model/selection` 耐久事件也没用——`installModelSelection` 只读内存 ref，不观测耐久事件（`core/agent/src/model-selection.ts:81-131`）。插件能摸到的最早时机全在门禁之后。
2. **专门的识图候选配置段（独立于候选链的有序列表）**
   - 最强的理由：用户原话"优先用配置的识图模型"，独立列表能把偏好顺序与 failover 顺序解耦。
   - 为何被否：在"选中识图模型过门禁"的形态下，链顺序 + 一对互斥条件已表达全部意图，独立列表是同一事实的第二个来源。用户确认"全局最好"后此方案彻底冗余。
3. **自动 modality 门（读 `ctx.llm.resolveModelInfo` 的 `inputModalities`，不能识图的候选在有图轮自动跳过）**
   - 最强的理由：不用用户配条件，自我修复；读的是 DSH 自己的声明，不是第二来源。
   - 为何被否：用户给文本模型勾选识图后，声明层面它就是"能识图"，自动门控永远不触发——显式条件是唯一还能表达意图的机制。且它修不了真正的入口（门禁在路由前）。
4. **sticky 做成布尔或会话级常驻**
   - 最强的理由：布尔简单；常驻不用想结束条件。
   - 为何被否：布尔无法表达"粘 N 个无图轮"这个唯一有意义的中间态；会话级常驻把用户锁在弱模型上，正是本项目要消除的体验。单参数 + 默认 0 让"立即回切"和"多粘几轮"是同一个旋钮的两端。
5. **给 DSH 提 issue 让核心改门禁**
   - 最强的理由：一劳永逸；核心的准入判定基于"选中模型"在路由插件时代确实过时。
   - 为何被否（暂缓）：核心在路由前无法知道插件会选谁，最合理的诉求也只是"把选择回退从 header 改成记住最后一次显式 pick"——这是核心的产品决定，等用户决定何时提，不作为本次实现的前置。

## Consequences

- 收益：
  - 用户的核心述求（有图走识图、没图走强文本、自动切回、零点击）在不动 DSH 核心的前提下闭环；门禁、路由、API 三层各司其职，假声明在正常路径上永不被戳破，失败全是响亮的。
  - `needs.images` 从死路变成三态条件，primary 豁免收窄到"只免自动机制"，二.5 的不变量比以前更精确。
  - 顺手修掉落回原路由路径的无限空转（有对证场景），条件跳过 notice 不再按 step 刷屏。
- 代价（明确记录，不隐瞒）：
  - **用户在 DSH 里给文本模型勾了识图**：这是整个方案的前提，是一次有意的假声明。路由器没接管时图片会原样进文本模型，撞 API 报错而非静默出错——已向用户说明并接受，设置页有完整操作说明。
  - **历史残留图的轮次会撞 API 报错**：路由器在路由时机看不到请求历史（`agent/request` payload 不带 messages，`pre-step` 只给本步 claimed 输入），"接着老图会话聊纯文本"的轮次会漏到文本模型。DSH 的 offload 最终会把老图转成文本引用，报错是暂时的；聊图开新会话可规避。已知限制，不藏。
  - **识图候选的优先级 = 链顺序**：独立偏好列表被否后的直接后果，多模态候选的先后即优先级。
  - **sticky 的跨轮行为只有单测覆盖**：组合 harness 一次 boot 一个 turn，造多 turn 端对端不可行（与熔断跨 step 跳过同一先例，unit.mjs 覆盖窗口逻辑）。
- 验证：
  - 单测 66/66（三态条件、turn 累积、tool-result 取数、sticky 窗口四种时序、`toolResultHasImage` 嵌套形状、stickyTurns 结构校验）；
  - 组合测试 12/12（真实 Cordis Loader + stub），新增两个场景：primary 被条件跳过端对端留痕；无图轮里「仅带图」候选被跳过且识图候选零调用、notice 按轮去重、终态 error；
  - `tsc --noEmit` 0 错误；`node --check` client.js 通过；客户端保存形状经 `normalizeProfiles`/`normalizeDefault` 向后兼容（旧配置无 stickyTurns 读 0）。
