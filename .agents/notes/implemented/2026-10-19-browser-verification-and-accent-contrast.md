# Agent Note: 浏览器实测把 accent 从文字色赶回底与边

Status: implemented

## Problem

UI 审查的 12 条全部按「结构 + 单元/组合测试」收尾后，剩下唯一没做的验证是真实浏览器。隔离 home 跑起来逐条点过，功能全部符合预期，但**量对比度时发现一个新缺陷**，而且是这轮自己引入的：

三处配置状态徽标（`● 接管中`、`🖼️ 识图路由`、`主模型固定首位`）把 `--dsh-router-accent` 直接当成了**文字颜色**。实测：

| 徽标 | 深色 | 浅色 |
|---|---|---|
| `● 接管中`（workspaceStatePill） | **2.61:1** | 4.28:1 |
| `🖼️ 识图路由`（imageRouteBadge） | **2.66:1** | 4.28:1 |
| `主模型固定首位`（primaryLockedBadge，既有） | **3.01:1** | 4.28:1 |

AA 对常规字号要求 4.5:1（10.5px/600 不算 large text，large 线在 14pt≈18.66px 粗体）。深色主题下这三处几乎读不出来。

这与 2026-10-16 已确立的纪律是同一条：**语义色文字永远不是色调色，颜色只进点和边**。当时的结论是围绕 `state-*` 别名下的，`--dsh-router-accent` 被漏在外，而我这轮又照着既有 `primaryLockedBadge` 的形状把它复制了两遍——**错误的先例被复制，是这类缺陷最常见的样子**。

## Decision

配置状态徽标改用与 `healthToneBadge` 同形的 `accentBadge()`：accent 只做 12% 淡染底与 40% 描边，文字一律 `label-primary`。

准入门槛（可机械判定）：

1. **`accentBadge()` 的文字不是 accent**。判定：`format.ts` 里该函数体含 `color: 'var(--dsw-alias-label-primary)'`，且不含 `color: 'var(--dsh-router-accent)'`；守卫用例 `configuration-state badges keep their text in label-primary` 钉住。
2. **徽标类样式不得把 accent 放进 `color`**。判定：同一条用例对 `workspaceStatePill` / `imageRouteBadge` / `primaryLockedBadge` / `needStatusBadgeActive` 四个块做源码检查。
3. **图标与头像不受此限**。`navDefaultIconWrap`、`workspaceAvatar`、`Icon` 的 accent 着色保留——它们没有需要读的文字，颜色本身就是信息。

## Alternatives considered

1. **把 accent 调亮/调暗，让它可以同时当文字色与底色**
   - 最强的理由：一处改完全局受益，不用在每个调用点分成「底」和「字」两种用法。
   - 为何被否：accent 同时是品牌底色（侧栏新建钮、保存钮的白字压在上面）和强调色。要让它当文字达标，深色主题下得显著提亮，白字压上去的按钮就会掉到 AA 以下——把问题从徽标搬到按钮，总量没减少。双色（`--dsh-router-accent` + `--dsh-router-accent-text`）能解，但那是新增一个 token 的全局改动，与本轮范围不成比例。

2. **保留 accent 文字，把徽标字号提到 18.66px 以上走 large-text 门槛**
   - 最强的理由：large text 的 AA 线是 3:1，深色下 2.61:1 仍不够，但浅色 4.28 够；配合略微提亮就能过。
   - 为何被否：徽标是页头第二行的次要信息，本就不该比模型名更抢眼。为了合规把徽标放大到 19px，视觉层级会反过来——为了指标牺牲了它存在的理由。

3. **只修新引入的两处，保留既有的 `primaryLockedBadge`**
   - 最强的理由：改动最小，只碰本轮自己写的代码，不扩散到未审的既有面。
   - 为何被否：三个徽标并排出现在同一张节点卡上，只修两个会出现「同一种徽标两种可读性」。而且 `primaryLockedBadge` 正是被复制的那个坏先例，不一起改，下次还会有人照着它写。

## Consequences

- 收益：三处徽标从 2.61–3.01:1 提到深色 **11.94:1** / 浅色 **16.18:1**，深浅两个主题都稳过 AA；`accentBadge()` 与 `healthToneBadge()` 同形，以后加配置状态徽标只有一个正确形状可抄；守卫用例把「accent 不进文字」变成可执行约束。
- 代价：accent 在徽标上只剩「淡底 + 描边 + 图标」三种较弱的存在感，`● 接管中` 的识别度比原来的彩色文字略低一档——这是合规换来的。
- 附带修掉一个我引入的样式 bug：`imageRouteBadge` 里为重置按钮默认字体写了 `font: 'inherit'`，这个简写把同一对象里前面的 `fontSize: 10.5` 一并重置，实测字号从 10.5px 跳到 16px。改为只继承 `fontFamily`。

## 第二批：非徽标的 accent 文字（同日，同一轮内补完）

首轮只修了三处徽标，把另外四处留成了「品牌强调」的开放项。这个划分站不住：它们同样是文字，同样低于 AA。补的做法不是把它们也改成 `label-primary`（那会抹掉页面的强调层级），而是**新增一个按主题解析的 accent 文字 token**：

```css
:root                        { --dsh-router-accent-text: color-mix(in srgb, var(--dsh-router-accent) 80%, black); }
body[data-ds-dark-theme]     { --dsh-router-accent-text: color-mix(in srgb, var(--dsh-router-accent) 60%, white); }
```

比例不是估的，是对着四个元素**实测的渲染背景**（深色 `rgb(44,44,46)`、`rgb(45,47,55)`、`rgb(46,49,61)`；浅色 `rgb(255,255,255)`、`rgb(246,247,254)`、`rgb(241,243,253)`）算出来的：深色混 40% 白 × 最亮背景 = 5.38:1，浅色混 20% 黑 × 最暗背景 = 6.06:1。色相仍来自同一个 accent token，没有第二个硬编码蓝。

落地后实测四处：`primaryCardTitle` 深 5.78 / 浅 6.85、`policySummaryBtn` 5.78 / 6.85、`guideToggleBtn` 5.54 / 6.41、`needsBtnActive` 5.37 / 6.19（:1）。

**同时修掉一个更要紧的既有 bug**：`.dsh-router-add-profile-btn:hover` 把 `color` 设成 accent，而这个按钮的底色本来就是 accent —— 悬停时加号变成 accent-on-accent（1:1），图标直接消失。改为悬停把底色压暗 12%（白字实测 5.96:1）并保住白色。抓手图标的悬停色也一并换成 `accent-text`。

**为什么不是把 accent 本身调到达标**：它同时是白字按钮的底色。深色主题下要让它当文字达标就得显著提亮，白字压上去会掉到 AA 以下——问题只是从文字搬到按钮。分成「底色 accent」与「文字 accent-text」两个 token 是唯一不用二选一的解。
