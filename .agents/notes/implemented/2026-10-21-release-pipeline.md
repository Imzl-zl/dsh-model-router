# Agent Note: 发布链路（tag 驱动、npm provenance、CI 四个套件）

Status: implemented

## Context

第一次发版是手工做的：`npm publish` 在终端里输 OTP，仓库里没有任何自动化；
包名 `dsh-model-router` 在公开 registry 上属于别人（0.7.1），所以真正发布的是
`dsh-models-router@0.2.0`，GitHub 仓库也一并改名。手工发布暴露了三件事：

1. **没有 CI。** 四个套件（unit / client-controller / remote / Loader 组合）只在本机跑过；
   一个只在 Windows 上验证过的仓库，别人 clone 下来没有任何绿灯信号。
2. **发布动作没有唯一入口。** tag、package.json 的版本、CHANGELOG 的一段、GitHub Release
   的说明，四样东西靠人记得同步；0.2.0 这次 npm 上还留下了一个
   `0.0.0-stage` 占位版本（npm 11 staged publish 的产物），就是因为流程不清楚。
3. **npm 页面的元数据是空的。** 没有 keywords / homepage / bugs / engines，README 只是
   仓库里的那份拷贝。

## Decision

1. **发布 = 推 tag，没有按钮。** `.github/workflows/release.yml` 在 `v*.*.*` tag 上运行：
   先断言 tag 与 `packages/dsh-models-router/package.json` 的 `version` 相等（不等就红），
   再 `npm ci` + 包内依赖 + `npm run bundle`，然后 `npm publish --provenance --access public`，
   最后用 `scripts/release-notes.mjs` 从 CHANGELOG 抽出该版本的一节，创建 GitHub Release。
2. **没有 token，也没有 secret：走 npm trusted publishing（OIDC）。** npm 的包设置里
   登记「仓库 + workflow 文件名」，release 运行时用 GitHub OIDC（`id-token: write`）换一个
   短命的发布凭据，顺带签 provenance。npm 账号的 publishing access 同时收紧为
   「必须 2FA、禁止 bypass token」——这样即使有人拿到静态 token 也发不了版。
3. **CHANGELOG 是发布说明的唯一来源。** 脚本按 `## [<version>]` 切段；段落缺失或为空，
   release 步骤直接失败——不允许"发上去了但没人知道改了什么"。
4. **CI 在 master 的 push 与所有 PR 上跑**：workspace 安装 → 包内构建依赖 →
   `npm run bundle` → host 入口的 tsc → 四个套件逐个跑（各自一个 step，红了能一眼看出是
   哪个套件）。
5. **npm 元数据进 package.json**：description / keywords / homepage / bugs / author /
   engines / repository / publishConfig。`prepublishOnly` 保证发的是刚构建的 `lib/`。
6. **仓库与包名统一为 `dsh-models-router`**（GitHub 仓库已改名，旧 URL 自动重定向；
   README/CHANGELOG/package.json 的链接一并更新）。
7. 新增 `CONTRIBUTING.md`：把"一个事实一处表达、不许静默兜底、非平凡改动写决策笔记、
   不许削弱测试"这四条写成外面的人能读的版本，指向 `AGENTS.md` 与验证命令。

## Alternatives considered

1. **继续手工发布（每次终端里 `npm publish` + 手写 release notes）。**
   - 最强的理由：零配置，仓库里不引入 GitHub Actions 与 npm token，发布者完全控制时机。
   - 为何被否：这次就是手工发的——tag、版本、CHANGELOG、release notes 四样各写一遍，
     而且留下了 `0.0.0-stage` 占位；任何"下次记得同步"的约定都会在下一次漂移。
2. **semantic-release / changesets 全自动（按 commit 决定版本、自动改 CHANGELOG）。**
   - 最强的理由：版本与日志由机器保证一致，人只写 commit。
   - 为何被否：这个项目的 CHANGELOG 是"交付里程碑"体例（minor 位标记一次交付，DSH peer
     范围随之移动），不是逐条 commit 的语义化流水；把版本交给 commit 前缀，会把这个体例
     改掉。`changesets` 的代价类似，还要多一套待办文件。
3. **发布到 GitHub Packages 而不是 npm。**
   - 最强的理由：token 就是 `GITHUB_TOKEN`，不引入第三方 secret。
   - 为何被否：DSH 的 `dsh plugin add <name>` 走的是 npm 解析；GitHub Packages 需要
     使用者在 `.npmrc` 里配 registry 与 scope，给安装者加了一道没必要的门。
4. **在 release workflow 里把整套测试再跑一遍。**
   - 最强的理由：tag 可以打在任意 commit 上，发布前再验一次最保险。
   - 为何被否：CI 已经在 master 的每个 push 上跑过同一组套件；release 里再跑一遍只是把
     发布时间翻倍，而且 tag 与 master 的差异是"只改了版本号与 CHANGELOG"。构建仍然在
     release 里做（证明 tag 的源码能构建出产物）。

## Consequences

- 收益：发布动作只有一条路径（`npm version` → CHANGELOG → tag → push），tag/版本/说明
  由 CI 强制一致；npm 页面有 provenance 徽章，来源可验证。
- 收益：任何人 clone 后能在 CI 页看到四个套件的绿灯，不必相信本机结果。
- 代价：多一个必须维护的 secret（`NPM_TOKEN`），token 过期或权限不足时 tag 会红——
  这一步的失败信息是 npm 的 `EOTP/E403`，需要人读日志。
- 代价：CI 每次 push 跑四个套件（组合场景 28 个，单次约 6–10 分钟），私有分钟数会消耗。
- 代价：两个 lockfile（根 + 包内）。包内依赖必须保持 `--legacy-peer-deps`，否则 peer
  会被装进包内、遮蔽宿主的模块实例；CI 与 CONTRIBUTING 都写明了这一点。
- 已知遗留：npm 上还留着 `0.0.0-stage` 占位版本（删除需要 2FA）；下次发版前后可以
  用 `npm unpublish dsh-models-router@0.0.0-stage` 或网页上的 Versions 页清掉。
- 已知遗留：0.2.0 的 tarball 里 README 是"加徽章之前"的版本；npm 页面的元数据要等下
  一个版本才会更新（重新发同一版本是不可能的）。
