/**
 * Browser half of the spike plugin: the Phase 1 config page on DSH's Plugins page.
 *
 * Written by hand in the client module system's factory format (no build step) so
 * the real UI can be looked at. It follows DSH's own conventions exactly:
 *   - a client half is a Cordis plugin with `name` / `inject` / `apply`
 *   - it registers into `plugins.bundle.config` (keyed by package name) for a bundle
 *   - labels come from this plugin's own `zh` / `en` dictionaries, never from the
 *     Config schema's `.description()`
 *   - form state comes from `ctx.configForms.get(ns)` via `SettingsFormModel`
 *
 * This renders the fields for ONE chain to show the shape of the page; the
 * navigator over the `profiles` dict is a design detail, not a mechanism question.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-router-spike/client',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement
    var prim = require('@deepseek-ai/dsh-client-ui-primitives')
    var SettingsForm = prim.SettingsForm
    var SettingsValueField = prim.SettingsValueField
    var SettingsFormModel = prim.SettingsFormModel
    var settingsTextField = prim.settingsTextField
    var settingsNumberField = prim.settingsNumberField
    var settingsBooleanField = prim.settingsBooleanField

    var NS = 'dsh-model-router-spike'
    /**
     * Settings namespace: the loader entry id the bundle patch declares
     * (`spike-probe`), NOT the package name. The Host derives every namespace
     * from `entry.options.id` (packages/settings/settings/src/index.ts:315,326),
     * exactly as the cot-translation bundle reads `'cot-translation'`.
     */
    var CONFIG_NS = 'spike-probe'

    var zh = {
      title: '模型渠道路由',
      description: '为选定的模型配置有序备份链，失败时按顺序切换。',
      takeOverOthers: '接管未配置的模型',
      takeOverOthersHint: '关闭时，只有下面显式配置了备份链的模型会走路由。',
      chainTitle: '备份链',
      chainHint: '按顺序尝试。第一个通常是用户自己选的那个模型。',
      candidateProvider: 'provider',
      candidateModel: '模型 ID',
      addCandidate: '添加候选',
      removeCandidate: '移除',
      switchOnTitle: '哪些失败会切换',
      rateLimit: '限流',
      server: '服务端错误',
      timeout: '超时',
      transport: '网络传输失败',
      emptyResponse: '空回复',
      maxTotalAttempts: '最多尝试次数',
      maxTotalAttemptsHint: '单个请求的硬上限，包含同渠道重试。',
    }
    var en = {
      title: 'Model channel routing',
      description: 'Configure an ordered backup chain for a selected model.',
      takeOverOthers: 'Take over unconfigured models',
      takeOverOthersHint: 'When off, only models with an explicit chain are routed.',
      chainTitle: 'Backup chain',
      chainHint: 'Tried in order. The first is usually the model the user picked.',
      candidateProvider: 'provider',
      candidateModel: 'Model ID',
      addCandidate: 'Add candidate',
      removeCandidate: 'Remove',
      switchOnTitle: 'Which failures switch',
      rateLimit: 'Rate limit',
      server: 'Server error',
      timeout: 'Timeout',
      transport: 'Transport failure',
      emptyResponse: 'Empty response',
      maxTotalAttempts: 'Max attempts',
      maxTotalAttemptsHint: 'Hard cap for one request, including same-route retries.',
    }

    /** One candidate row: provider, model, remove. */
    function CandidateRow(props) {
      var t = props.t
      var index = props.index
      return h('div', {
        key: index,
        style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
      },
        h(SettingsValueField, {
          id: 'candidate-provider-' + index,
          label: t('candidateProvider'),
          value: props.row.provider,
          invalid: false,
          disabled: props.disabled,
          onEdit: text => props.onField(index, 'provider', text),
        }),
        h(SettingsValueField, {
          id: 'candidate-model-' + index,
          label: t('candidateModel'),
          value: props.row.model,
          invalid: false,
          disabled: props.disabled,
          onEdit: text => props.onField(index, 'model', text),
        }),
        h('button', {
          type: 'button',
          onClick: () => props.onRemove(index),
        }, t('removeCandidate')),
      )
    }

    /** The chain editor for one profile. */
    function ChainEditor(props) {
      var t = props.t
      var rows = props.rows
      return h('div', null,
        h('h4', null, t('chainTitle')),
        h('p', { style: { opacity: 0.7 } }, t('chainHint')),
        rows.map((row, index) => h(CandidateRow, {
          key: index,
          t: t,
          index: index,
          row: row,
          disabled: props.disabled,
          onField: props.onField,
          onRemove: props.onRemove,
        })),
        h('button', { type: 'button', onClick: props.onAdd }, t('addCandidate')),
      )
    }

    /** The whole config page: global switch, one chain, switchOn, hard cap. */
    function RouterCard(props) {
      var t = props.t
      var state = props.useRouterCard(snapshot => snapshot)
      if (props.view === 'summary') return t('description')
      var disabled = !state.writable
      return h(SettingsForm, {
        labels: { save: '保存', discard: '放弃', saved: '已保存' },
        state: state,
        onSave: props.save,
        onDiscard: props.discard,
      },
        h(SettingsValueField, {
          id: 'router-take-over-others',
          label: t('takeOverOthers'),
          hint: t('takeOverOthersHint'),
          value: String(Boolean(state.takeOverOthers)),
          invalid: false,
          disabled: disabled,
          onEdit: text => props.edit('takeOverOthers', text === 'true'),
        }),
        h(ChainEditor, {
          t: t,
          rows: state.candidates,
          disabled: disabled,
          onField: (index, field, text) => props.editCandidate(index, field, text),
          onRemove: index => props.removeCandidate(index),
          onAdd: () => props.addCandidate(),
        }),
        h('h4', null, t('switchOnTitle')),
        ['rateLimit', 'server', 'timeout', 'transport', 'emptyResponse'].map(code =>
          h(SettingsValueField, {
            key: code,
            id: 'router-switch-on-' + code,
            label: t(code),
            value: String(Boolean(state.switchOn[code])),
            invalid: false,
            disabled: disabled,
            onEdit: text => props.editSwitchOn(code, text === 'true'),
          })),
        h(SettingsValueField, {
          id: 'router-max-total-attempts',
          label: t('maxTotalAttempts'),
          hint: t('maxTotalAttemptsHint'),
          value: String(state.maxTotalAttempts),
          invalid: false,
          numeric: true,
          disabled: disabled,
          onEdit: text => props.edit('maxTotalAttempts', Number(text)),
        }),
      )
    }

    exports.name = 'dsh-model-router-spike/client'
    exports.inject = ['slots', 'locale', 'configForms']
    exports.NS = NS

    /**
     * Mount the config page for this bundle.
     * @param ctx - browser plugin context.
     */
    exports.apply = function apply(ctx) {
      var t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'router: dictionaries')

      var scope = ctx.configForms.get(CONFIG_NS)
      var form = new SettingsFormModel(scope, [
        settingsTextField('takeOverOthers'),
        settingsNumberField('maxTotalAttempts'),
      ])
      var store = form.bind(() => {
        var value = scope.getSnapshot().value ?? {}
        return {
          ...form.shell(),
          takeOverOthers: value.takeOverOthers ?? false,
          maxTotalAttempts: value.maxTotalAttempts ?? 6,
          candidates: value.candidates ?? [
            { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          ],
          switchOn: value.switchOn ?? {
            rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false,
          },
        }
      })
      ctx.effect(() => () => { form.dispose() }, 'router: form subscription')

      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-model-router-spike',
        locale: NS,
        inject: () => ({
          hooks: { routerCard: store },
          save: form.actions().save,
          discard: form.actions().discard,
          edit: (path, value) => form.actions().edit(path, value),
          editCandidate: (index, field, text) => {
            var next = (scope.getSnapshot().value?.candidates ?? []).slice()
            next[index] = { ...next[index], [field]: text }
            form.actions().edit('candidates', next)
          },
          addCandidate: () => {
            var next = (scope.getSnapshot().value?.candidates ?? []).slice()
            next.push({ provider: '', model: '' })
            form.actions().edit('candidates', next)
          },
          removeCandidate: index => {
            var next = (scope.getSnapshot().value?.candidates ?? []).slice()
            next.splice(index, 1)
            form.actions().edit('candidates', next)
          },
          editSwitchOn: (code, on) => {
            var next = { ...(scope.getSnapshot().value?.switchOn ?? {}) }
            next[code] = on
            form.actions().edit('switchOn', next)
          },
        }),
      }, RouterCard)), 'router: config page')
    }

    exports.RouterCard = RouterCard
    return module.exports
  },
})
