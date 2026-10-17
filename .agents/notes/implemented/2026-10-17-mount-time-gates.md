# Agent Note: 挂载期三修——loading 帧不抛、常驻入口不认领快捷键、陈旧注释清零

Status: implemented

## Problem

三条 finding 都住在"插件唯一载体"这次删除留下的断面上：

1. **C3（配置 loading 期点开弹窗直接抛）**：`page.ts` 的 effect 把两种情况混成一个
   tripwire——`.dsh-router-form-body` 不在 DOM 就抛"seam 移动了"。但 DSH 的 SettingsForm
   在 namespace 未就绪时**不渲染 children**（`SettingsForm.tsx:55` 直接 return 一行
   unavailable），而 `state.available = snapshot.status === 'ready'`，configForms mirror
   首次回值前就是 loading。侧栏按钮常驻可点，用户在这个窗口点开弹窗即触发；effect 的
   deps 是 `[]`，抛了本次挂载永不恢复，只能关闭重开。
2. **I4（Ctrl+S 被全局认领）**：`footer.ts` 挂载即 `retainSurface()` 直到卸载，侧栏入口
   常驻 → `surfaceCount ≥ 1` 恒真 → `resolve` 只要插件激活就返回 `handled`。而
   `regions: ['page','editable','terminal']` 覆盖输入框与终端：在聊天里按 Ctrl+S 会把路由
   配置存了。`save()` 内部的 writable 判断只让它空转，**不阻止认领**。footer 那一次 retain
   对"弹窗开着"是冗余的——`page.ts` 在弹窗挂载时已独立 retain。
3. **M8（陈旧注释）**：`controller.ts` 与 `footer.ts` 的注释还在描述"插件页与侧栏弹窗
   可以同时挂着"——page 注册已在 2026-10-16 删除，`surfaceCount` 计数的理由随之消失。

## Decision

1. **两种条件，两种回答**：wrapper **不存在** = DSH 没渲染 children = 配置未就绪，没有
   可压的东西，直接 return；wrapper **存在**而 footer 兄弟不在 = seam 真移动，照旧抛。
   tripwire 的哨兵价值完整保留，只是不再把"未就绪"当"坏了"。
2. **删 `footer.ts` 的 retain/release**：唯一的持有者是弹窗里的工作台（`page.ts` 的挂载
   副作用）。侧栏入口按钮不计数——它常驻。
3. **`surfaceCount` 的注释重写**：计数保留（React 的 effect 成对到来，严格模式下
   挂-卸-挂，一次不配对的释放不该把门永久焊死），但注释写现在真正的 invariant，不再
   引用已删除的第二个载体。

## Alternatives considered

1. C3：把"配置就绪"作为 effect 的依赖（`[state.available]`）重跑
   - 最强的理由：不用改判断逻辑，available 翻真时自然会再压一次底栏。
   - 为何被否：那条依赖表达的是"何时该压底栏"，而 finding 问的是"什么情况下算 seam
     移动"——两件事。加依赖让 effect 在 loading→ready 时重跑，看似覆盖，但 loading 帧
     里那次抛仍然发生（React 先跑 effect 再等依赖变化），崩溃与"永不恢复"原样留下。
2. C3：在 footer.ts 渲染 RouterPage 处 try/catch 包住
   - 最强的理由：崩不到用户，改动更小。
   - 为何被否：catch 住之后这次挂载的底栏压制静默丢失（两个保存钮重新出现），而真正该
     响亮的"seam 移动"也被同一个 catch 吞掉。用 catch 把响亮失败降级，正是项目军律
     禁止的那类修法。
3. I4：resolve 里另问一次"弹窗开着吗"
   - 最强的理由：语义最直接：快捷键只在弹窗开着时归我们。
   - 为何被否：`page.ts` 的 retain 已经在精确表达"弹窗开着"（挂载/卸载各一次）。再加
     一个信号就是同一事实的第二个来源——这条线要消灭的正是它。
4. I4：让 `save()` 在没有面在位时拒绝执行
   - 最强的理由：至少不会真的存盘。
   - 为何被否：finding 的点是"认领"本身——`regions` 覆盖输入框与终端，键被认领后 DSH
     就不会把它交给别的所有者，用户按下去什么都没有（或存了不想存的东西）。拒绝执行
     治的是结果，认领治的是原因。

## Consequences

- 收益：loading 帧点开弹窗不再抛（对照组证明底栏压制照旧且 hidden/inert 都落上）；
  Ctrl+S 不再被常驻入口认领（弹窗开着才接）。`client-controller.mjs` 37→40（新增两条
  组件级用例，harness 从探针搬进套件：会跑 effect 的 React 替身 + 照
  `SettingsForm.tsx:50-73` 复刻的 SettingsForm——fake 的形状跟 DSH 源码，不跟插件实现）。
- 代价：① `surfaceCount` 现在只有一个持有者却仍是计数——注释写明了理由（effect 成对），
  若将来确认不需要配对语义可以简化成布尔，那是另一次决定。② 组件级测试依赖复刻的
  SettingsForm：DSH 改它的 children/footer 结构时，这个 fake 要与真实源码同步（文件头
  注释钉了复刻来源的行号）。
