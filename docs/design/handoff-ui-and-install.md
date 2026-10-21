# 交接：live app 接新版、弹层提交、README 图（新会话提示词）

这个页面的用途：把三件遗留问题交给一个新会话收尾。下面的代码块整段复制到新会话即可。

```text
目标：收尾三件遗留问题。仓库 D:\sudy\myproject\dsh-model-router；不修改 DSH 源码树
D:\sudy\github\deepseek-harness；不提交任何凭据；不削弱已有测试；不并发跑两个 run.mjs 类套件。

背景（已核实，别重新猜）：
- 工作树有一批未提交改动（README 中文默认、locales 文案修复、chip 弹层重排、
  字典键/占位符一致性测试）。先 `git status --porcelain` 看一眼，别回退它们。
- 用户正在用的 DSH 桌面 app 是 2026/10/20 15:40 启动的，插件是那时加载进内存的旧构建；
  之后的源码与构建它没加载。profile `C:\Users\zhanglu\.dsh\profiles\desktop\cordis.patch.yml`
  里 `- id: model-router` 仍是 `disabled: true`、`name: dsh-model-router`（旧单数名），
  且 `profiles\desktop\node_modules\dsh-model-router` 这个 junction 指向
  `packages\dsh-model-router`（已不存在）。所以 app 里看不到新版；直接重启还会加载失败。
- 新包目录是 `packages\dsh-models-router`，包名 `dsh-models-router`。旧配置是 `profiles`
  形状，新版读取时会迁成一条命名链，行为基本保持。

任务 1（live app 接新版；用户已授权改 profile）：
1. 备份 `cordis.patch.yml`（带时间戳）。
2. 新建 junction：`profiles\desktop\node_modules\dsh-models-router` →
   `D:\sudy\myproject\dsh-model-router\packages\dsh-models-router`。
3. 把 patch 里的行改成 `name: dsh-models-router`，删掉 `disabled: true`（或改 false）；
   配置内容保留旧的 `profiles` 形状，让新版迁移。
4. 重建 `lib/`：`npm run bundle --prefix packages/dsh-models-router`。
5. 让用户重启 app / 重载插件，然后在 app 里验证：
   - composer 工具行出现路由 chip，文案是实际会走的链名（不是泛泛的「默认链」）；
   - 点开弹层：链行是「链 | 名称 | ›」，有分隔线，重试输入 48px，提示只有一行；
   - 英文界面不再出现 `retryLimit` 键名。
   如果插件加载失败或 app 报错，恢复备份并告诉用户。
注意：重启会中断用户当前会话；先告知。

任务 2（弹层外部点击不提交）：
- 复现：打开 chip 弹层，在重试输入框里输入 5，点击弹层外部（例如 composer），
  `storages/model_router_sessions.json` 不变；按 Enter 或 Tab 才提交。
- 设计意图是「失焦或回车提交」（docs/design/per-session-chains.md）。
- 在 `src/client/chip.ts` / `src/client/controller.ts` 里决定：点外部关闭时提交当前草稿；
  Escape 仍按取消处理。加一条 client-controller 测试锁住行为，重建并跑 unit/client-controller。
- 不要把「写失败」路径改成静默成功。

任务 3（README 弹层图分辨率）：
- `docs/assets/session-chains/session-routing-popover.png` 是 348×278 的元素截图，
  在 README 两列里会被放大发糊。
- 起一个隔离 web 实例（DSH_HOME 新建，别复用 .dshhome-view/.dshhome-real；端口从 3492 起），
  用临时 overlay 配 dead/real-a/real-b + 两条链 + 一个绑定，按 3× 设备像素重拍弹层
  （CDP `Emulation.setDeviceMetricsOverride` 的 `deviceScaleFactor: 3`，或等价手段），
  覆盖该 PNG；必要时调整 README 画廊，别让不同长宽比的图被拉伸。
- 跑完删掉隔离 home/会话/overlay/临时脚本；`git status` 只应有预期改动。

验收：
- app 里能看到并操作新版 chip/弹层，英文无缺键；
- 点外部关闭会落盘（有测试），Escape 行为明确；
- README 弹层图清晰、画廊不拉伸；
- `npm run bundle`、unit、client-controller 通过；`git status` 无临时产物；
- DSH checkout 0 改动，凭据仍被忽略。
```
