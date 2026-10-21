/**
 * 「会话路由」页签：所有会话 × 它们各自绑定的链与重试次数。
 *
 * 设置面是全局的，DSH 不告诉插件"现在前台是哪个会话"，所以这一页从
 * `session.list` 列会话、从侧车读绑定，再按 sessionId 拼起来——用户要的是"我挑一个会话
 * 直接配"，而不是"先去聊天里找到那个会话再点开 chip"。两个入口写的是同一份侧车，所以
 * 它们永远不会说两套话。
 *
 * 会话在侧车里还留着、但 `session.list` 里已经没有的（被删掉的会话），单独列为"已删除"，
 * 只提供一个清除按钮：那是设计里约定的一次性对账，不为此加后台任务。
 */

import { h } from './dom.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { fill } from './format.ts'
import { routeKeyOf } from '../routes.ts'

/** Session ids are long; the last 8 characters are what tells two sessions apart in a list. */
export function shortSessionId(sessionId) {
  var text = String(sessionId ?? '')
  return text.length <= 8 ? text : text.slice(-8)
}

/**
 * The chain a row routes on: its bound one, else the default one.
 *
 * "Follow the default" is chain: null, so the row it must show the DEFAULT
 * chain's candidates — otherwise the user sees a session with no retry rows and
 * reads it as "this session cannot be configured".
 */
function chainOfRow(row, chains, defaultChainId) {
  var wanted = row.chain === null ? defaultChainId : row.chain
  return chains.filter(function (chain) { return chain.id === wanted })[0]
}

function chainTitle(chain, t) {
  return chain === undefined ? null : chain.name !== '' ? chain.name : t('chainDefaultName')
}

export function SessionRoutingView(props) {
  var t = props.t
  var state = props.state
  var rows = state.rows ?? []
  var toolbar = h('div', { className: 'dsh-router-session-toolbar' },
    h(Button, { size: 'sm', disabled: state.loading === true, onClick: props.onRefresh },
      state.loading === true ? t('sessionsLoading') : t('sessionsRefresh')))
  var body = rows.length === 0
    ? h('p', { className: 'dsh-router-notice', role: 'status' },
        state.loading === true ? t('sessionsLoading') : t('sessionsEmpty'))
    : h('div', { className: 'dsh-router-session-list' }, rows.map(function (row) {
        return h(SessionRow, {
          key: row.sessionId,
          t: t,
          row: row,
          chains: props.chains,
          defaultChainId: props.defaultChainId,
          banned: props.disabled || row.orphan === true,
          onSetChain: props.onSetChain,
          onSetRetry: props.onSetRetry,
          onClear: props.onClear,
        })
      }))
  return h('div', { className: 'dsh-router-view' },
    h('section', { className: 'dsh-router-section' },
      h('div', { className: 'dsh-router-section-head' },
        h('h2', { className: 'dsh-router-section-title' }, t('sessionsSectionTitle')),
        h('span', { className: 'dsh-router-section-count' }, rows.length),
        h('span', { className: 'dsh-router-section-hint' }, t('sessionsSectionHint'))),
      state.error !== null && state.error !== undefined
        ? h('div', { className: 'dsh-router-notice dsh-router-notice-error', role: 'alert' }, state.error)
        : null,
      toolbar,
      body))
}

function SessionRow(props) {
  var t = props.t
  var row = props.row
  var chain = chainOfRow(row, props.chains, props.defaultChainId)
  var options = [{ value: '', label: t('sessionChainFollowDefault') }].concat(
    props.chains.map(function (entry) {
      return { value: entry.id, label: entry.name !== '' ? entry.name : t('chainDefaultName') }
    }))
  var select = h('select', {
    className: 'dsh-router-select dsh-router-session-chain',
    'aria-label': t('sessionsChainLabel'),
    value: row.chain === null ? '' : row.chain,
    disabled: props.banned,
    onChange: function (event) { props.onSetChain(row.sessionId, event.target.value) },
  }, options.map(function (option) {
    return h('option', { key: option.value, value: option.value, selected: option.value === (row.chain === null ? '' : row.chain) }, option.label)
  }))
  var routes = chain === undefined
    ? []
    : chain.candidates.map(function (candidate) { return routeKeyOf(candidate.provider, candidate.model) })
  var retries = routes.map(function (route) {
    var override = Object.hasOwn(row.retries ?? {}, route)
    return h('label', { key: route, className: 'dsh-router-session-retry' },
      h('span', { className: 'dsh-router-session-retry-route', title: route }, route),
      h('input', {
        type: 'text',
        inputMode: 'numeric',
        className: 'dsh-router-session-chip-retry-input',
        'aria-label': fill(t('sessionRetryRowLabel'), { route: route }),
        placeholder: t('sessionRetryFollow'),
        disabled: props.banned,
        // 非受控：输入框自己持有文字，失焦/回车才提交一次写入（与 chip 同一条契约）。
        defaultValue: override ? String(row.retries[route]) : '',
        onBlur: function (event) { props.onSetRetry(row.sessionId, route, event.target.value) },
        onKeyDown: function (event) {
          if (event.key === 'Enter') props.onSetRetry(row.sessionId, route, event.target.value)
        },
      }))
  })
  return h('div', { className: 'dsh-router-session-row' + (row.orphan === true ? ' is-orphan' : '') },
    h('div', { className: 'dsh-router-session-ident' },
      h('span', { className: 'dsh-router-session-title', title: row.sessionId },
        row.title !== '' && row.title !== null && row.title !== undefined ? row.title : shortSessionId(row.sessionId)),
      h('code', { className: 'dsh-router-session-key' }, shortSessionId(row.sessionId))),
    row.orphan === true
      ? h('span', { className: 'dsh-router-session-orphan' }, t('sessionsOrphanBadge'))
      : select,
    row.orphan === true
      ? h(Button, { size: 'sm', disabled: props.disabled, onClick: function () { props.onClear(row.sessionId) } }, t('sessionsClear'))
      : h('div', { className: 'dsh-router-session-retries' },
          routes.length === 0
            ? h('span', { className: 'dsh-router-session-retry-empty' }, chainTitle(chain, t) === null ? t('sessionChainFollowDefault') : fill(t('sessionsNoCandidates'), { chain: chainTitle(chain, t) }))
            : retries))
}
