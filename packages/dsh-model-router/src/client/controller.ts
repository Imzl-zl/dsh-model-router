/**
 * The page's controller: a draft over the Host section, saved through
 * whole-section path ops. The Host is the only authority on acceptance, so
 * a save that did not land keeps the draft and the scope subscription
 * re-seeds from whatever the Host holds next.
 *
 * Note: host/draft 基准必须是两个独立对象 —— 见
 * .agents/notes/implemented/2026-10-15-host-draft-baseline-independence.md
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { clone, deepEqual, routeOf, summarize } from './format.ts'
import { defaultSwitchOn, normalizeDefault, normalizeHealth, normalizeProfiles, validate } from './validate.ts'
import { capTimeline, MAX_TIMELINE_POINTS } from '../timeline.ts'

export function createController(ctx, scope, t) {
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
    checkingRoutes: {},
    // Verdicts from the last end-to-end probe (1 token, TTFT cut), keyed by
    // route. Ephemeral for the same reason as `discover`; a scheduled run's
    // report is read from the Host when the health view opens.
    probe: {},
    probing: false,
    probingRoutes: {},
    // What the last manual run found, kept on screen until the next run. A
    // check that changes nothing visible reads as "nothing happened" — the
    // counts are the feedback, not the dots.
    checkSummary: null,
    probeSummary: null,
  }
  var saving = false
  var failed = false
  // 本插件的"面"在位计数：插件页与侧栏弹窗可以同时挂着（弹窗从插件页打开），所以是
  // 计数不是布尔。原生快捷键命令靠它判断"现在该不该由我接这个键"——DSH 的快捷键
  // 上下文只告诉它有没有模态、是哪個模态，不告诉它哪个设置页在前台。
  var surfaceCount = 0

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
        checkingRoutes: ui.checkingRoutes,
        probe: ui.probe,
        probing: ui.probing,
        probingRoutes: ui.probingRoutes,
        checkSummary: ui.checkSummary,
        probeSummary: ui.probeSummary,
      },
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
   * 合并一条渠道在新旧两份记录里的观测。时间线取**去重后的并集**并按时间排序——
   * 可用率是全局事实：同一个渠道这个会话用、那个会话也用，并发三个会话更是同时在用，
   * 统计必须合在一起算，没有"属于哪个会话"这一说。标量（状态/延迟/吞吐/最后错误）
   * 取较新那份：最近一次观测说什么就是什么。调用方保证 older 来自较旧的会话。
   *
   * 去重是必须的：`loadPassive()` 会在挂载、打开健康页、每轮巡检后重读同样 20 个
   * 会话，同一批观测点会被反复并进来。不按 time 去重，数组随页面停留时间无界增长，
   * 工作台的可用率与"观测点数"也跟着漂移。窗口与 host 的 `pushTimelinePoint` 同口径
   * （MAX_TIMELINE_POINTS），不立第二套标准。
   *
   * Note: 为何不是"整记录覆盖 + 最新会话赢"、为何不合并时间线窗口 —— 见
   * .agents/notes/implemented/2026-10-15-health-monitoring-cross-session-merge.md
   */
  function mergeHealthRecord(older, newer) {
    if (older === undefined || older === null) return newer
    var seen = {}
    var points = (older.timeline ?? []).concat(newer.timeline ?? [])
      .filter(function (point) {
        var key = point.time + ':' + point.status
        if (seen[key]) return false
        seen[key] = true
        return true
      })
      .sort(function (a, b) { return a.time - b.time })
    if (points.length > MAX_TIMELINE_POINTS) points = capTimeline(points)
    return Object.assign({}, newer, { timeline: points })
  }

  /** 把一批会话的记录按旧→新合进 ui.passive。 */
  function mergePassiveRecords(records) {
    if (!records) return
    var next = Object.assign({}, ui.passive)
    Object.keys(records).forEach(function (route) {
      next[route] = mergeHealthRecord(next[route], records[route])
    })
    ui.passive = next
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
        .sort(function (a, b) { return (a.updatedAt ?? 0) - (b.updatedAt ?? 0) })
        .slice(-20)
      // 先读齐、再按旧→新合并。两个坑都实测踩过：① 在并发回调里直接
      // Object.assign，谁最后 resolve 谁赢——同一条路由时而显示三天前的延迟、
      // 时而显示今天的，刷新就变；② 数组新的在前时最后 assign 的是最旧一条，
      // 语义恰好反了。旧→新顺序保证每条渠道留下的是最近一次观测。
      return Promise.all(sessions.map(function (entry) {
        return session.projections({ sessionId: entry.sessionId }).then(function (read) {
          // The live read is `{ asOfSeq, values }`; a migration-required
          // read carries cached values only. Either way the key is read
          // straight out of `values` — no `kind` gate (the wire payload
          // does not carry one).
          var values = read.ok && read.value !== null ? (read.value.values ?? {}) : {}
          // 先拷贝再写入：store 的 set 会 dev-freeze 它收到的对象，之后往
          // 原对象上赋值在 dev 构建里会静默失败（圆点永远显示"未探测"）。
          return values['router/channel-health'] ?? null
        }).catch(function () { return null })
      }))
    }).then(function (reads) {
      for (var i = 0; i < reads.length; i++) {
        mergePassiveRecords(reads[i])
      }
      publish()
    }).catch(function () {})
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

  /** Ask one route whether its endpoint answers and advertises this model. */
  function checkRoute(provider, model) {
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
    // mirror 的每次发布都会走到这里：保存被拒后的恢复读、连接重置、用户在
    // 别的设置页保存，都会重发整个文档。本 namespace 的值没变就什么都不做——
    // 把用户未保存的草稿冲掉，比晚一步反映宿主变化糟得多。裁定与代价见
    // .agents/notes/implemented/2026-10-15-ui-refactor-hardening.md。
    var next = seed()
    if (deepEqual(next, host)) return
    host = next
    // The baseline and the draft must be two independent snapshots. Sharing
    // one object behind both names makes every edit mutate the baseline
    // too, and `dirty` — the whole unsaved-changes signal — then reads
    // false forever. See .agents/notes/implemented/2026-10-15-host-draft-baseline-independence.md。
    draft = clone(next)
    failed = false
    // 配置变了，provider 目录也可能变了：旧的端点映射不能再拿去问。
    discoverFacts = null
    // The first snapshot can arrive after the controller was built (status
    // loading, no value), so the active tab is re-established here too.
    ensureActive()
    publish()
  })

  /**
   * The profile an edit addresses. An id that matches nothing throws rather
   * than silently editing a phantom chain — every caller passes an id the
   * UI has just rendered.
   */
  function profileOf(profileId) {
    var profile = draft.profiles.find(function (p) { return p.id === profileId })
    if (profile === undefined) throw new Error('model-router: no profile "' + profileId + '" in the draft')
    return profile
  }
  /**
   * The candidate list an edit addresses: the default pool, or one
   * profile's chain. An id that matches nothing throws rather than
   * silently editing a phantom list — every caller passes an id the UI
   * has just rendered.
   */
  function listOf(profileId, isDefault) {
    if (isDefault) return draft.default.candidates
    return profileOf(profileId).candidates
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
    /** One of this plugin's surfaces (settings page or quick modal) mounted. */
    retainSurface: function () { surfaceCount += 1 },
    /** That surface unmounted. */
    releaseSurface: function () { if (surfaceCount > 0) surfaceCount -= 1 },
    /** Whether a surface of ours is mounted at all — the shortcut command's gate. */
    surfaceActive: function () { return surfaceCount > 0 },
    setEnabled: function (value) { draft.enabled = value; publish() },
    setActive: function (id) {
      ui.activeId = id
      autoActive = false
      // 打开健康工作台时重取一次被动快照。它原本只在控制器创建时读一次，
      // 故障转移发生后工作台还显示着旧延迟/旧可用率——监控视图在事故进行中
      // 给人看旧数字，比没有这个数字更糟。重取是同一套 20 会话合并，代价是
      // 几次本地投影读。定时探测的报告同理：它是 Host 内存里最近一次运行的
      // 结果，打开视图时读，而不是假装有实时推送。
      if (id === '__health__') { loadPassive(); controller.loadProbeReport() }
      publish()
    },
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
      // mutate 拒绝（wire 抛错、恢复读失败）时必须自己收尾：saving 卡在 true
      // 会让保存按钮永久转圈，且用户看不到任何失败原因。
      scope.mutate([
        { op: 'set', path: ['enabled'], value: draft.enabled },
        { op: 'set', path: ['profiles'], value: draft.profiles },
        { op: 'set', path: ['default'], value: draft.default },
        { op: 'set', path: ['health'], value: draft.health },
      ], scope.getSnapshot().revision).then(function (accepted) {
        saving = false
        failed = !accepted
        publish()
      }, function () {
        saving = false
        failed = true
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
      var list = listOf(profileId, isDefault)
      entries.forEach(function (entry) {
        // 默认值先给、entry 后覆盖：目录选择不带 maxAttempts（1 是它的默认），
        // 手动录入带了就必须按用户填的走——写死 1 会静默吞掉用户输入。
        list.push(Object.assign({ maxAttempts: 1 }, entry))
      })
      ui.modal = null
      publish()
    },
    removeCandidate: function (profileId, index, isDefault) {
      // 只有 profile 的第一个候选是钉死的 when 模型；默认兜底池没有 primary，
      // 它的第一个候选和别的候选一样可增删、可换序。
      if (index <= 0 && !isDefault) return
      listOf(profileId, isDefault).splice(index, 1)
      publish()
    },
    moveCandidate: function (profileId, index, direction, isDefault) {
      if (index <= 0 && !isDefault) return
      var list = listOf(profileId, isDefault)
      var target = index + direction
      if (target < 1 || target >= list.length) return
      var swapped = list[target]
      list[target] = list[index]
      list[index] = swapped
      publish()
    },
    setMaxAttempts: function (profileId, index, value, isDefault) {
      var candidate = listOf(profileId, isDefault)[index]
      var parsed = Number(value)
      candidate.maxAttempts = Number.isFinite(parsed) ? Math.min(5, Math.max(1, Math.round(parsed))) : 1
      publish()
    },
    /** Patch one candidate's `needs`; an empty patch clears the field. */
    setNeeds: function (profileId, index, patch, isDefault) {
      var candidate = listOf(profileId, isDefault)[index]
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
    setStrategy: function (profileId, value, isDefault) {
      // 策略只管起点，所以名单本身不动——只改"从哪条开始"。目标链由调用方
      // 点名（与其余 setter 一致），不靠"当前停在哪个 tab"推断。
      if (isDefault) draft.default.strategy = value
      else profileOf(profileId).strategy = value
      publish()
    },
    setWeight: function (profileId, index, value, isDefault) {
      var parsed = Number(value)
      var clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0
      var list = listOf(profileId, isDefault)
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
      if (modal.kind === 'new-profile' || modal.kind === 'add-candidate') ensureCatalog()
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
          .sort(function (a, b) { return (a.updatedAt ?? 0) - (b.updatedAt ?? 0) })
          .slice(-20)
        // 与 loadPassive 同一套合并：读齐后旧→新，每条渠道留最近一次观测。
        return Promise.all(sessions.map(function (session) {
          return ctx.remote.session.projections({ sessionId: session.sessionId }).then(function (read) {
            // The live read is `{ asOfSeq, values }`; a migration-required
            // read carries cached values only. Either way the key is read
            // straight out of `values` — no `kind` gate (the wire payload
            // does not carry one).
            var values = read.ok && read.value !== null ? (read.value.values ?? {}) : {}
            return {
              sessionId: session.sessionId,
              entries: values['router/failover-history'] ?? [],
              records: values['router/channel-health'] ?? null,
            }
          }).catch(function () { return { sessionId: session.sessionId, entries: [], records: null } })
        }))
      }).then(function (rows) {
        // 合并放在这里而不是并发回调里：数组已按旧→新，最后赋值的才是最近一次
        // 观测；在回调里 assign 等于让 resolve 顺序决定赢家，刷新就变。
        for (var i = 0; i < rows.length; i++) {
          mergePassiveRecords(rows[i].records)
        }
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
      ui.checkSummary = null
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
      draft.default.candidates.forEach(collect)
      var keys = Object.keys(routes)
      var verdicts = {}
      Promise.all(keys.map(function (key) {
        var route = routes[key]
        return checkRoute(route.provider, route.model).then(function (verdict) {
          // 先拷贝后写入——store 的 set 会 dev-freeze 它收到的对象，往原对象
          // 上赋值在 dev 构建里会静默失败。
          ui.discover = Object.assign({}, ui.discover)
          ui.discover[key] = verdict
          verdicts[key] = verdict
        })
      })).then(function () {
        ui.checking = false
        ui.checkSummary = summarizeChecks(keys.map(function (key) { return verdicts[key] }))
        // 连通性检查跑完顺带重取被动快照：定时轮次开着的时候，健康工作台要跟着
        // 真实发生的事走，而不是停在页面挂载那一刻。
        loadPassive()
        publish()
      }).catch(function () {
        ui.checking = false
        publish()
      })
    },
    /** Run a connectivity check on a single route (0 Token discovery check). */
    checkRouteSingle: function (provider, model) {
      var key = provider + '/' + model
      if (ui.checkingRoutes && ui.checkingRoutes[key]) return
      ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
      ui.checkingRoutes[key] = true
      publish()
      return checkRoute(provider, model).then(function (verdict) {
        ui.discover = Object.assign({}, ui.discover)
        ui.discover[key] = verdict
        ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
        delete ui.checkingRoutes[key]
        publish()
      }).catch(function () {
        ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
        delete ui.checkingRoutes[key]
        publish()
      })
    },
    updateHealth: function (patch) {
      draft.health = Object.assign({}, draft.health, patch)
      publish()
    },
    /**
     * Read the Host's last probe report — what the scheduled run measured. The
     * browser holds no subscription, so this is read when the health view opens
     * and after every manual run, the same snapshot pattern the passive fold
     * uses.
     */
    loadProbeReport: function () {
      var health = ctx.remote && ctx.remote.routerHealth
      if (!health || typeof health.probeReport !== 'function') return
      health.probeReport().then(function (result) {
        if (!result || result.ok !== true || !result.value) return
        var next = {}
        ;(result.value.routes ?? []).forEach(function (entry) {
          next[entry.provider + '/' + entry.model] = entry
        })
        ui.probe = next
        publish()
      }).catch(function () {})
    },
    /** Probe one route end to end (1 token, cut at the first content byte). */
    probeRouteSingle: function (provider, model) {
      var key = provider + '/' + model
      if (ui.probingRoutes && ui.probingRoutes[key]) return
      var health = ctx.remote && ctx.remote.routerHealth
      if (!health || typeof health.probeAll !== 'function') return
      ui.probingRoutes = Object.assign({}, ui.probingRoutes)
      ui.probingRoutes[key] = true
      publish()
      health.probeAll({ routes: [{ provider: provider, model: model }] }).then(function (result) {
        if (result && result.ok === true) {
          var next = Object.assign({}, ui.probe)
          ;(result.value.routes ?? []).forEach(function (entry) {
            next[entry.provider + '/' + entry.model] = entry
          })
          ui.probe = next
        }
        ui.probingRoutes = Object.assign({}, ui.probingRoutes)
        delete ui.probingRoutes[key]
        publish()
      }).catch(function () {
        ui.probingRoutes = Object.assign({}, ui.probingRoutes)
        delete ui.probingRoutes[key]
        publish()
      })
    },
    /** Probe every configured route: profiles and the default pool alike. */
    probeAll: function () {
      if (ui.probing) return
      var health = ctx.remote && ctx.remote.routerHealth
      if (!health || typeof health.probeAll !== 'function') return
      var routes = {}
      var collect = function (candidate) {
        var key = routeOf(candidate)
        if (routes[key]) return
        routes[key] = { provider: candidate.provider, model: candidate.model }
      }
      draft.profiles.forEach(function (profile) {
        profile.candidates.forEach(collect)
      })
      draft.default.candidates.forEach(collect)
      ui.probing = true
      ui.probeSummary = null
      publish()
      health.probeAll({ routes: Object.keys(routes).map(function (key) { return routes[key] }) }).then(function (result) {
        if (result && result.ok === true) {
          var next = Object.assign({}, ui.probe)
          ;(result.value.routes ?? []).forEach(function (entry) {
            next[entry.provider + '/' + entry.model] = entry
          })
          ui.probe = next
          ui.probeSummary = summarizeProbes(result.value.routes ?? [])
        }
        ui.probing = false
        loadProbeReport()
        publish()
      }).catch(function () {
        ui.probing = false
        publish()
      })
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

/**
 * What a connectivity run found: reachable, advertised-but-not-this-model,
 * refused, and could-not-check are four different answers and are counted
 * separately — the last one says nothing about the channel.
 */
function summarizeChecks(verdicts) {
  return summarize(verdicts, function (verdict) {
    if (verdict.kind === 'reachable') return 'ok'
    if (verdict.kind === 'notAdvertised') return 'partial'
    if (verdict.kind === 'unreachable') return 'bad'
    return 'unknown'
  }, [
    { key: 'ok', label: '可达' },
    { key: 'partial', label: '在清单但非此模型' },
    { key: 'bad', label: '不可达' },
    { key: 'unknown', label: '没能检查' },
  ])
}

/** What a probe run found: passed, refused, and could-not-run. */
function summarizeProbes(routes) {
  return summarize(routes, function (entry) {
    if (entry.kind === 'reachable') return 'ok'
    if (entry.kind === 'unreachable') return 'bad'
    return 'unknown'
  }, [
    { key: 'ok', label: '通过' },
    { key: 'bad', label: '未通过' },
    { key: 'unknown', label: '没能测' },
  ])
}
