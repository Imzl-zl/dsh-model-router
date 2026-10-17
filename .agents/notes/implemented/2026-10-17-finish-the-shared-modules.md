# Agent Note: 三个共享纯模块收编——路由键、默认值、时间线窗口各只有一个表达式

Status: implemented

## Problem

2026-10-17 实现层审查的总结论是「抽象建到一半就停手，然后用字符串常量和注释把另一半
粘起来」，在纯函数层有三处：

1. **`routes.ts` 的 docstring 是一条假断言**。它写 "Everything here is pure and shared"，
   而 grep 实测 host 8 处 + browser 18 处编码、9 处解码全是手抄的 `provider + '/'` /
   `indexOf('/')` / `${a}/${b}`。模块自己声明要消灭的第二真相，被自己的调用方否定了。
   `notice.ts:44-46` 还有一个从未调用的 `label()` 复制 `routeLabel`，
   `client/format.ts` 的 `routeOf()` 只包了 `routeKeyOf` 却只有 4 个调用点，
   `controller.ts:12`/`page.ts:6` import 了它从未使用。
2. **默认值三到四处各写一遍**：`maxAttempts`/`maxTotalAttempts`（profile 6、默认池 3）/
   `stickyTurns`/`prompt '1'`/`timeoutSeconds 8`/`cooldownSeconds 300`/`scope 'route'`/
   `strategy 'order'` 在 `config.ts`（schema）、`validate.ts`、`controller.ts:390-397`、
   `pipeline.ts:455`、`modals.ts`（6 处）、`index.ts:373-375` 各写一份；`switchOn` 的码
   清单有三份（`config.ts` 的 `SWITCH_ON_KEYS` + `switchOnKeyOf`、`validate.ts` 的
   `SWITCH_ON_CODES`、`notice.ts` 的 `CODE_LABELS`），加一个码要改五个文件。
   漂移的表现是静默的：「UI 说 6、host 说 3」「UI 说开着、host 说关着」。
3. **`assertStructural` 有 8 个死 guard**。`_verify-i6.mjs` 逐条实测：对 8 个「只违反
   该条件」的 config，`Config()` **8/8 被 schema 拒**（两条生产调用路径都先过 schema：
   `index.ts:117` 读 Cordis 已校验值、`index.ts:126` 的 `Config(raw)` 自己跑一遍），
   绕过 schema 直调 `assertStructural` 才 8/8 会抛。其中 `timeoutSeconds < 1` 比
   schema 的 `.min(2)` 还弱——一个值为 1 的配置过得了 guard、过不了 schema。
   这些 guard 不防任何真实输入，只在 schema 收紧时变成会误导人的谎言。
   另有 `health-ui.ts:24,28` 绕过已建立的 `MAX_TIMELINE_POINTS` 自己写 24，
   以及字典里一个零调用点却写死「24 次时序波动」的死键 `channelTableTimeline`。

## Decision

三个不变量各收编到一处，旧表达全部删除：

1. **`routes.ts` 补 `routeParts(key)`**（第一个 `/` 切分；provider 段永不含 `/` 而 model
   段可以；无斜杠返回 `{provider: key, model: ''}`，由调用方自己的空值守卫丢掉——
   折叠一条坏记录不能抛）。host 13 处 + browser 18 处编码、9 处解码全部改调
   `routeKeyOf` / `routeParts`；`notice.ts` 的死 `label()`、`lineage.ts` 的私有
   `routeOf()`、`client/format.ts` 的 `routeOf()` 三个wrapper 全删。
   守卫：`src/` 里 `provider + '/'`、模板串 `${…provider|model}/`、`indexOf('/')`、
   `split('/')` 出现次数为 0（`routes.ts` 自身除外）——改前实测转红、列出全部 40 处。
2. **新建 `src/defaults.ts`**：8 个默认值常数 + `NEW_PROFILE_MAX_ATTEMPTS`（新profile 的
   种子值 2，刻意不同于 schema 默认 1，所以单独命名而不是混用）+ `SWITCH_ON_CODES`
   一张表（key / DSH code / 字典 labelKey）+ 从表派生的 `SWITCH_ON_KEYS` 与
   `switchOnKeyOf`。`DEFAULT_SWITCH_ON` 用 `Record<SwitchOnKey, boolean>` 类型把键集
   钉在表上：表里加一个码而这里不给默认值，tsc 就红。`notice.ts` 的 `CODE_LABELS`
   改用 `Record<SwitchOnCode, string>`：加码不加中文标签，tsc 就红。
   `assertStructural` 删掉 8 个数值 guard 与 2 个存在性判断，docstring 写明
   「只做跨字段校验；单字段边界由 schema 拥有」。
3. **`health-ui.ts` 改读 `MAX_TIMELINE_POINTS`**（槽位补齐与截断两处），注释里的 24
   一起改；死键 `channelTableTimeline`（zh/en 各一份）删除——它零调用点，仪表盘的头
   用的是 `healthMetricHistory`。

## Alternatives considered

1. 按 finding 严重度逐条修（C1→C2→…），routes/defaults 各修各的
   - 最强的理由：每条独立可评审、可独立 revert，审查清单已经排好序。
   - 为何被否：I5（键格式）与 I6（默认值/校验双源）是同一条病的两个切面，项目已经为
     route key 和时间线窗口建了共享模块、却没用在校验和默认值上。只收编键格式会留下
     「共享模块只覆盖了一半字段」的新漂移——比不建更难发现，因为读者会以为模块覆盖了。
2. 保留 `routeOf(candidate)` wrapper，让候选形状的调用点都走它
   - 最强的理由：候选形状的站点读起来更短，`pipeline.ts`/`page.ts` 已有 4 个调用点。
   - 为何被否：调用点的形状是异构的（candidate / verdict / catalog group / when /
     provider+model 两个字符串），wrapper 只能覆盖一半，剩下的一半仍要直接调
     `routeKeyOf`——结果是两个入口，读者必须两个都检查才能确认"键在哪拼"。删掉 wrapper、
     全部走 `routeKeyOf`，才是不变量的一处表达。
3. 8 个数值 guard 作为"纵深防御"保留
   - 最强的理由：schema 与 guard 之间多一层，将来若有人绕过 schema 直接调
     `assertStructural`（单测就是这么调的），仍有一道防线。
   - 为何被否：实测两条生产调用路径都过 schema，guard 在生产里 100% 不可达；而它给出
     的错误信息与 schema 的不同（`timeoutSeconds < 1` 还更弱），schema 一旦收紧，
     guard 就从"防线"变成"更早但更错的答案"。项目自己的 Debug-First 军律明确禁止
     "defensive guardrails just to make code run"。真正需要防守的是"绕过 schema 的
     新调用路径"，那由新增的组合/单测表达，不是由 guard 表达。
4. `switchOnSchema` 由 `SWITCH_ON_CODES` 表生成
   - 最强的理由：那才是字面上的一处表达，加码只改一个地方。
   - 为何被否：schema 每个字段都带一段给设置页看的用户文案（`.description()`），生成器
     要么丢掉文案、要么把 UI 文案塞进码表里；schemastery 的 `z.object` 也需要显式字段。
     采用类型钉住（`Record<SwitchOnKey, boolean>` / `Record<SwitchOnCode, string>`）+
     schema 每字段引用同一个 `DEFAULT_SWITCH_ON`：值不可能漂移，加码漏改会编译期红。

## Consequences

- 收益：三个不变量各有一处表达与一条守卫（路由键守卫 + 表/schema/草棒对账用例 +
   schema 拥有单字段边界用例 + 时间线窗口守卫）。四条 revert 抽样各自转红：手拼一处键、
   写死一处 24、加回一个 stickyTurns guard、浏览器自己写一份 switchOn 默认值。
   `unit.mjs` 99→103，`client-controller.mjs` 37→38，`run.mjs` 18 场景 0 失败不变。
- 代价：① 路由键守卫读的是源码文本，三种形状的正则都按本代码库的实际写法定制
   （`?? ''` 兜底、分数展示 `${position}/${total}` 要被排除）；将来若出现新的拼键写法
   （如 `String(provider) + '/'`），守卫要跟着补形状。② `intervalSeconds` 的默认 0
   不在审查清单枚举的 8 个里，但属于同一类事实（schema 与浏览器归一化各写一个 0），
   按"共享模块不能只覆盖一半字段"的原则一并收编。③ `defaults.ts` 让 `config.ts` 多了
   一个 import 依赖，`typert.host.js` 生成物需要重建后重新核对（`Profile` schema 是
   host face 唯一 surface——本轮已重建，run.mjs 18 场景含真实 boot，无回归）。
- 遗留（同类，未修）：`STRATEGIES`（config.ts）与 `STRATEGY_OPTIONS`（validate.ts）
  是同一张枚举的两份——属"枚举"不属"默认值"，不在本轮范围；`weight` 的默认 0 只在
  schema 出现一次，暂无漂移面。
