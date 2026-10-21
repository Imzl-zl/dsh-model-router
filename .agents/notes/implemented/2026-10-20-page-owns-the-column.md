# Agent Note: 页面自己滚动并拥有水平留白，四条固定行共享一条 960 列

Status: implemented

## Problem

工作台壳把滚动区拆成 `.dsh-router-scroll`，页头/页签/保存条是它的兄弟；每一行各自写一份
`max-width: 960px` 和水平 `padding`。实测（隔离实例 3401，视口 1468×880）四条行的左边界分别是
页头/页签 442、页脚 394、正文 390：页头与页签比正文缩进 52px，页脚又差 4px。

根因是 `box-sizing` 混用加滚动条：`.dsh-router-content` 是 content-box（960 内容 + 96 padding
= 1056 外框，文字从 390 起），`.dsh-router-head`/`.tabs` 是 border-box（960 含 padding，内宽
864，文字从 442 起）。把 padding 补齐只能消掉 52px：滚动条只压窄滚动容器（`scrollbar-gutter:
stable` 时 9px），而固定行不住在那个容器里，居中后仍差半个滚动条宽（4px）。

## Decision

页面自己当滚动容器并拥有水平留白，四条直接子行（`.dsh-router-top`、`.dsh-router-content`、
`.dsh-router-footer`、以及 top 里的 head/tabs）共享同一条 960 列；页头与页签装进一个 sticky
包装层吸顶，保存条 sticky 吸底。

准入门槛（可机械判定）：

1. 四条行的 `getBoundingClientRect().x` 必须相等。通过的样子：实测全为 391.7（1468 视口）与
   96（1000 视口）；不通过：任何一行为 442/394/390 这种差值。
2. 页面只有一个滚动容器：`.dsh-router-page` 的 `scrollHeight > clientHeight` 时，
   `document.scrollingElement` 不得滚动（`scrollHeight === clientHeight`）。
3. 注入 CSS 里不得再出现 `.dsh-router-scroll`；列规则必须是一条合并选择器同时覆盖 top /
   content / footer，不允许任一行自带水平 padding。
4. 滚动中页头不得离开视口顶部、保存条不得离开视口底部：滚到最大时 `.dsh-router-top` 的
   `top === 0`、保存条 `bottom === innerHeight`。

## Alternatives considered

1. 只统一 `box-sizing`，四行 padding 补成一致
   - 最强的理由：六行 CSS，不动 JS、不动三条源级守卫、不引入 sticky，回归面最小。
   - 为何被否：消不掉滚动条造成的 4px——正文列只在滚动容器里居中，固定行没有那个滚动条，
     两边永远差半个滚动条宽；而且"同一列"继续写在四处，下次再加一行必然再犯一次。
2. 用 9px 常数抵消滚动条宽度（`margin-right` / 额外 padding）
   - 最强的理由：保留现有滚动架构，只补偏移，比改壳便宜。
   - 为何被否：把平台滚动条宽度写成常数。overlay 滚动条（macOS 未被 CSS 样式化的场景）宽度
     为 0，这个补偿会反向错 4.5px；四行依旧各写一份几何。
3. 接受 4px，只修 52px
   - 最强的理由：4px 在 1468 视口下几乎不可见，先解决主症状、风险最低。
   - 为何被否：代码注释与 `docs/design/ui-layout-redesign.md` 都把"四条行左边缘对齐"写成契约，
     留着 4px 就是留一条自相矛盾的注释；下次有人量到 4px 会重新查一遍今天的结论。

## Consequences

- 收益：列宽单源（一条选择器），删掉 `.dsh-router-scroll` 这一层 flex 高度链与四份 padding；
  页头/页签/保存条"常驻"语义不变，但不再各自拥有几何，任何新加的直接子行自动落在同一条列上。
- 代价：sticky 的两块必须自己画不透明底色（`bg-base`），内容滚动时会从它们下面穿过；源级守卫
  与 `docs/design/ui-layout-redesign.md` 的树状图、`tools.md`、`product-plan.md` 的"只有内容区滚动"
  说法随本次一并改写。滚动条现在属于页面本身，位置贴着内容列右侧边缘。
