/**
 * The session's routing chip: which chain THIS conversation routes on.
 *
 * It lives in `conversation.input.left`, the composer tool row's session-scoped
 * list slot — after the permission and Plan controls, before the model selector.
 * Routing and the model are the same kind of decision ("where does this turn
 * go"), so the user should not have to look in two places for them. The slot
 * hands every occupant its `sessionId` (ui-session/src/client/index.ts:166-175),
 * so nothing here guesses which conversation is in front.
 *
 * Geometry is taken from DSH's own neighbouring control, not invented: the model
 * and permission triggers are 28px tall, `0 4px 0 8px` padded, `--dsw-radius-sm`
 * rounded, 13/20/400 in `--dsw-alias-label-secondary`, hover
 * `--dsw-alias-interactive-bg-hover`, with a 12px chevron
 * (ModelSelect.module.css / PermissionSelect.module.css). The narrow-container
 * collapse copies PermissionSelect's `@container (max-width: 460px)` rule, so all
 * three chips give up their labels at the same width.
 *
 * The popover is DSH's `Menu` primitive in portal mode (focus/Escape/outside
 * click/anchoring all come from it). A failed write keeps it open and shows the
 * error inside: closing it would leave the user with a chip that shows a choice
 * the Host never stored.
 *
 * Note: 为何绑定存 storageDomain 侧车、0 与"没填"的区别 —— 见
 * .agents/notes/implemented/2026-10-21-per-session-bindings.md
 * Note: 命名链、默认链与会话绑定的取值规则 —— 见
 * .agents/notes/implemented/2026-10-21-named-chains-and-the-session-chip.md
 */

import { useEffect, useRef, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { h } from './dom.ts'
import { fill } from './format.ts'
import { Icon, ICON_DOWN, ICON_ROUTE } from './icons.ts'
import { effectiveChains } from '../chain.ts'
import { MAX_SESSION_RETRIES } from '../defaults.ts'
import { parseRetryInput } from './validate.ts'
import { routeKeyOf } from '../routes.ts'
import { routeNames } from './naming.ts'
import { CONFIG_NS } from './locales.ts'

/** Popover row id for "follow the default chain": the stored binding is `chain: null` then. */
export var FOLLOW_DEFAULT = '__follow_default__'

/** One chip's state for one session. */
function freshChipView() {
  return {
    // 读取完成前不算"没有绑定"：两者在 chip 上长得一样，但只有后者能做决定。
    loading: true,
    chain: null,
    retries: {},
    persistent: true,
    open: false,
    saving: false,
    error: null,
    chains: [],
    defaultChainId: '',
    /** 正在输入、还没提交的重试次数，按路由键控（空串 = 用户清空了这一行）。 */
    retryDraft: {},
    /**
     * 重试行上那几条路由的显示名（目录未读到/不含这条路由时就是原始 id）。
     * 目录在一次激活里不会变，所以它随第一次读到落进视图，之后的 set 都带着它。
     */
    names: routeNames(null),
  }
}

function describeError(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/**
 * The chip's state machine, one entry per session.
 *
 * Split from the component so the write path is testable without React: the
 * component is a pure view over {@link view}, and the browser suite drives the
 * same methods the component calls.
 *
 * @param ctx - browser plugin context (config scope + the plugin's own Remote).
 * @param t - the bound dictionary.
 */
export function createSessionChip(ctx, t) {
  var views = new Map()
  var listeners = new Set()

  function stateOf(sessionId) {
    var current = views.get(sessionId)
    if (current === undefined) {
      current = freshChipView()
      views.set(sessionId, current)
    }
    return current
  }

  function set(sessionId, patch) {
    views.set(sessionId, Object.assign({}, stateOf(sessionId), patch))
    // 每个会话一个监听器集合不划算：同时只有一个 composer 在渲染，谁订阅谁重读。
    listeners.forEach(function (fn) { fn() })
  }

  /** The config's chains, read fresh: a save in the settings panel happens in another surface. */
  function chainsNow() {
    var scope = ctx.configForms.get(CONFIG_NS)
    var value = scope.getSnapshot().value ?? {}
    var effective = effectiveChains(value)
    return { chains: effective.chains, defaultChainId: effective.defaultChainId }
  }

  function health() {
    var remote = ctx.remote && ctx.remote.routerHealth
    return remote !== undefined && typeof remote.sessionBinding === 'function' ? remote : undefined
  }

  /**
   * The catalog read behind the retry rows' display names.
   *
   * Same read口 as the add-candidate dialog (`session/modelCatalog`), but the
   * chip is a different surface with its own lifetime, so it keeps its own
   * promise: read once per activation, and a refused/failed read is `null` —
   * the rows then show the raw route keys rather than names nobody confirmed.
   */
  var catalogPromise = null
  var names = routeNames(null)
  function loadNames() {
    if (catalogPromise === null) {
      catalogPromise = Promise.resolve(ctx.remote.session.modelCatalog()).then(
        // Remote 调用回来的是 `{ ok, value }` 信封（与 controller.ensureCatalog 同一个
        // 读口、同一个判据）：被拒或抛错都当"没有目录"，行上显示原始键。
        function (result) { return result !== null && result !== undefined && result.ok === true ? result.value : null },
        function () { return null },
      )
      catalogPromise.then(function (catalog) {
        names = routeNames(catalog)
        // 每一行都跟着变：会话 id 由视图自己带着，这里只把新名字发给当前打开的视图。
        views.forEach(function (_current, key) { set(key, { names: names }) })
      })
    }
    return catalogPromise
  }

  function unwrap(result) {
    if (!result || result.ok !== true) {
      var message = result && result.error && typeof result.error.message === 'string' ? result.error.message : ''
      throw new Error(message || t('sessionChainRefused'))
    }
    return result.value
  }

  /**
   * Write the retry overrides for `routes` in ONE `setSessionBinding`.
   *
   * `routes` are draft keys chosen by the caller: a single row for blur/Enter,
   * every pending row for an outside close. Parsing the whole set before the
   * write means one invalid box cannot leave half the edits persisted.
   *
   * @param sessionId - the session whose binding is written.
   * @param routes - draft keys to merge into the stored retry map.
   */
  function writeRetries(sessionId, routes) {
    var current = stateOf(sessionId)
    var retries = Object.assign({}, current.retries)
    for (var index = 0; index < routes.length; index += 1) {
      var route = routes[index]
      var parsed = parseRetryInput(Object.hasOwn(current.retryDraft, route) ? current.retryDraft[route] : '')
      if (parsed.kind === 'invalid') {
        set(sessionId, { error: fill(t('sessionRetryInvalid'), { max: MAX_SESSION_RETRIES }) })
        return Promise.resolve(stateOf(sessionId))
      }
      if (parsed.kind === 'follow') delete retries[route]
      else retries[route] = parsed.value
    }
    var remote = health()
    if (remote === undefined) {
      set(sessionId, { error: t('sessionChainUnavailable') })
      return Promise.resolve(stateOf(sessionId))
    }
    set(sessionId, { saving: true, error: null })
    return Promise.resolve(remote.setSessionBinding({
      sessionId: sessionId,
      chain: current.chain,
      retries: retries,
    })).then(unwrap).then(function (view) {
      var draft = Object.assign({}, stateOf(sessionId).retryDraft)
      routes.forEach(function (route) { delete draft[route] })
      set(sessionId, {
        saving: false,
        retries: view.retries !== undefined ? view.retries : {},
        retryDraft: draft,
        persistent: view.persistent !== false,
        error: null,
      })
      return stateOf(sessionId)
    }, function (error) {
      set(sessionId, { saving: false, error: describeError(error) })
      return stateOf(sessionId)
    })
  }

  return {
    /** Subscribe to any chip's state change; returns the unsubscribe function. */
    subscribe: function (fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    },

    /** The current view for one session; a session nobody loaded reads as loading. */
    view: function (sessionId) {
      return stateOf(sessionId)
    },

    /**
     * Read the binding (and the chain list) for this session.
     *
     * Runs on mount and again whenever the popover opens: the settings surface
     * may have renamed or removed chains in between, and a chip that keeps
     * showing a deleted chain is worse than one that reads again.
     */
    load: function (sessionId) {
      var config = chainsNow()
      set(sessionId, { chains: config.chains, defaultChainId: config.defaultChainId, names: names })
      // 目录只读一次，读到之前行上是原始键——不假装知道名字。
      loadNames()
      var remote = health()
      if (remote === undefined) {
        // 读口不在（宿主正在卸载）时不要卡在 loading：那与"没有绑定"长得一样，
        // 用户会以为这个会话没有路由设置。明说，并保留默认链的显示。
        set(sessionId, { loading: false, error: t('sessionChainUnavailable') })
        return Promise.resolve(stateOf(sessionId))
      }
      return Promise.resolve(remote.sessionBinding(sessionId)).then(unwrap).then(function (view) {
        set(sessionId, {
          loading: false,
          chain: view.chain,
          retries: view.retries !== undefined ? view.retries : {},
          // 读到的值就是输入框的值：未提交的编辑不能盖住刚落库的状态。
          retryDraft: {},
          // 老宿主（没有这个字段）按"能持久化"显示：它是默认行为，而不是新事实。
          persistent: view.persistent !== false,
          error: null,
        })
        return stateOf(sessionId)
      }, function (error) {
        set(sessionId, { loading: false, error: describeError(error) })
        return stateOf(sessionId)
      })
    },

    /** Open the popover: read the fresh chain list and the stored binding. */
    open: function (sessionId) {
      var config = chainsNow()
      set(sessionId, { open: true, error: null, chains: config.chains, defaultChainId: config.defaultChainId })
      return this.load(sessionId)
    },

    close: function (sessionId) {
      set(sessionId, { open: false })
    },

    toggle: function (sessionId) {
      return stateOf(sessionId).open ? this.close(sessionId) : this.open(sessionId)
    },

    /** 记录一行重试次数正在输入的值（提交前只活在视图里）。 */
    setRetryText: function (sessionId, route, text) {
      var draft = Object.assign({}, stateOf(sessionId).retryDraft)
      draft[route] = text === undefined || text === null ? '' : String(text)
      set(sessionId, { retryDraft: draft })
    },

    /**
     * Persist one route's retry override.
     *
     * 空 = 跟随链（删掉这个键），0..9 = 覆盖（0 是"这条路由不重试"）。越界值不猜、
     * 不夹：夹到 9 会让用户以为他写的 10 生效了。写入失败时保留用户输入并原地报错——
     * 与换链同一条契约（成功才刷新）。
     *
     * Note: 为何提交在失焦/回车、为何只列本会话那条链的候选 —— 见
     * .agents/notes/implemented/2026-10-21-retry-overrides-and-chain-management.md
     */
    commitRetry: function (sessionId, route) {
      return writeRetries(sessionId, [route])
    },

    /**
     * Close the popover because the pointer went outside it.
     *
     * The primitive closes on `pointerdown`, before the browser moves focus, so
     * the input's `blur` never runs and the typed value would be lost. An
     * outside click IS a blur: write the pending drafts first, then close on
     * success. A rejected write keeps the popover open with its error (the same
     * contract as choosing a chain) instead of pretending the value landed.
     *
     * Escape does not come through here — {@link close} is the cancel path and
     * must leave storage untouched.
     */
    dismiss: function (sessionId) {
      var routes = Object.keys(stateOf(sessionId).retryDraft)
      if (routes.length === 0) {
        set(sessionId, { open: false })
        return Promise.resolve(stateOf(sessionId))
      }
      return writeRetries(sessionId, routes).then(function (view) {
        // writeRetries clears `error` on success and sets it on every refusal,
        // so this is "the Host accepted the write", not "an error is absent".
        if (view.error === null) set(sessionId, { open: false })
        return stateOf(sessionId)
      })
    },

    /**
     * Bind this session to one chain (`null` = follow the default chain).
     *
     * Success means saved: the chip only refreshes and the popover only closes
     * after the Host answered with the stored binding. A rejection keeps the
     * popover open with the message inside, so the user can retry in place.
     */
    choose: function (sessionId, chainId) {
      var current = stateOf(sessionId)
      if (current.saving) return Promise.resolve(current)
      var remote = health()
      if (remote === undefined) {
        set(sessionId, { error: t('sessionChainUnavailable') })
        return Promise.resolve(stateOf(sessionId))
      }
      set(sessionId, { saving: true, error: null })
      // 重试覆盖原样带上：这次交互只改"哪条链"，不碰每路由次数（那是弹层里的另一块）。
      return Promise.resolve(remote.setSessionBinding({
        sessionId: sessionId,
        chain: chainId === FOLLOW_DEFAULT ? null : chainId,
        retries: current.retries,
      })).then(unwrap).then(function (view) {
        set(sessionId, {
          saving: false,
          open: false,
          chain: view.chain,
          retries: view.retries !== undefined ? view.retries : {},
          persistent: view.persistent !== false,
          error: null,
        })
        return stateOf(sessionId)
      }, function (error) {
        set(sessionId, { saving: false, error: describeError(error) })
        return stateOf(sessionId)
      })
    },
  }
}

/** A chain's display name; an unnamed chain is the dictionary's "default chain". */
function chainNameOf(view, chainId, t) {
  var chain = view.chains.filter(function (entry) { return entry.id === chainId })[0]
  if (chain === undefined) return chainId
  return chain.name !== '' ? chain.name : t('chainDefaultName')
}

/**
 * The chip itself.
 *
 * @param props.sessionId - the session this composer belongs to (slot standard prop).
 * @param props.t - the bound dictionary.
 * @param props.sessionChip - {@link createSessionChip}'s model, injected as a plain
 *   prop. Deliberately NOT under the reserved `hooks` key: that compartment is for
 *   host observable sources the runtime turns into `use*` selector hooks
 *   (ui-slots/src/index.ts:503-510), and this model is the plugin's own.
 */
export function SessionChainChip(props) {
  var t = props.t
  var sessionId = props.sessionId
  var chip = props.sessionChip
  var bump = useState(0)
  var setBump = bump[1]
  useEffect(function () {
    return chip.subscribe(function () { setBump(function (value) { return value + 1 }) })
  }, [chip])
  useEffect(function () { chip.load(sessionId) }, [chip, sessionId])
  // The primitive reports Escape and outside pointerdown through one onClose
  // callback. Remember which one it was: window capture runs before Menu's
  // document-capture Escape handler, so the flag is set by the time onClose
  // runs. Every other close (outside click, window blur) is a focus loss and
  // commits the pending draft.
  var cancelled = useRef(false)
  useEffect(function () {
    function onKeyDown(event) {
      if (event.key === 'Escape' && event.shiftKey !== true && chip.view(sessionId).open === true) {
        cancelled.current = true
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return function () { window.removeEventListener('keydown', onKeyDown, true) }
  }, [chip, sessionId])

  var view = chip.view(sessionId)
  // 未绑定时显示"实际会走的那条链"：默认链有名字就写名字，没有才是字典的「默认链」。
  // 写死「默认链」会让默认链改名后，chip 与弹层都在说一条不存在的链。
  var defaultName = view.defaultChainId === '' ? t('chainDefaultName') : chainNameOf(view, view.defaultChainId, t)
  var label = view.loading
    ? t('sessionChainLoading')
    : view.chain === null ? defaultName : chainNameOf(view, view.chain, t)

  // 链行在弹层里是"一个带子菜单的行"：弹出体属于 Menu 原语，不自己搭 portal。
  // 原语不给子菜单行画箭头，所以行内自己排「链 | 名字 | ›」——否则这一行看起来
  // 只是一个静态标题，用户不会去点它。
  var chainRow = {
    id: 'chain',
    label: h('span', { className: 'dsh-router-session-chip-chain' }, [
      h('span', { key: 'key', className: 'dsh-router-session-chip-chain-key' }, t('sessionChainRowKey')),
      h('span', { key: 'value', className: 'dsh-router-session-chip-chain-value' }, label),
      h('span', { key: 'chevron', className: 'dsh-router-session-chip-chain-chevron', 'aria-hidden': 'true' }, '›'),
    ]),
    submenu: [{ id: FOLLOW_DEFAULT, label: t('sessionChainFollowDefault') }].concat(
      view.chains.map(function (chain) {
        return { id: chain.id, label: chain.name !== '' ? chain.name : t('chainDefaultName') }
      }),
    ),
  }
  var items = [
    { type: 'label', id: 'title', text: t('sessionRouteTitle') },
    chainRow,
  ]

  var extras = []
  // 每路由的重试覆盖：行来自"本会话会走的那条链"的候选——给一条用不上的路由配次数
  // 只会写进一个永远不生效的键。
  var activeChain = view.chains.filter(function (entry) {
    return entry.id === (view.chain === null ? view.defaultChainId : view.chain)
  })[0]
  var retryRows = activeChain === undefined ? [] : activeChain.candidates.map(function (candidate) {
    var route = routeKeyOf(candidate.provider, candidate.model)
    var label = view.names.route(candidate.provider, candidate.model)
    var typed = Object.hasOwn(view.retryDraft, route)
      ? view.retryDraft[route]
      : Object.hasOwn(view.retries, route) ? String(view.retries[route]) : ''
    return h('div', { key: route, className: 'dsh-router-session-chip-retry' },
      h('span', { className: 'dsh-router-session-chip-route', title: route }, label),
      h('input', {
        type: 'text',
        inputMode: 'numeric',
        className: 'dsh-router-session-chip-retry-input',
        'aria-label': fill(t('sessionRetryRowLabel'), { route: label }),
        title: fill(t('sessionRetryFollowsChain'), { retries: candidate.maxRetries }),
        placeholder: t('sessionRetryFollow'),
        disabled: view.saving === true,
        value: typed,
        onChange: function (event) { chip.setRetryText(sessionId, route, event.target.value) },
        onBlur: function () { chip.commitRetry(sessionId, route) },
        onKeyDown: function (event) { if (event.key === 'Enter') chip.commitRetry(sessionId, route) },
      }))
  })
  if (retryRows.length > 0) {
    extras.push(h('div', { key: 'retries', className: 'dsh-router-session-chip-retries' },
      h('div', { className: 'dsh-router-session-chip-retry-note dsh-router-session-chip-retry-note-title' }, t('sessionRetryTitle')),
      retryRows,
      h('div', { className: 'dsh-router-session-chip-retry-note' }, fill(t('sessionRetryHint'), { max: MAX_SESSION_RETRIES }))))
  }
  if (view.error !== null) {
    extras.push(h('div', { key: 'error', className: 'dsh-router-session-chip-error', role: 'alert' }, view.error))
  }
  if (view.persistent === false) {
    // 没有 storageDomain 的组合：绑定只在本次进程里有效。说出来，而不是等重启后
    // 用户以为自己的选择被人改了。
    extras.push(h('div', { key: 'memory', className: 'dsh-router-session-chip-note' }, t('sessionChainMemoryOnly')))
  }

  return h(Menu, {
    open: view.open === true,
    portal: true,
    align: 'start',
    // chip 坐在 composer 工具行（视口底部）：向下没有空间，Menu 只能钳到贴底并压住
    // 输入框。向上开才是它真正的位置（设计稿也是画在 composer 上方）。
    side: 'top',
    // 关闭只由 Menu 的自身交互触发（Escape / 点外部 / 失焦）：写失败时没人调它，
    // 弹层因此留在原地。Escape 是取消，不写；其余（点外部、窗口失焦）按失焦处理，
    // 先把待提交的重试草稿落盘——Menu 在 pointerdown 就关闭，输入框的 blur 根本来不及跑。
    onClose: function () {
      var cancel = cancelled.current
      cancelled.current = false
      if (cancel) chip.close(sessionId)
      else chip.dismiss(sessionId)
    },
    onSelect: function (id) { chip.choose(sessionId, id) },
    items: items,
    className: 'dsh-router-session-chip-root',
    listClassName: 'dsh-router-session-chip-menu',
    anchor: h('button', {
      type: 'button',
      className: 'dsh-router-session-chip',
      'aria-haspopup': 'menu',
      'aria-expanded': view.open === true,
      'data-open': view.open === true ? 'true' : 'false',
      'aria-label': fill(t('sessionChainChipLabel'), { chain: label }),
      title: fill(t('sessionChainChipTitle'), { chain: label }),
      onClick: function () { chip.toggle(sessionId) },
    }, [
      // 两个图标各套一层 span：Icon 不接受 className，而 DSH 的几何（inline-flex
      // 座位 + caption 色的 chevron）本来就写在包装 span 上（PermissionSelect 同款）。
      h('span', { key: 'icon', className: 'dsh-router-session-chip-icon' }, h(Icon, { d: ICON_ROUTE, size: 14 })),
      h('span', { key: 'text', className: 'dsh-router-session-chip-label' }, label),
      h('span', { key: 'chevron', className: 'dsh-router-session-chip-chevron' }, h(Icon, { d: ICON_DOWN, size: 12 })),
    ]),
  }, extras)
}
