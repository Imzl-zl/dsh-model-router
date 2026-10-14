---
title: "DSH Model Router — 配置 UI 设计"
status: "proposal"
kind: "ui-design"
last_updated: "2026-10-12"
---

# DSH Model Router — 配置 UI 设计

## 摘要

本页是 `dsh-model-router` 插件在 DSH 客户端配置界面的完整设计规范。设计挂载点为 **Plugins 页 → 已安装插件 → `dsh-model-router` → 配置面板**（Slot: `plugins.bundle.config`）。

**设计理念**：
- **拒绝粗暴表格**：彻底抛弃死板文本框堆砌的“简陋表格”排版，建立以**有序降级流水线（Fallback Chain Pipeline）**为核心的直观心智模型；
- **100% 遵照 DSH 规范**：全量控件基于 DSH 官方原语封装，样式严格依托 DSH 官方 Design Token 系统（`ui-theme/design-platform.css`），原生支持深浅主题无缝切换；
- **全细节完备**：覆盖主配置面板、新建 Profile 弹窗、手动录入弹窗、全局默认兜底视图、候选高级路由条件展开面板、故障转移历史抽屉以及危险操作二次确认；
- **先例驱动**：表单与草稿状态机严谨复用 `ui-settings-subagent` 先例，模型列表与目录选择器复用 `ui-settings-models` 先例。

产品功能定义见 [product-plan.md](product-plan.md)，可视化高保真交互原型见 [spike/ui-mockup.html](../../spike/ui-mockup.html)。两条能力维度决策的理由见[笔记](../../.agents/notes/implemented/2026-10-12-drop-tools-eligibility-condition.md)与[笔记](../../.agents/notes/implemented/2026-10-12-router-prevalidates-reasoning-effort.md)。

---

## 一、DSH 官方设计系统与原语基线（源码盘点）

本设计所需全部控件与样式 token 均有明确的 DSH 官方源码依据：

| 元素 / 能力 | DSH 官方提供 | 源码依据 |
|---|---|---|
| 表单外壳与操作 | `SettingsForm`（`labels`/`state`/`onSave`/`onDiscard`/children） | [`SettingsForm.tsx:32-43`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/settings-form/SettingsForm.tsx#L32) |
| 设计 Token 系统 | `--dsw-alias-bg-*`、`--dsw-alias-border-*`、`--dsw-alias-label-*` | [`design-platform.css:284-398`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css#L284) |
| 布尔开关 | `Switch` 原语（`checked`/`label`/`disabled`/`onChange` 全受控） | [`Switch.tsx:18-27`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/Switch.tsx#L18) |
| 按钮原语 | `Button`（`variant: outline / ghost`，`size: sm`） | [`Button.tsx:30-45`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/Button.tsx#L30) |
| 状态与分类微章 | `Tag`、`Pill`（`tone: neutral / info / danger`） | [`Tag.tsx:16-24`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/Tag.tsx#L16) |
| 标签页切换 | `SegmentedTabs` / `SegmentedControl` | [`SegmentedTabs.tsx:20-40`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/SegmentedTabs.tsx#L20) |
| 模态挑选弹窗 | `Modal`（`open`/`title`/`onClose`/`footer`） | [`Modal.tsx:22-48`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/Modal.tsx#L22) |
| 风险二次确认 | `RiskConfirmation`（受控确认弹窗，必须勾选才能确认） | [`RiskConfirmation.tsx:29-60`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-primitives/src/RiskConfirmation.tsx#L29) |
| 真实模型目录 | `ctx.remote.session.modelCatalog()` → `groups: {id, name, models[]}` | [`SubagentModelSelectionCardController:321`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-subagent/src/client/subagent-model-selection-card-controller.ts#L321) |
| 控制器自持草稿 | 变更写入整段 `scope.mutate([{op:'set',path,value}], revision)` | [`subagent-model-selection-card-controller.ts:279-286`](file:///D:/sudy/github/deepseek-harness/packages/client/ui-settings-subagent/src/client/subagent-model-selection-card-controller.ts#L279) |

---

## 二、界面架构与多层级交互设计

### 2.1 整体信息架构

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 插件头部 (Plugin Header)                                                    │
│ [图标] Model Router  [v0.1.0] [● 活跃运行中]           [Switch] 启用渠道路由   │
│        为 Agent 主请求提供透明的跨 Provider 故障转移与备份链。               │
│                                                [按钮] 故障转移历史 ➔          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ 多 Profile 规则导航 (Profile Bar)                                            │
│ [ DeepSeek-V4 Flash (3 候选) ]  [ Claude 3.5 Sonnet (2 候选) ]  [+ 配置新模型] │
│ [ 🌐 全局默认兜底 (未启用) ]                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
       ┌──────────────────────────────┴──────────────────────────────┐
       ▼                                                             ▼
【普通 Profile 视图】                                       【全局默认兜底视图】
 1. 有序降级流水线 (Pipeline)                                 1. 全局默认兜底总开关
    - 首选主节点 (Primary)                                     2. 全局通用降级池列表
    - 故障转移指示线 (Failover Ribbon)                         3. 触发策略与尝试上限
    - 备用节点 (含高级路由条件面板)
 2. 故障转移触发策略 (Switch On Matrix)
 3. 重试预算与退避参数 (Execution Budget)
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ 二级弹窗与抽屉系统 (Modals & Drawers)                                       │
│ ├─ 新建 Profile 规则模态框 (New Profile Modal)                              │
│ ├─ 手动添加渠道模态框 (Manual Channel Modal)                                │
│ ├─ 从目录挑选模型模态框 (Catalog Picker Modal)                              │
│ ├─ 删除 Profile 二次确认 (Risk Confirmation Modal)                          │
│ └─ 故障转移历史抽屉 (Failover History Drawer)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────────────┐
│ 底部浮动操作条 (有改动时呼出)        [● 存在未保存的修改]    [放弃更改] [保存配置] │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2.2 核心体验重构点与排版规范

#### (1) 有序降级流水线（Pipeline Flow，替换原简陋表格）
- **心智强化**：将冷冰冰的双列文本框转为带有纵向虚线流向的 **Pipeline 节点卡片**。
- **节点视觉层级**：
  - **首选主渠道（Primary Node）**：序号 `01` 高亮，展示厂商专属徽标（如 DeepSeek 蓝、OpenAI 绿、Anthropic 橙），右侧设独立“单渠道尝试上限”微调框；徽标旁常驻展示该候选的**推理档位徽标**（来自 catalog `reasoning.efforts`，静态提示）；
  - **Primary 钉死规则**：`candidates[0]` 必须等于 `when` 模型（用户自己选的那个），不可删除、不可被换序。**显式配置的高级条件对它同样生效**（2026-10-14 起）：显式条件是用户意图，条件不满足就跳过并留 notice；primary 只豁免自动机制（熔断冷却、能力预校验）——跳过它不是“无失败也静默改路”，而是执行用户自己的配置；
  - **流转指示条（Failover Indicator）**：节点之间显式标注流转逻辑（`若主渠道遭遇限流或超时，自动切换至 1 号备用：Failover #1 ➔`）；
  - **备用节点（Fallback Nodes）**：展示模型全路径、能力匹配需求标签（`🖼️ 优先满足视觉输入`、`📄 优先满足大上下文`）与推理档位徽标；
  - **行内快捷操作**：右侧集成轻量工具按钮组：上移（提权）、下移（降权）、移除；**Primary 节点的上移与移除禁用**。
- **模型添加链路**：
  - 主入口：`从已配置的模型目录中添加候选`（打开 `Modal` 弹窗，读取 `modelCatalog()`，支持按 provider 分组多选，一键导入）；
  - 辅助入口：`+ 手动输入渠道信息`（打开模态弹窗，输入 `provider/model`，为离线或自定义扩展渠道兜底）。

#### (2) 多 Profile 规则管理（Profile Bar）
- 采用 DSH `SegmentedTabs` 范式置顶展示已配置的 profile 规则胶囊列表：
  - 每个胶囊展示：模型名（如 `DeepSeek-V4 Flash`）与候选数量 Badge（如 `3 候选`）；
  - 末端提供 `+ 为其他模型配置规则` 快捷按钮；
  - 包含一个 `🌐 全局默认兜底` 专用 Profile 标签，用于统一配置未显式配规则的模型。

#### (3) 故障切换策略矩阵（Policy Matrix）
- 升级为 **策略卡片网格（Trigger Cards）**：
  - 每张卡片包含：中文业务名（如“服务限流与排队”）、DSH 标准错误代号 Badge（`RATE_LIMIT`）、应用场景小字说明（“HTTP 429、并发用尽、TPM/RPM 频次超限”）；
  - 选中时卡片边框高亮（采用品牌主色变体），未选中时弱化；
  - 第六张为 `INVALID_REQUEST`（“请求被拒绝/能力不兼容”），**默认不勾选**：工具等能力不兼容属于此类，勾选后允许切换到下一个候选；分类依赖 provider 归一化（deepseek 报 `INVALID_REQUEST`、pi-ai 可能报 `PI_AI_ERROR`），不保证精确，README 已声明；
  - 底部补充醒目的 **“零浪费熔断安全机制”** 说明框，明确向用户披露不可重试错误（如 `ABORTED`、`AUTH_FAILED`、`NO_ADAPTER`）将直接抛出，绝不进行盲目重试。
- **小节副标题文案（修正后）**：“勾选异常的渠道切换发生前，DSH 仍会按默认策略在同渠道重试至多 5 次；不勾选的异常不切换备用渠道。”

---

### 2.3 细节页面与二级交互视图规格

#### (1) 新建 Profile 规则模态框 (New Profile Modal)
- **触发路径**：点击 Profile Bar 右上角的 `+ 为其他模型配置规则` 按钮。
- **界面包含**：
  - `为哪个主模型创建路由 (Primary Model)`：下拉框/输入框，可直接列出当前系统中尚未创建路由规则的已装模型；
  - `初始化候选链模板`：提供快速模板（“复制现有的 DeepSeek-V4 降级链路” 或 “从空白链路开始”）；
  - 底部动作：`取消` / `确认创建规则`。确认后在 Tab 栏追加新规则并自动聚焦。

#### (2) 全局默认兜底规则专用配置页 (Global Default Profile View)
- **触发路径**：点击 Profile Bar 上的 `🌐 全局默认兜底` 标签切换进入。
- **界面包含**：
  - 顶部引导说明蓝框（披露全局兜底机制：仅当主请求模型未配置任何专属 Profile 时生效，默认关闭保证零侵入）；
  - `全局默认兜底开关`（Switch 原语，受控切换）；
  - `全局通用降级池`：无固定单一 Primary 01，由用户配置通用的兜底模型优先级列表；
  - 独立的全局失败切换策略与总尝试次数上限。

#### (3) 候选节点高级路由条件展开面板 (Node Advanced Conditions & Needs Panel)
- **触发路径**：点击**任意**候选节点卡片上的 `⚙️ 高级路由条件` 按钮——含 Primary 节点（2026-10-14 起显式条件对 primary 生效，见[未决事项](open-questions.md)第四节）。
- **行内展开折叠面板，包含 2 项原子匹配条件**：
  - `图像/多模态输入 (needs.images)`：**三态分段控件**（`不限` / `仅带图请求` / `仅无图请求`），请求侧判定、精确。`仅带图请求` = 有图才轮到它；`仅无图请求` = 没图才轮到它——一对互斥值就是把一条链拆成「识图路 / 文本路」；图片条件按 turn 累积（工具循环后续步与 `read_image` 的工具结果都算这一轮的图）；
  - `最小上下文门槛 (needs.minContextTokens)`：数字框（如 `120000`），预估 Token 达到该量级时才允许降级至该超大上下文模型（tokenMeter 投影，估算且系统性低估中文，hint 必须披露“估算值”）。
- **识图路由引导框**（Profile 视图，链路编辑区下方常驻）：说明完整形态——在 DSH 模型设置里给文本模型勾选 `input:[text,image]`（发送门禁只查声明），primary 配「仅无图请求」、识图模型配「仅带图请求」，之后带图请求自动走识图模型、无图轮自动切回、零手动切换。
- **`识图粘滞（无图轮）` (stickyTurns)**：预算区数字框（0~99，默认 0），带图轮之后继续按「有图」路由的无图轮数；追问刚发过的图片时设 2~3。
- **推理档位是自动维度，不占条件位**：候选节点常驻展示 catalog 的 `reasoning.efforts` 徽标；运行时若当前请求的 reasoning effort 不被候选支持，Router 经 `resolveCallConfig` 预校验自动跳过该候选，无需用户配置。
- **条件全部不满足时**：链上无人可接 → 落回用户自己的路由（让真实失败暴露在那里），中文 notice 说明每个候选为什么被跳过；条件跳过 notice 按 (turn, 跳过组) 去重——工具循环每步重决同一批跳过，发一次就够。不忽略条件强留 Primary（那会把带图请求发给不支持图片的模型）。

#### (4) 手动录入候选渠道模态框 (Manual Channel Modal)
- **触发路径**：点击降级链底部的 `+ 手动输入渠道信息` 按钮。
- **界面包含**：
  - `Provider 标识`（`SettingsValueField`，如 `openai`、`pi-ai-siliconflow`）——对照 `modelCatalog().routableProviders` **实时校验**，不在册即时红字（catalog 是该清单的权威投影）；
  - `模型 ID`（`SettingsValueField`，如 `gpt-4o`、`deepseek-ai/DeepSeek-V3`）——**不校验**目录成员：catalog membership 是 advisory，核心路由接受未列出的 model id；
  - `单渠道尝试上限`（数字输入框，默认 1 次，范围 1~5），hint 注明“切换前会先等待一次退避（约 0.5~10 秒）”；
  - 具有非空校验与格式检查。

#### (5) 故障转移历史抽屉 (Failover History Drawer)
- **触发路径**：点击页面右上角 `故障转移历史` 按钮。
- **右侧滑出抽屉（Drawer 非官方原语，须自建 `createPortal` 到 body，不用裸 `fixed` 定位），只含一个区块**：
  - **最近故障转移历史**：时间戳、所属会话、原始失败模型、触发的错误码（`RATE_LIMIT` / `TIMEOUT` / …）、最终接管的候选序号；
  - 数据来自插件自有 session projection（key `router/failover-history`，带 wire，折叠 `request/header` + `assistant/attempt`）；
  - 客户端读取路径：`ctx.remote.session.list()` 取会话列表（list 行自带 cached 投影提示，冷会话零额外调用）→ 对最近 N=20 个会话调 `ctx.remote.session.projections({sessionId})` 取权威值；client 半包须 `inject: ['remote', 'remote.session', 'sessions']`。
- **投影硬约束**（违反即设计缺陷）：wire view 只输出“最近 N 条 + 聚合计数”（每个 tail 页携带全部 client-visible key，无按 key 裁剪，UI-scale 是纪律）；state 必须 plain JSON；view 返回对象必须复用引用；key 带插件命名空间，`stateVersion` 从 1 起只增；卸载即 key 消失、客户端读成能力缺失。
- **健康状态/延迟/成功率/冷却倒计时不做**：无数据来源（Router 不包 stream、全局健康度明确不做），列入 README Known Limitations，与全局熔断同批“不做”。

#### (6) 删除 Profile 的二次风险确认弹窗 (Risk Confirmation Modal)
- **触发路径**：在专属 Profile 页面点击 `删除此规则` 按钮。
- **复用官方 `RiskConfirmation` 原语**：
  - 显示红色危险标题与风险告知说明；
  - 包含强制确认复选框：`我已知晓该风险，确认删除该 Profile 规则`；
  - 只有勾选复选框后，“确认删除”按钮才解除禁用，防止用户误触导致重要路由配置丢失。

---

## 三、控制器状态机（依据 `SubagentModelSelectionCardController`）

由于路由配置包含数组（候选链）、对象（多 Profile）及布尔策略，不能走仅支持扁平文本的 `form.edit()`，必须由控制器自持草稿，基于 `scope.mutate` 的整段 path op 落地。

### 3.1 控制器状态定义

```typescript
export interface CandidateDraft {
  provider: string
  model: string
  displayName?: string
  maxAttempts: number
  needs?: {
    images?: boolean
    minContextTokens?: number
  }
}

export interface ProfileDraft {
  id: string
  when: { provider: string; model: string }
  candidates: CandidateDraft[]   // [0] 钉死为 when 模型：不可删、不可换序；显式 needs 条件对它同样生效
  switchOn: string[]
  maxTotalAttempts: number
}

export interface ModelRouterCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  revision: number
  enabled: boolean
  activeProfileId: string
  profiles: ProfileDraft[]        // 数组；按 when 精确匹配，无序关系
  defaultProfile: {
    enabled: boolean
    candidates: CandidateDraft[]  // 纯备用池，无钉死节点（Primary 永远是运行时用户所选）
    switchOn: string[]
    maxTotalAttempts: number
  }
}
```

### 3.2 动作分发与保存机制

1. **草稿标记**：任意字段（移动候选、添加候选、修改尝试次数、勾选切换条件）修改时，更新控制器内存草稿并置 `dirty = true`；
2. **保存动作（Save）**：
   ```typescript
   async save(): Promise<void> {
     if (!this.state.dirty || this.state.saving) return
     this.state.saving = true
     try {
       const ops = [
         { op: 'set', path: 'enabled', value: this.state.enabled },
         { op: 'set', path: 'profiles', value: this.state.profiles },
         { op: 'set', path: 'default', value: this.state.defaultProfile },
       ]
       await this.scope.mutate(ops, this.state.revision)
       this.state.dirty = false
     } catch (err) {
       this.state.failed = true
     } finally {
       this.state.saving = false
     }
   }
   ```
3. **放弃修改（Discard）**：清空内存草稿，从当前 `snapshot` 重新投影生成状态。

---

## 四、国际化（i18n）全量字典规范

严格遵循 DSH `verify-client-ui-i18n` 门禁约束（无行内硬编码字符串，所有可见文本、`aria-label`、`title` 必须进 locale）：

命名空间：`settings.modelRouter`

```typescript
export const zh = {
  // 头部与全局
  pluginTitle: 'Model Router',
  pluginDesc: '为 Agent 主请求提供透明的跨 Provider 故障转移与备份链。当主模型遭遇限流或异常时，按指定顺序自动降级并保留上下文。',
  pluginStatusRunning: '活跃运行中',
  globalSwitchLabel: '启用渠道路由',
  globalSwitchDesc: '关闭时，所有模型均绕过路由插件，直接调用官方适配器。',
  failoverHistoryButton: '故障转移历史',

  // Profile 导航
  profilesTitle: '已配置的路由规则 (Profiles)',
  addProfile: '为其他模型配置规则',
  defaultProfileTab: '🌐 全局默认兜底',
  defaultProfileNotActive: '未启用',
  candidateCountTag: '{n} 候选',
  deleteProfileBtn: '删除此规则',

  // 降级流水线
  pipelineTitle: '降级链路 (Fallback Chain)',
  pipelineSubtitle: '请求优先发送至首选主渠道。若达到单渠道尝试上限或触发指定异常，将自动流转至下一备用渠道。',
  primaryModelBadge: '用户默认首选',
  singleAttemptLimit: '单渠道尝试',
  attemptLimitHint: '切换前会先等待一次退避（约 0.5~10 秒）',
  timesUnit: '次',
  moveUp: '上移',
  moveDown: '下移',
  removeNode: '从链路中移除',
  failoverNotice: '若主渠道遭遇限流或超时，自动切换至备用：',
  addFromCatalog: '从已配置的模型目录中添加候选',
  addManual: '手动输入渠道信息',
  toggleNeedsBtn: '⚙️ 高级路由条件',

  // 高级路由需求 (Needs)
  needImagesTitle: '图像/多模态输入',
  needImagesHint: '仅当会话包含图片时允许匹配',
  needContextTitle: '最小上下文门槛 (Tokens)',
  needContextHint: '按预估值判断（估算值，可能低估中文），达到门槛时启用',
  reasoningBadge: '推理档位',
  reasoningAutoSkipHint: '当前请求的推理档位不被此候选支持时将自动跳过',

  // 故障转移策略
  switchOnTitle: '故障转移触发策略 (Switch On)',
  switchOnSubtitle: '勾选异常的渠道切换前，DSH 仍会按默认策略在同渠道重试至多 5 次；不勾选的异常不切换备用渠道。',
  rateLimitName: '服务限流与排队',
  rateLimitDesc: 'HTTP 429、并发用尽、TPM/RPM 频次超限。',
  serverErrorName: '上游服务端崩溃',
  serverErrorDesc: 'HTTP 500/502/503/504、服务暂时过载不可用。',
  timeoutName: '响应与连接超时',
  timeoutDesc: '首字等待超时、流式传输过程中断超时。',
  transportName: '网络传输中断',
  transportDesc: 'DNS 寻址失败、TCP 连接被重置、SSL 握手中断。',
  emptyResponseName: '空回复异常',
  emptyResponseDesc: '模型正常返回 200 但未输出任何可用 Token 内容。',
  invalidRequestName: '请求被拒绝 / 能力不兼容',
  invalidRequestDesc: '工具等能力不被候选支持时出现；分类依赖 provider，不保证精确。',
  safetyNoticeTitle: '零浪费熔断安全机制：',
  safetyNoticeText: '用户主动中断 (ABORTED)、凭证失效 (AUTH_FAILED) 及不可达的模型配置 (NO_ADAPTER) 属于永久性错误，将绝不进行盲目转移，立即向用户提示。',

  // 预算与操作
  budgetTitle: '重试预算与退避 (Execution Budget)',
  budgetSubtitle: '防止坏请求陷入无限重试死循环，限制单个 Agent 轮次的总调用成本。',
  maxTotalAttempts: '单请求最多总尝试次数',
  maxTotalAttemptsHint: '含同渠道重试及所有跨渠道降级次数硬顶',
  backoffTitle: '退避抖动基准 (Backoff)',
  backoffHint: '遵循 DSH 标准指数退避 (500ms ~ 10000ms)',
  backoffBadge: '标准自动退避',

  // 浮动条
  dirtyChangesNotice: '存在未保存的路由配置更改',
  discard: '放弃更改',
  save: '保存配置',
  saving: '正在保存...',
  saveSuccess: '保存成功',
  saveFailed: '保存配置失败',

  // 全局默认兜底页
  defaultProfileIntroTitle: '全局默认兜底规则说明',
  defaultProfileIntroDesc: '当用户在 DSH 对话框选中的模型未单独配置专属路由 Profile 时，若开启此全局兜底，则统一使用本页策略。默认关闭保证零侵入。',
  defaultProfileSwitchLabel: '接管未配置的模型',
  defaultProfileSwitchDesc: '是否接管所有未配置专属规则的模型调用。',
  defaultPoolTitle: '全局通用降级池',

  // 弹窗与抽屉
  newProfileModalTitle: '新建模型路由规则 (Profile)',
  targetModelLabel: '为哪个主模型创建路由 (Primary Model)',
  templateLabel: '初始化候选链模板',
  confirmCreateProfile: '确认创建规则',
  manualModalTitle: '手动添加候选渠道',
  providerLabel: 'Provider 标识 (提供方 ID)',
  modelIdLabel: '模型 ID (Model ID)',
  confirmAddManual: '添加至链路',
  riskConfirmTitle: '确认删除路由规则？',
  riskConfirmDesc: '删除后，针对该模型的专属降级链将被永久移除。此后该模型若发生限流或故障，将不再触发自动故障转移，直接向用户抛出错误。',
  riskConfirmCheckbox: '我已知晓该风险，确认删除该 Profile 规则',
  confirmDeleteBtn: '确认删除',
  failoverHistoryDrawerTitle: '最近故障转移历史',
  failoverLogsTitle: '最近故障转移历史',
  catalogModalTitle: '从模型目录添加候选',
  searchModelPlaceholder: '按模型名称或 Provider 搜索...',
  adoptSelected: '添加所选模型至链路',
  close: '关闭',
  cancel: '取消',
}

export const en = {
  // Header
  pluginTitle: 'Model Router',
  pluginDesc: 'Provides transparent cross-provider failover and fallback chains for Agent main requests. Gracefully falls back when primary models hit rate limits or downtime.',
  pluginStatusRunning: 'Active',
  globalSwitchLabel: 'Enable Model Routing',
  globalSwitchDesc: 'When disabled, all requests bypass the router and invoke official adapters directly.',
  failoverHistoryButton: 'Failover History',

  // Profiles
  profilesTitle: 'Configured Profiles',
  addProfile: 'Configure for another model',
  defaultProfileTab: '🌐 Global Default Fallback',
  defaultProfileNotActive: 'Disabled',
  candidateCountTag: '{n} candidates',
  deleteProfileBtn: 'Delete this profile',

  // Pipeline
  pipelineTitle: 'Fallback Chain Pipeline',
  pipelineSubtitle: 'Requests route to primary channel first. On failure reaching attempt limit, flow steps down to the next fallback candidate.',
  primaryModelBadge: 'Primary Choice',
  singleAttemptLimit: 'Attempts per candidate',
  attemptLimitHint: 'One backoff wait (about 0.5-10s) precedes each switch',
  timesUnit: 'times',
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  removeNode: 'Remove from chain',
  failoverNotice: 'Switches automatically on eligible failure to fallback #',
  addFromCatalog: 'Add candidate from model catalog',
  addManual: 'Add custom channel manually',
  toggleNeedsBtn: '⚙️ Advanced Conditions',

  // Needs
  needImagesTitle: 'Vision / Image Input',
  needImagesHint: 'Only matched when conversation includes images',
  needContextTitle: 'Min Context Floor (Tokens)',
  needContextHint: 'Estimated projection (may under-count CJK); enabled at threshold',
  reasoningBadge: 'Reasoning',
  reasoningAutoSkipHint: 'Auto-skipped when the request effort is unsupported',

  // Switch On
  switchOnTitle: 'Failover Trigger Policies (Switch On)',
  switchOnSubtitle: 'DSH still retries the same channel up to 5 times before a checked category fails over; unchecked categories never switch channels.',
  rateLimitName: 'Rate Limit & Queue Exhaustion',
  rateLimitDesc: 'HTTP 429, concurrency saturation, TPM/RPM ceiling hit.',
  serverErrorName: 'Upstream Server Outage',
  serverErrorDesc: 'HTTP 500/502/503/504, temporary service crash or outage.',
  timeoutName: 'Response & Stream Timeout',
  timeoutDesc: 'TTFT timeout, mid-stream transmission hang timeout.',
  transportName: 'Network Transport Interrupted',
  transportDesc: 'DNS failure, connection reset, SSL handshake failure.',
  emptyResponseName: 'Empty Response Anomaly',
  emptyResponseDesc: 'HTTP 200 returned but token generation payload is empty.',
  invalidRequestName: 'Request Rejected / Incompatible',
  invalidRequestDesc: 'Raised when a capability like tools is unsupported; classification is provider-dependent.',
  safetyNoticeTitle: 'Zero-Waste Circuit Breaker:',
  safetyNoticeText: 'Permanent failures such as User Abort (ABORTED), Bad Credentials (AUTH_FAILED), or Missing Adapter (NO_ADAPTER) will NEVER failover blindly.',

  // Budget
  budgetTitle: 'Execution Budget & Backoff',
  budgetSubtitle: 'Prevents infinite retry loops and bounds total token invocation costs.',
  maxTotalAttempts: 'Max total attempts per request',
  maxTotalAttemptsHint: 'Hard limit across all intra-channel retries and cross-channel failovers',
  backoffTitle: 'Exponential Backoff',
  backoffHint: 'Follows DSH standard exponential backoff (500ms ~ 10000ms)',
  backoffBadge: 'Standard Auto Backoff',

  // Floating
  dirtyChangesNotice: 'Unsaved routing changes detected',
  discard: 'Discard Changes',
  save: 'Save Changes',
  saving: 'Saving...',
  saveSuccess: 'Saved successfully',
  saveFailed: 'Failed to save configuration',

  // Default Profile
  defaultProfileIntroTitle: 'Global Default Fallback Policy',
  defaultProfileIntroDesc: 'Applied when the active model selected in DSH chat lacks a dedicated profile. Disabled by default to guarantee zero unexpected intrusion.',
  defaultProfileSwitchLabel: 'Take Over Unconfigured Models',
  defaultProfileSwitchDesc: 'Take over requests for all unconfigured models.',
  defaultPoolTitle: 'Global Fallback Pool',

  // Modals & Drawer
  newProfileModalTitle: 'Create New Routing Profile',
  targetModelLabel: 'Target Primary Model',
  templateLabel: 'Initialize from Template',
  confirmCreateProfile: 'Create Profile',
  manualModalTitle: 'Add Custom Channel Manually',
  providerLabel: 'Provider Identifier',
  modelIdLabel: 'Model Identifier',
  confirmAddManual: 'Add to Chain',
  riskConfirmTitle: 'Delete Routing Profile?',
  riskConfirmDesc: 'The fallback chain for this model will be permanently deleted. Subsequent rate limits or downtime will error out directly.',
  riskConfirmCheckbox: 'I acknowledge the risk and confirm deletion',
  confirmDeleteBtn: 'Delete Profile',
  failoverHistoryDrawerTitle: 'Recent Failover History',
  failoverLogsTitle: 'Recent Failover History',
  catalogModalTitle: 'Add Candidates from Catalog',
  searchModelPlaceholder: 'Search model name or provider...',
  adoptSelected: 'Add selected models to chain',
  close: 'Close',
  cancel: 'Cancel',
}
```

---

## 五、交付物与验证

1. **高保真可交互原型文件**：[`spike/ui-mockup.html`](../../spike/ui-mockup.html)
   - 可在浏览器中直接体验完整的 Profile 切换、高级条件展开折叠、新建弹窗、手动录入弹窗、删除确认弹窗、以及右侧滑出的故障转移历史抽屉；
   - 原生支持 ☀️ 浅色 / 🌙 深色双主题切换验证。
2. **源码实现落地计划**：
   - Client 半按 `experimental/client-ui-cot-translation` 范式挂载到 Slot `plugins.bundle.config`；
   - 控制器代码继承 `ui-settings-subagent` 范式，通过 `scope.mutate` 的整段 path op 提交；
   - 所有文案与国际化已在第四节全量定义，无缝支持后续编码阶段。
