# Agent Note: 更新提示与更新日志的归属

Status: implemented

## Context

用户要求「有新版本提示、点击一键更新、更新完进入弹一次更新日志」这样的常规插件体验，
并明确指出 DSH 原生支持更新。现场事实：

- 用户装了 `dshmarket`（DSH 插件市场）。它的已安装列表本来就会按 npm 版本检查更新、
  提供一键更新，并从插件仓库的 GitHub Release 读取「What changed」；它还有一套公开的
  update API v1，供插件自己的设置页复用检查/安装/重启。
- DSH 自己的插件市场（`plugin-market`）也有索引与版本列表，但只覆盖被收录的条目，
  且没有更新后的 changelog 弹窗。
- 本插件此前的 README 没有更新说明，版本里也没有任何“当前装的是哪一版”的运行时事实；
  npm 页面看到的是包内 README，而不是仓库根 README。

真正的缺口不是“如何安装新版本”（那是市场/包管理器的事），而是“新版本跑起来后，
让用户看到这一版改了什么”，以及“不要在插件里再写一套安装器”。

## Decision

1. **更新检查、一键更新、更新说明链接全部留在 DSH Market 原生路径**：不 spawn
   pnpm/dsh，不复制 `dshmarket` 的安装/重启算法，也不新增一套私有更新协议。
   插件只负责“更新之后”的那一步。
2. **构建时把当前版本的 CHANGELOG 小节嵌进产物**：`scripts/embed-changelog.mjs`
   从根 `CHANGELOG.md` 取 `## [版本]` 小节，生成
   `src/client/release.generated.ts`；`bundle` 先跑它。这样弹窗描述的是**实际安装的
   产物**，不是仓库 HEAD，也不依赖运行时网络（离线首启不会说谎）。
3. **每个浏览器只弹一次，按版本记账**：`localStorage['dsh-models-router:seen-version']`
   与当前 `RELEASE_VERSION` 不同（或还没记过）时，工作台自动弹一次；关闭即写入当前版本。
   页头永远保留「更新日志」按钮，用户可随时重看。
4. **读取时机放在 `applyInner` 的第一个 await 之前**：`localStorage` 必须在这一拍读，
   晚了会被 client module system/测试夹具换掉全局 window；入口把布尔值传给控制器，
   不在渲染期再读一次。
5. **包内 README 由根 README 生成**：`scripts/sync-package-readmes.mjs` 把
   `docs/assets/` 等相对链接改成 GitHub 绝对地址后写入包目录，npm 页面与仓库首页
   只有一份作者源，不再出现“npm 上没有截图/没有中文默认”的情况。

## Alternatives considered

1. **插件自己 fetch npm registry + 调 `dsh plugin add` 一键更新。**
   - 最强的理由：不依赖用户装 `dshmarket`，UI 可以完全长在插件页里。
   - 为何被否：安装/替换正在运行的包、Windows 文件占用、profile 锁、重启归属都是
     DSH Market 已经处理过的一整套边界；在业务插件里重写一遍就是第二个更新器，
     而且很容易在更新时把插件自己删掉一半。
2. **运行时从 GitHub raw / Releases API 取 changelog。**
   - 最强的理由：不用把 CHANGELOG 塞进 bundle，历史版本也能取。
   - 为何被否：离线/国内网络下会静默空白；取到的是仓库当前文本，不是已安装版本的
     文本；还会把一次“打开工作台”变成一次外网请求。
3. **只在 DSH Market 里看「What changed」，插件不做弹窗。**
   - 最强的理由：零新增代码，完全原生。
   - 为何被否：用户明确要“更新完进入弹一次”；市场只有更新前的链接，没有更新后的
     一次性提示。构建时嵌入 + localStorage 记账是满足这句话的最小实现。
4. **把 `release.generated.ts` 放进 `.gitignore`，只在构建时生成。**
   - 最强的理由：不把生成物提交进仓库。
   - 为何被否：`tsc`/编辑器/测试在未跑 `bundle` 的 checkout 上会直接缺模块；本项目的
     既有约定是 `lib/` 不进 git、其余构建输入可提交。生成物提交并由 bundle 重写，
     守卫测试再核对它与 `package.json`/`CHANGELOG.md` 一致。

## Consequences

- 收益：更新路径完全走 DSH 原生市场；插件只多一个“更新后说明”的薄层，不会与市场
  争夺安装权。npm 页面现在与仓库首页一致（中文默认、banner、截图、友链）。
- 代价：发版时必须先写好 `CHANGELOG.md` 的 `## [版本]` 小节，否则 `bundle` 直接失败
  （这是有意的：没有更新说明的版本不该发布）。
- 代价：`localStorage` 被禁用时，弹窗每次加载都会出现；礼貌性提示不值得让页面报错，
  所以这是显式接受的降级。
- 代价：banner 的深色卡片在亮色主题下是一块深色区域；这是为了让标题在暗色主题下
  可读而做的取舍，不随 GitHub 主题切换（SVG 读不到页面主题）。
- 未做：不把更新检查塞进插件页；不订阅 GitHub Release 事件；不做自动下载。
