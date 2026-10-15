# Agent Note: 客户端半包拆模块，构建产物即测试与浏览器的一致对象

Status: implemented

## Problem

客户端半包是一个 4576 行手写单文件，自带 `window.__ModuleLoader__.load` 工厂包装，
`exports['./client']` 直指它。agent 据此推断"浏览器半包不需要构建"，于是插件自有
Remote 的客户端投影无处挂接——单文件经 bundle 端点下发时没有模块边界，
`import ... from './remote'` 无从引入。同时，三个结构回归测试（侧栏/工作区括号
深度、弹窗视口约束、熔断规则更新器）都靠读这一个文件的文本，"拆分之后这些守卫
读哪个文件"本身成了一个未记录的决定。

## Decision

客户端半包拆为 `src/client/index.ts` 入口 + 15 个按职责划分的模块，tsdown 以 DSH
预设同款契约构建 `lib/client.js`（CJS 工厂：banner 注册裸包名、footer 返回
module.exports、平台模块经 require 外置），`exports['./client']` 指向构建产物；
结构回归测试改读源码模块，行为测试跑构建产物。

准入门槛（可机械判定）：

1. `npm run bundle` 后 `lib/client.js` 存在，且其 factory 的 require 面恰为平台
   模块基线四项（react、react-dom、@deepseek-ai/dsh-client-store、
   @deepseek-ai/dsh-client-ui-primitives）——多一个说明外置清单漏配，少一个说明
   误内联。
2. `node packages/dsh-model-router/tests/client-controller.mjs` 对
   `lib/client.js` 全绿（默认 CLIENT_PATH 即构建产物），且三个文本守卫读
   `src/client/{page,modals,styles}.ts` 而非 bundle。
3. 隔离 home + Chrome MCP：配置页、流水线、健康徽标、添加候选弹窗、保存闭环五
   场景不回退，且 `cordis.patch.yml` 出现保存后的值。

## Alternatives considered

1. 保留单文件，只在外层加构建（不拆模块）
   - 最强的理由：零回归风险——文件内容不变，bundle 只是换个外壳；三个文本守卫
     一行不用改。
   - 为何被否：拆分的理由不是美观，是客户端必须能 import 生成的 `./remote`
     （Phase 3），单文件没有模块边界；且 4576 行单文件本身就是本次要还的债。
2. 文本守卫继续读 bundle
   - 最强的理由：测的就是最终下发的字节，理论上最贴近真实。
   - 为何被否：rolldown 会重印 AST——单引号变双引号、`function (current)` 丢
     空格、三元条件行被合并——三个守卫的定位串全部失配；而它们守的是"作者写错了
     什么"（括号配平但错位、类名没递给 Modal、闭包写状态），那是源码侧的错误，
     bundle 是机械变换。行为断言（save/dirty/check）仍然跑 bundle。
3. 客户端模块写成 .ts 并纳入包 tsconfig 严格检查
   - 最强的理由：与 DSH 客户端包（tsconfig.client.json）一致，有类型安全。
   - 为何被否：4500 行零标注遗留代码要补全注解才能过 strict，工作量大且与本次
     目标无关；现状是客户端半包从不做类型检查（手写 .js 时代亦然），维持现状并
     把 src/client 排除出 host tsconfig——Typert host-face 程序也不该编译浏览器
     模块。
4. 拆分粒度再细（按组件一个个文件）
   - 最强的理由：单一职责最彻底。
   - 为何被否：按现有区块切（16 个文件）已经让每个文件一个职责；再细会产生大量
     碎片文件，跨文件跳转成本超过收益。

## Consequences

- 收益：客户端有了模块边界，Phase 3 的远程投影有处可挂；测试对象与浏览器对象
  统一为 lib/client.js；每个模块职责单一，后续改动可按模块定位。
- 代价：开发循环对客户端同样要重建才在浏览器生效；bundle 与 sourcemap 进 lib/
  （gitignored）；源码模块不被类型检查，编辑器会显示 implicit any；拆分校验从
  "node --check 单文件"变为"node --check lib/client.js + 结构回归测试读源码"。
