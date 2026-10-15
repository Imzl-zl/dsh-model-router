# Agent Note: host 基线与 draft 草稿的引用独立性（dirty 信号修复）

Status: implemented

## Problem

2026-10-15 的控制器加固（`7f5a250`，见 `.agents/notes/implemented/2026-10-15-ui-refactor-hardening.md`）给 `scope.subscribe` 加了"值没变就 return"的守卫，重播种写法同时变成：

```js
var next = seed()
if (deepEqual(next, host)) return
host = next
draft = next   // 两个名字指向同一个对象
```

生产启动路径必然踩中：控制器构建时 scope 首帧还是 loading（`seed()` 读到默认值），settings mirror 的首次发布一定走"值变化"分支——`host` 和 `draft` 从此共享一个对象。此后任何编辑（`draft.default.enabled = false`）都同时改掉了"宿主基准"，`deepEqual(draft, host)` 恒真：**dirty 永远为假**。用户可见后果：编辑后"保存配置"按钮永远置灰、"● 未保存修改"徽标和"放弃更改"从不出现、Ctrl+S 无响应，所有编辑刷新即丢。2026-10-14 验证过的保存闭环（tools.md 记录）被此次回归打破。

现有测试为何没抓住：两个 subscribe 测试都是"先编辑、再重发布"，恰好绕开别名路径；生产顺序永远是"先重发布、后编辑"。

证据：浏览器侧给 `JSON.stringify` 打补丁捕获 `deepEqual(draft, host)` 实参，拨开关后两个实参同时变成 `enabled:false` 变体；Node harness 红/绿复现（值变化重发布后再编辑 → 原版 dirty 假、修复后 dirty 真）。

## Decision

重播种时基线取新值、草稿取它的**独立拷贝**：

```js
host = next
// The baseline and the draft must be two independent snapshots. Sharing
// one object behind both names makes every edit mutate the baseline
// too, and `dirty` — the whole unsaved-changes signal — then reads
// false forever. See .agents/notes/implemented/2026-10-15-host-draft-baseline-independence.md。
draft = clone(next)
```

回归测试 `an edit after a value-changing republish keeps the draft dirty` 锁定生产启动路径（loading 首帧 → 值变化重发布 → 编辑），先红后绿。

## Alternatives considered

1. **去掉守卫，恢复 41a99a8 的无条件重播种**（两次独立 `seed()` 调用，别名问题自然消失）
   - 最强理由：改动最小，且回归到曾被验证过的行为；`host = seed(); draft = seed()` 两个调用天然独立。
   - 为何被否：那正是本次要摆脱的 bug——任何 mirror 重发布（用户在别的设置页保存、连接重置后的恢复读）都会冲掉用户未保存的草稿。用"编辑全丢"换"脏信号失灵"不是修复，是回退。

2. **`Object.freeze(host)`，让别名在写入时暴露**
   - 最强理由：把"基线不可变"从约定升级为运行时强制，下次谁再写出别名立刻炸亮。
   - 为何被否：client.js 工厂经 `new Function` 装载，运行在 sloppy 模式——冻结对象的写入静默失败而非抛错，得到的是更隐蔽的 bug 而不是亮故障，违反 debug-first；且 freeze 只守得住这一条路径。

3. **dirty 改为与"上次保存时的序列化值"比较，不再持有 host 变量**
   - 最强理由：语义最直接——"相对已保存状态的差异"，从结构上消灭"基线被草稿污染"这一类问题。
   - 为何被否：需要新的保存快照状态及其生命周期（保存成功、被拒恢复、丢弃各自的更新点），且会丢掉"宿主值变了草稿让位"的现有语义；为一个回归引入第二套 dirty 机制，面远大于一行修复。

## Consequences

- 收益：
  - dirty / 保存按钮 / 放弃更改 / Ctrl+S 全线恢复；隔离 home 端到端实测：拨开关 → 脏徽标 + 保存可用 → 保存 → 徽标清零、按钮置灰 → `cordis.patch.yml` 的 `default.enabled` 落库为 false。
  - 回归测试覆盖此前完全盲视的生产启动路径（先重发布后编辑），与两个既有 subscribe 测试互补。
- 代价：
  - 每次值变化重播种多一次深拷贝（`clone(next)`，配置节为小型纯 JSON，开销可忽略）。
  - `host`/`draft` 两个变量的独立性仍无语言级强制，靠一行注释加测试守护；若未来重构控制器状态，这条不变量要随之搬迁，不能只搬代码。
