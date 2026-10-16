/** The plugin's dialogs: health settings, new profile and add-candidate. */

import { useEffect, useState } from 'react'
import { h } from './dom.ts'
import { S } from './styles.ts'
import { Icon, ICON_TRASH } from './icons.ts'
import { Button, Modal, SegmentedControl, SegmentedTabs, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { BREAKER_CODE_PRESETS } from './validate.ts'

export function HealthSettingsModal(props) {
  var t = props.t
  var health = props.health || {}
  var discover = health.discover || {}
  var probe = health.probe || {}
  var [passiveOn, setPassiveOn] = useState(health.passive !== false)
  var [discoverOn, setDiscoverOn] = useState(discover.enabled === true)
  var [discoverInterval, setDiscoverInterval] = useState(String(discover.intervalSeconds ?? 0))
  var [probeOn, setProbeOn] = useState(probe.enabled === true)
  var [probeInterval, setProbeInterval] = useState(String(probe.intervalSeconds ?? 0))
  var [probePrompt, setProbePrompt] = useState(typeof probe.prompt === 'string' ? probe.prompt : '1')
  var [probeTimeout, setProbeTimeout] = useState(String(probe.timeoutSeconds ?? 8))
  // Per-route probe content, seeded from what the Host already holds.
  var [promptOverrides, setPromptOverrides] = useState((probe.prompts ?? []).map(function (entry) {
    return { route: entry.route ?? '', prompt: entry.prompt ?? '' }
  }))
  // The routes the config names, minus the ones already overridden — offered
  // instead of asking the user to type provider/model by hand.
  var routeChoices = (props.routes ?? []).filter(function (route) {
    return !promptOverrides.some(function (entry) { return entry.route === route })
  })

  function patchPromptOverride(index, patch) {
    setPromptOverrides(function (current) {
      var next = current.slice()
      next[index] = Object.assign({}, next[index], patch)
      return next
    })
  }

  // A newly added override row lands below the fold (the modal body is capped by
  // the shell), so bring it into view — otherwise the user clicks add, sees
  // nothing change, and concludes the control is dead.
  useEffect(function () {
    if (promptOverrides.length === 0) return
    var body = document.getElementById('dsh-router-health-modal-body')
    if (body && typeof body.scrollTo === 'function') {
      body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
    }
  }, [promptOverrides.length])
  var breaker = health.breaker || {}
  var [breakerOn, setBreakerOn] = useState(breaker.enabled === true)
  var [rules, setRules] = useState((breaker.rules || []).map(function (rule) {
    return {
      code: rule.code || '',
      message: rule.message || '',
      cooldownSeconds: rule.cooldownSeconds ?? 300,
      scope: rule.scope === 'channel' ? 'channel' : 'route',
    }
  }))
  // 一条两个字段都空白的规则永远命中不了任何东西。这里不静默过滤——弹窗
  // 替用户删掉规则，就会和页面级 validate() 对同一份数据说出两种结论；
  // 禁掉确认、把问题摆在规则旁边，两边始终是同一条消息。
  var hasEmptyRule = rules.some(function (rule) { return !rule.code && !rule.message })

  // Every mutation goes through the updater form. The close/lost-rule
  // failure is silent: `rules.concat(...)` reads the render-time closure,
  // so two clicks inside one batch both append to the same array and the
  // last write wins — a fast double-click on a preset chip or on
  // "+ 添加规则" drops a rule the user saw appear.
  function patchRule(index, patch) {
    setRules(function (current) {
      var next = current.slice()
      next[index] = Object.assign({}, next[index], patch)
      return next
    })
  }

  function intervalOf(text) {
    var n = Math.round(Number(text))
    return isFinite(n) && n > 0 ? n : 0
  }

  return h(Modal, {
    open: true,
    className: 'dsh-router-settings-modal',
    title: t('healthModalTitle'),
    closeLabel: t('close'),
    onClose: props.onClose,
    footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
      h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
      h(Button, {
        variant: 'primary',
        disabled: hasEmptyRule,
        onClick: function () {
          props.onUpdateHealth({
            passive: passiveOn,
            discover: { enabled: discoverOn, intervalSeconds: intervalOf(discoverInterval) },
            probe: {
              enabled: probeOn,
              intervalSeconds: intervalOf(probeInterval),
              prompt: probePrompt.trim().length > 0 ? probePrompt.trim() : '1',
              timeoutSeconds: Math.max(1, Math.round(Number(probeTimeout)) || 8),
              // 逐路由覆盖：路由与内容都填满才算一条——空路由是用户还没选完，
              // 空内容是用户刚删了字，两种情况都不该落一条进配置。
              prompts: promptOverrides
                .filter(function (entry) { return entry.route.length > 0 && entry.prompt.trim().length > 0 })
                .map(function (entry) { return { route: entry.route, prompt: entry.prompt.trim() } }),
            },
            breaker: {
              enabled: breakerOn,
              rules,
            },
          })
          props.onClose()
        },
      }, t('applyChanges'))),
  },
    // Tall enough that the probe tier's own fields sit above the fold: with a
    // 500px cap the global prompt and the per-route editor were below the
    // scroll, which read as "the setting does not exist".
    h('div', { id: 'dsh-router-health-modal-body', style: { width: 'min(640px, 92vw)', maxHeight: 'min(720px, 88vh)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4, boxSizing: 'border-box' } },
      // --- Tier 1: runtime observation ---
      h('div', { style: S.healthTierCard },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.formLabel }, t('healthPassiveLabel')),
            h('span', { style: S.formHint }, t('healthPassiveHint'))),
          h(Switch, {
            checked: passiveOn,
            label: t('healthPassiveLabel'),
            onChange: function (next) { setPassiveOn(next) },
          }))),

      // --- Tier 2: connectivity check ---
      h('div', { style: S.healthTierCard },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.formLabel }, t('healthDiscoverLabel')),
            h('span', { style: S.formHint }, t('healthDiscoverHint'))),
          h(Switch, {
            checked: discoverOn,
            label: t('healthDiscoverLabel'),
            onChange: function (next) { setDiscoverOn(next) },
          })),
        discoverOn ? h('div', { style: Object.assign({}, S.formGroup, { paddingTop: 6, borderTop: '0.5px solid var(--dsw-alias-border-l2)' }) },
          h('span', { style: S.formLabel }, t('healthDiscoverIntervalLabel')),
          h('span', { style: S.formHint }, t('healthDiscoverIntervalHint')),
          h('input', {
            style: Object.assign({}, S.formInput, { width: 140 }),
            type: 'text',
            inputMode: 'numeric',
            placeholder: '0',
            'aria-label': t('healthDiscoverIntervalLabel'),
            value: discoverInterval,
            onChange: function (event) { setDiscoverInterval(event.target.value) },
          })) : null),

      // --- Tier 3: end-to-end probe ---
      // 探测是真功能：手动按钮与宿主定时器都通。默认关闭写在默认值里，开不开、
      // 多久一轮由用户定——插件只提供能力，不替用户决定要不要花这个 token。
      h('div', { style: S.healthTierCard },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            h('span', { style: S.formLabel }, t('healthProbeLabel')),
            h('span', { style: S.formHint }, t('healthProbeHint'))),
          h(Switch, {
            checked: probeOn,
            label: t('healthProbeLabel'),
            onChange: function (next) { setProbeOn(next) },
          })),
        h('div', { style: Object.assign({}, S.formGroup, { paddingTop: 6, borderTop: '0.5px solid var(--dsw-alias-border-l2)' }) },
          h('span', { style: S.formLabel }, t('healthProbeIntervalLabel')),
          h('span', { style: S.formHint }, t('healthProbeIntervalHint')),
          h('input', {
            style: Object.assign({}, S.formInput, { width: 140 }),
            type: 'text',
            inputMode: 'numeric',
            placeholder: '0',
            'aria-label': t('healthProbeIntervalLabel'),
            value: probeInterval,
            onChange: function (event) { setProbeInterval(event.target.value) },
          })),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('healthProbePromptLabel')),
          h('span', { style: S.formHint }, t('healthProbePromptHint')),
          h('input', {
            style: Object.assign({}, S.formInput, { width: '100%' }),
            type: 'text',
            placeholder: '1',
            'aria-label': t('healthProbePromptLabel'),
            value: probePrompt,
            onChange: function (event) { setProbePrompt(event.target.value) },
          })),
        // Per-route probe content sits directly under the shared prompt: a
        // gateway filters content by its own rules, so a route that rejects the
        // shared prompt needs its own — the host has always honored this, the
        // editor was the missing half. The add button shares the label's row so
        // the control is reachable without scrolling.
        h('div', { style: S.formGroup },
          h('div', { style: S.probeOverrideHead },
            h('span', { style: S.formLabel }, t('healthProbePromptsLabel')),
            h('button', {
              type: 'button',
              style: Object.assign({}, S.manualBtn, { marginTop: 0 }),
              disabled: routeChoices.length === 0,
              onClick: function () {
                setPromptOverrides(function (current) {
                  var free = routeChoices.filter(function (route) {
                    return !current.some(function (entry) { return entry.route === route })
                  })
                  return current.concat([{ route: free[0] ?? '', prompt: '' }])
                })
              },
            }, t('healthProbeOverrideAdd'))),
          h('span', { style: S.formHint }, t('healthProbePromptsHint')),
          promptOverrides.map(function (entry, index) {
            return h('div', { key: entry.route + '#' + index, style: S.probeOverrideRow },
              h('select', {
                style: Object.assign({}, S.formInput, { width: 200, flex: 'none' }),
                'aria-label': t('healthProbeRouteLabel'),
                value: entry.route,
                onChange: function (event) { patchPromptOverride(index, { route: event.target.value }) },
              },
                h('option', { value: entry.route }, entry.route || t('healthProbeRoutePlaceholder')),
                routeChoices.map(function (route) {
                  return h('option', { key: route, value: route }, route)
                })),
              h('input', {
                style: Object.assign({}, S.formInput, { flex: 1, minWidth: 120 }),
                type: 'text',
                placeholder: probePrompt || '1',
                'aria-label': t('healthProbePromptLabel'),
                value: entry.prompt,
                onChange: function (event) { patchPromptOverride(index, { prompt: event.target.value }) },
              }),
              h('button', {
                type: 'button',
                className: 'dsh-router-action-btn dsh-router-action-btn-danger',
                style: Object.assign({}, S.actionBtn, S.actionBtnDanger, { flex: 'none' }),
                title: t('healthProbeOverrideRemove'),
                'aria-label': t('healthProbeOverrideRemove'),
                onClick: function () {
                  setPromptOverrides(function (current) {
                    var next = current.slice()
                    next.splice(index, 1)
                    return next
                  })
                },
              }, h(Icon, { d: ICON_TRASH, size: 13 })))
          })),
        h('div', { style: S.formGroup },
          h('span', { style: S.formLabel }, t('healthProbeTimeoutLabel')),
          h('span', { style: S.formHint }, t('healthProbeTimeoutHint')),
          h('input', {
            style: Object.assign({}, S.formInput, { width: 140 }),
            type: 'text',
            inputMode: 'numeric',
            placeholder: '8',
            'aria-label': t('healthProbeTimeoutLabel'),
            value: probeTimeout,
            onChange: function (event) { setProbeTimeout(event.target.value) },
          }))),

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
        breakerOn ? h('div', { style: Object.assign({}, S.formGroup, { paddingTop: 8, borderTop: '0.5px solid var(--dsw-alias-border-l2)' }) },
          h('p', { style: Object.assign({}, S.formHint, { margin: '0 0 6px 0' }) }, t('breakerSharedHint')),
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
                  setRules(function (current) { return current.concat([{ code: preset.code, message: '', cooldownSeconds: preset.seconds, scope: 'route' }]) })
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
              // A segmented control, not a native select: the modal body scrolls,
              // and a native popup gets clipped by the scroll container — the user
              // saw the scope options cut off. Two exclusive choices are exactly
              // what a tablist is for, and it needs no popup at all.
              h('div', { style: { flex: 'none' } },
                h(SegmentedControl, {
                  id: 'router-breaker-scope-' + index,
                  label: t('breakerScopeLabel'),
                  value: rule.scope,
                  disabled: props.disabled,
                  options: [
                    { value: 'route', label: t('breakerScopeRoute'), title: t('breakerScopeRouteHint') },
                    { value: 'channel', label: t('breakerScopeChannel'), title: t('breakerScopeChannelHint') },
                  ],
                  onChange: function (next) { patchRule(index, { scope: next }) },
                })),
              h('button', {
                type: 'button',
                className: 'dsh-router-action-btn dsh-router-action-btn-danger',
                style: Object.assign({}, S.actionBtn, S.actionBtnDanger),
                title: t('breakerRemoveRule'),
                'aria-label': t('breakerRemoveRule'),
                onClick: function () {
                  setRules(function (current) {
                    var next = current.slice()
                    next.splice(index, 1)
                    return next
                  })
                },
              }, h(Icon, { d: ICON_TRASH, size: 13 })))
          }),
          h('button', {
            type: 'button',
            style: Object.assign({}, S.manualBtn, { marginTop: 8 }),
            onClick: function () { setRules(function (current) { return current.concat([{ code: '', message: '', cooldownSeconds: 300, scope: 'route' }]) }) },
          }, t('breakerAddRule')),
          hasEmptyRule ? h('span', { style: S.formHint, role: 'alert' }, t('problemBreakerEmptyRule')) : null) : null))
  )
}


export function NewProfileModal(props) {
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
  var [target, setTarget] = useState('')
  var [manual, setManual] = useState(false)
  var [provider, setProvider] = useState('')
  var [model, setModel] = useState('')
  var [templateId, setTemplateId] = useState('')
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


export function AddCandidateModal(props) {
  var t = props.t
  var [tab, setTab] = useState('catalog')

  // --- Tab 1: Catalog Picker state ---
  var [query, setQuery] = useState('')
  var [selected, setSelected] = useState({})
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

  // --- Tab 2: Custom / Manual state ---
  var registered = props.routableProviders ?? []
  var [provider, setProvider] = useState('')
  var [model, setModel] = useState('')
  var [maxAttempts, setMaxAttempts] = useState('1')
  var manualGroup = (props.catalog?.groups ?? []).find(function (entry) { return entry.id === provider })
  var suggestions = (manualGroup?.models ?? []).map(function (entry) { return entry.id })
  var canAddManual = provider !== '' && model.trim() !== ''

  var canSubmit = tab === 'catalog' ? selectedCount > 0 : canAddManual

  return h(Modal, {
    open: true,
    className: 'dsh-router-candidate-modal',
    title: t('addCandidateModalTitle'),
    closeLabel: t('close'),
    onClose: props.onClose,
    footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
      h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
      h(Button, {
        variant: 'primary',
        disabled: !canSubmit,
        onClick: function () {
          if (tab === 'catalog') {
            if (selectedCount === 0) return
            var picked = Object.keys(selected).map(function (route) {
              var slash = route.indexOf('/')
              return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
            })
            props.onAdd(picked)
          } else {
            if (!canAddManual) return
            props.onAdd([{ provider: provider, model: model.trim(), maxAttempts: Math.min(5, Math.max(1, Number(maxAttempts) || 1)) }])
          }
          props.onClose()
        },
      }, tab === 'catalog'
        ? (t('adoptSelected') + (selectedCount > 0 ? ' (' + selectedCount + ')' : ''))
        : t('confirmAddManual'))),
  },
    h('div', { style: { marginBottom: 12 } },
      h(SegmentedTabs, {
        items: [
          { value: 'catalog', label: t('addCandidateTabCatalog') },
          { value: 'manual', label: t('addCandidateTabManual') },
        ],
        value: tab,
        onChange: function (val) { setTab(val) },
      })),

    tab === 'catalog'
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('input', {
          style: S.formInput,
          type: 'search',
          placeholder: t('searchModelPlaceholder'),
          'aria-label': t('searchModelPlaceholder'),
          value: query,
          onChange: function (event) { setQuery(event.target.value) },
        }),
        props.catalog === null ? h('span', { style: S.formHint }, t('catalogLoading')) : null,
        entries.length === 0 && props.catalog !== null
          ? h('div', { style: { padding: '24px 0', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 } },
            query ? t('noMatchingProfiles') : t('addCandidateEmpty'))
          : entries.map(function (entry) {
            return h('div', { key: entry.group.id },
              h('div', { style: S.catalogGroupTitle }, entry.group.name),
              entry.models.map(function (m) {
                var route = entry.group.id + '/' + m.id
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
                  h('span', null, m.name),
                  h('span', { style: S.providerBadge }, entry.group.id))
              }))
          }))
      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: S.manualGuideBox },
          h('div', { style: S.manualGuideHeader },
            h('span', { style: S.manualGuideIcon }, '💡'),
            h('span', { style: S.manualGuideTitle }, t('manualGuideTitle'))),
          h('div', { style: S.manualGuideText }, t('manualGuideDesc'))),
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
          }))))
}
