/**
 * Browser half of dsh-model-router: the config page on DSH's Plugins page.
 *
 * Hand-written in the client module system's factory format (no build step),
 * following the verified spike pattern and DSH's own conventions:
 *   - a client half is a Cordis plugin with `name` / `inject` / `apply`
 *   - it registers into `plugins.bundle.config` (keyed by package name),
 *     rendering `view: 'page'` and reading its own settings scope rather than
 *     the Host-supplied form prop (the cot-translation precedent)
 *   - every visible string comes from this plugin's own `zh` / `en`
 *     dictionaries — the Config schema's `.description()` is never shown
 *   - the config holds arrays, nested objects and booleans, which the flat
 *     text-staging `SettingsFormModel` cannot express, so a controller holds
 *     the draft and saves through whole-section `scope.mutate` path ops (the
 *     ui-settings-subagent precedent); `SettingsForm` still provides the frame
 *
 * Phase 1 scope: master switch, per-model profiles with a pinned primary,
 * per-candidate attempt caps, the six-code `switchOn` matrix, the total-attempt
 * budget, the default fallback pool, and the four dialogs. Conditional routing
 * (needs) and the failover-history drawer arrive with their host features.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-router/client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var ReactDOM = require('react-dom')
    var h = React.createElement
    var prim = require('@deepseek-ai/dsh-client-ui-primitives')
    var clientStore = require('@deepseek-ai/dsh-client-store')
    var SettingsForm = prim.SettingsForm
    var Switch = prim.Switch
    var Button = prim.Button
    var Tag = prim.Tag
    var SegmentedTabs = prim.SegmentedTabs
    var Modal = prim.Modal
    var RiskConfirmation = prim.RiskConfirmation
    var createSnapshotStore = clientStore.createSnapshotStore

    /** Cordis plugin name. */
    var NS = 'dsh-model-router'
    /**
     * Settings namespace: the loader entry id the bundle patch declares
     * (`model-router`), NOT the package name — the Host derives every namespace
     * from `entry.options.id` (packages/settings/settings/src/index.ts:315,326).
     */
    var CONFIG_NS = 'model-router'

    var zh = {
      pluginTitle: 'Model Router',
      pluginDesc: '为 Agent 主请求提供透明的跨 Provider 故障转移与备份链。当主模型遭遇限流或异常时，按指定顺序自动降级并保留上下文。',
      globalSwitchLabel: '启用渠道路由',
      globalSwitchDesc: '关闭时，所有模型均绕过路由插件，直接调用官方适配器。',
      profilesTitle: '已配置的路由规则 (PROFILES)',
      addProfile: '为其他模型配置规则',
      defaultProfileTab: '🌐 全局默认兜底',
      candidateCountTag: '{n} 候选',
      deleteProfileBtn: '删除此规则',
      pipelineTitle: '降级链路 (Fallback Chain)',
      strategyLabel: '选路策略',
      strategySharedHint: '三种策略只决定「从哪条渠道开始」；任一渠道失败，都会继续尝试链上其余渠道，直到成功或用尽预算。',
      strategyorder: '按顺序',
      strategyweight: '按权重',
      'strategyround-robin': '轮询',
      strategyHintorder: '永远从第一条开始。最可预测，出问题时一眼能看懂它会怎么走。',
      strategyHintweight: '按权重比例随机选起点。适合把负载摊到多个渠道，比如免费渠道 30%、稳定渠道 70%。注意：换了渠道 prompt 缓存就废了，每条请求都在丢缓存。',
      'strategyHintround-robin': '每条请求顺移到下一条起点。适合后端完全对等的场景；渠道不对等时通常不如按权重，而且同样每条都丢缓存。',
      weightLabel: '权重',
      weightHint: '只有「按权重」策略会读这个数；0 表示永远不会被选为起点，但别的渠道失败后仍可能试到它',
      pipelineSubtitle: '请求优先发送至首选主渠道。若达到单渠道尝试上限或触发指定异常，将自动流转至下一备用渠道。',
      primaryModelBadge: '用户默认首选',
      singleAttemptLimit: '单渠道尝试',
      attemptLimitHint: '切换前会先等待一次退避（约 0.5~10 秒）',
      timesUnit: '次',
      turnsUnit: '轮',
      moveUp: '上移',
      moveDown: '下移',
      removeNode: '从链路中移除',
      primaryPinnedHint: '首选节点钉死为用户所选模型，不可删除或换序',
      toggleNeedsBtn: '⚙️ 高级路由条件',
      needImagesTitle: '图像/多模态输入',
      needImagesHint: '按本次请求有没有图片决定此候选能不能上场；对第一个候选（你选中的模型）同样生效',
      needImagesAnyLabel: '不限',
      needImagesRequireLabel: '仅带图请求',
      needImagesForbidLabel: '仅无图请求',
      needContextTitle: '最小上下文门槛 (Tokens)',
      needContextHint: '按预估值判断（估算值，可能低估中文）；0 表示不限制',
      stickyTurns: '识图粘滞（无图轮）',
      stickyTurnsHint: '带图轮之后继续按「有图」路由的无图轮数；0 = 无图轮立即切回。追问刚发过的图片时设 2~3，识图模型多粘几轮',
      visionWorkflowTitle: '让不能识图的模型接住图片（零点击）：',
      visionWorkflowText: '在 DSH 模型设置里给该模型勾选 input:[text,image]——发送门禁只查这份声明，不查真实能力。然后把本规则配成：第一个候选（它自己）选「仅无图请求」，识图模型选「仅带图请求」。之后带图的请求自动走识图模型，API 永远收不到它处理不了的图；无图轮自动切回它，下一次发图照样过门禁，不用手动切模型。',
      problemBadSticky: 'Profile {id} 的识图粘滞轮数不能为负',
      reasoningBadge: '推理档位',
      failoverNotice: '若主渠道遭遇限流或超时，自动切换至备用：',
      failoverTag: 'Failover',
      addFromCatalog: '从已配置的模型目录中添加候选',
      addManual: '+ 手动输入渠道信息',
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
      safetyNoticeText: '用户主动中断 (ABORTED)、凭证或权限被拒 (AUTH) 及不可达的模型配置 (NO_ADAPTER) 属于永久性错误，将绝不进行盲目转移，立即向用户提示。',
      budgetTitle: '重试预算与退避 (Execution Budget)',
      budgetSubtitle: '防止坏请求陷入无限重试死循环，限制单个 Agent 轮次的总调用成本。',
      maxTotalAttempts: '单请求最多总尝试次数',
      maxTotalAttemptsHint: '含同渠道重试及所有跨渠道降级次数硬顶',
      backoffTitle: '退避抖动基准 (Backoff)',
      backoffHint: '遵循 DSH 标准指数退避 (500ms ~ 10000ms)',
      backoffBadge: '标准自动退避',
      defaultProfileIntroTitle: '全局默认兜底规则说明',
      defaultProfileIntroDesc: '当用户在 DSH 对话框选中的模型未单独配置专属路由 Profile 时，若开启此全局兜底，则统一使用本页策略。默认关闭保证零侵入。',
      defaultProfileSwitchLabel: '接管未配置的模型',
      defaultProfileSwitchDesc: '是否接管所有未配置专属规则的模型调用。用户当前选中的模型永远是第一跳。',
      defaultPoolTitle: '全局通用降级池',
      defaultPoolSubtitle: '当任何未配置规则的模型发生故障时，尝试以下通用保底候选：',
      newProfileModalTitle: '新建模型路由规则 (Profile)',
      targetModelLabel: '为哪个主模型创建路由 (Primary Model)',
      targetModelHint: '用户在 DSH 会话中选中该模型时，插件将按本规则接管与备份。',
      manualTargetOption: '-- 手动输入其他渠道与模型 ID --',
      templateLabel: '初始化候选链模板',
      templateBlank: '从空候选链开始创建',
      templateCopy: '复制现有的规则候选链',
      confirmCreateProfile: '确认创建规则',
      manualModalTitle: '手动添加候选渠道',
      providerLabel: '渠道 (Provider)',
      providerSelectHint: '只能从 DSH 已注册的渠道里选——写错的名字不会报错，只会在运行时被静默跳过，所以这里不给你打错的机会。',
      providerPickPlaceholder: '-- 选择一个已注册的渠道 --',
      manualNoRegisteredProvider: 'DSH 里还没有已注册的渠道。请先到「设置 → Models」添加一个 provider，再回来加候选。',
      modelIdLabel: '模型 ID (Model ID)',
      modelIdFreeHint: '自由输入。网关支持的模型常常不在任何目录里，所以这里不限制；输入框会按所选渠道的目录模型给建议。',
      confirmAddManual: '添加至链路',
      catalogModalTitle: '从模型目录添加候选',
      searchModelPlaceholder: '按模型名称或 Provider 搜索...',
      adoptSelected: '添加所选模型至链路',
      riskConfirmTitle: '确认删除路由规则？',
      riskConfirmDesc: '删除后，针对该模型的专属降级链将被永久移除。此后该模型若发生限流或故障，将不再触发自动故障转移，直接向用户抛出错误。',
      riskConfirmCheckbox: '我已知晓该风险，确认删除该 Profile 规则',
      confirmDeleteBtn: '确认删除',
      close: '关闭',
      cancel: '取消',
      defaultProfileNotActive: '未启用',
      failoverHistoryButton: '故障转移历史',
      failoverHistoryDrawerTitle: '最近故障转移历史',
      failoverHistoryEmpty: '暂无故障转移记录',
      failoverHistoryLoading: '正在加载...',
      failoverHistoryError: '加载失败',
      failoverHistoryRetry: '重试',
      failoverHistoryHint: '仅显示最近 20 个会话的记录',
      failoverEntrySettled: '已成功',
      failoverEntryUnsettled: '未完成',
      failoverSessionLabel: '会话',
      codeRATE_LIMIT: '限流',
      codeSERVER: '服务端错误',
      codeTIMEOUT: '超时',
      codeTRANSPORT: '网络传输中断',
      codeEMPTY_RESPONSE: '空回复',
      codeINVALID_REQUEST: '请求被拒绝',
      problemsTitle: '配置有问题，保存已被阻止：',
      problemDuplicateId: '规则 ID 重复：{id}',
      problemEmptyChain: '规则 {id} 的候选链为空',
      problemUnpinnedPrimary: '规则 {id} 的第一个候选必须是 when 模型（{route}）',
      problemBadMaxAttempts: '规则 {id} 的第 {index} 个候选尝试次数必须在 1~5 之间',
      problemEmptyRoute: '规则 {id} 的第 {index} 个候选缺少 provider 或模型 ID',
      problemBadTotal: '规则 {id} 的总尝试上限必须 ≥ 1',
      problemBadDefaultTotal: '全局兜底的总尝试上限必须 ≥ 1',
      problemBadDefaultSticky: '全局兜底的识图粘滞轮数不能为负',
      problemWeightNoPositive: '选路策略是「按权重」，但没有任何候选的权重大于 0——这样永远从第一条开始，等于没配',
      problemBreakerEmptyRule: '自动禁用里有一条规则既没填错误码也没填错误信息，它永远命中不了任何东西',
      formUnavailable: '配置当前不可用',
      formReadOnly: '当前配置为只读',
      formSaveFailed: '保存失败，请重试',
      formSave: '保存配置',
      formSaving: '正在保存...',
      formDiscard: '放弃更改',
      catalogLoading: '正在加载模型目录...',
      noUnconfiguredModels: '所有已目录模型都已配置规则',
      attemptRangeHint: '1~5',
      sidebarActionLabel: '模型路由',
      sidebarActionTooltip: '模型路由与故障转移控制中心',
      saveSuccess: '配置已成功保存',
      unsavedChangesBadge: '未保存修改',
      unsavedChangesBarText: '发现尚未保存的路由配置变更',
      saveShortcutHint: '保存配置 (Ctrl+S)',
      discardShortcutHint: '放弃更改',
      quickModalTitle: '模型路由控制中心',
      statusRunningBadge: '路由生效中',
      statusDisabledBadge: '已暂停',
      stepMinus: '减少重试次数',
      stepPlus: '增加重试次数',
      savedStateTip: '配置已是最新',
      healthSectionTitle: '渠道健康监控',
      healthTiersIntro: '三档各自独立，按你需要的开。「运行时记录」免费，但只能反映已经发生过的事；「连通性检查」不生成内容、不花 Token，能知道渠道现在通不通；「发送测试消息」是真的发一条消息，也是唯一能证明模型真能出字的方式，但要花 Token。插件不替你选。',
      healthPassiveLabel: '运行时记录',
      healthPassiveHint: '正常对话的结果自动记入渠道健康，零成本、不发任何额外请求。缺点是要等事情发生过才知道。',
      healthDiscoverLabel: '连通性检查',
      healthDiscoverHint: '向渠道要一份模型清单（DSH 原生接口，不生成内容）。能发现端点不通、密钥失效、模型不在清单里；不花 Token。',
      healthDiscoverIntervalLabel: '检查周期 (秒)',
      healthDiscoverIntervalHint: '0 表示只手动跑，不后台轮询。定时只在 DSH 界面开着的时候跑；限流是每个渠道各自的，按你自己渠道的承受能力设，多密都行',
      healthProbeLabel: '发送测试消息',
      healthProbeUnavailable: '需要一条从浏览器到服务器的通道才能触发和回收结果。DSH 的插件远程接口要求构建管线生成的 Typert 贡献，而这个插件是手写单文件、没有构建步骤——所以这一档的开关和配置先不做，等构建管线就绪再开。',
      healthProbeHint: '真的发一条最小消息。配额打满、上游容量不足、模型被下线但仍在清单里，只有这个能发现。会花 Token，所以默认关闭。',
      breakerLabel: '自动禁用',
      breakerHint: '渠道命中规则后凉一段时间，冷却到了自动放行重试——不是永久拉黑',
      breakerSharedHint: '禁用是"过一会儿再试"：冷却结束后的下一个请求会真的去试它，又失败就再禁。用户自己选的那一条永远不跳过。',
      breakerRulesLabel: '禁用规则',
      breakerRulesHint: '错误码精确匹配 + 错误信息包含匹配，填几个就按几个匹配，都填就是两条都要满足。码可以手输任意值——常用码只是快捷方式。',
      breakerCodeLabel: '错误码（精确匹配，可留空）',
      breakerCodePlaceholder: '例如 AUTH',
      breakerMessageLabel: '错误信息包含（可留空）',
      breakerMessagePlaceholder: '例如 quota',
      breakerCooldownLabel: '禁用时长（秒）',
      breakerSecondsUnit: '秒',
      breakerAddRule: '+ 添加规则',
      breakerRemoveRule: '删除这条规则',
      breakerAlreadyAdded: '已经加过了',
      checkAllBtn: '检查全部渠道',
      checkingText: '检查中...',
      healthStatusHealthy: '正常',
      healthStatusDegraded: '降级',
      healthStatusUnhealthy: '异常',
      healthStatusUnknown: '未探测',
      healthConfigBtn: '健康监控设置',
      healthModalTitle: '渠道健康监控',
      healthMetricHistory: '近期记录',
      healthMetricLatency: '整轮耗时',
      healthMetricThroughput: '吞吐',
      healthBarIdle: '暂无请求 / 闲置时段',
      passiveDotTitle: '运行时记录',
      passiveNeverObserved: '运行时记录：这个渠道还没有被真实对话用过',
      connectivityNotRun: '连通性检查：还没跑过',
      connectivityReachable: '连通性检查：端点应答，且这个模型在它的清单里',
      connectivityNotAdvertised: '连通性检查：端点应答，但这个模型不在它的清单里',
      connectivityAdvertisedCount: '清单里有',
      connectivityNotConfigurable: '连通性检查：这个渠道不是可配置 provider，问不出端点',
      connectivityUnavailable: '连通性检查：DSH 的发现接口当前不可用',
      connectivityUnreachable: '连通性检查：端点没应答',
    }
    var en = {
      pluginTitle: 'Model Router',
      pluginDesc: 'Transparent cross-provider failover and fallback chains for Agent main requests.',
      globalSwitchLabel: 'Enable Model Routing',
      globalSwitchDesc: 'When disabled, all requests bypass the router and invoke official adapters directly.',
      profilesTitle: 'Configured Profiles',
      addProfile: 'Configure for another model',
      defaultProfileTab: '🌐 Global Default Fallback',
      candidateCountTag: '{n} candidates',
      deleteProfileBtn: 'Delete this profile',
      pipelineTitle: 'Fallback Chain Pipeline',
      strategyLabel: 'Start strategy',
      strategySharedHint: 'The three strategies decide one thing only: where the chain starts. Any channel that fails still hands off to the rest of the chain, until one answers or the budget runs out.',
      strategyorder: 'In order',
      strategyweight: 'By weight',
      'strategyround-robin': 'Round-robin',
      strategyHintorder: 'Always start at the first entry. The most predictable — when something breaks you can read the order and know exactly what it will do.',
      strategyHintweight: 'Draw the start by weight. For spreading load across channels, e.g. free 30% / stable 70%. Note: switching channels throws away the prompt cache, so every request pays a cache miss.',
      'strategyHintround-robin': 'Move the start one step per request. For genuinely interchangeable backends; with unequal channels "by weight" is usually better, and it costs a cache miss on every request too.',
      weightLabel: 'Weight',
      weightHint: 'Only the "by weight" strategy reads this. 0 means never chosen as the start, but it can still be tried after another channel fails.',
      pipelineSubtitle: 'Requests route to the primary channel first. On failure reaching the attempt limit, flow steps down to the next fallback candidate.',
      primaryModelBadge: 'Primary Choice',
      singleAttemptLimit: 'Attempts per candidate',
      attemptLimitHint: 'One backoff wait (about 0.5-10s) precedes each switch',
      timesUnit: 'times',
      turnsUnit: 'turns',
      moveUp: 'Move Up',
      moveDown: 'Move Down',
      removeNode: 'Remove from chain',
      primaryPinnedHint: 'The primary node is pinned to the selected model and cannot be removed or reordered',
      toggleNeedsBtn: '⚙️ Advanced Conditions',
      needImagesTitle: 'Vision / Image Input',
      needImagesHint: 'Gates this candidate on whether the request carries an image; applies to the first candidate (your selected model) too',
      needImagesAnyLabel: 'Any',
      needImagesRequireLabel: 'Image requests',
      needImagesForbidLabel: 'Text-only requests',
      needContextTitle: 'Min Context Floor (Tokens)',
      needContextHint: 'Estimated projection (may under-count CJK); 0 disables the gate',
      stickyTurns: 'Vision stickiness (no-image turns)',
      stickyTurnsHint: 'No-image turns that keep routing as if the request had an image; 0 = revert immediately. Set 2~3 to keep the vision model for follow-ups about a just-sent image',
      visionWorkflowTitle: 'Let a text-only model handle images (zero clicks):',
      visionWorkflowText: 'Tick input:[text,image] for that model in DSH model settings — the send gate reads the declaration, not the real capability. Then set this rule up as: the first candidate (the model itself) to "Text-only requests", the vision model to "Image requests". Image requests then route to the vision model automatically, the API never receives an image it cannot process, no-image turns revert on their own, and the next image still passes the gate — no manual switching.',
      problemBadSticky: 'Profile {id} sticky turns must not be negative',
      reasoningBadge: 'Reasoning',
      failoverNotice: 'Switches automatically on eligible failure to fallback #',
      failoverTag: 'Failover',
      addFromCatalog: 'Add candidate from model catalog',
      addManual: '+ Add custom channel manually',
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
      safetyNoticeText: 'Permanent failures such as User Abort (ABORTED), Rejected Credentials (AUTH), or Missing Adapter (NO_ADAPTER) will NEVER failover blindly.',
      budgetTitle: 'Execution Budget & Backoff',
      budgetSubtitle: 'Prevents infinite retry loops and bounds total token invocation costs.',
      maxTotalAttempts: 'Max total attempts per request',
      maxTotalAttemptsHint: 'Hard limit across all intra-channel retries and cross-channel failovers',
      backoffTitle: 'Exponential Backoff',
      backoffHint: 'Follows DSH standard exponential backoff (500ms ~ 10000ms)',
      backoffBadge: 'Standard Auto Backoff',
      defaultProfileIntroTitle: 'Global Default Fallback Policy',
      defaultProfileIntroDesc: 'Applied when the active model selected in DSH chat lacks a dedicated profile. Disabled by default to guarantee zero unexpected intrusion.',
      defaultProfileSwitchLabel: 'Take Over Unconfigured Models',
      defaultProfileSwitchDesc: 'Take over requests for all unconfigured models. The model you picked is always the first hop.',
      defaultPoolTitle: 'Global Fallback Pool',
      defaultPoolSubtitle: 'When any unconfigured model fails, these fallback candidates are tried:',
      newProfileModalTitle: 'Create New Routing Profile',
      targetModelLabel: 'Target Primary Model',
      targetModelHint: 'When the user selects this model in a DSH session, this profile takes over.',
      manualTargetOption: '-- Enter another channel and model ID manually --',
      templateLabel: 'Initialize from Template',
      templateBlank: 'Start from an empty chain',
      templateCopy: 'Copy an existing profile chain',
      confirmCreateProfile: 'Create Profile',
      manualModalTitle: 'Add Custom Channel Manually',
      providerLabel: 'Channel (provider)',
      providerSelectHint: 'Pick from the channels DSH has registered. A mistyped name would not error — it would just be skipped at runtime — so this does not give you the chance to mistype it.',
      providerPickPlaceholder: '-- Pick a registered channel --',
      manualNoRegisteredProvider: 'DSH has no registered channel yet. Add one under Settings → Models first, then come back to add candidates.',
      modelIdLabel: 'Model ID',
      modelIdFreeHint: 'Free text. Gateways often serve models no catalog lists, so this is not restricted; the field suggests the selected channel\'s catalog models.',
      confirmAddManual: 'Add to Chain',
      catalogModalTitle: 'Add Candidates from Catalog',
      searchModelPlaceholder: 'Search model name or provider...',
      adoptSelected: 'Add selected models to chain',
      riskConfirmTitle: 'Delete Routing Profile?',
      riskConfirmDesc: 'The fallback chain for this model will be permanently deleted. Subsequent rate limits or downtime will error out directly.',
      riskConfirmCheckbox: 'I acknowledge the risk and confirm deletion',
      confirmDeleteBtn: 'Delete Profile',
      close: 'Close',
      cancel: 'Cancel',
      defaultProfileNotActive: 'Disabled',
      failoverHistoryButton: 'Failover History',
      failoverHistoryDrawerTitle: 'Recent Failover History',
      failoverHistoryEmpty: 'No failover records yet',
      failoverHistoryLoading: 'Loading...',
      failoverHistoryError: 'Failed to load',
      failoverHistoryRetry: 'Retry',
      failoverHistoryHint: 'Showing the 20 most recent sessions',
      failoverEntrySettled: 'completed',
      failoverEntryUnsettled: 'unfinished',
      failoverSessionLabel: 'Session',
      codeRATE_LIMIT: 'rate limit',
      codeSERVER: 'server error',
      codeTIMEOUT: 'timeout',
      codeTRANSPORT: 'transport failure',
      codeEMPTY_RESPONSE: 'empty response',
      codeINVALID_REQUEST: 'request rejected',
      problemsTitle: 'Configuration problems block the save:',
      problemDuplicateId: 'Duplicate profile id: {id}',
      problemEmptyChain: 'Profile {id} has no candidates',
      problemUnpinnedPrimary: 'Profile {id} candidates[0] must be the when model ({route})',
      problemBadMaxAttempts: 'Profile {id} candidate {index} maxAttempts must be 1~5',
      problemEmptyRoute: 'Profile {id} candidate {index} is missing provider or model id',
      problemBadTotal: 'Profile {id} maxTotalAttempts must be >= 1',
      problemBadDefaultTotal: 'The default pool maxTotalAttempts must be >= 1',
      problemBadDefaultSticky: 'The default pool sticky turns must be >= 0',
      problemWeightNoPositive: 'The start strategy is "by weight" but no candidate has a positive weight — every request would start at the first entry, which is the same as not configuring it.',
      problemBreakerEmptyRule: 'One auto-disable rule has neither a code nor a message, so it can never match anything.',
      formUnavailable: 'Configuration is currently unavailable',
      formReadOnly: 'The configuration is read-only',
      formSaveFailed: 'Save failed, please retry',
      formSave: 'Save Changes',
      formSaving: 'Saving...',
      formDiscard: 'Discard Changes',
      catalogLoading: 'Loading the model catalog...',
      noUnconfiguredModels: 'Every catalog model already has a profile',
      attemptRangeHint: '1~5',
      sidebarActionLabel: 'Model Router',
      sidebarActionTooltip: 'Model Router & Failover Control Center',
      saveSuccess: 'Configuration saved',
      unsavedChangesBadge: 'Unsaved',
      unsavedChangesBarText: 'Unsaved routing configuration changes detected',
      saveShortcutHint: 'Save (Ctrl+S)',
      discardShortcutHint: 'Discard',
      quickModalTitle: 'Model Router Control Center',
      statusRunningBadge: 'Active',
      statusDisabledBadge: 'Paused',
      stepMinus: 'Decrease attempts',
      stepPlus: 'Increase attempts',
      savedStateTip: 'Up to date',
      healthSectionTitle: 'Channel Health Monitor',
      healthTiersIntro: 'Three independent tiers — enable what you need. Runtime observation is free but only knows the past. A connectivity check sends no content and costs no tokens, and tells you whether the channel answers right now. Sending a test message really sends one, and is the only thing that proves a model can answer — but it costs tokens. The plugin does not choose for you.',
      healthPassiveLabel: 'Runtime observation',
      healthPassiveHint: 'Real conversation outcomes folded into channel health. Zero cost, no extra requests — but you only learn about something after it happened.',
      healthDiscoverLabel: 'Connectivity check',
      healthDiscoverHint: 'Ask each channel for its model list through DSH\'s own discovery interface. Catches a dead endpoint, a bad key, or a model missing from the list. Costs no tokens.',
      healthDiscoverIntervalLabel: 'Check interval (sec)',
      healthDiscoverIntervalHint: '0 means manual only. The schedule runs while the DSH UI is open; rate limits are per channel, so set whatever your own channels tolerate',
      healthProbeLabel: 'Send a test message',
      healthProbeUnavailable: 'Triggering this and reading its result back both need a browser-to-host channel. DSH\'s plugin remote interface requires a Typert contribution generated by the build pipeline, and this plugin is a hand-written single file with no build step — so this tier\'s switch and settings stay off until that exists.',
      healthProbeHint: 'Actually send one minimal message. An exhausted quota, an upstream capacity shortage, or a model delisted but still advertised — only this catches those. Costs tokens, so it is off by default.',
      breakerLabel: 'Auto-disable',
      breakerHint: 'Take a channel out of rotation when it fails in a way you said should disqualify it. The block always expires — a cooldown, not a ban.',
      breakerSharedHint: 'A block lifts on its own: the first request after the cooldown really tries the channel again, and a fresh failure re-arms it. The route you picked yourself is never skipped.',
      breakerRulesLabel: 'Disable rules',
      breakerRulesHint: 'Match on the error code exactly and/or the error message containing a string. Every field you fill must match. Any code can be typed — the presets are only shortcuts.',
      breakerCodeLabel: 'Error code (exact, optional)',
      breakerCodePlaceholder: 'e.g. AUTH',
      breakerMessageLabel: 'Message contains (optional)',
      breakerMessagePlaceholder: 'e.g. quota',
      breakerCooldownLabel: 'Cooldown (seconds)',
      breakerSecondsUnit: 'sec',
      breakerAddRule: '+ Add rule',
      breakerRemoveRule: 'Remove this rule',
      breakerAlreadyAdded: 'Already added',
      checkAllBtn: 'Check all channels',
      checkingText: 'Checking...',
      healthStatusHealthy: 'Healthy',
      healthStatusDegraded: 'Degraded',
      healthStatusUnhealthy: 'Unhealthy',
      healthStatusUnknown: 'Untested',
      healthConfigBtn: 'Health Settings',
      healthModalTitle: 'Channel Health Monitor',
      healthMetricHistory: 'Recent',
      healthMetricLatency: 'Turn cost',
      healthMetricThroughput: 'Throughput',
      healthBarIdle: 'No requests / Idle',
      passiveDotTitle: 'Runtime observation',
      passiveNeverObserved: 'Runtime observation: no real conversation has used this channel yet',
      connectivityNotRun: 'Connectivity check: not run yet',
      connectivityReachable: 'Connectivity check: endpoint answered and this model is on its list',
      connectivityNotAdvertised: 'Connectivity check: endpoint answered, but this model is not on its list',
      connectivityAdvertisedCount: 'advertised',
      connectivityNotConfigurable: 'Connectivity check: this route is not a configurable provider, so it has no endpoint to ask',
      connectivityUnavailable: 'Connectivity check: DSH\'s discovery interface is unavailable',
      connectivityUnreachable: 'Connectivity check: endpoint did not answer',
    }

    /** The three start strategies, in the order the selector shows them. */
    var STRATEGY_OPTIONS = ['order', 'weight', 'round-robin']

    /**
     * 常用错误码的快捷选项。只是少打几个字——错误码本身永远可以手输任何值，
     * 因为 `LlmFailure.code` 是开放字符串，provider 自己的码也归它管。
     */
    var BREAKER_CODE_PRESETS = [
      { code: 'RATE_LIMIT', desc: '限流，通常几十秒就恢复', seconds: 60 },
      { code: 'SERVER', desc: '上游 5xx，几分钟', seconds: 300 },
      { code: 'TIMEOUT', desc: '超时，几分钟', seconds: 300 },
      { code: 'TRANSPORT', desc: '网络中断，几分钟', seconds: 300 },
      { code: 'AUTH', desc: '密钥或权限被拒（DSH 对 401/403 都用这个码），禁到人改配置为止', seconds: 3600 },
      { code: 'QUOTA', desc: '额度用尽（DSH 的 QUOTA_EXCEEDED_CODE），按账单周期', seconds: 7200 },
    ]

    /** The six switchOn codes: `key` is the config field, `labelKey` the dictionary stem. */
    var SWITCH_ON_CODES = [
      { key: 'rateLimit', labelKey: 'rateLimit', code: 'RATE_LIMIT' },
      { key: 'server', labelKey: 'serverError', code: 'SERVER' },
      { key: 'timeout', labelKey: 'timeout', code: 'TIMEOUT' },
      { key: 'transport', labelKey: 'transport', code: 'TRANSPORT' },
      { key: 'emptyResponse', labelKey: 'emptyResponse', code: 'EMPTY_RESPONSE' },
      { key: 'invalidRequest', labelKey: 'invalidRequest', code: 'INVALID_REQUEST' },
    ]

    function defaultSwitchOn() {
      return { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
    }
    function defaultProfileValue() {
      return { enabled: false, candidates: [], switchOn: defaultSwitchOn(), maxTotalAttempts: 3, stickyTurns: 0 }
    }
    /** A config saved before `stickyTurns` existed reads undefined here; the host default is 0. */
    function normalizeProfiles(value) {
      return clone(value ?? []).map(function (profile) {
        if (typeof profile.stickyTurns !== 'number' || profile.stickyTurns < 0) profile.stickyTurns = 0
        return profile
      })
    }
    function normalizeDefault(value) {
      var pool = clone(value ?? defaultProfileValue())
      if (typeof pool.stickyTurns !== 'number' || pool.stickyTurns < 0) pool.stickyTurns = 0
      return pool
    }

    // ---------- global styles injection (DSH sidebar & modal adaptations) ----------

    var ROUTER_CSS = [
      '/* dsh-model-router: sidebar footer actions adaptive column layout */',
      'div[class*="footerActions"] {',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  gap: 4px !important;',
      '  width: 100% !important;',
      '  box-sizing: border-box !important;',
      '}',
      'div[class*="collapsed"] div[class*="footerActions"] {',
      '  display: flex !important;',
      '  flex-direction: column !important;',
      '  align-items: center !important;',
      '  gap: 6px !important;',
      '  width: auto !important;',
      '}',
      '/* Sidebar footer action button styles */',
      '.dsh-router-footer-action {',
      '  box-sizing: border-box !important;',
      '  border: none !important;',
      '  background: transparent;',
      '  color: var(--dsw-alias-label-primary);',
      '  font-family: inherit;',
      '  font-size: 13.5px;',
      '  font-weight: 500;',
      '  line-height: 20px;',
      '  cursor: pointer;',
      '  white-space: nowrap !important;',
      '  user-select: none;',
      '  transition: background 0.15s ease, color 0.15s ease;',
      '}',
      '.dsh-router-footer-action:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;',
      '}',
      '.dsh-router-footer-action:active {',
      '  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.12)) !important;',
      '}',
      '.dsh-router-footer-action:focus-visible {',
      '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));',
      '  outline-offset: -1px;',
      '}',
      '/* Suppress duplicate SettingsForm footer inside router views (save action is prominently anchored to sticky header / modal top bar) */',
      '.dsh-router-page div[class*="footer"]:has(button),',
      '.dsh-router-modal-dialog div[class*="footer"]:has(button),',
      '.dsh-router-page div[class*="_footer"],',
      '.dsh-router-modal-dialog div[class*="_footer"] {',
      '  display: none !important;',
      '}',
      '/* Interactive micro-interactions */',
      '.dsh-router-save-btn:not(:disabled):hover {',
      '  filter: brightness(1.08);',
      '}',
      '.dsh-router-save-btn:not(:disabled):active {',
      '  filter: brightness(0.95);',
      '}',
      '.dsh-router-discard-btn:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;',
      '  color: var(--dsw-alias-label-primary) !important;',
      '}',
      '.dsh-router-catalog-btn:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;',
      '}',
      '.dsh-router-manual-btn:hover {',
      '  border-color: var(--dsw-alias-border-l3) !important;',
      '  color: var(--dsw-alias-label-primary) !important;',
      '}',
      '.dsh-router-danger-btn:hover {',
      '  background: rgba(239, 68, 68, 0.1) !important;',
      '  border-color: var(--dsw-alias-state-error, #ef4444) !important;',
      '}',
      '.dsh-router-add-profile-btn:hover {',
      '  border-color: var(--dsw-alias-brand-primary, #4A65E8) !important;',
      '  color: var(--dsw-alias-brand-primary, #4A65E8) !important;',
      '}',
      '.dsh-router-icon-btn:not(:disabled):hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;',
      '  color: var(--dsw-alias-label-primary) !important;',
      '}',
      '.dsh-router-stepper-btn:not(:disabled):hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12)) !important;',
      '  border-color: var(--dsw-alias-border-l4) !important;',
      '}',
      '.dsh-router-trigger-card:hover {',
      '  border-color: var(--dsw-alias-border-l4) !important;',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.04)) !important;',
      '}',
      '.dsh-router-modal-close-btn:hover {',
      '  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)) !important;',
      '  color: var(--dsw-alias-label-primary) !important;',
      '}',
      '.dsh-timeline-pill:hover {',
      '  transform: scaleY(1.3) scaleX(1.1) !important;',
      '  filter: brightness(1.3) !important;',
      '}',
      '/* Keyframes & transitions */',
      '@keyframes dsh-spin {',
      '  from { transform: rotate(0deg); }',
      '  to { transform: rotate(360deg); }',
      '}',
    ].join('\n')

    function ensureStyles() {
      if (typeof document === 'undefined') return function () {}
      var id = 'dsh-model-router-styles'
      var tag = document.querySelector('style[data-plugin="dsh-model-router"]')
      if (!tag) {
        tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-model-router'
        tag.dataset.pluginCss = id
        tag.textContent = ROUTER_CSS
        document.head.appendChild(tag)
      }
      return function () {
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
      }
    }

    // ---------- style constants (DSH design tokens) ----------

    var S = {
      page: { maxWidth: 960, margin: '0 auto', padding: '12px 16px 80px', boxSizing: 'border-box' },
      pageModal: { maxWidth: '100%', margin: '0', padding: '0 0 40px', boxSizing: 'border-box' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
      stickyHeader: {
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'var(--dsw-alias-bg-layer-0, rgba(20,20,24,0.85))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
        padding: '12px 20px',
        margin: '0 -20px 24px',
        borderRadius: '0 0 var(--dsw-radius-lg, 14px) var(--dsw-radius-lg, 14px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'nowrap',
      },
      headerLeft: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
      headerTitles: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      titleRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 700, color: 'var(--dsw-alias-label-primary)', margin: 0, whiteSpace: 'nowrap' },
      desc: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5, margin: 0, maxWidth: 460, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      headerActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'nowrap' },
      switchWrap: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--dsw-alias-bg-layer-2)', padding: '4px 10px', borderRadius: 'var(--dsw-radius-md, 8px)', border: '0.5px solid var(--dsw-alias-border-l2)', whiteSpace: 'nowrap' },
      switchLabel: { fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' },
      headerDivider: { width: 1, height: 20, background: 'var(--dsw-alias-border-l3)', margin: '0 4px', flexShrink: 0 },
      saveBtn: {
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-brand-primary, #4A65E8)',
        color: '#ffffff',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        padding: '0 16px',
        height: 34,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(74,101,232,0.35)',
        transition: 'all 0.15s ease',
      },
      saveBtnHighlight: {
        background: 'linear-gradient(135deg, #4A65E8 0%, #3551db 100%)',
        boxShadow: '0 0 10px rgba(74,101,232,0.5)',
      },
      saveBtnDisabled: {
        background: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.08))',
        color: 'var(--dsw-alias-label-tertiary, #888)',
        boxShadow: 'none',
        cursor: 'default',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        opacity: 0.6,
      },
      saveBtnSuccess: {
        background: 'var(--dsw-alias-state-success, #10b981)',
        color: '#ffffff',
        boxShadow: '0 2px 10px rgba(16,185,129,0.4)',
      },
      discardBtnHeader: {
        boxSizing: 'border-box',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        color: 'var(--dsw-alias-label-secondary)',
        padding: '0 12px',
        height: 34,
        borderRadius: 'var(--dsw-radius-md, 8px)',
        fontSize: 12.5,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 0.15s ease',
      },
      kbdTag: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 5px',
        borderRadius: '4px',
        background: 'rgba(0, 0, 0, 0.25)',
        border: '0.5px solid rgba(255, 255, 255, 0.2)',
        fontFamily: 'var(--ds-font-family-code, monospace)',
        fontSize: '10.5px',
        lineHeight: '12px',
        color: 'rgba(255, 255, 255, 0.85)',
        marginLeft: '4px',
        letterSpacing: '0.2px',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      },
      badgeRunning: {
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'rgba(16,185,129,0.12)',
        color: 'var(--dsw-alias-state-success, #10b981)',
        border: '0.5px solid rgba(16,185,129,0.3)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      badgePaused: {
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-tertiary)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      badgeDirty: {
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'rgba(245,158,11,0.15)',
        color: '#f59e0b',
        border: '0.5px solid rgba(245,158,11,0.4)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      saveFailedBadge: {
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'rgba(239,68,68,0.15)',
        color: 'var(--dsw-alias-state-error, #ef4444)',
        border: '0.5px solid rgba(239,68,68,0.4)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      card: {
        background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1))',
        border: '0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3))',
        borderRadius: 'var(--dsw-radius-xl, 16px)',
        padding: '22px 24px',
        marginBottom: 20,
        boxShadow: 'var(--dsw-card-shadow, 0 1px 3px rgba(0,0,0,0.1))',
        boxSizing: 'border-box',
      },
      sectionHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
      sectionTitle: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' },
      sectionSubtitle: { fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', margin: '3px 0 0' },
      dangerBtn: {
        boxSizing: 'border-box',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        color: 'var(--dsw-alias-state-error)',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        padding: '0 12px',
        height: 28,
        fontSize: 12,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background 0.15s ease',
      },
      node: { position: 'relative', paddingBottom: 16 },
      nodeCard: {
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-lg, 12px)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxSizing: 'border-box',
      },
      nodeCardPrimary: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        background: 'linear-gradient(90deg, rgba(74,101,232,0.08) 0%, var(--dsw-alias-bg-layer-2) 100%)',
        boxShadow: '0 0 0 1px rgba(74,101,232,0.2)',
      },
      nodeMainRow: { display: 'flex', alignItems: 'center', gap: 16 },
      rankBadge: {
        width: 36,
        height: 36,
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-secondary)',
        border: '0.5px solid var(--dsw-alias-border-l4)',
      },
      rankBadgePrimary: {
        background: 'linear-gradient(135deg, #4A65E8 0%, #324ecc 100%)',
        color: '#ffffff',
        borderColor: 'transparent',
        boxShadow: '0 2px 6px rgba(74,101,232,0.4)',
      },
      nodeContent: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      modelInfo: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      modelNameRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      modelName: { fontSize: 14.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      providerBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'var(--dsw-alias-bg-layer-4)', color: 'var(--dsw-alias-label-secondary)', border: '0.5px solid var(--dsw-alias-border-l2)', fontWeight: 500, fontFamily: 'var(--ds-font-family-code, monospace)', whiteSpace: 'nowrap', flexShrink: 0 },
      primaryBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'rgba(16,185,129,0.12)', color: 'var(--dsw-alias-state-success, #10b981)', border: '0.5px solid rgba(16,185,129,0.3)', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 },
      healthDots: { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 },
      healthDot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0, cursor: 'help' },
      dotHealthy: { background: 'var(--dsw-alias-state-success-primary, #22c55e)' },
      dotDegraded: { background: 'var(--dsw-alias-state-warn-primary, #f59e0b)' },
      dotUnhealthy: { background: 'var(--dsw-alias-state-error-primary, #ef4444)' },
      dotUnknown: { background: 'var(--dsw-alias-bg-layer-4)', border: '0.5px solid var(--dsw-alias-border-l3)' },
      modelPath: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'var(--ds-font-family-code, monospace)' },
      nodeTuning: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
      attemptPicker: { display: 'flex', alignItems: 'center', gap: 8, background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-md, 8px)', padding: '4px 10px', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flexShrink: 0 },
      stepperBtn: { width: 24, height: 24, borderRadius: 6, border: '0.5px solid var(--dsw-alias-border-l3)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'background 0.12s', flexShrink: 0, whiteSpace: 'nowrap' },
      attemptInput: { width: 26, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 700, textAlign: 'center', outline: 'none' },
      iconBtn: { width: 32, height: 32, borderRadius: 'var(--dsw-radius-md, 8px)', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, transition: 'background 0.15s, color 0.15s', flexShrink: 0 },
      iconBtnDisabled: { opacity: 0.25, cursor: 'not-allowed' },
      nodeActions: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
      connector: { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 8px 48px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
      connectorLine: { width: 2, alignSelf: 'stretch', minHeight: 22, background: 'linear-gradient(to bottom, var(--dsw-alias-brand-primary, #4A65E8), var(--dsw-alias-border-l3))', borderRadius: 1 },
      failoverTag: { background: 'var(--dsw-alias-bg-layer-3)', border: '0.5px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', borderRadius: 'var(--dsw-radius-sm, 8px)', padding: '2px 10px', fontWeight: 600, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 },
      addBar: { marginLeft: 48, display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' },
      catalogBtn: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-primary)', padding: '0 14px', height: 34, borderRadius: 'var(--dsw-radius-md, 8px)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background 0.15s', whiteSpace: 'nowrap', flexShrink: 0 },
      manualBtn: { boxSizing: 'border-box', background: 'transparent', border: '0.5px dashed var(--dsw-alias-border-l4)', color: 'var(--dsw-alias-label-secondary)', padding: '0 14px', height: 34, borderRadius: 'var(--dsw-radius-md, 8px)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 },
      tabBar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
      addProfileBtn: { boxSizing: 'border-box', border: '0.5px dashed var(--dsw-alias-border-l4)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '0 14px', height: 30, borderRadius: 'var(--dsw-radius-md, 8px)', fontSize: 12.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0, transition: 'border-color 0.15s, color 0.15s' },
      triggerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 8 },
      triggerCard: { background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-lg, 12px)', padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer', userSelect: 'none', transition: 'border-color 0.15s, background 0.15s, transform 0.12s', boxSizing: 'border-box' },
      triggerCardChecked: { borderColor: 'var(--dsw-alias-brand-primary)', background: 'rgba(74,101,232,0.06)' },
      triggerChk: { width: 17, height: 17, accentColor: 'var(--dsw-alias-brand-primary)', marginTop: 2, cursor: 'pointer', flexShrink: 0 },
      triggerName: { fontSize: 13.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      triggerCode: { fontSize: 11, fontFamily: 'var(--ds-font-family-code, monospace)', color: 'var(--dsw-alias-label-tertiary)', background: 'var(--dsw-alias-bg-layer-4)', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' },
      triggerDesc: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4, lineHeight: 1.45 },
      safetyBox: { marginTop: 16, padding: '14px 18px', borderRadius: 'var(--dsw-radius-md, 10px)', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l2)', display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 },
      budgetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
      budgetItem: { background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-lg, 12px)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, boxSizing: 'border-box' },
      budgetTitle: { fontSize: 13.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      budgetHint: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
      budgetInput: { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-sm, 8px)', padding: '4px 10px' },
      budgetInputField: { width: 44, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13.5, fontWeight: 600, textAlign: 'right', outline: 'none' },
      introBox: { background: 'rgba(74,101,232,0.08)', border: '0.5px solid rgba(74,101,232,0.25)', borderRadius: 'var(--dsw-radius-lg, 16px)', padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 14 },
      introTitle: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: '0 0 4px' },
      introDesc: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', margin: 0, lineHeight: 1.5 },
      problemsBox: { background: 'var(--dsw-alias-state-error-bg)', border: '0.5px solid var(--dsw-alias-state-error)', borderRadius: 'var(--dsw-radius-md, 12px)', padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.6 },
      discardBtn: { background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-secondary)', padding: '6px 14px', borderRadius: 'var(--dsw-radius-md, 12px)', fontSize: 13, cursor: 'pointer', marginBottom: 16 },
      formGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
      formLabel: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      formHint: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
      formInput: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-sm, 8px)', color: 'var(--dsw-alias-label-primary)', padding: '8px 12px', fontSize: 13, height: 36, outline: 'none', fontFamily: 'inherit' },
      catalogGroupTitle: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 6px' },
      catalogRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 'var(--dsw-radius-sm, 6px)', cursor: 'pointer', fontSize: 13, color: 'var(--dsw-alias-label-primary)', transition: 'background 0.12s ease' },
      countBadge: { fontSize: 11, padding: '1px 6px', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-4)', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      reasoningBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-tertiary)', border: '0.5px solid var(--dsw-alias-border-l2)', fontWeight: 500, whiteSpace: 'nowrap' },
      needsBtn: { boxSizing: 'border-box', background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', padding: '3px 10px', borderRadius: 'var(--dsw-radius-xs, 6px)', fontSize: 11.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0 },
      needsPanel: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 },
      needsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
      needCard: { background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm, 8px)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 },
      needHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      needHint: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.4 },
      needInput: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 4, color: 'var(--dsw-alias-label-primary)', padding: '3px 8px', fontSize: 12, height: 26, outline: 'none', width: 120 },
      drawerOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 250 },
      drawerPanel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '92vw', background: 'var(--dsw-alias-bg-layer-1)', borderLeft: '0.5px solid var(--dsw-alias-border-l4)', boxShadow: '-8px 0 36px rgba(0,0,0,0.5)', zIndex: 251, display: 'flex', flexDirection: 'column' },
      drawerHeader: { padding: '18px 24px', borderBottom: '0.5px solid var(--dsw-alias-border-l2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
      drawerBody: { padding: '16px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
      drawerHint: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', margin: 0 },
      drawerSession: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 },
      drawerEntry: { borderLeft: '2px solid var(--dsw-alias-brand-primary)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 3 },
      drawerEntryTime: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
      drawerEntryText: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

      // Sidebar action styles
      sidebarActionWide: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        height: 38,
        minHeight: 38,
        boxSizing: 'border-box',
        margin: 0,
        padding: '0 10px 0 8px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: 13.5,
        fontWeight: 500,
        lineHeight: '20px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background 0.15s ease',
      },
      sidebarActionRail: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        minHeight: 36,
        margin: '0 auto',
        padding: 0,
        border: 'none',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background 0.15s ease',
        position: 'relative',
      },
      sidebarLabel: { fontSize: 13.5, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      sidebarCountBadge: { fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flexShrink: 0 },
      railDirtyDot: { position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 4px #f59e0b' },

      // Modal window styles
      modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      },
      modalDialog: {
        width: 1000,
        maxWidth: '96vw',
        height: '88vh',
        maxHeight: 960,
        background: 'var(--dsw-alias-bg-layer-1, #18181c)',
        borderRadius: 'var(--dsw-radius-lg, 16px)',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      },
      modalTopBar: {
        padding: '12px 20px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-0, rgba(20,20,24,0.6))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        gap: 16,
      },
      modalTopTitle: { fontSize: 16, fontWeight: 700, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' },
      modalTopSubtitle: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      modalCloseBtn: {
        width: 32,
        height: 32,
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        transition: 'background 0.15s, color 0.15s',
        flexShrink: 0,
      },
      modalContentArea: {
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px 60px',
        boxSizing: 'border-box',
      },

      // Channel metrics & sparkline timeline styles
      channelMetricsCard: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '9px 14px',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.22))',
        border: '0.5px solid var(--dsw-alias-border-l3)',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        boxSizing: 'border-box',
        flexWrap: 'wrap',
      },
      healthTierCard: { background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsw-radius-md, 8px)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
      breakerChips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
      chipBtn: { boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2)', border: '0.5px solid var(--dsw-alias-border-l3)', color: 'var(--dsw-alias-label-secondary)', padding: '0 10px', height: 26, borderRadius: 'var(--dsw-radius-sm, 8px)', fontSize: 11.5, fontFamily: 'var(--ds-font-family-code, monospace)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
      breakerRuleRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
      strategyRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' },
      metricsColStatus: {
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 170,
      },
      metricsStatusHeader: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
      },
      metricsLabel: {
        fontSize: 11.5,
        fontWeight: 500,
        color: 'var(--dsw-alias-label-tertiary)',
        letterSpacing: '0.2px',
      },
      metricsStatusValue: {
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: 'var(--ds-font-family-code, monospace)',
      },
      timelineBarContainer: {
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        height: 14,
      },
      timelinePill: {
        width: 4,
        height: 14,
        borderRadius: 2,
        flexShrink: 0,
        transition: 'transform 0.1s ease, filter 0.1s ease',
        cursor: 'pointer',
      },
      metricsColValue: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        minWidth: 70,
      },
      metricsValNumber: {
        fontSize: 13.5,
        fontWeight: 700,
        fontFamily: 'var(--ds-font-family-code, monospace)',
        color: 'var(--dsw-alias-label-primary)',
      },
    }

    // ---------- helpers ----------

    function clone(value) {
      return JSON.parse(JSON.stringify(value))
    }
    function deepEqual(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }
    function routeOf(candidate) {
      return candidate.provider + '/' + candidate.model
    }
    function fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, function (_, key) { return String(vars[key]) })
    }
    function formatLatency(latencyMs) {
      if (typeof latencyMs !== 'number' || isNaN(latencyMs)) return '—'
      if (latencyMs >= 1000) return (latencyMs / 1000).toFixed(2) + 's'
      return Math.round(latencyMs) + 'ms'
    }
    function formatThroughput(tps) {
      if (typeof tps !== 'number' || isNaN(tps) || tps <= 0) return '—'
      return tps.toFixed(1) + 't/s'
    }
    function formatTime(ts) {
      if (!ts) return ''
      var d = new Date(ts)
      var hh = String(d.getHours()).padStart(2, '0')
      var mm = String(d.getMinutes()).padStart(2, '0')
      var ss = String(d.getSeconds()).padStart(2, '0')
      return hh + ':' + mm + ':' + ss
    }

    /** Client-side mirror of the host's structural checks, for a blocked save. */
    function validate(draft) {
      var problems = []
      var seen = new Set()
      draft.profiles.forEach(function (profile) {
        if (seen.has(profile.id)) problems.push({ key: 'problemDuplicateId', vars: { id: profile.id } })
        seen.add(profile.id)
        if (!profile.candidates.length) {
          problems.push({ key: 'problemEmptyChain', vars: { id: profile.id } })
        } else {
          var head = profile.candidates[0]
          if (head.provider !== profile.when.provider || head.model !== profile.when.model) {
            problems.push({ key: 'problemUnpinnedPrimary', vars: { id: profile.id, route: profile.when.provider + '/' + profile.when.model } })
          }
        }
        profile.candidates.forEach(function (candidate, index) {
          if (!candidate.provider || !candidate.model) problems.push({ key: 'problemEmptyRoute', vars: { id: profile.id, index: index + 1 } })
          if (!(candidate.maxAttempts >= 1 && candidate.maxAttempts <= 5)) problems.push({ key: 'problemBadMaxAttempts', vars: { id: profile.id, index: index + 1 } })
        })
        if (!(profile.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadTotal', vars: { id: profile.id } })
        if (!(profile.stickyTurns >= 0)) problems.push({ key: 'problemBadSticky', vars: { id: profile.id } })
      })
      if (!(draft.default.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadDefaultTotal', vars: {} })
      if (!(draft.default.stickyTurns >= 0)) problems.push({ key: 'problemBadDefaultSticky', vars: {} })
      // 与 host 的 assertStructural 保持同步：这里漏一条，用户就会存一个被 Host
      // 拒绝、且看不到原因的配置。
      if (draft.default.strategy === 'weight' && draft.default.candidates.every(function (c) { return !(c.weight > 0) })) {
        problems.push({ key: 'problemWeightNoPositive', vars: {} })
      }
      var breaker = draft.health && draft.health.breaker
      if (breaker && breaker.enabled) {
        breaker.rules.forEach(function (rule) {
          if (!rule.code && !rule.message) problems.push({ key: 'problemBreakerEmptyRule', vars: {} })
        })
      }
      return problems
    }

    /**
     * The four health tiers with their defaults, tolerating a legacy flat shape.
     *
     * A config saved before the rework carried `health: { enabled, prompt,
     * intervalMinutes, timeoutSeconds }`. Those minutes are converted rather than
     * dropped — silently losing a user's schedule is the same class of bug as the
     * save that never landed.
     */
    function normalizeHealth(value) {
      var health = value || {}
      var discover = health.discover || {}
      var probe = health.probe || {}
      var breaker = health.breaker || {}
      // 旧字段是分钟，新字段是秒；只在没有新字段时采用，避免覆盖已迁移的值。
      var legacyMinutes = typeof health.intervalMinutes === 'number' ? health.intervalMinutes : undefined
      var discoverSeconds = typeof discover.intervalSeconds === 'number'
        ? discover.intervalSeconds
        : legacyMinutes !== undefined ? legacyMinutes * 60 : 0
      var probeSeconds = typeof probe.intervalSeconds === 'number'
        ? probe.intervalSeconds
        : legacyMinutes !== undefined ? legacyMinutes * 60 : 0
      return {
        passive: health.passive !== false,
        discover: {
          enabled: discover.enabled === true,
          intervalSeconds: discoverSeconds,
        },
        probe: {
          enabled: probe.enabled === true,
          intervalSeconds: probeSeconds,
          prompt: typeof probe.prompt === 'string' && probe.prompt ? probe.prompt : '1',
          prompts: Array.isArray(probe.prompts) ? probe.prompts.slice() : [],
          timeoutSeconds: typeof probe.timeoutSeconds === 'number' ? probe.timeoutSeconds : 8,
        },
        breaker: {
          enabled: breaker.enabled === true,
          rules: Array.isArray(breaker.rules) ? breaker.rules.map(function (rule) {
            return {
              code: typeof rule.code === 'string' ? rule.code : '',
              message: typeof rule.message === 'string' ? rule.message : '',
              cooldownSeconds: typeof rule.cooldownSeconds === 'number' ? rule.cooldownSeconds : 300,
            }
          }) : [],
        },
      }
    }

    // ---------- controller ----------

    /**
     * The page's controller: a draft over the Host section, saved through
     * whole-section path ops. The Host is the only authority on acceptance, so
     * a save that did not land keeps the draft and the scope subscription
     * re-seeds from whatever the Host holds next.
     */
    function createController(ctx, scope, t) {
      var seed = function () {
        var value = scope.getSnapshot().value ?? {}
        return {
          enabled: value.enabled ?? true,
          profiles: normalizeProfiles(value.profiles),
          default: normalizeDefault(value.default),
          // A config saved by an older build carries the flat health shape; the
          // three tiers are re-derived here so one old row cannot leave the UI
          // reading `undefined` for a tier that has a perfectly good default.
          health: normalizeHealth(value.health),
        }
      }
      var host = seed()
      var draft = seed()
      var autoActive = true
      var ui = {
        activeId: null,
        modal: null,
        riskAck: false,
        catalog: null,
        catalogFailed: false,
        catalogLoading: false,
        drawerOpen: false,
        drawerLoading: false,
        drawerError: false,
        drawerRows: [],
        // Passive observation, folded by the host projection out of real
        // conversation outcomes. Keyed by route, merged across recent sessions.
        passive: {},
        // Verdicts from the last connectivity check, keyed by route. Ephemeral
        // by nature: a check answers "right now", so it is never persisted.
        discover: {},
        checking: false,
      }
      var saving = false
      var failed = false

      function project() {
        var snapshot = scope.getSnapshot()
        var problems = validate(draft)
        // The store freezes what it is given, so the published state must be a
        // detached snapshot: the controller keeps mutating its own draft.
        return {
          available: snapshot.status === 'ready',
          writable: snapshot.writable,
          dirty: !deepEqual(draft, host),
          invalid: problems.length > 0,
          saving: saving,
          failed: failed,
          draft: clone(draft),
          problems: problems,
          ui: {
            activeId: ui.activeId,
            modal: ui.modal,
            riskAck: ui.riskAck,
            catalog: ui.catalog,
            catalogFailed: ui.catalogFailed,
            catalogLoading: ui.catalogLoading,
            drawerOpen: ui.drawerOpen,
            drawerLoading: ui.drawerLoading,
            drawerError: ui.drawerError,
            drawerRows: ui.drawerRows,
            passive: ui.passive,
            discover: ui.discover,
            checking: ui.checking,
          },
          catalog: ui.catalog,
        }
      }
      var store = createSnapshotStore(project())
      function publish() { store.set(project()); armDiscoverTimer() }

      /**
       * 定时连通性检查。跑在浏览器/桌面壳里，所以只在整个 DSH 界面开着的时候有效——
       * 这一点在设置里写明了，不假装是后台常驻。周期由用户按自己渠道的限流承受
       * 能力定，插件不设下限：限流是每个渠道各自的，不是几个渠道加起来算的。
       */
      var discoverTimer = null
      var armedSeconds = -1
      function armDiscoverTimer() {
        var health = draft.health || {}
        var seconds = health.discover && health.discover.enabled ? (health.discover.intervalSeconds || 0) : 0
        if (seconds === armedSeconds) return
        armedSeconds = seconds
        if (discoverTimer !== null) { clearInterval(discoverTimer); discoverTimer = null }
        if (seconds > 0) discoverTimer = setInterval(function () { controller.checkAll() }, seconds * 1000)
      }

      /** Load the model catalog on first use; the modals render the loading state. */
      function ensureCatalog() {
        if (ui.catalog !== null || ui.catalogLoading) return
        ui.catalogLoading = true
        publish()
        ctx.remote.session.modelCatalog().then(function (result) {
          // Remote calls resolve to the `{ ok, value }` envelope, not the bare
          // value (the ui-settings-models / ui-model-selection precedent).
          if (!result.ok) throw new Error(result.error?.message ?? 'model catalog refused')
          ui.catalog = result.value
          ui.catalogLoading = false
          publish()
        }).catch(function () {
          ui.catalogFailed = true
          ui.catalogLoading = false
          publish()
        })
      }

      /**
       * Read the host projection's passive records. Health is a cross-session
       * fact, so this merges the same window the failover drawer reads rather
       * than pretending one session is the whole story.
       */
      function loadPassive() {
        var session = ctx.remote && ctx.remote.session
        if (!session) return
        session.list({}).then(function (result) {
          if (!result.ok) return
          var sessions = (result.value?.items ?? []).slice()
            .sort(function (a, b) { return (b.updatedAt ?? 0) - (a.updatedAt ?? 0) })
            .slice(0, 20)
          return Promise.all(sessions.map(function (entry) {
            return session.projections({ sessionId: entry.sessionId }).then(function (read) {
              // The live read is `{ asOfSeq, values }`; a migration-required
              // read carries cached values only. Either way the key is read
              // straight out of `values` — no `kind` gate (the wire payload
              // does not carry one).
              var values = read.ok && read.value !== null ? (read.value.values ?? {}) : {}
              var records = values['router/channel-health']
              if (records) {
                // 先拷贝再写入：store 的 set 会 dev-freeze 它收到的对象，之后往
                // 原对象上赋值在 dev 构建里会静默失败（圆点永远显示"未探测"）。
                ui.passive = Object.assign({}, ui.passive, records)
              }
            }).catch(function () {})
          }))
        }).then(function () { publish() }).catch(function () {})
      }
      loadPassive()

      /**
       * Connectivity check: ask one route for its model list through DSH's own
       * discovery remote — the same call the Models page's "fetch available
       * models" button makes. It sends no content, so it costs no tokens, and
       * it proves three things a stale config cannot: the endpoint answers,
       * the credential is accepted, and this model id is advertised.
       *
       * The request names only the namespace and the route. A configured route
       * supplies its own endpoint and credential inside the Host, so the client
       * reads the namespace from `listConfigurableProviders` and the stored
       * baseURL from `settings.describe` — both are DSH's own reads, which is why
       * this never guesses a provider's settings shape.
       */
      /**
       * provider → (settingsNs, baseURL) 的映射。这是配置事实，可以缓存；但缓存
       * 必须在 Host 推送新配置时作废，否则用户后来加的 provider 会一直查不到。
       * 探测本身不缓存——每一轮都重新问，那才是"定时检查"的意义。
       */
      var discoverFacts = null

      function loadDiscoverFacts() {
        if (discoverFacts !== null) return Promise.resolve(discoverFacts)
        var llm = ctx.remote && ctx.remote.llm
        var settings = ctx.remote && ctx.remote.settings
        if (!llm || !settings) return Promise.resolve(null)
        return Promise.all([
          llm.listConfigurableProviders(),
          settings.describe(),
        ]).then(function (results) {
          var providers = results[0] && results[0].ok ? results[0].value : []
          var namespaces = results[1] && results[1].ok ? results[1].value.namespaces : []
          var byNs = {}
          namespaces.forEach(function (entry) { byNs[entry.ns] = entry })
          var facts = {}
          providers.forEach(function (entry) {
            var namespace = byNs[entry.settingsNs]
            if (namespace === undefined) return
            var profile = namespace.value
            for (var i = 0; i < entry.settingsPath.length; i++) {
              profile = profile && typeof profile === 'object' ? profile[entry.settingsPath[i]] : undefined
            }
            if (profile === undefined || profile === null || typeof profile !== 'object') return
            facts[entry.provider] = {
              settingsNs: entry.settingsNs,
              baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
            }
          })
          discoverFacts = facts
          return facts
        }).catch(function () {
          discoverFacts = null
          return null
        })
      }

      /** Ask one route whether its endpoint answers and advertises this model. */      function checkRoute(provider, model) {
        return loadDiscoverFacts().then(function (facts) {
          if (facts === null) return { kind: 'unavailable', reason: 'discoveryUnavailable' }
          var fact = facts[provider]
          if (fact === undefined) return { kind: 'unavailable', reason: 'notConfigurable' }
          var request = { provider: provider }
          if (fact.baseURL !== undefined) request.baseURL = fact.baseURL
          return ctx.remote.llm.discoverModels(fact.settingsNs, request).then(function (response) {
            if (!response.ok) return { kind: 'unreachable', reason: response.error.message }
            var models = response.value || []
            return models.some(function (entry) { return entry.id === model })
              ? { kind: 'reachable' }
              : { kind: 'notAdvertised', advertised: models.length }
          })
        }).catch(function (error) {
          return { kind: 'unreachable', reason: String(error && error.message ? error.message : error) }
        })
      }

      scope.subscribe(function () {
        host = seed()
        draft = seed()
        failed = false
        // 配置变了，provider 目录也可能变了：旧的端点映射不能再拿去问。
        discoverFacts = null
        // The first snapshot can arrive after the controller was built (status
        // loading, no value), so the active tab is re-established here too.
        ensureActive()
        publish()
      })

      function activeProfile() {
        if (ui.activeId === '__default__') return null
        return draft.profiles.find(function (profile) { return profile.id === ui.activeId }) ?? draft.profiles[0] ?? null
      }
      /**
       * Re-establish the active tab while it is still auto-managed: the first
       * scope snapshot can arrive after the controller was built (status
       * loading, no value), and an explicit user pick always wins.
       */
      function ensureActive() {
        if (!autoActive) return
        ui.activeId = draft.profiles.length ? draft.profiles[0].id : '__default__'
      }
      ensureActive()

      var controller = {
        store: store,
        setEnabled: function (value) { draft.enabled = value; publish() },
        setActive: function (id) { ui.activeId = id; autoActive = false; publish() },
        discard: function () {
          draft = seed()
          failed = false
          publish()
        },
        save: function () {
          if (saving || !scope.getSnapshot().writable) return
          if (validate(draft).length) { publish(); return }
          saving = true
          failed = false
          publish()
          scope.mutate([
            { op: 'set', path: ['enabled'], value: draft.enabled },
            { op: 'set', path: ['profiles'], value: draft.profiles },
            { op: 'set', path: ['default'], value: draft.default },
            { op: 'set', path: ['health'], value: draft.health },
          ], scope.getSnapshot().revision).then(function (accepted) {
            saving = false
            failed = !accepted
            publish()
          })
        },
        addProfile: function (when, templateId) {
          var id = 'profile-' + String(draft.profiles.length + 1)
          while (draft.profiles.some(function (profile) { return profile.id === id })) {
            id = id + '-x'
          }
          var template = draft.profiles.find(function (profile) { return profile.id === templateId })
          var candidates = template
            ? template.candidates.map(function (candidate) { return clone(candidate) })
            : [{ provider: when.provider, model: when.model, maxAttempts: 2 }]
          candidates[0] = { provider: when.provider, model: when.model, maxAttempts: 2 }
          draft.profiles.push({
            id: id,
            when: { provider: when.provider, model: when.model },
            candidates: candidates,
            switchOn: defaultSwitchOn(),
            maxTotalAttempts: 6,
            stickyTurns: 0,
          })
          ui.activeId = id
          ui.modal = null
          publish()
        },
        deleteProfile: function (id) {
          draft.profiles = draft.profiles.filter(function (profile) { return profile.id !== id })
          ui.modal = null
          ui.riskAck = false
          ensureActive()
          publish()
        },
        addCandidates: function (profileId, entries, isDefault) {
          var list = isDefault ? draft.default.candidates : (draft.profiles.find(function (p) { return p.id === profileId }) ?? {}).candidates
          entries.forEach(function (entry) {
            list.push({ provider: entry.provider, model: entry.model, maxAttempts: 1 })
          })
          ui.modal = null
          publish()
        },
        removeCandidate: function (profileId, index, isDefault) {
          if (index <= 0) return
          var list = isDefault ? draft.default.candidates : draft.profiles.find(function (p) { return p.id === profileId }).candidates
          list.splice(index, 1)
          publish()
        },
        moveCandidate: function (profileId, index, direction, isDefault) {
          if (index <= 0) return
          var list = isDefault ? draft.default.candidates : draft.profiles.find(function (p) { return p.id === profileId }).candidates
          var target = index + direction
          if (target < 1 || target >= list.length) return
          var swapped = list[target]
          list[target] = list[index]
          list[index] = swapped
          publish()
        },
        setMaxAttempts: function (profileId, index, value, isDefault) {
          var list = isDefault ? draft.default.candidates : draft.profiles.find(function (p) { return p.id === profileId }).candidates
          var candidate = list[index]
          var parsed = Number(value)
          candidate.maxAttempts = Number.isFinite(parsed) ? Math.min(5, Math.max(1, Math.round(parsed))) : 1
          publish()
        },
        /** Patch one candidate's `needs`; an empty patch clears the field. */
        setNeeds: function (profileId, index, patch, isDefault) {
          var list = isDefault ? draft.default.candidates : draft.profiles.find(function (p) { return p.id === profileId }).candidates
          var candidate = list[index]
          var next = Object.assign({}, candidate.needs ?? {})
          // images 三态：require/forbid 各设一极，any 删掉这个字段。
          if (patch.imagesMode !== undefined) {
            if (patch.imagesMode === 'require') next.images = true
            else if (patch.imagesMode === 'forbid') next.images = false
            else delete next.images
          }
          if (patch.minContextTokens !== undefined) {
            if (patch.minContextTokens > 0) next.minContextTokens = patch.minContextTokens
            else delete next.minContextTokens
          }
          candidate.needs = Object.keys(next).length > 0 ? next : undefined
          publish()
        },
        setStickyTurns: function (profileId, value, isDefault) {
          var parsed = Number(value)
          var clamped = Number.isFinite(parsed) ? Math.min(99, Math.max(0, Math.round(parsed))) : 0
          if (isDefault) draft.default.stickyTurns = clamped
          else draft.profiles.find(function (p) { return p.id === profileId }).stickyTurns = clamped
          publish()
        },
        setMaxTotalAttempts: function (profileId, value, isDefault) {
          var parsed = Number(value)
          var clamped = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1
          if (isDefault) draft.default.maxTotalAttempts = clamped
          else draft.profiles.find(function (p) { return p.id === profileId }).maxTotalAttempts = clamped
          publish()
        },
        toggleSwitchOn: function (profileId, key, isDefault) {
          var target = isDefault ? draft.default.switchOn : draft.profiles.find(function (p) { return p.id === profileId }).switchOn
          target[key] = !target[key]
          publish()
        },
        setStrategy: function (value) {
          // 策略只管起点，所以名单本身不动——只改"从哪条开始"。
          if (draft.default.enabled && activeProfile() === null) draft.default.strategy = value
          else {
            var profile = activeProfile()
            if (profile !== null) profile.strategy = value
          }
          publish()
        },
        setWeight: function (index, value, isDefault) {
          var parsed = Number(value)
          var clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0
          var list = isDefault ? draft.default.candidates : activeProfile().candidates
          if (list[index] !== undefined) list[index].weight = clamped
          publish()
        },
        setDefaultEnabled: function (value) { draft.default.enabled = value; publish() },
        openModal: function (modal) {
          ui.modal = modal
          ui.riskAck = false
          // The catalog is loaded lazily: at apply time the host may still be
          // registering adapters, and an early read caches an empty catalog
          // forever.
          if (modal.kind === 'new-profile' || modal.kind === 'catalog') ensureCatalog()
          publish()
        },
        closeModal: function () { ui.modal = null; ui.riskAck = false; publish() },
        setRiskAck: function (value) { ui.riskAck = value; publish() },
        /** Open the drawer and load the recent failover ledger across sessions. */
        openDrawer: function () {
          ui.drawerOpen = true
          ui.drawerLoading = true
          ui.drawerError = false
          ui.drawerRows = []
          publish()
          ctx.remote.session.list({}).then(function (result) {
            if (!result.ok) throw new Error('session list refused')
            var sessions = (result.value?.items ?? []).slice()
              .sort(function (a, b) { return (b.updatedAt ?? 0) - (a.updatedAt ?? 0) })
              .slice(0, 20)
            return Promise.all(sessions.map(function (session) {
              return ctx.remote.session.projections({ sessionId: session.sessionId }).then(function (read) {
                // The live read is `{ asOfSeq, values }`; a migration-required
                // read carries cached values only. Either way the key is read
                // straight out of `values` — no `kind` gate (the wire payload
                // does not carry one).
                var values = read.ok && read.value !== null ? (read.value.values ?? {}) : {}
                var records = values['router/channel-health']
                if (records) ui.passive = Object.assign({}, ui.passive, records)
                return { sessionId: session.sessionId, entries: values['router/failover-history'] ?? [] }
              })
            }))
          }).then(function (rows) {
            ui.drawerRows = rows.filter(function (row) { return row.entries.length > 0 })
            ui.drawerLoading = false
            publish()
          }).catch(function () {
            ui.drawerError = true
            ui.drawerLoading = false
            publish()
          })
        },
        closeDrawer: function () { ui.drawerOpen = false; publish() },
        /** Run a connectivity check on every configured route: profiles and the default pool alike. */
        checkAll: function () {
          if (ui.checking) return
          ui.checking = true
          publish()
          var routes = {}
          var collect = function (candidate) {
            var key = routeOf(candidate)
            if (routes[key]) return
            routes[key] = { provider: candidate.provider, model: candidate.model }
          }
          draft.profiles.forEach(function (profile) {
            profile.candidates.forEach(collect)
          })
          ;(draft.default.candidates || []).forEach(collect)
          var keys = Object.keys(routes)
          Promise.all(keys.map(function (key) {
            var route = routes[key]
            return checkRoute(route.provider, route.model).then(function (verdict) {
              // 先拷贝后写入——store 的 set 会 dev-freeze 它收到的对象，往原对象
              // 上赋值在 dev 构建里会静默失败。
              ui.discover = Object.assign({}, ui.discover)
              ui.discover[key] = verdict
            })
          })).then(function () {
            ui.checking = false
            publish()
          }).catch(function () {
            ui.checking = false
            publish()
          })
        },
        updateHealth: function (patch) {
          draft.health = Object.assign({}, draft.health, patch)
          publish()
        },
        openHealthModal: function () {
          ui.modal = { kind: 'health' }
          publish()
        },
        /** 供插件半包卸载时调用：停掉定时轮询，别留下孤儿 interval。 */
        dispose: function () {
          if (discoverTimer !== null) { clearInterval(discoverTimer); discoverTimer = null }
          armedSeconds = -1
        },
      }
      return controller
    }

    // ---------- components ----------

    function Icon(props) {
      return h('svg', {
        width: props.size ?? 14,
        height: props.size ?? 14,
        viewBox: '0 0 16 16',
        fill: 'currentColor',
        style: Object.assign({ flexShrink: 0 }, props.spin ? { animation: 'dsh-spin 1s linear infinite' } : null),
      }, h('path', { d: props.d }))
    }
    function ModelRouterIcon(props) {
      var size = props.size ?? 18
      var color = props.color ?? 'currentColor'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        strokeWidth: '1.4',
        style: { flexShrink: 0 },
      },
        h('circle', { cx: '2.7', cy: '8', r: '1.45', stroke: color }),
        h('path', { d: 'M3.9 7.2 C 6.2 6.2 7.6 5.2 9.2 4.4', stroke: color, strokeLinecap: 'round' }),
        h('circle', { cx: '12.7', cy: '3.4', r: '1.45', stroke: color }),
        h('path', { d: 'M3.9 8.8 C 6.4 9.8 8 11 11.2 12.5', stroke: color, strokeLinecap: 'round' }),
        h('circle', { cx: '12.7', cy: '12.6', r: '1.45', stroke: color }))
    }

    var ICON_UP = 'm8 3.5 4 4.5H4z'
    var ICON_DOWN = 'm8 12.5-4-4.5h8z'
    var ICON_CLOSE = 'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z'
    var ICON_WARN = 'M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z'
    var ICON_SAVE = 'M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.5a.5.5 0 0 0-.146-.354l-2.5-2.5A.5.5 0 0 0 12 1H2zm0 1h9.293L13.5 4.207V14H2V2zm3 0v4h6V2H5zm1 1h4v2H6V3zM4 9h8v4H4V9z'
    var ICON_CHECK = 'M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z'
    var ICON_CLOCK = 'M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0-1A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm.5-9a.5.5 0 0 0-1 0v4.293l2.854 1.712a.5.5 0 0 0 .515-.858L8.5 7.82V5z'
    var ICON_UNDO = 'M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1zM8 4.414V1.586a.5.5 0 0 1 .854-.353l2.414 2.414a.5.5 0 0 1 0 .706L8.854 6.768A.5.5 0 0 1 8 6.414V4.414z'
    var ICON_PLUS = 'M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z'
    var ICON_MINUS = 'M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z'
    var ICON_ARROW_DOWN = 'M8 3.5a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.793V4a.5.5 0 0 1 .5-.5z'
    var ICON_SPINNER = 'M8 1.5a6.5 6.5 0 1 0 6.5 6.5A.75.75 0 0 0 13 8a5 5 0 1 1-5-5 .75.75 0 0 0 0-1.5z'
    var ICON_BOLT = 'M8.5 1.5 3 9h4.5L6.5 14.5 13 7H8.5z'
    var ICON_GEAR = 'M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311a1.464 1.464 0 0 1-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.86z'

    /** The catalog's reasoning efforts for one route, for the node badge. */
    function reasoningLabelOf(catalog, provider, model) {
      var group = (catalog?.groups ?? []).find(function (entry) { return entry.id === provider })
      var entry = (group?.models ?? []).find(function (item) { return item.id === model })
      var efforts = entry?.reasoning?.efforts
      if (!efforts || efforts.length === 0) return undefined
      return efforts.map(function (effort) { return effort.name }).join(' / ')
    }

    /**
     * One dot for one way of knowing a channel's state. There is deliberately
     * no combined lamp: "the door is open" and "it can actually answer" are
     * different facts, and folding them into one light would be this plugin
     * deciding on the user's behalf which evidence to trust.
     *
     * A dot only appears for a dimension the user turned on, so a channel the
     * user only passively observes shows one dot, never three grey ones.
     */
    function HealthDot(props) {
      var t = props.t
      var tone = props.tone
      var style = tone === 'healthy' ? S.dotHealthy
        : tone === 'degraded' ? S.dotDegraded
          : tone === 'unhealthy' ? S.dotUnhealthy
            : S.dotUnknown
      return h('span', { style: Object.assign({}, S.healthDot, style), title: props.title ?? '' })
    }

    /** The three dots for one route, each from its own dimension. */
    function HealthDots(props) {
      var t = props.t
      var route = props.route
      var passive = props.passive ? props.passive[route] : undefined
      var discover = props.discover ? props.discover[route] : undefined
      var showPassive = props.showPassive !== false
      var showDiscover = props.showDiscover === true
      var dots = []
      if (showPassive) {
        if (passive === undefined) {
          dots.push(h(HealthDot, { key: 'passive', t: t, tone: 'unknown', title: t('passiveNeverObserved') }))
        } else {
          var detail = t(passive.status === 'healthy' ? 'healthStatusHealthy' : passive.status === 'degraded' ? 'healthStatusDegraded' : 'healthStatusUnhealthy')
          if (typeof passive.latencyMs === 'number') detail += ' · ' + passive.latencyMs + 'ms'
          if (typeof passive.throughputTps === 'number') detail += ' · ' + passive.throughputTps.toFixed(1) + 't/s'
          if (passive.lastError) detail += ' · ' + passive.lastError
          dots.push(h(HealthDot, {
            key: 'passive',
            t: t,
            tone: passive.status,
            title: t('passiveDotTitle') + '：' + detail,
          }))
        }
      }
      if (showDiscover) {
        if (discover === undefined) {
          dots.push(h(HealthDot, { key: 'discover', t: t, tone: 'unknown', title: t('connectivityNotRun') }))
        } else if (discover.kind === 'reachable') {
          dots.push(h(HealthDot, { key: 'discover', t: t, tone: 'healthy', title: t('connectivityReachable') }))
        } else if (discover.kind === 'notAdvertised') {
          dots.push(h(HealthDot, {
            key: 'discover',
            t: t,
            tone: 'degraded',
            title: t('connectivityNotAdvertised') + '（' + t('connectivityAdvertisedCount') + ' ' + discover.advertised + '）',
          }))
        } else if (discover.kind === 'unavailable') {
          dots.push(h(HealthDot, {
            key: 'discover',
            t: t,
            tone: 'unknown',
            title: discover.reason === 'notConfigurable' ? t('connectivityNotConfigurable') : t('connectivityUnavailable'),
          }))
        } else {
          dots.push(h(HealthDot, { key: 'discover', t: t, tone: 'unhealthy', title: t('connectivityUnreachable') + '：' + discover.reason }))
        }
      }
      return h('span', { style: S.healthDots }, dots)
    }

    /** Sparkline timeline and metrics dashboard matching channel monitor specification. */
    function ChannelMetricsDashboard(props) {
      var t = props.t
      var record = props.record
      var timeline = (record && Array.isArray(record.timeline)) ? record.timeline : []
      var latencyMs = record ? record.latencyMs : undefined
      var throughputTps = record ? record.throughputTps : undefined

      var slots = []
      var padCount = Math.max(0, 24 - timeline.length)
      for (var i = 0; i < padCount; i++) {
        slots.push({ isIdle: true })
      }
      var recent = timeline.length > 24 ? timeline.slice(-24) : timeline
      for (var j = 0; j < recent.length; j++) {
        slots.push(recent[j])
      }

      var barElements = slots.map(function (item, idx) {
        if (item.isIdle) {
          return h('div', {
            key: 'bar-' + idx,
            className: 'dsh-timeline-pill',
            style: Object.assign({}, S.timelinePill, { background: 'var(--dsw-alias-bg-layer-4, rgba(255, 255, 255, 0.08))' }),
            title: t('healthBarIdle'),
          })
        }
        // DSH's own state tokens, so the bars follow the active theme instead
        // of hard-coded hex that only looks right on one of them.
        var barBg = 'var(--dsw-alias-state-success-primary, #22c55e)'
        var statusLabel = t('healthStatusHealthy')
        if (item.status === 'degraded') {
          barBg = 'var(--dsw-alias-state-warn-primary, #f59e0b)'
          statusLabel = t('healthStatusDegraded')
        } else if (item.status === 'unhealthy') {
          barBg = 'var(--dsw-alias-state-error-primary, #ef4444)'
          statusLabel = t('healthStatusUnhealthy')
        }
        var tip = '[' + formatTime(item.time) + '] ' + statusLabel
        if (typeof item.latencyMs === 'number') tip += ' · ' + formatLatency(item.latencyMs)
        if (typeof item.throughputTps === 'number' && item.throughputTps > 0) tip += ' · ' + formatThroughput(item.throughputTps)
        if (item.error) tip += ' (' + item.error + ')'

        return h('div', {
          key: 'bar-' + idx,
          className: 'dsh-timeline-pill',
          style: Object.assign({}, S.timelinePill, { background: barBg }),
          title: tip,
        })
      })

      return h('div', { style: S.channelMetricsCard },
        h('div', { style: S.metricsColStatus },
          h('div', { style: S.metricsStatusHeader },
            h('span', { style: S.metricsLabel }, t('healthMetricHistory')),
            h('span', { style: S.metricsStatusValue }, String(timeline.length) + '/' + 24)),
          h('div', { style: S.timelineBarContainer }, barElements)),
        h('div', { style: S.metricsColValue },
          h('span', { style: S.metricsLabel }, t('healthMetricLatency')),
          h('span', { style: S.metricsValNumber }, formatLatency(latencyMs))),
        h('div', { style: S.metricsColValue },
          h('span', { style: S.metricsLabel }, t('healthMetricThroughput')),
          h('span', { style: S.metricsValNumber }, formatThroughput(throughputTps))))
    }

    /** One candidate node in the pipeline. */
    function CandidateNode(props) {
      var t = props.t
      var candidate = props.candidate
      var index = props.index
      var isPrimary = index === 0 && !props.isDefault
      var expandedState = React.useState(false)
      var expanded = expandedState[0]
      var setExpanded = expandedState[1]
      var needs = candidate.needs ?? {}
      // images 是三态：undefined = 不限，true/false 各限一极，都算“配了条件”。
      var hasActiveNeeds = (needs.images !== undefined) || (needs.minContextTokens > 0)
      var imagesMode = needs.images === true ? 'require' : needs.images === false ? 'forbid' : 'any'
      var reasoning = reasoningLabelOf(props.catalog, candidate.provider, candidate.model)
      return h('div', { style: S.node },
        h('div', { style: Object.assign({}, S.nodeCard, isPrimary ? S.nodeCardPrimary : null) },
          h('div', { style: S.nodeMainRow },
            h('div', { style: Object.assign({}, S.rankBadge, isPrimary ? S.rankBadgePrimary : null) },
              isPrimary ? '★' : String(index + 1).padStart(2, '0')),
            h('div', { style: S.nodeContent },
              h('div', { style: S.modelInfo },
                h('div', { style: S.modelNameRow },
                  h('span', { style: S.modelName, title: candidate.model }, candidate.model || '—'),
                  h('span', { style: S.providerBadge }, candidate.provider),
                  isPrimary ? h('span', { style: S.primaryBadge }, '👑 ' + t('primaryModelBadge')) : null,
                  h(HealthDots, {
                    t: t,
                    route: routeOf(candidate),
                    passive: props.passive,
                    discover: props.discover,
                    showPassive: props.showPassive,
                    showDiscover: props.showDiscover,
                  }),
                  reasoning === undefined ? null : h('span', { style: S.reasoningBadge }, t('reasoningBadge') + ': ' + reasoning),
                  h('button', {
                    type: 'button',
                    style: Object.assign({}, S.needsBtn, hasActiveNeeds ? { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' } : null),
                    'aria-expanded': expanded,
                    onClick: function () { setExpanded(!expanded) },
                  }, hasActiveNeeds ? '⚙️ ● ' + t('toggleNeedsBtn') : '⚙️ ' + t('toggleNeedsBtn'))),
                h('span', { style: S.modelPath }, routeOf(candidate))),
              h('div', { style: S.nodeTuning },
                h('div', { style: S.attemptPicker, title: t('attemptLimitHint') },
                  h('span', { style: { whiteSpace: 'nowrap' } }, t('singleAttemptLimit')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-router-stepper-btn',
                    style: Object.assign({}, S.stepperBtn, (props.disabled || candidate.maxAttempts <= 1) ? { opacity: 0.35, cursor: 'not-allowed' } : null),
                    disabled: props.disabled || candidate.maxAttempts <= 1,
                    title: t('stepMinus'),
                    onClick: function () { props.onMaxAttempts(index, Math.max(1, candidate.maxAttempts - 1)) },
                  }, h(Icon, { d: ICON_MINUS, size: 10 })),
                  h('input', {
                    style: S.attemptInput,
                    type: 'text',
                    inputMode: 'numeric',
                    maxLength: 2,
                    'aria-label': t('singleAttemptLimit') + ' (' + t('attemptRangeHint') + ')',
                    value: String(candidate.maxAttempts),
                    disabled: props.disabled,
                    onChange: function (event) { props.onMaxAttempts(index, event.target.value) },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dsh-router-stepper-btn',
                    style: Object.assign({}, S.stepperBtn, (props.disabled || candidate.maxAttempts >= 5) ? { opacity: 0.35, cursor: 'not-allowed' } : null),
                    disabled: props.disabled || candidate.maxAttempts >= 5,
                    title: t('stepPlus'),
                    onClick: function () { props.onMaxAttempts(index, Math.min(5, candidate.maxAttempts + 1)) },
                  }, h(Icon, { d: ICON_PLUS, size: 10 })),
                  h('span', { style: { whiteSpace: 'nowrap' } }, t('timesUnit'))))),
            // 权重只在「按权重」策略下出现；其他策略下它不被读，摆着只会让人以为有用。
            props.showWeight ? h('div', { style: S.attemptPicker, title: t('weightHint') },
              h('span', { style: { whiteSpace: 'nowrap' } }, t('weightLabel')),
              h('input', {
                style: S.attemptInput,
                type: 'text',
                inputMode: 'numeric',
                maxLength: 3,
                'aria-label': t('weightLabel'),
                value: String(candidate.weight || 0),
                disabled: props.disabled,
                onChange: function (event) { props.onWeight(index, event.target.value) },
              }),
              h('span', { style: { whiteSpace: 'nowrap' } }, props.weightShare + '%')) : null,
            h('div', { style: S.nodeActions },
              h('button', {
                type: 'button',
                className: 'dsh-router-icon-btn',
                style: Object.assign({}, S.iconBtn, index <= 0 ? S.iconBtnDisabled : null),
                disabled: index <= 0 || props.disabled,
                title: isPrimary ? t('primaryPinnedHint') : t('moveUp'),
                onClick: function () { props.onMove(index, -1) },
              }, h(Icon, { d: ICON_UP })),
              h('button', {
                type: 'button',
                className: 'dsh-router-icon-btn',
                style: Object.assign({}, S.iconBtn, index >= props.total - 1 ? S.iconBtnDisabled : null),
                disabled: index >= props.total - 1 || props.disabled,
                title: t('moveDown'),
                onClick: function () { props.onMove(index, 1) },
              }, h(Icon, { d: ICON_DOWN })),
              h('button', {
                type: 'button',
                className: 'dsh-router-icon-btn',
                style: Object.assign({}, S.iconBtn, index <= 0 ? S.iconBtnDisabled : null),
                disabled: index <= 0 || props.disabled,
                title: isPrimary ? t('primaryPinnedHint') : t('removeNode'),
                onClick: function () { props.onRemove(index) },
              }, h(Icon, { d: ICON_CLOSE })))),
          h(ChannelMetricsDashboard, { t: t, record: props.passive ? props.passive[routeOf(candidate)] : null }),
          expanded ? h('div', { style: S.needsPanel },
            h('div', { style: S.needsGrid },
              h('div', { style: S.needCard },
                h('div', { style: S.needHeader },
                  h('span', null, t('needImagesTitle')),
                  h(SegmentedTabs, {
                    items: [
                      { value: 'any', label: t('needImagesAnyLabel'), id: 'images-any-' + index, panelId: 'images-any-panel-' + index },
                      { value: 'require', label: t('needImagesRequireLabel'), id: 'images-require-' + index, panelId: 'images-require-panel-' + index },
                      { value: 'forbid', label: t('needImagesForbidLabel'), id: 'images-forbid-' + index, panelId: 'images-forbid-panel-' + index },
                    ],
                    value: imagesMode,
                    onChange: function (value) { props.onNeeds(index, { imagesMode: value }) },
                  })),
                h('span', { style: S.needHint }, t('needImagesHint'))),
              h('div', { style: S.needCard },
                h('div', { style: S.needHeader }, h('span', null, t('needContextTitle'))),
                h('input', {
                  style: S.needInput,
                  type: 'text',
                  inputMode: 'numeric',
                  placeholder: '0',
                  'aria-label': t('needContextTitle'),
                  value: String(needs.minContextTokens ?? 0),
                  disabled: props.disabled,
                  onChange: function (event) {
                    var parsed = Number(event.target.value)
                    props.onNeeds(index, { minContextTokens: Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0 })
                  },
                }),
                h('span', { style: S.needHint }, t('needContextHint'))))) : null))
    }

    /** The failure-code labels live in the dictionaries; the drawer shows the code verbatim when a key is missing. */
    function codeLabel(t, code) {
      return t('code' + code)
    }

    /** The failover-history drawer: a body-portaled panel over the plugin page. */
    function FailoverDrawer(props) {
      var t = props.t
      var ui = props.state.ui
      var rows = ui.drawerRows
      var body = []
      if (ui.drawerLoading) body.push(h('p', { key: 'loading', style: S.drawerHint }, t('failoverHistoryLoading')))
      else if (ui.drawerError) body.push(h('button', { key: 'retry', type: 'button', style: S.manualBtn, onClick: props.onReload }, t('failoverHistoryRetry')))
      else if (rows.length === 0) body.push(h('p', { key: 'empty', style: S.drawerHint }, t('failoverHistoryEmpty')))
      else {
        rows.forEach(function (row, rowIndex) {
          if (rowIndex > 0) body.push(h('div', { key: 'sep' + rowIndex, style: { height: 1, background: 'var(--dsw-alias-border-l2)', margin: '12px 0' } }))
          body.push(h('div', { key: 's' + rowIndex, style: S.drawerSession }, t('failoverSessionLabel') + ' ' + String(row.sessionId).slice(0, 8)))
          row.entries.forEach(function (entry, index) {
            body.push(h('div', { key: 'e' + rowIndex + '_' + index, style: S.drawerEntry },
              h('div', { style: S.drawerEntryTime }, new Date(entry.time).toLocaleString()),
              h('div', { style: S.drawerEntryText },
                '主模型 ' + entry.from + ' 失败（' + codeLabel(t, entry.code) + '），切换至 ' + entry.to,
                h('span', { style: Object.assign({}, S.failoverTag, entry.settled ? null : { color: 'var(--dsw-alias-state-warn)' }) },
                  entry.settled ? t('failoverEntrySettled') : t('failoverEntryUnsettled')))))
          })
        })
      }
      return ReactDOM.createPortal(
        h('div', { style: S.drawerOverlay },
          h('div', { style: S.drawerPanel, role: 'dialog', 'aria-label': t('failoverHistoryDrawerTitle') },
            h('div', { style: S.drawerHeader },
              h('h3', { style: { fontSize: 15, fontWeight: 600, margin: 0 } }, t('failoverHistoryDrawerTitle')),
              h('button', { type: 'button', style: S.iconBtn, 'aria-label': t('close'), onClick: props.onClose }, h(Icon, { d: ICON_CLOSE }))),
            h('div', { style: S.drawerBody },
              h('p', { style: S.drawerHint }, t('failoverHistoryHint')),
              body))),
        document.body,
      )
    }

    /** The failover connector between two nodes. */
    function Connector(props) {
      var t = props.t
      return h('div', { style: S.connector },
        h('div', { style: S.connectorLine }),
        h('span', { style: S.failoverTag },
          h(Icon, { d: ICON_ARROW_DOWN, size: 11 }),
          t('failoverTag') + ' #' + String(props.toIndex)),
        h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('failoverNotice')))
    }

    /** The ordered pipeline editor for one chain. */
    function PipelineEditor(props) {
      var t = props.t
      var candidates = props.candidates
      var strategy = props.strategy === 'weight' || props.strategy === 'round-robin' ? props.strategy : 'order'
      var weightTotal = candidates.reduce(function (sum, c) { return sum + Math.max(0, c.weight || 0) }, 0)
      var nodes = []
      candidates.forEach(function (candidate, index) {
        if (index > 0) nodes.push(h(Connector, { key: 'c' + index, t: t, toIndex: index }))
        nodes.push(h(CandidateNode, {
          key: 'n' + index,
          t: t,
          candidate: candidate,
          index: index,
          total: candidates.length,
          isDefault: props.isDefault,
          disabled: props.disabled,
          catalog: props.catalog,
          passive: props.passive,
          discover: props.discover,
          showPassive: props.showPassive,
          showDiscover: props.showDiscover,
          // 权重只在「按权重」策略下出现——其他策略下它不被读，摆着只会让人以为有用。
          showWeight: strategy === 'weight',
          weightShare: strategy === 'weight' && weightTotal > 0 ? Math.round((Math.max(0, candidate.weight || 0) / weightTotal) * 100) : 0,
          onMaxAttempts: props.onMaxAttempts,
          onWeight: props.onWeight,
          onMove: props.onMove,
          onRemove: props.onRemove,
          onNeeds: props.onNeeds,
        }))
      })
      return h('div', null,
        h('div', { style: S.strategyRow },
          h('span', { style: S.formLabel }, t('strategyLabel')),
          h(SegmentedTabs, {
            items: STRATEGY_OPTIONS.map(function (entry) {
              return { value: entry, label: t('strategy' + entry), id: 'strategy-' + entry, panelId: 'strategy-panel-' + entry }
            }),
            value: strategy,
            onChange: function (value) { if (props.onStrategy) props.onStrategy(value) },
          })),
        h('p', { style: S.formHint }, t('strategySharedHint')),
        h('p', { style: S.formHint }, t('strategyHint' + strategy)),
        nodes)
    }

    /** The six switchOn cards. */
    function SwitchOnGrid(props) {
      var t = props.t
      return h('div', null,
        h('div', { style: S.triggerGrid },
          SWITCH_ON_CODES.map(function (entry) {
            var on = Boolean(props.value[entry.key])
            return h('label', {
              key: entry.key,
              className: 'dsh-router-trigger-card',
              style: Object.assign({}, S.triggerCard, on ? S.triggerCardChecked : null),
            },
              h('input', {
                type: 'checkbox',
                style: S.triggerChk,
                checked: on,
                disabled: props.disabled,
                onChange: function () { props.onToggle(entry.key) },
              }),
              h('div', { style: { flex: 1 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: S.triggerName }, t(entry.labelKey + 'Name')),
                  h('span', { style: S.triggerCode }, entry.code)),
                h('div', { style: S.triggerDesc }, t(entry.labelKey + 'Desc'))))
          })),
        h('div', { style: S.safetyBox },
          h(Icon, { d: ICON_WARN, size: 16 }),
          h('div', null,
            h('strong', null, t('safetyNoticeTitle')),
            ' ' + t('safetyNoticeText'))))
    }

    /** The budget row: editable total cap, editable sticky turns, read-only backoff badge. */
    function BudgetRow(props) {
      var t = props.t
      return h('div', { style: S.budgetGrid },
        h('div', { style: S.budgetItem },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.budgetTitle }, t('maxTotalAttempts')),
            h('span', { style: S.budgetHint }, t('maxTotalAttemptsHint'))),
          h('div', { style: S.budgetInput },
            h('input', {
              style: S.budgetInputField,
              type: 'text',
              inputMode: 'numeric',
              maxLength: 2,
              'aria-label': t('maxTotalAttempts'),
              value: String(props.maxTotalAttempts),
              disabled: props.disabled,
              onChange: function (event) { props.onMaxTotal(event.target.value) },
            }),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('timesUnit')))),
        props.stickyTurns === undefined ? null : h('div', { style: S.budgetItem },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.budgetTitle }, t('stickyTurns')),
            h('span', { style: S.budgetHint }, t('stickyTurnsHint'))),
          h('div', { style: S.budgetInput },
            h('input', {
              style: S.budgetInputField,
              type: 'text',
              inputMode: 'numeric',
              maxLength: 2,
              'aria-label': t('stickyTurns'),
              value: String(props.stickyTurns),
              disabled: props.disabled,
              onChange: function (event) { props.onStickyTurns(event.target.value) },
            }),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('turnsUnit')))),
        h('div', { style: S.budgetItem },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.budgetTitle }, t('backoffTitle')),
            h('span', { style: S.budgetHint }, t('backoffHint'))),
          h(Tag, { tone: 'neutral' }, t('backoffBadge'))))
    }

    /** One profile's view: pipeline, switchOn, budget. */
    function ProfileView(props) {
      var t = props.t
      var profile = props.profile
      return h('div', null,
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('pipelineTitle')),
              h('p', { style: S.sectionSubtitle }, t('pipelineSubtitle'))),
            h('button', {
              type: 'button',
              className: 'dsh-router-danger-btn',
              style: S.dangerBtn,
              onClick: function () { props.onDeleteProfile(profile.id) },
            }, t('deleteProfileBtn'))),
          h(PipelineEditor, {
            t: t,
            candidates: profile.candidates,
            strategy: profile.strategy,
            onStrategy: function (value) { props.onStrategy(value) },
            disabled: props.disabled,
            catalog: props.catalog,
            passive: props.passive,
            discover: props.discover,
            showPassive: props.showPassive,
            showDiscover: props.showDiscover,
            onMaxAttempts: function (index, value) { props.onMaxAttempts(profile.id, index, value, false) },
            onMove: function (index, direction) { props.onMove(profile.id, index, direction, false) },
            onRemove: function (index) { props.onRemove(profile.id, index, false) },
            onNeeds: function (index, patch) { props.onNeeds(profile.id, index, patch, false) },
            onWeight: function (index, value) { props.onWeight(index, value, false) },
          }),
          h('div', { style: S.safetyBox },
            h(Icon, { d: ICON_WARN, size: 16 }),
            h('div', null,
              h('strong', null, t('visionWorkflowTitle')),
              ' ' + t('visionWorkflowText'))),
          h('div', { style: S.addBar },
            h('button', { type: 'button', className: 'dsh-router-catalog-btn', style: S.catalogBtn, disabled: props.disabled, onClick: function () { props.onOpenCatalog(profile.id, false) } }, t('addFromCatalog')),
            h('button', { type: 'button', className: 'dsh-router-manual-btn', style: S.manualBtn, disabled: props.disabled, onClick: function () { props.onOpenManual(profile.id, false) } }, t('addManual')))),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('switchOnTitle')),
              h('p', { style: S.sectionSubtitle }, t('switchOnSubtitle')))),
          h(SwitchOnGrid, {
            t: t,
            value: profile.switchOn,
            disabled: props.disabled,
            onToggle: function (key) { props.onToggleSwitchOn(profile.id, key, false) },
          })),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('budgetTitle')),
              h('p', { style: S.sectionSubtitle }, t('budgetSubtitle')))),
          h(BudgetRow, {
            t: t,
            maxTotalAttempts: profile.maxTotalAttempts,
            stickyTurns: profile.stickyTurns,
            disabled: props.disabled,
            onMaxTotal: function (value) { props.onMaxTotal(profile.id, value, false) },
            onStickyTurns: function (value) { props.onStickyTurns(profile.id, value, false) },
          })))
    }

    /** The default fallback pool's view. */
    function DefaultView(props) {
      var t = props.t
      var pool = props.pool
      return h('div', null,
        h('div', { style: S.introBox },
          h(Icon, { d: ICON_WARN, size: 20 }),
          h('div', null,
            h('h3', { style: S.introTitle }, t('defaultProfileIntroTitle')),
            h('p', { style: S.introDesc }, t('defaultProfileIntroDesc')))),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('defaultProfileSwitchLabel')),
              h('p', { style: S.sectionSubtitle }, t('defaultProfileSwitchDesc')))),
          h(Switch, {
            checked: pool.enabled,
            label: t('defaultProfileSwitchLabel'),
            disabled: props.disabled,
            onChange: function (next) { props.onDefaultEnabled(next) },
          })),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h3', { style: Object.assign({}, S.sectionTitle, { fontSize: 13.5 }) }, t('defaultPoolTitle')),
              h('p', { style: S.sectionSubtitle }, t('defaultPoolSubtitle')))),
          h(PipelineEditor, {
            t: t,
            candidates: pool.candidates,
            strategy: pool.strategy,
            isDefault: true,
            disabled: props.disabled,
            catalog: props.catalog,
            passive: props.passive,
            discover: props.discover,
            showPassive: props.showPassive,
            showDiscover: props.showDiscover,
            onStrategy: props.onStrategy,
            onMaxAttempts: function (index, value) { props.onMaxAttempts(null, index, value, true) },
            onMove: function (index, direction) { props.onMove(null, index, direction, true) },
            onRemove: function (index) { props.onRemove(null, index, true) },
            onNeeds: function (index, patch) { props.onNeeds(null, index, patch, true) },
            onWeight: function (index, value) { props.onWeight(index, value, true) },
          }),
          h('div', { style: S.addBar },
            h('button', { type: 'button', className: 'dsh-router-catalog-btn', style: S.catalogBtn, disabled: props.disabled, onClick: function () { props.onOpenCatalog(null, true) } }, t('addFromCatalog')),
            h('button', { type: 'button', className: 'dsh-router-manual-btn', style: S.manualBtn, disabled: props.disabled, onClick: function () { props.onOpenManual(null, true) } }, t('addManual')))),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('switchOnTitle')),
              h('p', { style: S.sectionSubtitle }, t('switchOnSubtitle')))),
          h(SwitchOnGrid, {
            t: t,
            value: pool.switchOn,
            disabled: props.disabled,
            onToggle: function (key) { props.onToggleSwitchOn(null, key, true) },
          })),
        h('section', { style: S.card },
          h('div', { style: S.sectionHeader },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('h2', { style: S.sectionTitle }, t('budgetTitle')),
              h('p', { style: S.sectionSubtitle }, t('budgetSubtitle')))),
          h(BudgetRow, {
            t: t,
            maxTotalAttempts: pool.maxTotalAttempts,
            stickyTurns: pool.stickyTurns,
            disabled: props.disabled,
            onMaxTotal: function (value) { props.onMaxTotal(null, value, true) },
            onStickyTurns: function (value) { props.onStickyTurns(null, value, true) },
          })))
    }

    /** Health Settings Modal dialog. */
    /**
     * Health settings: three independent tiers, each with its own switch.
     *
     * The plugin does not pick a winner between them. Runtime observation is
     * free but only knows the past; a connectivity check sends no content and
     * present; a real probe is the only thing that proves a model can answer,
     * and it costs tokens — so the user decides which of those they want.
     */
    /**
     * Health settings: the tiers the user can actually choose between.
     *
     * Runtime observation and the connectivity check are offered. Sending a
     * test message is described but not offered — it needs a browser-to-host
     * channel this plugin cannot declare without a build step, and a switch
     * that saves while doing nothing is the same lie as a save that never
     * landed.
     */
    function HealthSettingsModal(props) {
      var t = props.t
      var health = props.health || {}
      var discover = health.discover || {}
      var [passiveOn, setPassiveOn] = React.useState(health.passive !== false)
      var [discoverOn, setDiscoverOn] = React.useState(discover.enabled === true)
      var [discoverInterval, setDiscoverInterval] = React.useState(String(discover.intervalSeconds ?? 0))
      var breaker = health.breaker || {}
      var [breakerOn, setBreakerOn] = React.useState(breaker.enabled === true)
      var [rules, setRules] = React.useState((breaker.rules || []).map(function (rule) {
        return { code: rule.code || '', message: rule.message || '', cooldownSeconds: rule.cooldownSeconds ?? 300 }
      }))

      function patchRule(index, patch) {
        var next = rules.slice()
        next[index] = Object.assign({}, next[index], patch)
        setRules(next)
      }

      function intervalOf(text) {
        var n = Math.round(Number(text))
        return isFinite(n) && n > 0 ? n : 0
      }

      return h(Modal, {
        open: true,
        title: t('healthModalTitle'),
        closeLabel: t('close'),
        onClose: props.onClose,
        footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
          h(Button, {
            variant: 'primary',
            onClick: function () {
              // The probe tier is not offered, so whatever a previous save left
              // in it is preserved rather than overwritten with defaults.
              var current = props.health || {}
              props.onUpdateHealth({
                passive: passiveOn,
                discover: { enabled: discoverOn, intervalSeconds: intervalOf(discoverInterval) },
                probe: current.probe,
                breaker: {
                  enabled: breakerOn,
                  rules: rules.filter(function (rule) { return rule.code || rule.message }),
                },
              })
              props.onClose()
            },
          }, t('formSave'))),
      },
        h('div', { style: S.introBox },
          h(Icon, { d: ICON_WARN, size: 20 }),
          h('div', null,
            h('h3', { style: S.introTitle }, t('healthSectionTitle')),
            h('p', { style: S.introDesc }, t('healthTiersIntro')))),

        // --- Tier 1: runtime observation ---
        h('div', { style: Object.assign({}, S.formGroup, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }) },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.formLabel }, t('healthPassiveLabel')),
            h('span', { style: S.formHint }, t('healthPassiveHint'))),
          h(Switch, {
            checked: passiveOn,
            label: t('healthPassiveLabel'),
            onChange: function (next) { setPassiveOn(next) },
          })),

        // --- Tier 2: connectivity check ---
        h('div', { style: S.healthTierCard },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('span', { style: S.formLabel }, t('healthDiscoverLabel')),
              h('span', { style: S.formHint }, t('healthDiscoverHint'))),            h(Switch, {
              checked: discoverOn,
              label: t('healthDiscoverLabel'),
              onChange: function (next) { setDiscoverOn(next) },
            })),
          h('div', { style: S.formGroup },
            h('span', { style: S.formLabel }, t('healthDiscoverIntervalLabel')),
            h('span', { style: S.formHint }, t('healthDiscoverIntervalHint')),
            h('input', {
              style: S.formInput,
              type: 'text',
              inputMode: 'numeric',
              placeholder: '0',
              'aria-label': t('healthDiscoverIntervalLabel'),
              value: discoverInterval,
              onChange: function (event) { setDiscoverInterval(event.target.value) },
            }))),

        // --- Tier 3: real probe ---
        h('div', { style: S.healthTierCard },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('span', { style: S.formLabel }, t('healthProbeLabel')),
              h('span', { style: S.formHint }, t('healthProbeHint'))),
            h(Switch, {
              checked: false,
              disabled: true,
              label: t('healthProbeLabel'),
            })),
          // The tier is described, not offered: a switch that saves but does
          // nothing is the same lie as the save that never landed. Its settings
          // come back with the channel that makes them mean something.
          h('p', { style: S.formHint }, t('healthProbeUnavailable'))),

        // --- Tier 4: circuit breaker ---
        h('div', { style: S.healthTierCard },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              h('span', { style: S.formLabel }, t('breakerLabel')),
              h('span', { style: S.formHint }, t('breakerHint'))),
            h(Switch, {
              checked: breakerOn,
              label: t('breakerLabel'),
              onChange: function (next) { setBreakerOn(next) },
            })),
          h('p', { style: S.formHint }, t('breakerSharedHint')),
          breakerOn ? h('div', { style: S.formGroup },
            h('span', { style: S.formLabel }, t('breakerRulesLabel')),
            h('span', { style: S.formHint }, t('breakerRulesHint')),
            h('div', { style: S.breakerChips },
              BREAKER_CODE_PRESETS.map(function (preset) {
                var exists = rules.some(function (rule) { return rule.code === preset.code && !rule.message })
                return h('button', {
                  key: preset.code,
                  type: 'button',
                  className: 'dsh-router-catalog-btn',
                  style: Object.assign({}, S.chipBtn, exists ? { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' } : null),
                  disabled: exists,
                  title: exists ? t('breakerAlreadyAdded') : preset.desc,
                  onClick: function () {
                    setRules(rules.concat([{ code: preset.code, message: '', cooldownSeconds: preset.seconds }]))
                  },
                }, preset.code)
              })),
            rules.map(function (rule, index) {
              return h('div', { key: 'br' + index, style: S.breakerRuleRow },
                h('input', {
                  style: Object.assign({}, S.formInput, { flex: 1 }),
                  type: 'text',
                  placeholder: t('breakerCodePlaceholder'),
                  'aria-label': t('breakerCodeLabel'),
                  value: rule.code,
                  onChange: function (event) { patchRule(index, { code: event.target.value }) },
                }),
                h('input', {
                  style: Object.assign({}, S.formInput, { flex: 1 }),
                  type: 'text',
                  placeholder: t('breakerMessagePlaceholder'),
                  'aria-label': t('breakerMessageLabel'),
                  value: rule.message,
                  onChange: function (event) { patchRule(index, { message: event.target.value }) },
                }),
                h('input', {
                  style: Object.assign({}, S.formInput, { width: 76 }),
                  type: 'text',
                  inputMode: 'numeric',
                  placeholder: '300',
                  'aria-label': t('breakerCooldownLabel'),
                  value: String(rule.cooldownSeconds),
                  onChange: function (event) { patchRule(index, { cooldownSeconds: event.target.value }) },
                }),
                h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' } }, t('breakerSecondsUnit')),
                h('button', {
                  type: 'button',
                  style: S.iconBtn,
                  title: t('breakerRemoveRule'),
                  'aria-label': t('breakerRemoveRule'),
                  onClick: function () {
                    var next = rules.slice()
                    next.splice(index, 1)
                    setRules(next)
                  },
                }, h(Icon, { d: ICON_CLOSE })))
            }),
            h('button', {
              type: 'button',
              style: Object.assign({}, S.manualBtn, { marginTop: 8 }),
              onClick: function () { setRules(rules.concat([{ code: '', message: '', cooldownSeconds: 300 }])) },
            }, t('breakerAddRule'))) : null)
      )
    }

    /** New-profile dialog: pick an unconfigured model, choose a template. */
    function NewProfileModal(props) {
      var t = props.t
      var configured = props.configured
      var options = []
      ;(props.catalog?.groups ?? []).forEach(function (group) {
        group.models.forEach(function (model) {
          var route = group.id + '/' + model.id
          if (configured.some(function (entry) { return entry === route })) return
          options.push({ value: route, label: group.name + ' / ' + model.name + '  (' + route + ')' })
        })
      })
      var [target, setTarget] = React.useState('')
      var [manual, setManual] = React.useState(false)
      var [provider, setProvider] = React.useState('')
      var [model, setModel] = React.useState('')
      var [templateId, setTemplateId] = React.useState('')
      var manualRoute = provider.trim() && model.trim() ? provider.trim() + '/' + model.trim() : ''
      var canCreate = manual ? Boolean(manualRoute) : Boolean(target)
      return h(Modal, {
        open: true,
        title: t('newProfileModalTitle'),
        closeLabel: t('close'),
        onClose: props.onClose,
        footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
          h(Button, {
            variant: 'primary',
            disabled: !canCreate,
            onClick: function () {
              if (!canCreate) return
              var route = manual ? manualRoute : target
              var slash = route.indexOf('/')
              props.onCreate({
                provider: route.slice(0, slash),
                model: route.slice(slash + 1),
              }, templateId)
            },
          }, t('confirmCreateProfile'))),
      },
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('targetModelLabel')),
          h('span', { style: S.formHint }, t('targetModelHint')),
          props.catalog === null ? h('span', { style: S.formHint }, t('catalogLoading')) : null,
          options.length === 0 && props.catalog !== null ? h('span', { style: S.formHint }, t('noUnconfiguredModels')) : null,
          props.catalog !== null ? h('select', {
            style: S.formInput,
            value: manual ? '__manual__' : target,
            onChange: function (event) {
              if (event.target.value === '__manual__') { setManual(true); return }
              setManual(false)
              setTarget(event.target.value)
            },
          },
            h('option', { value: '' }, '—'),
            options.map(function (option) {
              return h('option', { key: option.value, value: option.value }, option.label)
            }),
            h('option', { value: '__manual__' }, t('manualTargetOption'))) : null,
          manual ? h('div', { style: { display: 'flex', gap: 8 } },
            h('input', {
              style: Object.assign({}, S.formInput, { flex: 1 }),
              placeholder: 'provider',
              'aria-label': t('providerLabel'),
              value: provider,
              onChange: function (event) { setProvider(event.target.value) },
            }),
            h('input', {
              style: Object.assign({}, S.formInput, { flex: 1 }),
              placeholder: 'model',
              'aria-label': t('modelIdLabel'),
              value: model,
              onChange: function (event) { setModel(event.target.value) },
            })) : null),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('templateLabel')),
          h('select', {
            style: S.formInput,
            value: templateId,
            onChange: function (event) { setTemplateId(event.target.value) },
          },
            h('option', { value: '' }, t('templateBlank')),
            props.profiles.map(function (profile) {
              return h('option', { key: profile.id, value: profile.id }, t('templateCopy') + '：' + profile.when.provider + '/' + profile.when.model)
            }))))
    }

    /** Manual candidate dialog: provider checked against the registered list. */
    /**
     * 手动添加候选：provider 只能从已注册的里选，model 自由输入。
     *
     * provider 名是人猜不出来的——写错不会报错，只会在运行时被静默跳过，所以这里
     * 根本不给他打错的机会。模型 ID 相反：网关支持的模型常常不在任何目录里，所以
     * 保留自由输入，只用目录里的同名模型做建议（datalist），不强制。
     */
    function ManualChannelModal(props) {
      var t = props.t
      var registered = props.routableProviders ?? []
      var [provider, setProvider] = React.useState('')
      var [model, setModel] = React.useState('')
      var [maxAttempts, setMaxAttempts] = React.useState('1')
      // 目录里这个 provider 的模型，仅作为输入建议，不影响能否保存。
      var group = (props.catalog?.groups ?? []).find(function (entry) { return entry.id === provider })
      var suggestions = (group?.models ?? []).map(function (entry) { return entry.id })
      var canAdd = provider !== '' && model.trim() !== ''
      return h(Modal, {
        open: true,
        title: t('manualModalTitle'),
        closeLabel: t('close'),
        onClose: props.onClose,
        footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
          h(Button, {
            variant: 'primary',
            disabled: !canAdd,
            onClick: function () {
              if (!canAdd) return
              props.onAdd([{ provider: provider, model: model.trim(), maxAttempts: Math.min(5, Math.max(1, Number(maxAttempts) || 1)) }])
            },
          }, t('confirmAddManual'))),
      },
        registered.length === 0
          ? h('p', { style: S.formHint }, t('manualNoRegisteredProvider'))
          : h('div', { style: S.formGroup },
            h('span', { style: S.formLabel }, t('providerLabel')),
            h('span', { style: S.formHint }, t('providerSelectHint')),
            h('select', {
              style: S.formInput,
              'aria-label': t('providerLabel'),
              value: provider,
              onChange: function (event) { setProvider(event.target.value) },
            },
              h('option', { value: '' }, t('providerPickPlaceholder')),
              registered.map(function (id) { return h('option', { key: id, value: id }, id) }))),
        registered.length === 0 ? null : h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('modelIdLabel')),
          h('span', { style: S.formHint }, t('modelIdFreeHint')),
          h('input', {
            style: S.formInput,
            list: 'dsh-router-model-suggestions',
            placeholder: suggestions.length > 0 ? suggestions[0] : 'deepseek-ai/DeepSeek-V3',
            'aria-label': t('modelIdLabel'),
            value: model,
            onChange: function (event) { setModel(event.target.value) },
          }),
          suggestions.length > 0 ? h('datalist', { id: 'dsh-router-model-suggestions' },
            suggestions.map(function (id) { return h('option', { key: id, value: id }) })) : null),
        registered.length === 0 ? null : h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('singleAttemptLimit') + ' (' + t('attemptRangeHint') + ')'),
          h('input', {
            style: S.formInput,
            type: 'text',
            inputMode: 'numeric',
            maxLength: 2,
            'aria-label': t('singleAttemptLimit'),
            value: maxAttempts,
            onChange: function (event) { setMaxAttempts(event.target.value) },
          })))
    }

    /** Catalog picker dialog: search, grouped multi-select, adopt. */
    function CatalogPickerModal(props) {
      var t = props.t
      var [query, setQuery] = React.useState('')
      var [selected, setSelected] = React.useState({})
      var groups = props.catalog?.groups ?? []
      var needle = query.trim().toLowerCase()
      var entries = []
      groups.forEach(function (group) {
        var models = group.models.filter(function (model) {
          if (needle === '') return true
          return model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle) || group.name.toLowerCase().includes(needle)
        })
        if (models.length > 0) entries.push({ group: group, models: models })
      })
      var selectedCount = Object.keys(selected).length
      return h(Modal, {
        open: true,
        title: t('catalogModalTitle'),
        closeLabel: t('close'),
        onClose: props.onClose,
        footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
          h(Button, {
            variant: 'primary',
            disabled: selectedCount === 0,
            onClick: function () {
              var picked = Object.keys(selected).map(function (route) {
                var slash = route.indexOf('/')
                return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
              })
              props.onAdd(picked)
            },
          }, t('adoptSelected') + (selectedCount > 0 ? ' (' + selectedCount + ')' : '')),
        ),
      },
        h('input', {
          style: S.formInput,
          type: 'search',
          placeholder: t('searchModelPlaceholder'),
          'aria-label': t('searchModelPlaceholder'),
          value: query,
          onChange: function (event) { setQuery(event.target.value) },
        }),
        props.catalog === null ? h('span', { style: S.formHint }, t('catalogLoading')) : null,
        entries.map(function (entry) {
          return h('div', { key: entry.group.id },
            h('div', { style: S.catalogGroupTitle }, entry.group.name),
            entry.models.map(function (model) {
              var route = entry.group.id + '/' + model.id
              return h('label', { key: route, style: S.catalogRow },
                h('input', {
                  type: 'checkbox',
                  style: Object.assign({}, S.triggerChk, { accentColor: 'var(--dsw-alias-brand-primary)' }),
                  checked: Boolean(selected[route]),
                  onChange: function () {
                    var next = Object.assign({}, selected)
                    if (next[route]) delete next[route]
                    else next[route] = true
                    setSelected(next)
                  },
                }),
                h('span', null, model.name),
                h('span', { style: S.providerBadge }, entry.group.id))
            }))
        }))
    }

    /** The whole config page. */
    function RouterPage(props) {
      var t = props.t
      var state = props.useRouterPage(function (snapshot) { return snapshot })
      if (props.view === 'summary') return t('pluginDesc')
      var draft = state.draft
      var disabled = !state.writable || state.saving
      var activeProfile = null
      if (state.ui.activeId !== '__default__') {
        activeProfile = draft.profiles.find(function (profile) { return profile.id === state.ui.activeId }) ?? draft.profiles[0] ?? null
      }
      var modal = state.ui.modal
      var routableProviders = state.catalog?.routableProviders ?? []
      var isModalView = Boolean(props.isModalView)

      // Shortcut: Ctrl+S / Cmd+S save
      React.useEffect(function () {
        function onKeyDown(e) {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault()
            if (state.dirty && state.writable && !state.saving && !state.invalid) {
              props.onSave()
            }
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return function () { window.removeEventListener('keydown', onKeyDown) }
      }, [state.dirty, state.writable, state.saving, state.invalid, props.onSave])

      return h('div', { className: 'dsh-router-page', style: isModalView ? S.pageModal : S.page },
        // Enhanced Sticky Action Header
        !isModalView ? h('header', { style: S.stickyHeader },
          h('div', { style: S.headerLeft },
            h(ModelRouterIcon, { size: 30, color: 'var(--dsw-alias-brand-primary, #4A65E8)' }),
            h('div', { style: S.headerTitles },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('h1', { style: S.titleRow }, t('pluginTitle')),
                h('span', { style: draft.enabled ? S.badgeRunning : S.badgePaused },
                  draft.enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
                state.dirty ? h('span', { style: S.badgeDirty }, '● ' + t('unsavedChangesBadge')) : null),
              h('p', { style: S.desc }, t('pluginDesc')))),
          h('div', { style: S.headerActions },
            h('button', {
              type: 'button',
              className: 'dsh-router-catalog-btn',
              style: Object.assign({}, S.catalogBtn, state.ui.checking ? { opacity: 0.6, cursor: 'wait' } : null),
              disabled: disabled || state.ui.checking,
              title: t('checkAllBtn'),
              onClick: props.onCheckAll,
            }, h(Icon, { d: state.ui.checking ? ICON_SPINNER : ICON_BOLT, size: 14, spin: state.ui.checking }), state.ui.checking ? t('checkingText') : t('checkAllBtn')),
            h('button', {
              type: 'button',
              className: 'dsh-router-catalog-btn',
              style: S.catalogBtn,
              disabled: disabled,
              title: t('healthConfigBtn'),
              onClick: props.onOpenHealthModal,
            }, h(Icon, { d: ICON_GEAR, size: 14 }), t('healthConfigBtn')),
            h('button', {
              type: 'button',
              className: 'dsh-router-catalog-btn',
              style: S.catalogBtn,
              onClick: props.onOpenDrawer,
            }, h(Icon, { d: ICON_CLOCK, size: 14 }), t('failoverHistoryButton')),
            h('div', { style: S.switchWrap },
              h('span', { style: S.switchLabel }, t('globalSwitchLabel')),
              h(Switch, {
                checked: draft.enabled,
                label: t('globalSwitchLabel'),
                disabled: disabled,
                title: t('globalSwitchDesc'),
                onChange: function (next) { props.onEnabled(next) },
              })),
            state.dirty ? h('button', {
              type: 'button',
              className: 'dsh-router-discard-btn',
              style: S.discardBtnHeader,
              disabled: disabled,
              onClick: props.onDiscard,
            }, h(Icon, { d: ICON_UNDO, size: 13 }), t('formDiscard')) : null,
            h('button', {
              type: 'button',
              className: 'dsh-router-save-btn',
              style: Object.assign({}, S.saveBtn,
                (state.dirty && state.writable && !state.saving && !state.invalid ? S.saveBtnHighlight : S.saveBtnDisabled)),
              disabled: !state.dirty || disabled || state.invalid,
              title: state.dirty ? t('saveShortcutHint') : t('savedStateTip'),
              onClick: props.onSave,
            },
              state.saving ? h(Icon, { d: ICON_SPINNER, size: 14, spin: true }) : (state.dirty ? h(Icon, { d: ICON_SAVE, size: 14 }) : h(Icon, { d: ICON_CHECK, size: 14 })),
              state.saving ? t('formSaving') : t('formSave'),
              state.dirty ? h('kbd', { style: S.kbdTag }, 'Ctrl+S') : null))) : null,

        // Top validation problems alert (if any)
        state.problems.length > 0 ? h('div', { style: S.problemsBox, role: 'alert' },
          h('strong', null, t('problemsTitle')),
          h('ul', { style: { margin: '4px 0 0', paddingLeft: 18 } },
            state.problems.map(function (problem, index) {
              return h('li', { key: index }, fill(t(problem.key), problem.vars))
            }))) : null,

        state.failed ? h('div', { style: S.problemsBox, role: 'alert' },
          h('strong', null, t('formSaveFailed'))) : null,

        // SettingsForm container (preserves lifecycle and bottom save contract)
        h(SettingsForm, {
          labels: {
            unavailable: t('formUnavailable'),
            readOnly: t('formReadOnly'),
            saveFailed: t('formSaveFailed'),
            save: t('formSave'),
            saving: t('formSaving'),
          },
          state: {
            available: state.available,
            writable: state.writable,
            dirty: state.dirty,
            invalid: state.invalid,
            saving: state.saving,
            failed: state.failed,
          },
          onSave: props.onSave,
          onDiscard: props.onDiscard,
        },
          h('section', { style: S.card },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dsw-alias-label-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 } }, t('profilesTitle')),
                h('span', { style: S.countBadge }, String(draft.profiles.length))),
              h('button', {
                type: 'button',
                className: 'dsh-router-add-profile-btn',
                style: S.addProfileBtn,
                disabled: disabled,
                onClick: function () { props.onOpenNewProfile() },
              }, h(Icon, { d: ICON_PLUS, size: 12 }), t('addProfile'))),
            h(SegmentedTabs, {
              items: draft.profiles.map(function (profile) {
                return {
                  value: profile.id,
                  label: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
                    h('span', { style: { fontWeight: 500 } }, profile.when.model),
                    h('span', { style: S.countBadge }, fill(t('candidateCountTag'), { n: profile.candidates.length }))),
                  id: 'tab-' + profile.id,
                  panelId: 'panel-' + profile.id,
                }
              }).concat([{
                value: '__default__',
                label: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
                  h('span', { style: { fontWeight: 500 } }, t('defaultProfileTab')),
                  h('span', { style: S.countBadge }, draft.default.enabled ? t('candidateCountTag').replace('{n}', String(draft.default.candidates.length)) : t('defaultProfileNotActive'))),
                id: 'tab-default',
                panelId: 'panel-default',
              }]),
              value: activeProfile === null ? '__default__' : activeProfile.id,
              onChange: function (value) { props.onActive(value) },
              label: t('profilesTitle'),
            })),
          activeProfile === null
            ? h(DefaultView, {
              t: t,
              pool: draft.default,
              disabled: disabled,
              catalog: state.catalog,
              passive: state.ui.passive,
              discover: state.ui.discover,
              showPassive: draft.health.passive !== false,
              showDiscover: draft.health.discover?.enabled === true,
              onDefaultEnabled: props.onDefaultEnabled,
              onStrategy: props.onStrategy,
              onWeight: props.onWeight,
              onMaxAttempts: props.onMaxAttempts,
              onMove: props.onMove,
              onRemove: props.onRemove,
              onMaxTotal: props.onMaxTotal,
              onToggleSwitchOn: props.onToggleSwitchOn,
              onNeeds: props.onNeeds,
              onOpenCatalog: props.onOpenCatalog,
              onOpenManual: props.onOpenManual,
            })
            : h(ProfileView, {
              t: t,
              profile: activeProfile,
              disabled: disabled,
              catalog: state.catalog,
              passive: state.ui.passive,
              discover: state.ui.discover,
              showPassive: draft.health.passive !== false,
              showDiscover: draft.health.discover?.enabled === true,
              onDeleteProfile: props.onDeleteProfile,
              onStrategy: props.onStrategy,
              onWeight: props.onWeight,
              onMaxAttempts: props.onMaxAttempts,
              onMove: props.onMove,
              onRemove: props.onRemove,
              onMaxTotal: props.onMaxTotal,
              onToggleSwitchOn: props.onToggleSwitchOn,
              onNeeds: props.onNeeds,
              onOpenCatalog: props.onOpenCatalog,
              onOpenManual: props.onOpenManual,
            })),



        modal !== null && modal.kind === 'health' ? h(HealthSettingsModal, {
          t: t,
          health: draft.health,
          onClose: props.onCloseModal,
          onUpdateHealth: props.onUpdateHealth,
        }) : null,
        modal !== null && modal.kind === 'new-profile' ? h(NewProfileModal, {
          t: t,
          catalog: state.catalog,
          catalogLoading: state.ui.catalogLoading,
          profiles: draft.profiles,
          configured: draft.profiles.map(function (profile) { return profile.when.provider + '/' + profile.when.model }),
          onClose: props.onCloseModal,
          onCreate: props.onCreateProfile,
        }) : null,
        modal !== null && modal.kind === 'manual' ? h(ManualChannelModal, {
          t: t,
          routableProviders: routableProviders,
          catalog: state.catalog,
          onClose: props.onCloseModal,
          onAdd: function (entries) { props.onAddCandidates(modal.profileId, entries, modal.isDefault) },
        }) : null,
        modal !== null && modal.kind === 'catalog' ? h(CatalogPickerModal, {
          t: t,
          catalog: state.catalog,
          catalogLoading: state.ui.catalogLoading,
          onClose: props.onCloseModal,
          onAdd: function (entries) { props.onAddCandidates(modal.profileId, entries, modal.isDefault) },
        }) : null,
        modal !== null && modal.kind === 'delete' ? h(RiskConfirmation, {
          open: true,
          title: t('riskConfirmTitle'),
          description: t('riskConfirmDesc'),
          acknowledgeLabel: t('riskConfirmCheckbox'),
          cancelLabel: t('cancel'),
          closeLabel: t('close'),
          confirmLabel: t('confirmDeleteBtn'),
          acknowledged: state.ui.riskAck,
          onAcknowledgedChange: props.onRiskAck,
          onCancel: props.onCloseModal,
          onConfirm: function () { props.onConfirmDelete(modal.profileId) },
        }) : null,
        state.ui.drawerOpen ? h(FailoverDrawer, {
          key: 'drawer',
          t: t,
          state: state,
          onClose: props.onCloseDrawer,
          onReload: props.onOpenDrawer,
        }) : null)
    }

    /** The sidebar entry button registered into `sidebar.footer.action`. */
    function ModelRouterFooterAction(props) {
      var t = props.t
      var state = props.useRouterPage(function (s) { return s })
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var isWide = Boolean(props.wide)
      var enabled = state?.draft?.enabled ?? true
      var dirty = state?.dirty ?? false
      var profileCount = (state?.draft?.profiles ?? []).length

      React.useEffect(function () {
        if (!open) return
        function handleKeyDown(e) {
          if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', handleKeyDown)
        return function () { window.removeEventListener('keydown', handleKeyDown) }
      }, [open])

      var buttonProps = {
        type: 'button',
        className: 'dsh-router-footer-action' + (isWide ? '' : ' rail'),
        style: isWide ? S.sidebarActionWide : S.sidebarActionRail,
        title: t('sidebarActionTooltip'),
        'aria-label': t('sidebarActionLabel'),
        'aria-expanded': open,
        onClick: function () { setOpen(true) },
      }

      var modalElement = open ? ReactDOM.createPortal(
        h('div', {
          style: S.modalOverlay,
          onClick: function (e) { if (e.target === e.currentTarget) setOpen(false) },
        },
          h('div', { className: 'dsh-router-modal-dialog', style: S.modalDialog, role: 'dialog', 'aria-modal': true },
            h('div', { style: S.modalTopBar },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
                h(ModelRouterIcon, { size: 24, color: 'var(--dsw-alias-brand-primary, #4A65E8)' }),
                h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h('span', { style: S.modalTopTitle }, t('quickModalTitle')),
                    h('span', {
                      style: enabled ? S.badgeRunning : S.badgePaused,
                    }, enabled ? '● ' + t('statusRunningBadge') : '○ ' + t('statusDisabledBadge')),
                    dirty ? h('span', { style: S.badgeDirty }, '● ' + t('unsavedChangesBadge')) : null,
                    state.failed ? h('span', { style: S.saveFailedBadge }, t('formSaveFailed')) : null),
                  h('span', { style: S.modalTopSubtitle }, t('pluginDesc')))),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
                h('button', {
                  type: 'button',
                  className: 'dsh-router-catalog-btn',
                  style: Object.assign({}, S.catalogBtn, state?.ui?.checking ? { opacity: 0.6, cursor: 'wait' } : null),
                  disabled: !state?.writable || state?.saving || state?.ui?.checking,
                  title: t('checkAllBtn'),
                  onClick: props.onCheckAll,
                }, h(Icon, { d: state?.ui?.checking ? ICON_SPINNER : ICON_BOLT, size: 14, spin: state?.ui?.checking }), state?.ui?.checking ? t('checkingText') : t('checkAllBtn')),
                h('button', {
                  type: 'button',
                  className: 'dsh-router-catalog-btn',
                  style: S.catalogBtn,
                  disabled: !state?.writable || state?.saving,
                  title: t('healthConfigBtn'),
                  onClick: props.onOpenHealthModal,
                }, h(Icon, { d: ICON_GEAR, size: 14 }), t('healthConfigBtn')),
                h('button', {
                  type: 'button',
                  className: 'dsh-router-catalog-btn',
                  style: S.catalogBtn,
                  onClick: props.onOpenDrawer,
                }, h(Icon, { d: ICON_CLOCK, size: 14 }), t('failoverHistoryButton')),
                dirty ? h('button', {
                  type: 'button',
                  className: 'dsh-router-discard-btn',
                  style: S.discardBtnHeader,
                  disabled: !state.writable || state.saving,
                  onClick: props.onDiscard,
                }, h(Icon, { d: ICON_UNDO, size: 13 }), t('formDiscard')) : null,
                h('button', {
                  type: 'button',
                  className: 'dsh-router-save-btn',
                  style: Object.assign({}, S.saveBtn, (!dirty || !state.writable || state.saving || state.invalid) ? S.saveBtnDisabled : S.saveBtnHighlight),
                  disabled: !dirty || !state.writable || state.saving || state.invalid,
                  title: dirty ? t('saveShortcutHint') : t('savedStateTip'),
                  onClick: props.onSave,
                },
                  state.saving ? h(Icon, { d: ICON_SPINNER, size: 14, spin: true }) : (dirty ? h(Icon, { d: ICON_SAVE, size: 14 }) : h(Icon, { d: ICON_CHECK, size: 14 })),
                  state.saving ? t('formSaving') : t('formSave'),
                  dirty ? h('kbd', { style: S.kbdTag }, 'Ctrl+S') : null),
                h('button', {
                  type: 'button',
                  className: 'dsh-router-modal-close-btn',
                  style: S.modalCloseBtn,
                  title: t('close'),
                  onClick: function () { setOpen(false) },
                }, h(Icon, { d: ICON_CLOSE, size: 16 })))),
            h('div', { style: S.modalContentArea },
              h(RouterPage, Object.assign({}, props, {
                isModalView: true,
                onCloseModalView: function () { setOpen(false) },
              }))))),
        document.body
      ) : null

      return h(React.Fragment, null,
        h('button', buttonProps,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h(ModelRouterIcon, { size: isWide ? 17 : 19, color: enabled ? 'var(--dsw-alias-brand-primary, #4A65E8)' : 'var(--dsw-alias-label-tertiary, #888)' }),
            isWide ? h('span', { style: S.sidebarLabel }, t('sidebarActionLabel')) : null),
          isWide
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                dirty ? h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }, title: t('unsavedChangesBadge') }) : null,
                h('span', { style: S.sidebarCountBadge }, String(profileCount)))
            : (dirty ? h('span', { style: S.railDirtyDot }) : null)),
        modalElement
      )
    }

    exports.name = NS + '/client'
    // `remote.llm` carries the connectivity check (DSH's own model discovery)
    // and `remote.settings` carries the endpoint facts it needs. Both are native
    // remotes — nothing here declares a remote of its own, because a plugin
    // remote needs a Typert contribution generated by a build step this
    // package does not have.
    exports.inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session', 'remote.llm', 'remote.settings']

    /**
     * Mount the config page for this bundle.
     * @param ctx - browser plugin context.
     */
    exports.apply = function apply(ctx) {
      // Labels come from this plugin's own dictionaries, bound by namespace —
      // never from the Config schema's `.description()`.
      var t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'router: dictionaries')
      ctx.effect(ensureStyles, 'router: global styles')
      // 定时器随插件半包的生命周期一起销毁，不在设置改动后留下孤儿轮询。
      // 它声明在 createController 里，所以由控制器交回 disposer，而不是在这里
      // 直接够那个变量——function 作用域够不到，只会在每次卸载时抛 ReferenceError。
      ctx.effect(function () {
        return function () { controller.dispose() }
      }, 'router: discover timer')

      var scope = ctx.configForms.get(CONFIG_NS)
      var controller = createController(ctx, scope, t)

      var actions = {
        onSave: function () { controller.save() },
        onDiscard: function () { controller.discard() },
        onEnabled: function (value) { controller.setEnabled(value) },
        onActive: function (id) { controller.setActive(id) },
        onDefaultEnabled: function (value) { controller.setDefaultEnabled(value) },
        onMaxAttempts: function (profileId, index, value, isDefault) { controller.setMaxAttempts(profileId, index, value, isDefault) },
        onNeeds: function (profileId, index, patch, isDefault) { controller.setNeeds(profileId, index, patch, isDefault) },
        onMove: function (profileId, index, direction, isDefault) { controller.moveCandidate(profileId, index, direction, isDefault) },
        onRemove: function (profileId, index, isDefault) { controller.removeCandidate(profileId, index, isDefault) },
        onMaxTotal: function (profileId, value, isDefault) { controller.setMaxTotalAttempts(profileId, value, isDefault) },
        onStickyTurns: function (profileId, value, isDefault) { controller.setStickyTurns(profileId, value, isDefault) },
        onToggleSwitchOn: function (profileId, key, isDefault) { controller.toggleSwitchOn(profileId, key, isDefault) },
        onStrategy: function (value) { controller.setStrategy(value) },
        onWeight: function (index, value, isDefault) { controller.setWeight(index, value, isDefault) },
        onOpenNewProfile: function () { controller.openModal({ kind: 'new-profile' }) },
        onOpenManual: function (profileId, isDefault) { controller.openModal({ kind: 'manual', profileId: profileId, isDefault: isDefault }) },
        onOpenCatalog: function (profileId, isDefault) { controller.openModal({ kind: 'catalog', profileId: profileId, isDefault: isDefault }) },
        onCloseModal: function () { controller.closeModal() },
        onCreateProfile: function (when, templateId) { controller.addProfile(when, templateId) },
        onAddCandidates: function (profileId, entries, isDefault) { controller.addCandidates(profileId, entries, isDefault) },
        onDeleteProfile: function (profileId) { controller.openModal({ kind: 'delete', profileId: profileId }) },
        onConfirmDelete: function (profileId) { controller.deleteProfile(profileId) },
        onRiskAck: function (value) { controller.setRiskAck(value) },
        onOpenDrawer: function () { controller.openDrawer() },
        onCloseDrawer: function () { controller.closeDrawer() },
        onCheckAll: function () { controller.checkAll() },
        onOpenHealthModal: function () { controller.openHealthModal() },
        onUpdateHealth: function (patch) { controller.updateHealth(patch) },
      }

      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-model-router',
        locale: NS,
        inject: () => Object.assign({ hooks: { routerPage: controller.store } }, actions),
      }, RouterPage)), 'router: config page')

      ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'model-router',
        order: 120,
        locale: NS,
        inject: () => Object.assign({ hooks: { routerPage: controller.store } }, actions),
      }, ModelRouterFooterAction)), 'router: sidebar entry')
    }

    exports.RouterPage = RouterPage
    exports.ModelRouterFooterAction = ModelRouterFooterAction
    return module.exports
  },
})
