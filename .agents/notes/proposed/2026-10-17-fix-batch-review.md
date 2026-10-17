# Agent Note: 实现层审查修复批次的独立复审——1 条覆盖缺口 + 2 条登记/隔离，其余为旧账

> 状态：**proposed / 复审结论；待办 1-3 已于 2026-10-17 执行**（见
> `.agents/notes/implemented/2026-10-17-close-the-review-todos.md`），待办 4/5 仍开放。
> 本篇是**只读复审**的产物，复审期间未改动任何产品代码（变异实验全部还原并重跑四套件确认绿）。
>
> - 复审范围：`git log --oneline 70e0af9~1..HEAD` = 10 提交，`HEAD = 432bfee`，工作树干净。
> - 被复审的主张：`.agents/notes/proposed/2026-10-17-finish-the-abstractions.md` 的 9 条
>   结构线全部实施完毕，完成定义是「不变量只有一处表达 + 旧表达被删除」；四套件
>   unit 107 / client-controller 41 / run 20 场景 / remote 14。
> - 复审手段：读实现 → 读它的测试 → **独立变异复验**（4 条按其声称抽样 + 1 条它没抽到的）
>   → 回 DSH checkout 核对源码锚点 → Chrome 实测 I7 的四个变体。
> - 复审时实跑基线：**unit 107 / client-controller 41 / run 20 场景 0 失败 / remote 14 /
>   tsc 0 错误**，与主张一致；`git -C D:\sudy\github\deepseek-harness status --porcelain`
>   **0 行**（全程只读）。复审结束后四套件复跑仍为上述数字。

## 一句话结论

**产品代码没找到会静默出错、丢数据或不生效的地方；9 条线里 8 条按完成定义达成。**
待办只有 3 条，其中只有第 1 条值得马上做：**「内层重试 + 预算已尽 → 否决」这条分支
（`index.ts:401-411`）在本批次后没有任何组合覆盖，删掉它 20 个场景全绿**——它不是被
抽样漏掉，是抽样之后被 I1 的提前决定架空的（原钉子场景现在走不到那里）。

## 已独立证实的（本批次的主张成立，勿重复怀疑）

1. **线 1（`routes.ts`）真的 0 违例**：不信守卫、自己 grep——`src/` 里 `provider + '/'` 0 处、
   `split('/')` 0 处、`indexOf('/')` 仅 `routes.ts:36`、模板串里带 `/` 的 5 处全是
   `position/total` 展示；host 8 + browser 18 处编码、9 处解码全部收编；`workspace.ts`
   三处靠 `routeParts` 的 `{model:''}` + `ensure()` 空值守卫等价替换旧的 `slash > 0`。
2. **8 个死 guard 删除后跨字段校验仍全**：空链、未钉 primary、重复 route（profiles + default）、
   weight 无正权重、空白 break rule 五条都在（`config.ts:362-410`）；单字段边界确由 schema
   拥有，且 `unit.mjs:532-558` 有「assertStructural 不得再守它」的反向用例。
3. **`normalizeModelInfo` 全家恰好四码**：回 DSH 读 `llm/src/index.ts:756-823`
   （`INVALID_MODEL_INFO` ×3 处、`CONTEXT`、`MAX_TOKENS`、`REASONING`），`precheck.ts` 收全了；
   `resolveCallConfig` 可达的抛出码我逐个枚举过（`llm/src/index.ts:897,995`、
   `llm-pi-ai/src/adapter.ts:258,268,271`、`llm-deepseek` 的 `resolveModel` 不抛），三档无漏。
4. **C1 的假绿病灶已断**：`unit.mjs:1205-1214` 的 `neverEnding` 现在是 await abort 后
   **yield** aborted finish（与 `llm/src/index.ts:1111-1114,1161-1169` 同形）；
   `probe.ts:138-166`（finish）与 `:171-190`（catch）分类次序逐行一致。
5. **I7 的偏离必要**：Chrome 实测 `spike/i7-height-chain-variants.html`（视口 880px）——
   V1（定案原始链：只到 `contentClassName`）body 1028 > content 723、`scrolls:false`（内容穿透后
   被 dialog 裁掉）；V4（交付形状）body 645、真滚。定案那条链确实不工作。
6. **文档与代码一致**：`dsh-capability-boundary.md §G2` 的最外层/prepend/root ctx/生命周期四条
   与 `index.ts:348,423` 逐条相符；§7.4「日志留观测、结论标作废」的处理成立（其余三行结论在
   现行设计下仍为真）；`open-questions.md` 一.3/一.4 已同步；`index.ts` 与 `router.ts` 的文件头
   与 `:317-423` 的实际注册一致。
7. **I2/I8/I9 的文案与单源**：退避文案 zh/en 六处都改成「三种情形」且与代码行为一致；
   `--dsw-alias-brand-primary` 与 `rgba(74,101,232,x)` 在 `src/` 均 0 处（只剩 `:root` 的
   token 定义）；I9 恢复字典键 + `fill()`，`pipeline.ts`/`modals.ts` 中文字面量 0。
8. **死代码清扫属实**：`connectivityKey`/`conditionsMet`/`probeTimer` 字段/`emptyConditions`
   未用 import/`timeoutOf`/`channelTableTimeline` 全部 grep 0；新增的 `ICON_GRIP` 确被
   `pipeline.ts` 使用（不是新死代码）。

## 待办（按建议执行顺序；每项都给了位置、证据与代价）

### 1.〔必做〕否决分支没有组合覆盖，且 `run.mjs` 的注释已经与事实相反

- **位置**：`packages/dsh-model-router/src/index.ts:401-411`（被架空的分支）；
  `packages/dsh-model-router/tests/run.mjs:422-427`（已假的注释）。
- **证据（变异实验）**：把 `401-411` 整个删掉 → `npm run bundle` → `node tests/run.mjs`
  = **`20 scenario(s), 0 failure(s)`**，一次都没红。
- **它不是死代码**（用探针实测过，探针文件已删）：配置 `switchOn.rateLimit=false`（用户没勾限流）
  \+ 候选 `maxAttempts 2` + `maxTotalAttempts 5` + 一直 429 时——交付代码**恰好 5 次真实调用**；
  删掉否决分支 **6 次**（越过用户配的硬上限）。该形状下它是唯一在挡上限的东西。
- **为什么本批次弄丢了它**：`budget-cap-when-the-whole-chain-dies` 原本是它的钉子，I1 的
  提前决定让这条场景**根本走不到**该分支（同场景的 `llm/retry records == 0` 恰恰证明
  llm-retry 没被咨询过）。把提前决定改成永不成立后重跑，这条场景立刻红在 `llm/retry 0→2`
  ——它现在钉的是**提前决定**，不再是否决。
- **修法**：把探针转正为正式场景（可直接用这段配置，harness 的 `profile()`/`C()` 已够用）：

  ```js
  {
    name: 'veto-rejects-llm-retry-when-the-total-cap-is-spent',
    note: '未勾选该码 + 总上限已尽：llm-retry 的重试也要被否决，硬上限不许越过',
    router: { enabled: true,
      profiles: [profile([C('stub-primary', 2), C('stub-backup', 1)],
        { switchOn: { ...SWITCH_ON, rateLimit: false }, maxTotalAttempts: 5 })],
      default: { enabled: false, candidates: [], switchOn: { ...SWITCH_ON }, maxTotalAttempts: 3 } },
    script: { 'stub-primary': { outcomes: ['fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT',
      'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT', 'fail:RATE_LIMIT'] } },
    check(events) {
      eq('real calls equal the configured cap', failedAttempts(events).length, 5)
      eq('headers', headers(events), ['stub-primary/stub-model'])
      eq('turn end', turnEnd(events), 'error')
    },
  },
  ```
  同时改掉 `run.mjs:423-427` 的注释（现文声称该场景还钉住「llm-retry 在最后一条候选上自己的
  5 次重试也被挡住」——假的）。
- **代价**：组合套件 +1 场景（约 15s），`run.mjs` 从 20 变 **21** 场景；`AGENTS.md` 与
  `memory.md` 的数字要跟着改。若要更省，可把 `switch-off-terminal` 的 `maxTotalAttempts`
  从 6 改成 5（该场景形状正好差一格：`maxRetries 5` 与总上限 6 让否决落在边界外），但那会
  改动一条既有场景的语义，不如新增。

### 2.〔必做〕文档卫生四处（共约 5 分钟）

| 位置 | 现状 | 改法 |
|---|---|---|
| `docs/design/open-questions.md:88-92` | 第五节的「前置说明」重复两遍，第二遍还是提案口吻（「建议同一次会话里一起定」），而工作已落地 | 删掉第二段（与 `docs/AGENTS.md` §1「只记当下事实」一致） |
| `docs/design/open-questions.md:27` | 一表第 5、6 行挤在一行（`…product-plan §2.2 \|\| 6 \| …`），第 6 行渲染成第 5 行的一部分 | 在 `\|\| 6` 前补换行（**旧有**缺陷，非本批次引入） |
| `AGENTS.md:14,47` | 写「18 个真实 Loader 组合测试 / 18/18」，实际 `run.mjs` 是 20 场景（加完待办 1 是 21） | 改成实际数；M16 的修法在提交时就已经过期 |
| `src/router.ts:88`、`src/client/controller.ts:421`、`src/client/pipeline.ts:275` | 默认值仍有手写副本：两处 `maxAttempts: 1`、一处 `'order'`（`DEFAULT_STRATEGY` 目前只有 `config.ts:65` 一个消费者） | 前两处改引 `DEFAULT_MAX_ATTEMPTS`、第三处改引 `DEFAULT_STRATEGY`；`router.ts:88` 若认为它是另一个事实（「用户自己的路由只打一枪」）就给它独立命名，别留裸字面量 |

### 3.〔必做〕把 I6 的另一半登记为遗留（只登记，不实现）

- **位置**：`.agents/notes/implemented/2026-10-17-finish-the-shared-modules.md` 的「遗留」段。
- **事实**：I6 的问题是「校验**与**默认值双源」。线 2 只收了默认值 + 删死 guard；跨字段规则
  至今是两处表达（`src/config.ts:362-410` 抛错、`src/client/validate.ts:55-107` 收问题对象），
  靠四句「与 host 的 assertStructural 同步」的人工注释维持（`validate.ts:73-74,92-93,97-99`）。
  该笔记的遗留只登记了 `STRATEGIES`/`STRATEGY_OPTIONS`，没登记这一条——下一个想确认
  「I6 修完了吗」的人会得到错误答案。
- **修法**：写清「跨字段校验仍是双源、为什么不合并（client 产出 `{key, vars}` 而 host 抛
  异常，合并需要一次结果结构设计）、留给哪一轮」。真要合并：抽一个纯规则模块，host 抛错、
  client 格式化，代价中等，**不要塞进本轮**。

### 4.〔可选 / 决策级〕否决分支的终态不记熔断

- **位置**：`src/index.ts:404-411`（否决 `return undefined` 前没有 `noteBreaker()`），
  对照 `:383`/`:391`（提前决定两分支都记）、`:416`（内层放弃记）。
- **性质**：**本批次之前就存在**（该分支与「放行」分支都不记），本批次只是给 B/C 两条路径
  新增了记录，方向是「记更多」。函数自己的注释说「记不记不该取决于恢复走哪条路」，比代码宽。
  可观察面：`switchOn` 未勾该码 + 总上限较小时，为该码配的熔断规则永不落库。
- **修法**：否决前也 `noteBreaker()`（与提前决定的终态分支一致）；「放行」分支不记是对的
  （llm-retry 还在重试同一条路由，失败尚未定论）。这会改变熔断行为，**属决策级**，要单独
  写一篇 implemented 笔记并在同批加一条守卫用例。

### 5.〔按需〕`run.mjs` 的固定共享路径在并发下互相污染

- **位置**：`tests/run.mjs:30-31`（`HOME`/`SESSIONS`）、`:573-586`（`boot()` 写死
  `stub-script.json` / `overlay.yml`）。
- **证据**：复审时两个 `run.mjs` 实例重叠，得到 `20 scenario(s), 23 failure(s)`，签名在单实例下
  不可能出现——`primary-success`（脚本 `{outcomes:['ok']}`）记了两次 `AUTH` 失败尝试，而全套件
  只有 `auth-dead-key-fails-over` 的脚本会产生 `AUTH`；`failover-rate-limit` 反而 0 次失败。
  单实例连跑两次都是 `20 scenario(s), 0 failure(s)`。**那 23 条是复审方的测量事故，不是产品缺陷**，
  但机制在代码里。
- **修法**：每场景输入落到 `HERE + '.run-' + process.pid + '/'`（或按场景名建目录），
  `HOME`/`SESSIONS`/overlay 一起搬。代价约 10 行 + 所有路径重算。
- **在此之前**：**绝不并发跑两个 `run.mjs`**（见文末须知）。

## 9 条结构线逐条判定

| 线 | 判定 |
|---|---|
| 1 `routes.ts` | **达成**（自己 grep，0 违例） |
| 2 `defaults.ts` | **按线内范围达成**（8 常量 + 码表 + 类型钉住 + 删 8 死 guard）；跨字段校验双源未修未登记 → 待办 3；残留 3 处字面量 → 待办 2 |
| 3 `timeline.ts` | **达成** |
| 4 失败分类 | **达成**（aborted 三分与 catch/finish 同序；fake 改真实形状） |
| 5 attempt 预算 | **代码达成，测试网缺一格** → 待办 1 |
| 6 健康锚点 / lineage | **达成**（`step/start` + `(turn,step)` 门控；settle 用事件自身 turn/step） |
| 7 挂载门 / 快捷键 | **达成**（loading 帧不抛；常驻入口不认领）；组件级用例是真的行为测试 |
| 7b 高度链 | **达成**（零类名猜测、零 vh 算术、z-index 命名常量）；含一处已记录且必要的偏离 |
| 8 文档与文案 | **达成**（六处 C4 陈述、I2 六处、I9、I8 单源）；残余 `AGENTS.md` 数字 → 待办 2 |
| 阶段 4 revert 抽样 | 我独立抽 4 条全部按其声称转红；**发现一条它没抽到的分支** → 待办 1 |

### 线 5 的分工问题（「是不是有一个是死代码」）

`canFireAgain`（`router.ts:257-261`）**不是死代码，但在当前接线下永远不会是决定因素**。
纯代码推演：能走到 `decideRecovery`（`index.ts:417`）说明提前决定（`:377-379`）为假，即
`signal.aborted || attemptsOnCandidate < maxAttempts || !eligible`；而 `decideRecovery` 先
`aborted` 终态、再 `exhausted`、再 `eligible`，剩下能到达 `canFireAgain` 的情形必然满足
`attemptsOnCandidate < maxAttempts` → 恒为真。实测佐证：把提前决定改成永不成立后，
`last-candidate-cap-fires-no-extra-call` 仍全绿（`canFireAgain` 接住了同一形状）。
**「提前决定先拦住、`canFireAgain` 是决策层契约」这个说法站得住**，笔记也如实写明了重叠；
保留有理——删它单测红，且它是提前决定被收窄时的唯一防线。**不需要改。**

## 变异复验记录（改坏 → 看红 → 还原 → 重 bundle → 四套件复绿）

| # | 变异 | 结果 |
|---|---|---|
| ① | `router.ts:257-261` `canFireAgain` 恒真 | unit **107 → 106**，唯一红：`the last candidate is not fired once past its cap, and neither is a lone one` |
| ② | `index.ts:378` 提前决定条件永不成立（`current.maxAttempts < 0`） | bundle 后 `run.mjs budget-cap-when-the-whole-chain-dies`：`llm/retry records` 与 `llm/retry-started records` 各 **0 → 2** 转红；同状态下 `last-candidate-cap` 仍绿（层次分工的实测证据） |
| ③ | `health.ts:209` `step/start` 不开锚点 | unit **107 → 104**，红三条（含两条 I3 用例） |
| ④ | `styles.ts:247-251` 删高度链结构选择器 | client-controller **41 → 39**，红两条 ratchet 守卫 |
| ⑤ | `index.ts:401-411` 删否决分支 | **全绿（20/0）** → 这就是待办 1；另用探针证明该分支在合法配置下确实在挡上限（5 vs 6 次） |

## 无问题的检查清单（复审真看过的）

路线键 40 处收编；`assertStructural` 跨字段集与 schema 边界归属；`decideRecovery` 的
`exhausted` 与 `canFireAgain` 分工；probe 两条分类次序与 `NEVER_CALLED_CODES`；
`health.ts` 门控双向性与 v3 bump 的 `.strict()` 配合；`lineage.ts` settle 门控；
DSH 结构依赖面（`Modal.tsx:64/73/83`、`SettingsForm.tsx:50-73` 逐行读过，与插件三处结构
选择器的假设对上）；accent 单源；I2 文案；I9 中文字面量；死代码清单逐符号 grep；
`index.ts` 五分支副作用对账；四套件与 tsc；两棵树状态。

**五分支副作用对账结论**：A 纯透传（不记失败/不记熔断）；B/C 提前决定两分支都
`noteBreaker()` + 各自 `logger.warn`；D 否决只 warn（旧有不记，见待办 4）；E 放行什么都不做
（**正确**——llm-retry 还在重试同一条路由）；F 内层放弃 `noteBreaker()` + `decideRecovery`。
与修复前相比 B/C **新增**记录（修复前这两形状会走 E 不记、或更晚才走 F 记），方向与笔记宣称一致。

## 剩余未修项（**旧账，勿混入本轮修复**）

审计表里本批次明确没接的 Minor/Nit，逐条 grep 确认现状，供将来单独一轮「债务清理」核对：
M1（`assertNoAlwaysPolicy` 盲区仍在 `index.ts:581`）、M3（`index.ts:175` 与 `:353` 两个
`noteFailure` 写入方）、M4（`index.ts:494` 的 connectivity 无取消缝）、M5（`config.ts:88`
未点名 emptyResponse 与 llm-retry 的碰撞）、M7（`controller.ts:433/442` 两套重排并存）、
M9（`controller.ts:476-493` 绕过 `profileOf`，未知 id 会 TypeError）、M11（`controller.ts:122`
`publish()` 会在 dispose 后复活定时器）、M12（`format.ts:8-10` 键序敏感）、M13
（`modals.ts:571-574` 非更新器形式）、M14（`locales.ts:188,493` 写死 ⌘S）、M15（9 个死样式键
defined=1/uses=0；`configuredRouteList` 在 `controller.ts:22` 与 `page.ts:16` 各一份）、
M17（`probe.ts:198-209` 私有 `TimeoutError`）、M18（`chain.ts`/`footer.ts` 借语义色表达三态）、
M19（`validate.ts:20-25` 六个中文 `desc`）、M21（`modals.ts` 的 `SegmentedControl` 读
`props.disabled`，而 `page.ts` 渲染 `HealthSettingsModal` 时不传该 prop）、M22（client 全
`var`/`function`）、N1–N8 全部未动。
**M10 已不再成立**：`controller.ts:267-279` 的 `runCheck` 把 Reject 映射成 `cannotCheck()`，
每条路由都会落一条可见的「没能检查」。

## 下一会话操作须知（复审踩过的坑）

1. 改宿主或客户端源码后**必须** `npm run bundle --prefix packages/dsh-model-router`
   （`run.mjs` 与 `remote.mjs` 跑构建产物）；只跑单测（直导 `.ts`）看不出 bundle 旧。
2. 四套件在**未改动**的树上基线为 **unit 107 / client-controller 41 / run 20 场景 0 失败 /
   remote 14**，`tsc --noEmit` 0 错误。做完待办 1 之后 run 应为 **21 场景 0 失败**，
   其余三个数字不变——掉了就是改坏了。
3. **绝不并发跑两个 `run.mjs`**（固定共享路径，见待办 5）；一次只跑一个实例。
4. DSH checkout `D:\sudy\github\deepseek-harness` 严格只读，收尾时
   `git -C … status --porcelain` 必须 0 行。
5. `memory.md:11` 的「回归抽样：本批次 12 次……每次对应守卫或用例都转红」在本轮后已知
   **不完整**（漏了否决分支）。下一轮闭环时请连同四套件数字、`AGENTS.md` 的 18/18 一起更新。
6. 本轮复审**未改产品代码**，工作树干净；复审期间的临时日志与探针文件已删除。
