# Agent Note: 弹窗高度链——结构选择器够到 DSH 的滚动区，零类名猜测

Status: implemented

## Problem

I7 是两层猜测叠加：注入 `[class*="body"]{overflow-y:auto}` 把 DSH Modal 的 body 改成滚动
容器（猜它哈希后的 CSS-module 类名），再用 `closest('[class*="body"]')` 去找它。DSH 一改名，
`closest` 返 null、CSS 静默失配——健康弹窗"点了添加规则没反应"（新行落在折叠线下没人
看见），而失败是完全静默的。同一条病还有第三个切面：`max-height: calc(84vh - 70px)` 是
按视口拍的高度，70px 既不是 DSH 真实头高（62px，`Modal.module.css:71-77`：padding
22+28+12），也没算 `.dialog` 的 20px gap 与 `footer` prop；而守卫正则只匹配
`calc(100vh…)`，`84vh`/`88vh` 全漏。M20：自建抽屉的 z-index 1100/1101 是裸数字，
缺"为什么是这个值"的引用。

## Decision

`open-questions.md` 第五节第 4、5 项的定案方向（删 `[class*="body"]` 整块、插件自己的
`#dsh-router-health-modal-body` 升级成滚动容器、`contentClassName` 给 DSH 的 `css.content`
补 `flex:1; min-height:0`、删 `calc(84vh - 70px)` 只留 dialog 根上一个 vh 常数、z-index 提
成命名常量）全部落地，**但定案写的链少了一环，实测补上**：

定案的链是 `.dialog` → `css.content`(flex:1,min-height:0) → 插件自己的 div
(flex:1,min-height:0,overflow-y:auto)。**实测（`spike/i7-height-chain-probe.html`，
Chrome 量的是真实盒模型）这条链不工作**：DSH 的 `.body` 夹在中间，它没有 `min-height:0`
也没有高度边界，于是保持内容高度并溢出 content 包装器——插件容器拿到的高度等于内容高度，
`scrollHeight === clientHeight`，什么都不滚，底部被 `.dialog` 的 `overflow:hidden` 裁掉。
三个变体对照（`spike/i7-height-chain-variants.html`）实测：只有 contentClassName 不够；
**从插件自己的类出发、够到 content 包装器的最后一个孩子**（即 DSH 的 `.body`，
`Modal.tsx:83` 渲染 header、可选 description、body）补 `flex:1; min-height:0;
overflow-y:auto`，链才通（body 599px、滚动容器 599px、真滚、全部不溢出）。

所以最终形状（V4，已实测）：
- `.dsh-router-settings-modal, .dsh-router-candidate-modal`：单选择器（DSH 把调用方的
  className 与自己的 `css.dialog` 放在同一元素上，`Modal.tsx:64`），保留
  `max-height: 84vh` 作为整张样式表里每个载体唯一的 vh 常数。
- `.dsh-router-modal-content`（经 `contentClassName`，`Modal.tsx:73`）：`flex:1;
  min-height:0`——链上第一环。
- `.dsh-router-modal-content > div:last-child`：`flex:1; min-height:0; overflow-y:auto`
  ——链上第二环，**结构选择器**，不猜类名。
- `#dsh-router-health-modal-body`（插件自己的 div，基样式走内联）：`flex:1; min-height:0;
  overflow-y:auto`——它自己是滚动容器，effect 因此读自己的 id，不再 `closest` 猜。
- z-index：`Z_OVERLAY = 1100` / `Z_PANEL = 1101` 命名常量 + 引用注释（DSH 没有 z-index
  token 量表，1100 是 DSH 自己"压在 Modal(1000) 之上一层"的既定值，树内 9 处先例）。

## Alternatives considered

1. 定案的原始链（只有 contentClassName + 插件自己的 div）
   - 最强的理由：零结构假设，只碰插件自己的元素与 DSH 明确提供的钩子。
   - 为何被否：实测不工作（见上）。DSH 的 `.body` 既不收缩也不限高，内容高度直接穿透。
     按一条没量过的链实施，就是本项目要消灭的"看起来优雅"。
2. 继续猜 `[class*="body"]`，只是把 guess 集中到一处
   - 最强的理由：链是通的（现状就是通的），改动最小。
   - 为何被否：finding 的病灶正是这个猜测——`[hash]_[local]` 受构建保证
     （`tsdown.client.ts:562`）但 hash 随内容变，猜具体类名永远脆，且失败静默。
3. `:last-child` 换成 `> div:nth-child(2)`
   - 最强的理由：更明确地表达"header 之后的那个"。
   - 为何被否：DSH 的 Modal 在 header 与 body 之间还渲染可选 description
     （`Modal.tsx:80-82`），有 description 时 nth-child(2) 会命中它。`:last-child`
     对 description 的存在免疫，只对"body 之后又加了节点"敏感——而那会连 body 的
     语义一起改，是可接受的耦合面。
4. 给 DSH 提 PR，让 `.body` 自带 `min-height:0`
   - 最强的理由：根治，插件侧一行结构选择器都不需要。
   - 为何被否：本轮拿不到上游改动；且即使上游改了，插件仍要兼容未升级的宿主。
     结构选择器在新旧宿主上都成立。

## Consequences

- 收益：三处类名猜测（`div[class*="dialog"]` 四变体、`[class*="content"]`、
  `[class*="body"]` 与 effect 的 `closest`）全清，注入 CSS 里 `[class*=` 出现 0 次；
  `calc(84vh - 70px)` 与魔数 70px 删除，vh 常数只剩 dialog 根上的 84vh（quick modal 的
  88vh 同属载体根本身，合法）；高度由 flex 链推导（Chrome 实测：内容再长也只在内层
  滚动，header/footer 不动）。z-index 有命名常量与 DSH 先例引用。`client-controller.mjs`
  37→40，其中两条是重写的守卫（vh 算术 + 类名猜测 + 链环 + 命名常量）。
- 代价：① 结构选择器 `:last-child` 是对 DSH Modal JSX 结构的依赖——比猜哈希类名稳
  （结构在源码里可见），但 DSH 若在 body 之后往 content 里加节点，选择器会静默错位。
  注释里钉了 `Modal.tsx:83` 这个锚。② 删除的 `[class*="body"]` 块原本还覆盖了 DSH body
  的 margin-top(8px)/padding(0 24px 14px)/gap(10px)；现在回到 DSH 自己的默认值
  （margin-top 20px、padding 0 24px、无 gap）。各弹窗的孩子自带间距（formGroup 的 gap、
  health modal 自己 div 的 gap 12、tabs 行的 marginBottom），视觉由浏览器复测确认。
  ③ 两个 spike HTML 留在 `spike/` 作为这次测量的复现依据。
