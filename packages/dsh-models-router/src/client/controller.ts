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
import { clone, deepEqual, fill, summarize } from './format.ts'
import { defaultChainValue, normalizeNamedChain, normalizeHealth, validate } from './validate.ts'
import { defaultChainOf, effectiveChains } from '../chain.ts'
import { pruneTimeline } from '../timeline.ts'
import { configuredRouteList, routeKeyOf, routeParts } from '../routes.ts'
import { DEFAULT_FIRST_HOP_MAX_RETRIES, DEFAULT_MAX_RETRIES, MAX_RETRIES } from '../defaults.ts'
import { RELEASE_VERSION } from './release.generated.ts'

/** Where the browser remembers the last release whose notes it has shown. */
var SEEN_VERSION_KEY = 'dsh-models-router:seen-version'

/**
 * The release whose notes this browser last acknowledged, or null when it has
 * never seen one (fresh install, or storage denied).
 */
function seenVersion() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(SEEN_VERSION_KEY)
  } catch (error) {
    return null
  }
}

/** Remember the running release after the user dismisses its notes. */
function rememberVersion() {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(SEEN_VERSION_KEY, RELEASE_VERSION)
  } catch (error) {
    // Storage can be denied while the app still works. The dialog then appears
    // again on the next load; that is better than failing the page over a
    // courtesy notice.
  }
}

/**
 * Whether this activation should open the release notes.
 *
 * Read by the browser-half entry **before its first await**: the activation has
 * the page's real `localStorage` then, while a later read can race the client
 * module system swapping the global window between test/browser contexts.
 * Exported so `apply.ts` can compute it synchronously and hand it in.
 */
export function notesForCurrentVersion() {
  return seenVersion() !== RELEASE_VERSION
}

/**
 * @param initialNotesOpen - whether to open the release notes on this activation.
 */
export function createController(ctx, scope, t, initialNotesOpen = notesForCurrentVersion()) {
  var seed = function () {
    var value = scope.getSnapshot().value ?? {}
    // 旧配置（单链 / 按模型分规则 + 默认兜底池）在这里迁成命名链：规则模块与宿主读的
    // 是同一个 effectiveChains，所以浏览器看到的就是 Host 会执行的那一批。
    var effective = effectiveChains(value)
    return {
      // 与 host schema 的默认值同源：接管会改请求实际打到的渠道，默认关。
      enabled: value.enabled ?? false,
      chains: effective.chains.map(normalizeNamedChain),
      defaultChainId: effective.defaultChainId,
      // A config saved by an older build carries the flat health shape; the
      // three tiers are re-derived here so one old row cannot leave the UI
      // reading `undefined` for a tier that has a perfectly good default.
      health: normalizeHealth(value.health),
    }
  }
  var host = seed()
  var draft = seed()
  var ui = {
    activeId: null,
    // 链列表里正在编辑的那一条（null = 默认链）。这是视图状态，不是配置：不写进 draft，
    // 也不参与脏检查——"我在看哪条链"与"配置改了什么"是两件事。
    chainId: null,
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
    // Why the channel history could not be read, or null when the last read was
    // whole. A failed read used to fall through to an empty fold, which renders
    // exactly like "no channel has ever run" — the one lie this workspace cannot
    // afford, since its whole job is telling the user what a channel did.
    //
    // Note: 为何"读不到"必须上屏 —— 见
    // .agents/notes/implemented/2026-10-21-connectivity-deadline-and-honest-history.md
    passiveError: null,
    // 这一版更新日志是否该弹：只在浏览器记录的版本与当前产物不同（或从没记过）
    // 时为真。关掉即记账，所以同版本不会每次打开都弹。
    notesOpen: initialNotesOpen,
  }
  var saving = false
  var failed = false
  // 本插件"面"的在位计数。唯一的持有者是侧栏弹窗里的工作台（page.ts 的挂载
  // 副作用）——侧栏入口按钮本身不计数：它常驻，一计数 surfaceActive() 就恒真，
  // Ctrl+S 会被全局认领（regions 覆盖输入框与终端），而只读时 save() 只是空转、
  // 并不阻止认领。仍然是计数不是布尔：React 的 effect 成对到来（严格模式下
  // 挂-卸-挂），一次不配对的释放不该把门永久焊死。
  // 原生快捷键命令靠它判断"现在该不该由我接这个键"——DSH 的快捷键上下文只告诉
  // 它有没有模态、是哪個模态，不告诉它哪个设置面在前台。
  var surfaceCount = 0

  function project() {
    var snapshot = scope.getSnapshot()
    var problems = validate(draft)
    // The store freezes what it is given, so the published state must be a
    // detached snapshot: the controller keeps mutating its own draft.
    var published = clone(draft)
    // 默认链在快照里还有一份别名 `chain`：界面按"一条链"编辑，而链列表里的哪一条
    // 是默认链只有 draft 知道。它是派生的视图、不是第二份状态——draft 上并没有这个
    // 键，`dirty` 比较的也是没有它的那一份；冻结发生在 clone 之后，所以草稿不受影响。
    published.chain = edited(published)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: !deepEqual(draft, host),
      invalid: problems.length > 0,
      saving: saving,
      failed: failed,
      draft: published,
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
        passiveError: ui.passiveError,
        notesOpen: ui.notesOpen,
      },
    }
  }
  var store = createSnapshotStore(project())
  var disposed = false
  function publish() {
    // 卸载之后的迟到发布（在飞远程调用的回调、忙态下限的 setTimeout）会经
    // armDiscoverTimer 把定时器复活——dispose 清掉的 interval 又回来了，而 UI
    // 早已不在，巡检周期对着一个卸载了的 fiber 空转。卸载后 publish 什么都不做。
    if (disposed) return
    store.set(project()); armDiscoverTimer()
  }

  /**
   * 定时连通性检查。跑在浏览器/桌面壳里，所以只在整个 DSH 界面开着的时候有效——
   * 这一点在设置里写明了，不假装是后台常驻。周期由用户按自己渠道的限流承受
   * 能力定，插件不设下限：限流是每个渠道各自的，不是几个渠道加起来算的。
   *
   * 周期读 **host**（已保存的配置）而不是 draft：未保存的编辑不该改变正在跑的
   * 巡检节奏，保存成功才重新武装——与宿主侧探针定时器"保存即 fiber 重启按新周期
   * 重武装"是同一套语义。
   */
  var discoverTimer = null
  var armedSeconds = -1
  // 忙态的最短可见时长：长到看得清、短到不觉慢。见 controller.holdBusy 的注释——
  // 预检即失败的路由（NO_ADAPTER / MISSING_CREDENTIAL）会在微任务里 resolve，
  // 不设下限的话"忙"和"完成"被 React 批进同一帧，用户看不到任何反馈。
  var MIN_BUSY_MS = 450
  function armDiscoverTimer() {
    var health = host.health || {}
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
    // 窗口规则与 host 的 pushTimelinePoint 同源（../timeline.ts 的 pruneTimeline：
    // 按时间戳保留 24 小时 + 条数上限）。此前这里是"最近 24 次观测"，与 host 的
    // 同一句注释说的是两件事——合并后看到的比投影里存的多/少，而时间轴现在画的是
    // 固定格数 × 时长桶，裁剪规则不一致就会让柱子与可用率各算一套。
    return Object.assign({}, newer, { timeline: pruneTimeline(points) })
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
  /** An error as one line of text, for a message that has to be shown as-is. */
  function describeError(error) {
    if (error && typeof error.message === 'string' && error.message.length > 0) return error.message
    return String(error)
  }

  function loadPassive() {
    var session = ctx.remote && ctx.remote.session
    if (!session) return
    // Failures are collected rather than swallowed: a read that yields nothing
    // renders identically to "this channel never ran", so the difference has to
    // reach the screen (see `ui.passiveError`).
    var failures = []
    session.list({}).then(function (result) {
      if (!result.ok) throw new Error(describeError(result.error) || 'session.list was refused')
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
          // A refused read is not "no records": the two must not fold into the
          // same empty state.
          if (!read.ok) throw new Error(describeError(read.error) || 'the projection read was refused')
          var values = read.value !== null ? (read.value.values ?? {}) : {}
          // 先拷贝再写入：store 的 set 会 dev-freeze 它收到的对象，之后往
          // 原对象上赋值在 dev 构建里会静默失败（圆点永远显示"未探测"）。
          return values['router/channel-health'] ?? null
        }).catch(function (error) {
          failures.push(describeError(error))
          return null
        })
      })).then(function (reads) { return { reads: reads, total: sessions.length } })
    }).then(function (page) {
      for (var i = 0; i < page.reads.length; i++) {
        mergePassiveRecords(page.reads[i])
      }
      ui.passiveError = failures.length === 0
        ? null
        : failures.length === page.total
          ? fill(t('healthHistoryUnreadable'), { error: failures[0] })
          : fill(t('healthHistoryPartial'), { failed: failures.length, total: page.total, error: failures[0] })
      publish()
    }).catch(function (error) {
      // The list itself failed, so not one session was read. Say that instead of
      // publishing the empty fold the old code left behind.
      ui.passiveError = fill(t('healthHistoryUnreadable'), { error: describeError(error) })
      publish()
    })
  }
  loadPassive()

  /**
   * Connectivity check: ask the Host for one or more routes' model lists
   * through DSH's own discovery — the same call the Models page's "fetch
   * available models" button makes. It sends no content, so it costs no tokens,
   * and it proves three things a stale config cannot: the endpoint answers,
   * the credential is accepted, and this model id is advertised.
   *
   * The call goes to this plugin's own Host face rather than to
   * `remote.llm.discoverModels` directly, because the classification has to
   * happen where the `LlmError` code is still alive — see
   * ../connectivity.ts. The browser receives an already-classified verdict and
   * never has to guess from a message.
   *
   * A run always answers for every route it was asked about: the Host
   * guarantees one verdict per requested route, and the two paths that cannot
   * reach it at all (the face unmounted, the call refused) synthesize the
   * honest "could not check" verdict per route instead of leaving holes — a
   * route nobody answered for is exactly 没能检查, and a summary that silently
   * omits it would under-report what the user asked for.
   *
   * Note: 为何这条路必须走宿主（LlmError.code 过不了 Remote 信封）—— 见
   * .agents/notes/implemented/2026-10-16-connectivity-no-discovery-is-not-a-refusal.md
   */
  // 在飞的连通性检查：卸载时全部 abort。发现调用是真实网络请求，"0 Token"
  // 不等于"0 后果"——UI 走了还继续打端点既是浪费，也可能把渠道打出限流。
  // 信号经 Typert 的 cancellation 通道到宿主（描述符声明 signal 末参即注入，
  // 与 probeAll 同一机制），宿主把取消传进 discoverModels。
  var checkAborts = new Set()
  // 在飞的探测：与连通性检查同契约。探测花的是真 token，面板一关就必须停，
  // 不能只靠宿主侧的超时兜底。
  var probeAborts = new Set()
  function runCheck(routes, signal) {
    var health = ctx.remote && ctx.remote.routerHealth
    var cannotCheck = function () {
      return routes.map(function (route) {
        return { provider: route.provider, model: route.model, kind: 'unavailable', reason: 'hostUnavailable' }
      })
    }
    if (!health || typeof health.checkConnectivity !== 'function') return Promise.resolve(cannotCheck())
    return health.checkConnectivity({ routes: routes }, signal).then(function (result) {
      if (!result || result.ok !== true) return cannotCheck()
      return result.value ?? []
    }, cannotCheck)
  }

  /** Ask one route whether its endpoint answers and advertises this model. */
  function checkRoute(provider, model, signal) {
    return runCheck([{ provider: provider, model: model }], signal).then(function (verdicts) {
      return verdicts[0] ?? { provider: provider, model: model, kind: 'unavailable', reason: 'hostUnavailable' }
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
    publish()
  })

  /**
   * The chain the editor is editing: the default one.
   *
   * Every section of the workbench (start strategy, first hop, fallbacks,
   * switch-on, budget) edits ONE chain, and `seed()` guarantees the draft has at
   * least one (a config with no chains is normalized to one empty chain). Chain
   * management — adding, renaming, deleting, choosing the default — is what the
   * settings panel's chain list does; it edits `draft.chains` directly.
   */
  function edited(target) {
    var picked = ui.chainId === null
      ? undefined
      : target.chains.filter(function (chain) { return chain.id === ui.chainId })[0]
    return picked !== undefined ? picked : defaultChainOf(target)
  }

  /** 链名的上限：够写清任务，又不至于把链列表撑爆。 */
  var CHAIN_NAME_MAX = 40

  /** 新链的 id：chain-2、chain-3… 取第一个没被占用的（id 是身份，不能撞）。 */
  function nextChainId(chains) {
    for (var index = 2; index < 1000; index += 1) {
      var candidate = 'chain-' + index
      if (!chains.some(function (chain) { return chain.id === candidate })) return candidate
    }
    return 'chain-' + String(Date.now())
  }

  var controller = {
    store: store,
    /** The dialog's workbench mounted. */
    retainSurface: function () { surfaceCount += 1 },
    /** That workbench unmounted. */
    releaseSurface: function () { if (surfaceCount > 0) surfaceCount -= 1 },
    /** Whether our workbench is mounted at all — the shortcut command's gate. */
    surfaceActive: function () { return surfaceCount > 0 },
    setEnabled: function (value) { draft.enabled = value; publish() },
    /** 选一条链来编辑（五个分区改的就是它）。 */
    selectChain: function (id) { ui.chainId = id; publish() },
    /** 新增一条空链，并立刻切到它上面编辑。 */
    addChain: function () {
      var id = nextChainId(draft.chains)
      draft.chains.push(Object.assign({ id: id, name: '' }, defaultChainValue()))
      ui.chainId = id
      publish()
    },
    /**
     * 复制一条链：候选 / switchOn / 预算 / 粘滞 / 策略整份带走，只换 id 与显示名。
     *
     * 用户要的是"同一条链只换一条候选"时不重配。副本是**显式动作**（对某条链点「复制」），
     * 不是"添加链"的默认行为——新链默认仍是空链，否则"两条完全一样"会成为默认状态。
     * 名字在这里落成当前语言的一份快照：它是显示名、可改，不值得为它建一套跨语言引用。
     */
    copyChain: function (id) {
      var source = draft.chains.filter(function (entry) { return entry.id === id })[0]
      if (source === undefined) return
      var copy = clone(source)
      copy.id = nextChainId(draft.chains)
      copy.name = fill(t('chainCopyName'), { name: source.name !== '' ? source.name : t('chainDefaultName') }).slice(0, CHAIN_NAME_MAX)
      draft.chains.push(copy)
      ui.chainId = copy.id
      publish()
    },
    renameChain: function (id, value) {
      var chain = draft.chains.filter(function (entry) { return entry.id === id })[0]
      if (chain === undefined) return
      // 名字只是显示；id 才是身份，所以改名不会动任何会话绑定。
      chain.name = String(value === undefined || value === null ? '' : value).slice(0, CHAIN_NAME_MAX)
      publish()
    },
    setDefaultChain: function (id) {
      if (!draft.chains.some(function (entry) { return entry.id === id })) return
      draft.defaultChainId = id
      publish()
    },
    removeChain: function (id) {
      // 最后一条链不能删：没有链的配置等于"插件完全不接管"，那不是用户点删除时想要的。
      if (draft.chains.length <= 1) return
      draft.chains = draft.chains.filter(function (entry) { return entry.id !== id })
      if (draft.defaultChainId === id) draft.defaultChainId = draft.chains[0].id
      if (ui.chainId === id) ui.chainId = null
      publish()
    },
    setActive: function (id) {
      ui.activeId = id
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
      ui.chainId = null
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
        { op: 'set', path: ['chains'], value: draft.chains },
        { op: 'set', path: ['defaultChainId'], value: draft.defaultChainId },
        // 旧形状的单链键：迁移之后就不能留第二份「当前链」，否则下一次加载看到两个
        // 形状并存，谁赢取决于一条迁移规则，而用户以为自己改的是另一份。
        { op: 'unset', path: ['chain'] },
        { op: 'set', path: ['health'], value: draft.health },
      ], scope.getSnapshot().revision).then(function (accepted) {
        saving = false
        failed = !accepted
        publish()
      }, function (e) {
        saving = false
        failed = true
        publish()
      })
    },
    /** Add fallback candidates to the one chain. */
    addCandidates: function (entries) {
      entries.forEach(function (entry) {
        // 目录选择只带 route（provider/model）：重试次数先给默认值，之后在链上逐条改。
        edited(draft).candidates.push(Object.assign({ maxRetries: DEFAULT_MAX_RETRIES }, entry))
      })
      ui.modal = null
      publish()
    },
    removeCandidate: function (index) {
      edited(draft).candidates.splice(index, 1)
      publish()
    },
    reorderCandidates: function (fromIndex, toIndex) {
      var list = edited(draft).candidates
      if (fromIndex >= list.length || toIndex >= list.length || fromIndex === toIndex) return
      var item = list.splice(fromIndex, 1)[0]
      list.splice(toIndex, 0, item)
      publish()
    },
    moveCandidate: function (index, direction) {
      // 一次移动就是一次换位：与拖拽走同一条重排路径。曾有两套实现（splice 搬家
      // 与相邻交换），边界守卫各写各的，改一边忘了另一边就静默出错。
      controller.reorderCandidates(index, index + direction)
    },
    setMaxRetries: function (index, value) {
      var candidate = edited(draft).candidates[index]
      var parsed = Number(value)
      candidate.maxRetries = Number.isFinite(parsed) ? Math.min(MAX_RETRIES, Math.max(0, Math.round(parsed))) : DEFAULT_MAX_RETRIES
      publish()
    },
    /** Patch one candidate's `needs`; an empty patch clears the field. */
    setNeeds: function (index, patch) {
      var candidate = edited(draft).candidates[index]
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
    setStickyTurns: function (value) {
      var parsed = Number(value)
      edited(draft).stickyTurns = Number.isFinite(parsed) ? Math.min(99, Math.max(0, Math.round(parsed))) : 0
      publish()
    },
    setFirstHopMaxRetries: function (value) {
      var parsed = Number(value)
      edited(draft).firstHopMaxRetries = Number.isFinite(parsed) ? Math.min(MAX_RETRIES, Math.max(0, Math.round(parsed))) : DEFAULT_FIRST_HOP_MAX_RETRIES
      publish()
    },
    toggleSwitchOn: function (key) {
      edited(draft).switchOn[key] = !edited(draft).switchOn[key]
      publish()
    },
    setStrategy: function (value) {
      // 策略只管起点，所以名单本身不动——只改"从哪条开始"。
      edited(draft).strategy = value
      publish()
    },
    setWeight: function (index, value) {
      var parsed = Number(value)
      var clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0
      if (edited(draft).candidates[index] !== undefined) edited(draft).candidates[index].weight = clamped
      publish()
    },
    openModal: function (modal) {
      ui.modal = modal
      ui.riskAck = false
      // The catalog is loaded lazily: at apply time the host may still be
      // registering adapters, and an early read caches an empty catalog
      // forever.
      if (modal.kind === 'add-candidate') ensureCatalog()
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
    /** Run a connectivity check on every configured route (the chain's candidates). */
    checkAll: function () {
      if (ui.checking) return
      ui.checking = true
      ui.checkSummary = null
      publish()
      var started = Date.now()
      var keys = configuredRouteList(draft)
      // keys 是 `provider/model` 字符串（拼拆规则都在 ../routes.ts）；拆回两半
      // 交给检查器。
      var routes = keys.map(routeParts)
      var abort = new AbortController()
      checkAborts.add(abort)
      // 一次调用问完整轮：分类在宿主侧，一轮检查因此也只是一次往返。
      runCheck(routes, abort.signal).then(function (verdicts) {
        checkAborts.delete(abort)
        // 先拷贝后写入——store 的 set 会 dev-freeze 它收到的对象，往原对象
        // 上赋值在 dev 构建里会静默失败。
        var next = Object.assign({}, ui.discover)
        verdicts.forEach(function (verdict) { next[routeKeyOf(verdict.provider, verdict.model)] = verdict })
        ui.discover = next
        // 汇总按"这一轮被问到的每一条"算：宿主对每条请求都给一个判定，两条
        // 到不了宿主的路径也按条补上"没能检查"。少算一条就是少报一次故障。
        ui.checkSummary = summarizeChecks(routes.map(function (route) {
          return next[routeKeyOf(route.provider, route.model)]
            ?? { provider: route.provider, model: route.model, kind: 'unavailable', reason: 'hostUnavailable' }
        }), t)
        // 连通性检查跑完顺带重取被动快照：定时轮次开着的时候，健康工作台要跟着
        // 真实发生的事走，而不是停在页面挂载那一刻。
        loadPassive()
        controller.holdBusy(started, function () {
          ui.checking = false
          publish()
        })
      }).catch(function () {
        checkAborts.delete(abort)
        controller.holdBusy(started, function () {
          ui.checking = false
          publish()
        })
      })
    },
    /** Run a connectivity check on a single route (0 Token discovery check). */
    checkRouteSingle: function (provider, model) {
      var key = routeKeyOf(provider, model)
      if (ui.checkingRoutes && ui.checkingRoutes[key]) return
      ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
      ui.checkingRoutes[key] = true
      publish()
      var started = Date.now()
      var abort = new AbortController()
      checkAborts.add(abort)
      return checkRoute(provider, model, abort.signal).then(function (verdict) {
        checkAborts.delete(abort)
        ui.discover = Object.assign({}, ui.discover)
        ui.discover[key] = verdict
        controller.holdBusy(started, function () {
          ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
          delete ui.checkingRoutes[key]
          publish()
        })
      }).catch(function () {
        checkAborts.delete(abort)
        controller.holdBusy(started, function () {
          ui.checkingRoutes = Object.assign({}, ui.checkingRoutes)
          delete ui.checkingRoutes[key]
          publish()
        })
      })
    },
    updateHealth: function (patch) {
      draft.health = Object.assign({}, draft.health, patch)
      publish()
    },
    /**
     * Hold the busy state on screen long enough to be perceived, then `settle`.
     *
     * A route the Host cannot even assemble fails before any I/O —
     * `NO_ADAPTER` when the provider is not registered here,
     * `MISSING_CREDENTIAL` when it has no key — so the promise resolves in a
     * microtask. React then batches the "busy" and "done" publishes into one
     * render and the user sees nothing at all: measured on such a route, the two
     * DOM commits land 2ms and 7ms after the click, i.e. the spinner exists for
     * five milliseconds and is never painted. A click that looks ignored reads
     * as a frozen app, which is worse than a slow one, so the busy state is held
     * for a floor. The real duration still wins whenever it is longer — this
     * only ever adds visible time to a failure that was instantaneous.
     *
     * @param started - `Date.now()` taken when the busy state was published.
     * @param settle - clears the busy state and publishes the result.
     */
    holdBusy: function (started, settle) {
      var left = MIN_BUSY_MS - (Date.now() - started)
      if (left <= 0) { settle(); return }
      setTimeout(settle, left)
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
          next[routeKeyOf(entry.provider, entry.model)] = entry
        })
        ui.probe = next
        publish()
      }).catch(function () {})
    },
    /** Probe one route end to end (1 token, cut at the first content byte). */
    probeRouteSingle: function (provider, model) {
      var key = routeKeyOf(provider, model)
      if (ui.probingRoutes && ui.probingRoutes[key]) return
      var health = ctx.remote && ctx.remote.routerHealth
      if (!health || typeof health.probeAll !== 'function') return
      ui.probingRoutes = Object.assign({}, ui.probingRoutes)
      ui.probingRoutes[key] = true
      publish()
      var started = Date.now()
      var abort = new AbortController()
      probeAborts.add(abort)
      health.probeAll({ routes: [{ provider: provider, model: model }] }, abort.signal).then(function (result) {
        probeAborts.delete(abort)
        if (result && result.ok === true) {
          var next = Object.assign({}, ui.probe)
          ;(result.value.routes ?? []).forEach(function (entry) {
            next[routeKeyOf(entry.provider, entry.model)] = entry
          })
          ui.probe = next
        }
        controller.holdBusy(started, function () {
          ui.probingRoutes = Object.assign({}, ui.probingRoutes)
          delete ui.probingRoutes[key]
          publish()
        })
      }).catch(function () {
        probeAborts.delete(abort)
        controller.holdBusy(started, function () {
          ui.probingRoutes = Object.assign({}, ui.probingRoutes)
          delete ui.probingRoutes[key]
          publish()
        })
      })
    },
    /** Probe every configured route (the chain's candidates). */
    probeAll: function () {
      if (ui.probing) return
      var health = ctx.remote && ctx.remote.routerHealth
      if (!health || typeof health.probeAll !== 'function') return
      var routes = configuredRouteList(draft).map(routeParts)
      ui.probing = true
      ui.probeSummary = null
      publish()
      var started = Date.now()
      var abort = new AbortController()
      probeAborts.add(abort)
      health.probeAll({ routes: routes }, abort.signal).then(function (result) {
        probeAborts.delete(abort)
        if (result && result.ok === true) {
          var next = Object.assign({}, ui.probe)
          ;(result.value.routes ?? []).forEach(function (entry) {
            next[routeKeyOf(entry.provider, entry.model)] = entry
          })
          ui.probe = next
          ui.probeSummary = summarizeProbes(result.value.routes ?? [], t)
        }
        loadProbeReport()
        controller.holdBusy(started, function () {
          ui.probing = false
          publish()
        })
      }).catch(function () {
        probeAborts.delete(abort)
        controller.holdBusy(started, function () {
          ui.probing = false
          publish()
        })
      })
    },
    openHealthModal: function () {
      ui.modal = { kind: 'health' }
      publish()
    },
    /** Re-open this release's notes from the page head. */
    openNotes: function () {
      ui.notesOpen = true
      publish()
    },
    /** Dismiss the notes and remember this release, so they do not nag on reload. */
    closeNotes: function () {
      rememberVersion()
      ui.notesOpen = false
      publish()
    },
    /** 供插件半包卸载时调用：停掉定时轮询、取消在飞的检查，别留下孤儿 interval 与孤儿请求。 */
    dispose: function () {
      disposed = true
      if (discoverTimer !== null) { clearInterval(discoverTimer); discoverTimer = null }
      armedSeconds = -1
      checkAborts.forEach(function (abort) { abort.abort() })
      checkAborts.clear()
      probeAborts.forEach(function (abort) { abort.abort() })
      probeAborts.clear()
    },
  }
  return controller
}

/**
 * What a connectivity run found: reachable, advertised-but-not-this-model,
 * refused, and could-not-check are four different answers and are counted
 * separately — the last one says nothing about the channel.
 */
function summarizeChecks(verdicts, t) {
  return summarize(verdicts, function (verdict) {
    if (verdict.kind === 'reachable') return 'ok'
    if (verdict.kind === 'notAdvertised') return 'partial'
    if (verdict.kind === 'unreachable') return 'bad'
    return 'unknown'
  }, [
    { key: 'ok', label: t('checkSummaryOk') },
    { key: 'partial', label: t('checkSummaryPartial') },
    { key: 'bad', label: t('checkSummaryBad') },
    { key: 'unknown', label: t('checkSummaryUnknown') },
  ])
}

/** What a probe run found: passed, refused, and could-not-run. */
function summarizeProbes(routes, t) {
  return summarize(routes, function (entry) {
    if (entry.kind === 'reachable') return 'ok'
    if (entry.kind === 'unreachable') return 'bad'
    return 'unknown'
  }, [
    { key: 'ok', label: t('probeSummaryOk') },
    { key: 'bad', label: t('probeSummaryBad') },
    { key: 'unknown', label: t('probeSummaryUnknown') },
  ])
}
