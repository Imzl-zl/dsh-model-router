# Agent Note: 文档与文案对齐实现——六处陈旧陈述、退避实话、accent 单源

Status: implemented

## Problem

实现层审查的 C4/I2/I8/I9/M16/M2 余项，全部是"注释/文档/文案声称与实现相反"或"死代码"，
共用一个病因：**实现继续前进，描述性文本留在原地**。

- **C4**：`agent/request-error` 的位置在 2026-10-16 就从"llm-retry 内层"改成"最外层
  + prepend"（依据：同一场景内层打 7 次、外层打 2 次），但六处描述性文本仍在说内层：
  `src/index.ts` 文件头、`src/router.ts` 文件头、`dsh-capability-boundary.md` §G2 的
  表格/两段论证/预算归属/worst case 公式，以及 §7.4 spike 日志里那条"同时推翻了 Router
  也用 prepend 的想法"的结论。照任何一处旧文本"修"回去，都会重新引入 7-call bug。
- **I2**：五处退避文案声称"每次切换前都有一次退避等待"。AUTH/QUOTA 不在 llm-retry 的默认
  可重试集里（`retry-policy.ts:18-24`），切换零等待；2026-10-17 的 I1 修复后，**候选额度
  用尽后的切换也不再进入 llm-retry**——文案要说实话的范围比修复前更大。
- **I9**：在飞改动把 `Connector` 的两个字典键换成了硬编码中文（`'顺延 #' + …`、
  `'前序重试耗尽后自动切换至此候选'`），`failoverTag`/`failoverNotice` 成孤立键，en locale
  显示中文。
- **I8**：`--dsw-alias-brand-primary` 是 DSH 的**品牌墨色**（亮色近黑、暗色近白），插件借它
  着色的 15 处因此在某个主题里渲染成近黑/近白；而 `--dsh-router-accent` 已在 `:root` 定义，
  写在内联里的 `#4A65E8` 回退永不生效——错得完全静默。另有 29 处手算
  `rgba(74,101,232,x)` 淡染，令牌一改不会跟着改。
- **M16**：`AGENTS.md` 两处写"8 个真实 Loader 组合测试 / 8/8"，实际 18 个场景。
- **M2 余项**：`connectivityKey()` 零调用方、`probeTimer` 字段只写不读、`emptyConditions`
  未用 import、`conditionsMet` 无生产调用方（只有一个测它自己的用例）、`probe.ts` 注释里
  提到不存在的 `timeoutOf`。

## Decision

1. **C4 六处重写并指向实测依据**：两处代码文件头改成现行设计（两个 seam 都 prepend、
  最外层、I1 的提前决定）；`dsh-capability-boundary.md` §G2 整段重写（表格、为什么必须在
   最外层含 7-vs-2 的实测、最外层不等于绕开内层、I1 的第三条路、生命周期）；budget 段改成
   "总 worst case = maxTotalAttempts"；§7.4 的 spike **日志保留观测、结论标注作废**（日志是
   真实跑过的输出，改它等于改历史；作废的结论指向现行设计）。`open-questions.md` 一.3/一.4
   同步为现行事实。
2. **I2 六处 + 一处追加改实话**：`config.ts` 的 maxAttempts 描述、`attemptLimitHint` 两本、
   `backoffHint` 两本、以及 `switchOnSubtitle` 两本——最后一条不在枚举的六处里，但它声称
   "切换前 DSH 仍会按默认策略在同渠道重试至多 5 次"，对默认配置（maxAttempts=1）从来不成立，
   I1 之后更不成立；同一类谎，一起改。新文案按三种情形说：候选还有额度时的同渠道重试可能等
   一次 llm-retry 退避；凭证/额度类失败不等待；额度用尽后的切换不等待。
3. **I9 恢复字典键 + `{n}` 占位**：`Connector` 改回 `t('failoverTag')` 与
   `fill(t('failoverNotice'), { n: props.toIndex })`。两本字典的值原本就以色尾的 `#`/`：`
   暗示要接一个编号，`fill()` 把编号放到该放的地方；组件里不再出现任何中文字面量。
4. **I8 一次性扫清**：15 处 `--dsw-alias-brand-primary` → `--dsh-router-accent`；29 处
   手算 `rgba(74,101,232,x)` → `color-mix(in srgb, var(--dsh-router-accent) X%, transparent)`；
   24 处永不生效的 `#4A65E8` 回退删除；`icons.ts` 的 Logo 渐变判断从"认品牌墨色"改成"认插件
   accent"（调用点现在传的就是 accent 变量，旧判断会让渐变整体失效）。
5. **M16**：`AGENTS.md` 8/8 → 18/18。
6. **M2 余项清扫**：删 `connectivityKey`、`probeTimer` 字段与赋值、未用的 `emptyConditions`
   import、`conditionsMet` 及其自测用例（生产调用方集合才是规格，一个只覆盖死代码的用例是
   假绿），修 `probe.ts` 的陈旧注释。

## Alternatives considered

1. C4：只改代码注释，文档留待"文档轮次"
   - 最强的理由：代码是执行真相，注释与实现不一致最致命；文档可以下一轮统一。
   - 为何被否：`dsh-capability-boundary.md` 是能力边界的唯一权威（`docs/AGENTS.md`：
     "一项设计事实只保留一个权威说明"）。旧结论留在权威文档里，下一个会话会据此把位置改回
     内层——那正是 7-call bug 的入口。finding 的验证方法原话："照任何一处旧注释/文档修回去，
     都会重新引入 7-call bug。"
2. C4：把 §7.4 的 spike 日志整段重写成现行设计
   - 最强的理由：文档只留当下事实，没有矛盾。
   - 为何被否：那一段是**跑过的输出**（事件序列与计数），改它就是把观测历史改成想要的样子。
     日志留观测、结论标作废，读者既看得到当时测到什么，也看得到它为什么不作数。
3. I9：照原样恢复 `t('failoverNotice')` 单独渲染
   - 最强的理由：与修复前逐字一致，最小惊讶。
   - 为何被否：两本字典的值以色尾的 `#`/`：` 结尾，单独渲染就是一个悬空的符号；
     `fill()` 用项目已有的模式把编号放进去，两种语言都读得完整。
4. I8：保留 `#4A65E8` 回退（反正不生效）
   - 最强的理由：零风险，回退只在样式表注入失败时兜底。
   - 为何被否：一个永不生效的回退是死代码，而且它让同一个颜色在 ~30 处有两种拼写；
     审查的修法原文就要求删。真正需要兜底的场景（样式表没注入）下整个插件都没有样式，
     一个蓝色回退救不了任何东西。
5. M2：保留 `conditionsMet`，因为"它有测试覆盖"
   - 最强的理由：删测试违反"不得删除测试"的军律。
   - 为何被否：军律禁的是**让失败变绿**而删测试；这里删的是没有生产调用方的函数和只测它的
     用例——那样的用例正是假绿（函数消失它才该红）。生产调用方集合才是规格。

## Consequences

- 收益：六处权威文本与实现一致；退避文案按三种情形说真话；组件里无硬编码中文；强调色单源
  （15 + 29 + 24 处归一）；`AGENTS.md` 的数字对上；五个死代码/死导入清掉。
  `client-controller.mjs` 40→41（新增 accent 单源守卫），`unit.mjs` 108→107（删一条只覆盖
  死代码的用例）。
- 代价：① 新文案比旧文案长——真话有三种情形，一句话说不完。② §7.4 现在带一条"此处结论已
  作废"的标注，读者要多读一段才能走到现行设计；这是保留观测历史必须付的。③ I8 的脚本
  （`spike/i8-accent-sweep.mjs`）留在 spike/ 作为这次机械替换的记录，可复跑可审计。
