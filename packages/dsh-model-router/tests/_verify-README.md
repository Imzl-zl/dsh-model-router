# 临时验证探针（审计复核用，不属于测试套件）

本目录（`packages/dsh-model-router/tests/`）下所有以 `_verify-` 开头的 `.mjs` 文件都是
**一次性审计复核探针**，为 `.agents/notes/proposed/2026-10-17-implementation-audit-findings.md`
的逐条证伪/证实而写。它们：

- **不在任何测试套件里**——`run.mjs` / `unit.mjs` / `client-controller.mjs` / `remote.mjs`
  都不引用它们，也没有被加进任何 glob。
- 每个文件头部的 JSDoc 写明它验的是哪一条、fake 的形状依据是什么。
- 可以直接 `node packages/dsh-model-router/tests/<file>.mjs` 跑；预期结果写在各文件尾部
  的断言里（当前全部按"缺陷存在"的样子转红或打印实测值）。

复核完成后整批删除即可；若其中某条转成了正式回归测试，应搬进对应套件并删掉这里的副本。

## 清单

| 文件 | 验的条目 | 跑法 | 当前预期 |
|---|---|---|---|
| `_verify-c1.mjs` | C1：探针超时分支不可达 | `node …/_verify-c1.mjs` | 断言红：得到 `unavailable/empty stream`，应为 `unreachable/TIMEOUT` |
| `_verify-c1-gen.mjs` → 生成 `_verify-c1-unit.mjs` | C1 revert 实验 | `node …/_verify-c1-gen.mjs && node …/_verify-c1-unit.mjs` | 生成把 `neverEnding` 改成真实 adapter abort 形状的 `unit.mjs` 副本；跑它应有 **2** 条转红（`:1098` 与 `:1173`） |
| `_verify-c2.mjs` | C2：`planFire` 末位候选多打一次 | `node …/_verify-c2.mjs` | 全绿（它是在证明推演表成立） |
| `_verify-gen.mjs` → 生成 `_verify-run.mjs` | C2 / I1 / I2 的组合层 | `node …/_verify-gen.mjs && node …/_verify-run.mjs` | 真 boot headless，stub 退避 3000ms。**注意：这些断言钉的是"缺陷存在"的基线，修好后要跟着翻**——C2 修好后 `real calls` 由 4 变 3、health fold 每候选由 `{…third:2}` 变各 1；I1 修好后 `llm/retry count`/`llm/retry-started count` 由 2 变 0、boot 墙钟由 ~8.5s 降到 ~2.2s。翻不过来就是修法没到位 |
| `_verify-stub-slow.mjs` | I1②/I2 的 3000ms 退避 stub | 被 `_verify-run.mjs` 引用 | 与 `stub-adapter.mjs` 同形，只把退避改成 3000ms |
| `_verify-c3-i4.mjs` | C3（配置 loading 期挂载抛错）/ I4（`surfaceActive()` 恒真） | `node …/_verify-c3-i4.mjs` | 全绿（两条都复现） |
| `_verify-i3.mjs` | I3：健康延迟跨 step/重试膨胀 | `node …/_verify-i3.mjs` | 断言红：step 2 得 4400ms，应 500ms |
| `_verify-i6.mjs` | I6：8 个死分支 | `node …/_verify-i6.mjs` | 全绿（证明 8 个 guard 都被 schema 挡在前面） |
| `_verify-lineage.mjs` | 待核实 #7：lineage settle 缺 step 门控 | `node …/_verify-lineage.mjs` | 全绿（证明跨 step 的成功会结算旧 entry） |

## 备注

- `_verify-c3-i4.mjs` 自带一个一遍过的小 React（跑 effect、按 React 单子规则填
  `props.children`、只在真进树的元素上挂 ref、给兄弟节点接 `nextElementSibling`），
  以及一个照 `SettingsForm.tsx:50-73` 复刻的 `SettingsForm`——fake 的形状跟的是 DSH 源码，
  不是插件实现。
- 跑组合层探针前必须 `npm run bundle --prefix packages/dsh-model-router`。
