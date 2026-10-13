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
      pipelineSubtitle: '请求优先发送至首选主渠道。若达到单渠道尝试上限或触发指定异常，将自动流转至下一备用渠道。',
      primaryModelBadge: '用户默认首选',
      singleAttemptLimit: '单渠道尝试',
      attemptLimitHint: '切换前会先等待一次退避（约 0.5~10 秒）',
      timesUnit: '次',
      moveUp: '上移',
      moveDown: '下移',
      removeNode: '从链路中移除',
      primaryPinnedHint: '首选节点钉死为用户所选模型，不可删除或换序',
      toggleNeedsBtn: '⚙️ 高级路由条件',
      needImagesTitle: '图像/多模态输入',
      needImagesHint: '仅当会话包含图片时允许匹配',
      needContextTitle: '最小上下文门槛 (Tokens)',
      needContextHint: '按预估值判断（估算值，可能低估中文）；0 表示不限制',
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
      safetyNoticeText: '用户主动中断 (ABORTED)、凭证失效 (AUTH_FAILED) 及不可达的模型配置 (NO_ADAPTER) 属于永久性错误，将绝不进行盲目转移，立即向用户提示。',
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
      providerLabel: 'Provider 标识 (提供方 ID)',
      providerHint: '需与 DSH 已注册的 Adapter 或官方 Provider 标识一致。',
      providerUnregistered: '该 provider 未在已注册列表中找到，保存后将被运行时跳过',
      modelIdLabel: '模型 ID (Model ID)',
      modelIdHint: '该 Provider 支持的具体物理模型名称。',
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
      healthEnabledLabel: '启用健康监控',
      healthPromptLabel: '探测消息内容 (Prompt)',
      healthPromptHint: '发送极小 Token 消息探测渠道存活。可自定义以避开特定渠道违禁词拦截（默认 "hi"）',
      healthIntervalLabel: '自动探测周期 (分钟)',
      healthIntervalHint: '设为 0 表示仅手动探测与对话被动记录，不产生后台 Token 费用',
      healthTimeoutLabel: '单次探测超时 (秒)',
      healthTimeoutHint: '单渠道探测超时限制（默认 8 秒）',
      probeAllBtn: '探测全部渠道',
      probingText: '探测中...',
      probeDoneNotice: '全部渠道探测完成',
      healthStatusHealthy: '正常',
      healthStatusDegraded: '降级',
      healthStatusUnhealthy: '异常',
      healthStatusUnknown: '未探测',
      healthConfigBtn: '健康监控设置',
      healthModalTitle: '渠道健康监控与探测设置',
      healthPassiveHint: '💡 零消耗机制：对话过程中成功的请求自动标记正常并记录延迟；异常错误（429/500/超时）自动标记降级或异常，日常使用不产生任何额外 Token 费用。主动探测仅消耗 1 Token 并于首字到达时立即断开。',
      healthMetricStatus: '状态',
      healthMetricLatency: '延迟',
      healthMetricThroughput: '吞吐',
      healthBarIdle: '暂无请求 / 闲置时段',
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
      pipelineSubtitle: 'Requests route to the primary channel first. On failure reaching the attempt limit, flow steps down to the next fallback candidate.',
      primaryModelBadge: 'Primary Choice',
      singleAttemptLimit: 'Attempts per candidate',
      attemptLimitHint: 'One backoff wait (about 0.5-10s) precedes each switch',
      timesUnit: 'times',
      moveUp: 'Move Up',
      moveDown: 'Move Down',
      removeNode: 'Remove from chain',
      primaryPinnedHint: 'The primary node is pinned to the selected model and cannot be removed or reordered',
      toggleNeedsBtn: '⚙️ Advanced Conditions',
      needImagesTitle: 'Vision / Image Input',
      needImagesHint: 'Only matched when the conversation includes images',
      needContextTitle: 'Min Context Floor (Tokens)',
      needContextHint: 'Estimated projection (may under-count CJK); 0 disables the gate',
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
      safetyNoticeText: 'Permanent failures such as User Abort (ABORTED), Bad Credentials (AUTH_FAILED), or Missing Adapter (NO_ADAPTER) will NEVER failover blindly.',
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
      providerLabel: 'Provider Identifier',
      providerHint: 'Must match a registered DSH adapter or official provider id.',
      providerUnregistered: 'This provider is not in the registered list; it will be skipped at runtime',
      modelIdLabel: 'Model Identifier',
      modelIdHint: 'The exact physical model name this provider accepts.',
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
      healthEnabledLabel: 'Enable Health Monitoring',
      healthPromptLabel: 'Probe Prompt',
      healthPromptHint: 'Sends minimal token prompt. Customize to avoid provider content filter rejections (default "hi").',
      healthIntervalLabel: 'Auto Probe Interval (min)',
      healthIntervalHint: 'Set 0 for manual/passive only; avoids background token costs.',
      healthTimeoutLabel: 'Probe Timeout (sec)',
      healthTimeoutHint: 'Per-channel timeout limit (default 8s).',
      probeAllBtn: 'Probe All Channels',
      probingText: 'Probing...',
      probeDoneNotice: 'All channels probed successfully',
      healthStatusHealthy: 'Healthy',
      healthStatusDegraded: 'Degraded',
      healthStatusUnhealthy: 'Unhealthy',
      healthStatusUnknown: 'Untested',
      healthConfigBtn: 'Health Settings',
      healthModalTitle: 'Channel Health & Proactive Probe Settings',
      healthPassiveHint: '💡 Zero-Cost Mechanism: Successful conversation requests automatically record latency and mark channels healthy; failures (429/500/timeout) mark degraded/unhealthy. Active probes limit to 1 token and abort immediately on first token (TTFT).',
      healthMetricStatus: 'Status',
      healthMetricLatency: 'Latency',
      healthMetricThroughput: 'Throughput',
      healthBarIdle: 'No requests / Idle',
    }

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
      return { enabled: false, candidates: [], switchOn: defaultSwitchOn(), maxTotalAttempts: 3 }
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
      healthBadgeHealthy: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'rgba(39, 174, 96, 0.12)', color: '#27ae60', border: '0.5px solid rgba(39, 174, 96, 0.3)', fontWeight: 600, fontFamily: 'var(--ds-font-family-code, monospace)', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'help' },
      healthBadgeDegraded: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'rgba(243, 156, 18, 0.12)', color: '#e67e22', border: '0.5px solid rgba(243, 156, 18, 0.3)', fontWeight: 600, fontFamily: 'var(--ds-font-family-code, monospace)', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'help' },
      healthBadgeUnhealthy: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'rgba(231, 76, 60, 0.12)', color: '#e74c3c', border: '0.5px solid rgba(231, 76, 60, 0.3)', fontWeight: 600, fontFamily: 'var(--ds-font-family-code, monospace)', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'help' },
      healthBadgeUnknown: { fontSize: 11, padding: '2px 8px', borderRadius: 'var(--dsw-radius-xs, 4px)', background: 'var(--dsw-alias-bg-layer-4)', color: 'var(--dsw-alias-label-tertiary)', border: '0.5px solid var(--dsw-alias-border-l2)', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'help' },
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
    function formatAvailability(pct) {
      if (typeof pct !== 'number' || isNaN(pct)) return '—'
      return pct.toFixed(2) + '%'
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
      })
      if (!(draft.default.maxTotalAttempts >= 1)) problems.push({ key: 'problemBadDefaultTotal', vars: {} })
      return problems
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
          profiles: clone(value.profiles ?? []),
          default: clone(value.default ?? defaultProfileValue()),
          health: clone(value.health ?? {
            enabled: true,
            prompt: 'hi',
            intervalMinutes: 0,
            timeoutSeconds: 8,
          }),
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
        healthRecords: {},
        healthProbing: false,
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
            healthRecords: ui.healthRecords,
            healthProbing: ui.healthProbing,
          },
          catalog: ui.catalog,
        }
      }
      var store = createSnapshotStore(project())
      function publish() { store.set(project()) }

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

      var callHealth = async function (method, args) {
        var svc = (typeof ctx.get === 'function' ? ctx.get('remote.routerHealth') : null) || null
        if (!svc || typeof svc[method] !== 'function') return null
        try {
          var r = args === undefined ? await svc[method]() : await svc[method](args)
          if (r && r.ok) return r.value
          return r
        } catch (e) {
          return null
        }
      }

      function loadHealthSnapshot() {
        callHealth('getSnapshot').then(function (snapshot) {
          if (snapshot && typeof snapshot === 'object') {
            ui.healthRecords = Object.assign({}, ui.healthRecords, snapshot)
            publish()
          }
        }).catch(function () {})
      }
      loadHealthSnapshot()

      scope.subscribe(function () {
        host = seed()
        draft = seed()
        failed = false
        // The first snapshot can arrive after the controller was built (status
        // loading, no value), so the active tab is re-established here too.
        ensureActive()
        loadHealthSnapshot()
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
          if (patch.images !== undefined) {
            if (patch.images) next.images = true
            else delete next.images
          }
          if (patch.minContextTokens !== undefined) {
            if (patch.minContextTokens > 0) next.minContextTokens = patch.minContextTokens
            else delete next.minContextTokens
          }
          candidate.needs = Object.keys(next).length > 0 ? next : undefined
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
                if (values['router/channel-health']) {
                  ui.healthRecords = Object.assign({}, values['router/channel-health'], ui.healthRecords)
                }
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
        probeAll: function () {
          if (ui.healthProbing) return
          ui.healthProbing = true
          publish()
          var candidates = []
          var seen = {}
          draft.profiles.forEach(function (p) {
            p.candidates.forEach(function (c) {
              var k = routeOf(c)
              if (!seen[k]) { seen[k] = true; candidates.push({ provider: c.provider, model: c.model }) }
            })
          })
          if (draft.default.enabled) {
            draft.default.candidates.forEach(function (c) {
              var k = routeOf(c)
              if (!seen[k]) { seen[k] = true; candidates.push({ provider: c.provider, model: c.model }) }
            })
          }
          callHealth('probeAll', {
            prompt: draft.health?.prompt || 'hi',
            timeoutSeconds: draft.health?.timeoutSeconds || 8,
            candidates: candidates,
          }).then(function (records) {
            if (records && typeof records === 'object') {
              ui.healthRecords = Object.assign({}, ui.healthRecords, records)
            }
            ui.healthProbing = false
            publish()
          }).catch(function () {
            ui.healthProbing = false
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
        loadHealthSnapshot: loadHealthSnapshot,
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

    /** Channel health badge showing status and latency or error. */
    function HealthBadge(props) {
      var t = props.t
      var record = props.record
      if (!record || record.status === 'unknown') {
        return h('span', {
          style: S.healthBadgeUnknown,
          title: t('healthStatusUnknown'),
        }, '⚪ ' + t('healthStatusUnknown'))
      }
      var status = record.status
      var latency = typeof record.latencyMs === 'number' ? record.latencyMs + 'ms' : null
      var tooltip = status === 'healthy'
        ? (t('healthStatusHealthy') + (latency ? ' (' + latency + ')' : ''))
        : status === 'degraded'
          ? (t('healthStatusDegraded') + (latency ? ' (' + latency + ')' : '') + (record.lastError ? ': ' + record.lastError : ''))
          : (t('healthStatusUnhealthy') + (record.lastError ? ': ' + record.lastError : ''))

      if (status === 'healthy') {
        return h('span', {
          style: S.healthBadgeHealthy,
          title: tooltip,
        }, '🟢 ' + (latency ?? t('healthStatusHealthy')))
      }
      if (status === 'degraded') {
        return h('span', {
          style: S.healthBadgeDegraded,
          title: tooltip,
        }, '🟡 ' + (latency ?? t('healthStatusDegraded')))
      }
      return h('span', {
        style: S.healthBadgeUnhealthy,
        title: tooltip,
      }, '🔴 ' + t('healthStatusUnhealthy'))
    }

    /** Sparkline timeline and metrics dashboard matching channel monitor specification. */
    function ChannelMetricsDashboard(props) {
      var t = props.t
      var record = props.record
      var timeline = (record && Array.isArray(record.timeline)) ? record.timeline : []
      var availabilityPct = record ? record.availabilityPct : undefined
      var latencyMs = record ? record.latencyMs : undefined
      var throughputTps = record ? record.throughputTps : undefined

      var availColor = 'var(--dsw-alias-label-tertiary)'
      if (typeof availabilityPct === 'number') {
        if (availabilityPct >= 99) availColor = '#00e599'
        else if (availabilityPct >= 90) availColor = '#f59e0b'
        else availColor = '#ef4444'
      }

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
        var barBg = '#00e599'
        var statusLabel = t('healthStatusHealthy')
        if (item.status === 'degraded') {
          barBg = '#f59e0b'
          statusLabel = t('healthStatusDegraded')
        } else if (item.status === 'unhealthy') {
          barBg = '#ef4444'
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
            h('span', { style: S.metricsLabel }, t('healthMetricStatus')),
            h('span', { style: Object.assign({}, S.metricsStatusValue, { color: availColor }) }, formatAvailability(availabilityPct))),
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
      var hasActiveNeeds = (needs.images === true) || (needs.minContextTokens > 0)
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
                  h(HealthBadge, { t: t, record: props.healthRecords ? props.healthRecords[routeOf(candidate)] : null }),
                  reasoning === undefined ? null : h('span', { style: S.reasoningBadge }, t('reasoningBadge') + ': ' + reasoning),
                  isPrimary ? null : h('button', {
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
          h(ChannelMetricsDashboard, { t: t, record: props.healthRecords ? props.healthRecords[routeOf(candidate)] : null }),
          !isPrimary && expanded ? h('div', { style: S.needsPanel },
            h('div', { style: S.needsGrid },
              h('div', { style: S.needCard },
                h('div', { style: S.needHeader },
                  h('span', null, t('needImagesTitle')),
                  h(Switch, {
                    checked: needs.images === true,
                    label: t('needImagesTitle'),
                    disabled: props.disabled,
                    onChange: function (next) { props.onNeeds(index, { images: next }) },
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
          healthRecords: props.healthRecords,
          onMaxAttempts: props.onMaxAttempts,
          onMove: props.onMove,
          onRemove: props.onRemove,
          onNeeds: props.onNeeds,
        }))
      })
      return h('div', null, nodes)
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

    /** The budget row: editable total cap, read-only backoff badge. */
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
            disabled: props.disabled,
            catalog: props.catalog,
            healthRecords: props.healthRecords,
            onMaxAttempts: function (index, value) { props.onMaxAttempts(profile.id, index, value, false) },
            onMove: function (index, direction) { props.onMove(profile.id, index, direction, false) },
            onRemove: function (index) { props.onRemove(profile.id, index, false) },
            onNeeds: function (index, patch) { props.onNeeds(profile.id, index, patch, false) },
          }),
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
            disabled: props.disabled,
            onMaxTotal: function (value) { props.onMaxTotal(profile.id, value, false) },
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
            isDefault: true,
            disabled: props.disabled,
            catalog: props.catalog,
            healthRecords: props.healthRecords,
            onMaxAttempts: function (index, value) { props.onMaxAttempts(null, index, value, true) },
            onMove: function (index, direction) { props.onMove(null, index, direction, true) },
            onRemove: function (index) { props.onRemove(null, index, true) },
            onNeeds: function (index, patch) { props.onNeeds(null, index, patch, true) },
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
            disabled: props.disabled,
            onMaxTotal: function (value) { props.onMaxTotal(null, value, true) },
          })))
    }

    /** Health Settings Modal dialog. */
    function HealthSettingsModal(props) {
      var t = props.t
      var health = props.health || {}
      var [enabled, setEnabled] = React.useState(health.enabled ?? true)
      var [prompt, setPrompt] = React.useState(health.prompt ?? 'hi')
      var [intervalMinutes, setIntervalMinutes] = React.useState(String(health.intervalMinutes ?? 0))
      var [timeoutSeconds, setTimeoutSeconds] = React.useState(String(health.timeoutSeconds ?? 8))

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
              var intervalNum = Math.max(0, Math.round(Number(intervalMinutes) || 0))
              var timeoutNum = Math.min(60, Math.max(1, Math.round(Number(timeoutSeconds) || 8)))
              props.onUpdateHealth({
                enabled: enabled,
                prompt: prompt.trim() || 'hi',
                intervalMinutes: intervalNum,
                timeoutSeconds: timeoutNum,
              })
              props.onClose()
            },
          }, t('formSave'))),
      },
        h('div', { style: S.introBox },
          h(Icon, { d: ICON_WARN, size: 20 }),
          h('div', null,
            h('h3', { style: S.introTitle }, t('healthSectionTitle')),
            h('p', { style: S.introDesc }, t('healthPassiveHint')))),
        h('div', { style: Object.assign({}, S.formGroup, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }) },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.formLabel }, t('healthEnabledLabel')),
            h('span', { style: S.formHint }, t('healthPassiveHint'))),
          h(Switch, {
            checked: enabled,
            label: t('healthEnabledLabel'),
            onChange: function (next) { setEnabled(next) },
          })),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('healthPromptLabel')),
          h('span', { style: S.formHint }, t('healthPromptHint')),
          h('input', {
            style: S.formInput,
            type: 'text',
            placeholder: 'hi',
            'aria-label': t('healthPromptLabel'),
            value: prompt,
            onChange: function (event) { setPrompt(event.target.value) },
          })),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('healthIntervalLabel')),
          h('span', { style: S.formHint }, t('healthIntervalHint')),
          h('input', {
            style: S.formInput,
            type: 'text',
            inputMode: 'numeric',
            placeholder: '0',
            'aria-label': t('healthIntervalLabel'),
            value: intervalMinutes,
            onChange: function (event) { setIntervalMinutes(event.target.value) },
          })),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('healthTimeoutLabel')),
          h('span', { style: S.formHint }, t('healthTimeoutHint')),
          h('input', {
            style: S.formInput,
            type: 'text',
            inputMode: 'numeric',
            placeholder: '8',
            'aria-label': t('healthTimeoutLabel'),
            value: timeoutSeconds,
            onChange: function (event) { setTimeoutSeconds(event.target.value) },
          })))
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
    function ManualChannelModal(props) {
      var t = props.t
      var [provider, setProvider] = React.useState('')
      var [model, setModel] = React.useState('')
      var [maxAttempts, setMaxAttempts] = React.useState('1')
      var registered = props.routableProviders ?? []
      var providerKnown = provider.trim() === '' || registered.length === 0 || registered.indexOf(provider.trim()) >= 0
      var canAdd = provider.trim() !== '' && model.trim() !== ''
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
              props.onAdd([{ provider: provider.trim(), model: model.trim(), maxAttempts: Math.min(5, Math.max(1, Number(maxAttempts) || 1)) }])
            },
          }, t('confirmAddManual'))),
      },
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('providerLabel')),
          h('span', { style: S.formHint }, t('providerHint')),
          h('input', {
            style: S.formInput,
            placeholder: 'pi-ai-siliconflow, openai',
            'aria-label': t('providerLabel'),
            value: provider,
            onChange: function (event) { setProvider(event.target.value) },
          }),
          !providerKnown ? h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-state-warn)' } }, t('providerUnregistered')) : null),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('modelIdLabel')),
          h('span', { style: S.formHint }, t('modelIdHint')),
          h('input', {
            style: S.formInput,
            placeholder: 'deepseek-ai/DeepSeek-V3',
            'aria-label': t('modelIdLabel'),
            value: model,
            onChange: function (event) { setModel(event.target.value) },
          })),
        h('div', { style: S.formGroup },
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
              style: Object.assign({}, S.catalogBtn, state.ui.healthProbing ? { opacity: 0.6, cursor: 'wait' } : null),
              disabled: disabled || state.ui.healthProbing,
              title: t('probeAllBtn'),
              onClick: props.onProbeAll,
            }, h(Icon, { d: state.ui.healthProbing ? ICON_SPINNER : ICON_BOLT, size: 14, spin: state.ui.healthProbing }), state.ui.healthProbing ? t('probingText') : t('probeAllBtn')),
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
              healthRecords: state.ui.healthRecords,
              onDefaultEnabled: props.onDefaultEnabled,
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
              healthRecords: state.ui.healthRecords,
              onDeleteProfile: props.onDeleteProfile,
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
                  style: Object.assign({}, S.catalogBtn, state?.ui?.healthProbing ? { opacity: 0.6, cursor: 'wait' } : null),
                  disabled: !state?.writable || state?.saving || state?.ui?.healthProbing,
                  title: t('probeAllBtn'),
                  onClick: props.onProbeAll,
                }, h(Icon, { d: state?.ui?.healthProbing ? ICON_SPINNER : ICON_BOLT, size: 14, spin: state?.ui?.healthProbing }), state?.ui?.healthProbing ? t('probingText') : t('probeAllBtn')),
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

    var ROUTER_HEALTH_CONTRIBUTION = {
      package: '@sudy/dsh-model-router',
      descriptors: [
        {
          namespace: 'routerHealth',
          method: 'getSnapshot',
          parameters: [],
          uplink: null,
          result: { mode: 'src-json' },
        },
        {
          namespace: 'routerHealth',
          method: 'probeAll',
          parameters: [
            {
              name: 'payload',
              wire: 'payload',
              kind: 'value',
              codec: { mode: 'src-json' },
              optional: true,
            },
          ],
          uplink: null,
          result: { mode: 'src-json' },
        },
      ],
    }

    exports.name = NS + '/client'
    exports.inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

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
        onToggleSwitchOn: function (profileId, key, isDefault) { controller.toggleSwitchOn(profileId, key, isDefault) },
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
        onProbeAll: function () { controller.probeAll() },
        onOpenHealthModal: function () { controller.openHealthModal() },
        onUpdateHealth: function (patch) { controller.updateHealth(patch) },
      }

      if (ctx.remote && typeof ctx.remote.$mount === 'function') {
        ctx.effect(function () {
          var unmount = null
          ctx.remote.$mount(ROUTER_HEALTH_CONTRIBUTION).then(function (dispose) {
            unmount = dispose
            if (typeof controller.loadHealthSnapshot === 'function') {
              controller.loadHealthSnapshot()
            }
          }).catch(function () {})
          return function () {
            if (typeof unmount === 'function') {
              void unmount().catch(function () {})
            }
          }
        }, 'router: remote health mount')
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
