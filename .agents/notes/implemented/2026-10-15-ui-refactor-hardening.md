# Agent Note: UI 半包控制器状态机与 DSH 规范对齐的修复批次

Status: implemented

## Problem

对 2026-10-15 的 UI 重构做审查，发现一批会真实咬到用户的问题，且都不是样式问题：

1. `save()` 只挂了 `.then`：`scope.mutate` 一旦 reject（wire 抛错、恢复读失败），
   `saving` 永远停在 `true`——保存按钮永久转圈，且没有任何失败呈现。
2. 客户端 `validate()` 只校验默认兜底池的「weight 策略无正权重」，漏了 per-profile；
   与 host 的 `assertStructural`（config.ts:354-361）不对称。用户把某个 profile 设成
   按权重且全 0，客户端放行、host 拒 config，界面只剩一句没有原因的"保存失败"。
3. `scope.subscribe` 无条件 `host = seed(); draft = seed()`，而 DSH 的
   `ConfigFormController.derive()` 在 mirror 每次发布时都 `store.update`、
   `SettingsDescribeMirror.run()` 回包无条件 `set`——保存被拒后的恢复读、用户在别的
   设置页保存，都会把进行中的路由编辑静默冲掉。控制器注释承诺的
   "a save that did not land keeps the draft" 与行为相反。
4. 默认兜底池没有 primary，但 controller 与 UI 都把 index 0 按 primary 钉死：
   第一个候选删不掉，下移按钮可点却被控制器静默忽略。
5. 一批 DSH 不存在的 design token（`--dsw-alias-bg-layer-0/4`、`-state-error`、
   `-state-error-bg`、`-state-warn`、`--dsw-card-shadow`）：亮色主题下吸顶栏是深色、
   错误框没有底色、危险按钮不红；`--dsw-alias-brand-primary` 配白字在暗色主题下
   白-on-近白。
6. 抽屉里一句硬编码中文；5 处 `SegmentedTabs` 的 `panelId` 全部指向不存在的元素；
   识图指南折叠控件键盘不可操作；快捷控制中心手搓 Modal（丢掉焦点管理）；
   三处复制粘贴的工具按钮组；13 个从未渲染的字典键。

## Decision

按"先行为、后契约、后卫生"一个批次修完，控制器行为修复由新的测试 harness 兜底。

准入门槛（可机械判定）：

1. 每个修复都有红/绿证据：`tests/client-controller.mjs` 用 `CLIENT_PATH` 指向修复前的
   `git show HEAD:` 版本必须红，指向工作区必须绿。
2. DSH 规范以只读 checkout 的源码为准：token 必须存在于
   `design-platform.css`，原语 props 必须与 `ui-primitives/src/*.tsx` 的签名一致，
   不凭记忆断言。
3. 不静默：用户数据不被替用户删（空规则禁确认而非过滤），失败必须呈现
   （mutate reject → `failed`），未知 id 抛出而非编辑幻影列表。

关键裁定：

- **草稿保全闸**：`scope.subscribe` 里先 `seed()` 再与 `host` 深比较，值没变直接
  return。宿主仍是唯一权威——值真变时照旧重投影、冲掉草稿；但"没变"不再等于
  "该冲"。
- **Modal 复用**：快捷控制中心改用 `prim.Modal` 的 `headless` 模式（mask/Escape/
  焦点进入与归还/Tab 圈禁全部来自 `useModalLayer`），自绘顶栏留在 children；
  故障转移抽屉接入同一层栈（`useModalLayer` + z-index 抬到 Modal 之上）——它是自建
  body-portal 层，不接入就会在控制中心里"按钮可见、抽屉不可见"。
- **单一来源**：健康色调（点/药丸/时间轴）统一走 `healthToneStyle(tone)`；插件蓝收进
  一个 `--dsh-router-accent` 自定义属性（DSH 没有插件 accent token，这是唯一允许的
  自建色，且只此一处定义）。
- **样式单一住处**：插件自有页面里的控件一律「内联做基样式、注入 CSS 只管
  hover/active/focus」。重构给 subnav-bar/tool-btn/compact-health/needs-btn 补了带
  `!important` 的 CSS 基规则，与同名内联样式逐属性重复且 CSS 恒赢——内联的
  「已配条件」高亮因此失效。删掉这四个基规则，约定归一；footer-action 的 CSS 基规则
  保留（它在 DSH 自己的侧栏里，要跟宿主样式抢），modal-dialog 的保留（要盖
  `Modal.module.css` 的 `.dialog`）。
- **宿主 CSS 债务的两种处置**：① 侧栏 `div[class*="footerActions"]` 全局覆盖——
  slot 契约没有按条目布局的控制面（ownerProps 只有 `wide`），没有不猜类名的替代，
  保留但把 DSH 源码锚点写进注释（SidebarRoot.tsx:306 / module.css:587-600）；
  ② SettingsForm 底栏抑制——原来靠 `div[class*="footer"]:has(button)` 猜 DSH 的
  CSS-modules 类名，改为把孩子包进 `.dsh-router-form-body`，用结构兄弟选择器
  `+ div:has(button)` 指向底栏：上游改类名只会响亮失败（出现两个保存钮），不会静默失效。
- **ChainView 合并**：ProfileView 与 DefaultView 约 110 行里 ~85% 相同（差异只在面板
  id 作用域、删除按钮、识图指南、池的说明+开关），合并为一个组件按 `isDefault` 参数化，
  消掉 ~100 行重复；调用点的两份 22 项 prop 列表合成一份。
- **actions 动作签名对齐**：`actions.onWeight` 漏了第一项 `profileId` 形参，导致编辑默认
  兜底池权重时误把 `null` 当成 index、把 number 当成 isDefault，抛出 `no profile "null"` 异常；
  `onStrategy` 同样显式参数化 `(profileId, value, isDefault)`，抹平隐式依赖。两项新增单测覆盖（13/13 绿）。
- **Modal 容器尺寸防夹修固**：`ModelRouterFooterAction` 曾将 `.dsh-router-modal-dialog`
  套在 children 内层 div，导致外层 DSH `Modal.module.css` 的 `.dialog` 将宽度钳死在 380px 并裁切；
  改为直接将 `className: 'dsh-router-modal-dialog'` 传给 `Modal` 并剔除冗余内层 div，还原千像素控制中心卡片。
- **抽屉与图标微体验**：抽屉蒙层补全点击空白处关闭（backdrop click-to-dismiss）；HeaderTools
  按所在视图细化 tooltip 文案；ChainView 子导航切页弃用跨系统字体不一且易乱码的 Emoji，
  统一改用单色矢量 SVG 图标（`ICON_ROUTE`、`ICON_SHIELD`、`ICON_CHART`），与 DSH 极简设计系统对齐。

## Alternatives considered

1. subscribe 里改成"脏状态时永不重投影"
   - 最强的理由：实现最简，一行判断保住草稿，绝不误冲。
   - 为何被否：宿主真的改了配置（另一处写入、连接重置）时用户永远看不到，且保存
     成功后的清洁态也来得莫名其妙——把"权威同步"整个关掉，只治了症状。
2. 保存被拒后用 toast/notice 提示原因，不动 subscribe
   - 最强的理由：用户至少知道失败了，改动面最小。
   - 为何被否：草稿还是被冲掉了；提示的是"失败了"，用户看到的却是"配置恢复了"，
      两件事对不上，反而更难信。
3. 手搓 Modal 保留，自己补焦点圈禁和 Escape
   - 最强的理由：顶栏布局完全自主，不依赖官方 Modal 的内部结构。
   - 为何被否：`useModalLayer` 已经处理了组合态守卫、层栈次序、焦点归还和
      `data-modal-autofocus`，手搓等于把这些逐条重新实现一遍还要自己养；
      `headless` 模式正是为"自定义顶栏"设计的，没有理由不用。
4. 插件蓝继续散落硬编码，只把按钮改成 `--dsw-alias-brand-primary`
   - 最强的理由：最"贴 token"，零自建色。
   - 为何被否：`--dsw-alias-brand-primary` 是近黑/近白的品牌墨色，不是插件的蓝；
      照抄会让保存钮在暗色主题下白-on-近白，且与既有的蓝色渐变、徽标全面打架。
5. 控制器测试用 jsdom 渲染组件断言 DOM
   - 最强的理由：覆盖到渲染层，tabpanel/aria 关系也能验。
   - 为何被否：client.js 是 factory 形态、依赖 react/primitives/store 四个模块，
     搭 jsdom 的收益低而维护面大；驱动 `apply(ctx)` 的 slot inject 动作面 +
     snapshot store，恰好覆盖本次全部行为修复，且零新依赖。

## Consequences

- 收益：四个行为缺陷（保存卡死/校验不对称/草稿被冲/默认池钉死）有测试兜底且红过；
  亮色与暗色主题回归真实 token；抽屉、指南、tabpanel 的键盘与读障路径可用；
  `client.js` 少了三处复制粘贴和 13 个死键；工具按钮组从三份变一份。
- 代价：`scope.subscribe` 每次发布多一次 `seed()` + JSON 深比较（配置规模下可忽略）；
  抽屉 z-index 从 250 抬到 1100，与官方 Modal 层（1000）形成隐式约定——DSH 若改
  Modal 层级，这里要跟着核；测试 harness 自己维护一套 ctx/store stub，DSH 改
  `configForms`/slot 注入签名时它先红。

## 代码回指

- `client.js` 的 `scope.subscribe` 闸门（草稿保全）与 `tests/client-controller.mjs`
  的 harness 受本笔记约束。
