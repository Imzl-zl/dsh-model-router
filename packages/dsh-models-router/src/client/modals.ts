/**
 * The plugin's two configuration dialogs.
 *
 * Both are DSH's own `Modal` with one fixed size (`.dsh-router-modal`) and one
 * scrolling body (`contentClassName` → the content wrapper → its last child,
 * the same structural chain styles.ts documents). The health dialog is a single
 * scrollable column of sections — the tabbed version changed the card's height
 * by ~300px when switching to the breaker tab, and the breaker rules opened a
 * second dialog on top. Rules are edited in place now.
 *
 * Note: 弹窗尺寸、滚动链与"无第二层子弹窗"的依据 —— 见 docs/design/ui-layout-redesign.md
 */

import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, MarkdownText, Modal, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { h } from './dom.ts'
import { fill, formatWindowHours } from './format.ts'
import { Icon, ICON_TRASH } from './icons.ts'
import { routeKeyOf, routeParts } from '../routes.ts'
import { BREAKER_CODE_PRESETS } from './validate.ts'
import {
  DEFAULT_BREAKER_COOLDOWN_SECONDS,
  DEFAULT_BREAKER_SCOPE,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_SECONDS,
} from '../defaults.ts'
import { DEFAULT_TIMELINE_BUCKET_SECONDS, TIMELINE_BUCKET_SECONDS } from '../timeline.ts'

const MODAL_CLASS = 'dsh-router-modal'
const MODAL_CONTENT = 'dsh-router-modal-content'

/**
 * One titled block inside a dialog body. The tier's on/off switch sits in the
 * section head on the right — repeating the tier name on its own switch row
 * made every section say its name twice.
 */
function Section(props) {
  return h('section', { className: 'dsh-router-modal-section' },
    h('div', { className: 'dsh-router-modal-section-head' },
      h('div', { className: 'dsh-router-modal-section-copy' },
        h('h3', { className: 'dsh-router-modal-section-title' }, props.title),
        props.hint === undefined ? null : h('p', { className: 'dsh-router-modal-section-hint' }, props.hint)),
      props.switch === undefined ? null : h('div', { className: 'dsh-router-modal-section-switch' }, props.switch)),
    props.children)
}

/** Label above control: the shape a long hint needs (the control row squeezed it). */
function StackedField(props) {
  return h('div', { className: 'dsh-router-field-col' },
    h('span', { className: 'dsh-router-label' }, props.label),
    props.children,
    props.hint === undefined ? null : h('span', { className: 'dsh-router-hint' }, props.hint))
}

/** A whole-number text field that reports a number, clamped by the caller. */
function NumberInput(props) {
  return h(Input, {
    type: 'text',
    inputMode: 'numeric',
    className: props.className,
    value: props.value,
    disabled: props.disabled,
    'aria-label': props.label,
    onChange: function (event) {
      var parsed = Number(event.target.value)
      if (Number.isFinite(parsed)) props.onChange(parsed)
    },
  })
}

export function HealthSettingsModal(props) {
  var t = props.t
  var health = props.health || {}
  var discover = health.discover || {}
  var probe = health.probe || {}
  var breaker = health.breaker || {}

  var [passiveOn, setPassiveOn] = useState(health.passive !== false)
  var [timelineBucketSeconds, setTimelineBucketSeconds] = useState(
    typeof health.timelineBucketSeconds === 'number' ? health.timelineBucketSeconds : DEFAULT_TIMELINE_BUCKET_SECONDS,
  )
  var [discoverOn, setDiscoverOn] = useState(discover.enabled === true)
  var [discoverInterval, setDiscoverInterval] = useState(String(discover.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS))
  var [probeOn, setProbeOn] = useState(probe.enabled === true)
  var [probeInterval, setProbeInterval] = useState(String(probe.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS))
  var [probePrompt, setProbePrompt] = useState(typeof probe.prompt === 'string' ? probe.prompt : DEFAULT_PROBE_PROMPT)
  var [probeTimeout, setProbeTimeout] = useState(String(probe.timeoutSeconds ?? DEFAULT_PROBE_TIMEOUT_SECONDS))
  var [promptOverrides, setPromptOverrides] = useState((probe.prompts ?? []).map(function (entry) {
    return { route: entry.route ?? '', prompt: entry.prompt ?? '' }
  }))
  var [breakerOn, setBreakerOn] = useState(breaker.enabled === true)
  var [rules, setRules] = useState((breaker.rules || []).map(function (rule) {
    return {
      code: rule.code || '',
      message: rule.message || '',
      cooldownSeconds: rule.cooldownSeconds ?? DEFAULT_BREAKER_COOLDOWN_SECONDS,
      scope: rule.scope === 'channel' ? 'channel' : DEFAULT_BREAKER_SCOPE,
    }
  }))

  var routeChoices = (props.routes ?? []).filter(function (route) {
    return !promptOverrides.some(function (entry) { return entry.route === route })
  })
  // 一条两个字段都空白的规则永远命中不了任何东西。不静默过滤：弹窗替用户删规则，
  // 就会和页面级 validate() 对同一份数据说出两种结论。禁掉确认，把问题摆在旁边。
  var hasEmptyRule = rules.some(function (rule) { return !rule.code && !rule.message })

  // A newly added override row lands at the bottom of the scrolling body; bring it
  // into view with scrollIntoView (the nearest scrollable ancestor is the modal
  // body), so the click never looks dead.
  var lastOverrideRef = useRef(null)
  useEffect(function () {
    var el = lastOverrideRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [promptOverrides.length])

  function intervalOf(text) {
    var n = Math.round(Number(text))
    return isFinite(n) && n > 0 ? n : 0
  }

  function patchOverride(index, patch) {
    setPromptOverrides(function (current) {
      var next = current.slice()
      next[index] = Object.assign({}, next[index], patch)
      return next
    })
  }

  function patchRule(index, patch) {
    setRules(function (current) {
      var next = current.slice()
      next[index] = Object.assign({}, next[index], patch)
      return next
    })
  }

  var passiveSection = h(Section, {
    key: 'passive',
    title: t('healthPassiveLabel'),
    hint: t('healthPassiveHint'),
    switch: h(Switch, {
      checked: passiveOn,
      label: t('healthPassiveLabel'),
      disabled: props.disabled,
      onChange: function (next) { setPassiveOn(next) },
    }),
  },
    h(StackedField, { label: t('timelineBucketLabel'), hint: t('timelineBucketHint') },
      h(SegmentedControl, {
        id: 'router-timeline-bucket',
        label: t('timelineBucketLabel'),
        value: String(timelineBucketSeconds),
        disabled: props.disabled,
        options: TIMELINE_BUCKET_SECONDS.map(function (seconds) {
          return {
            value: String(seconds),
            label: seconds >= 60 ? (seconds / 60) + t('timelineBucketMinutes') : seconds + 's',
            title: fill(t('timelineBucketWindow'), { window: formatWindowHours(seconds) }),
          }
        }),
        onChange: function (next) { setTimelineBucketSeconds(Number(next)) },
      })))

  var discoverSection = h(Section, {
    key: 'discover',
    title: t('healthDiscoverLabel'),
    hint: t('healthDiscoverHint'),
    switch: h(Switch, {
      checked: discoverOn,
      label: t('healthDiscoverLabel'),
      disabled: props.disabled,
      onChange: function (next) { setDiscoverOn(next) },
    }),
  },
    discoverOn
      ? h(StackedField, { label: t('healthDiscoverIntervalLabel'), hint: t('healthDiscoverIntervalHint') },
          h(NumberInput, {
            label: t('healthDiscoverIntervalLabel'),
            value: discoverInterval,
            disabled: props.disabled,
            onChange: function (next) { setDiscoverInterval(String(Math.max(0, Math.round(next)))) },
          }))
      : null)

  var overrideRows = promptOverrides.map(function (entry, index) {
    var isLast = index === promptOverrides.length - 1
    return h('div', {
      key: entry.route + '#' + index,
      className: 'dsh-router-breaker-row',
      ref: isLast ? lastOverrideRef : undefined,
    },
      h('select', {
        className: 'dsh-router-select',
        'aria-label': t('healthProbeRouteLabel'),
        value: entry.route,
        disabled: props.disabled,
        onChange: function (event) { patchOverride(index, { route: event.target.value }) },
      },
        h('option', { value: entry.route }, entry.route || t('healthProbeRoutePlaceholder')),
        routeChoices.map(function (route) {
          return h('option', { key: route, value: route }, route)
        })),
      h(Input, {
        type: 'text',
        placeholder: probePrompt || '1',
        'aria-label': t('healthProbePromptLabel'),
        value: entry.prompt,
        disabled: props.disabled,
        onChange: function (event) { patchOverride(index, { prompt: event.target.value }) },
      }),
      h('button', {
        type: 'button',
        className: 'dsh-router-icon-btn dsh-router-icon-btn-danger',
        title: t('healthProbeOverrideRemove'),
        'aria-label': t('healthProbeOverrideRemove'),
        disabled: props.disabled,
        onClick: function () {
          setPromptOverrides(function (current) {
            var next = current.slice()
            next.splice(index, 1)
            return next
          })
        },
      }, h(Icon, { d: ICON_TRASH, size: 12 })))
  })

  var probeSection = h(Section, {
    key: 'probe',
    title: t('healthProbeLabel'),
    hint: t('healthProbeHint'),
    switch: h(Switch, {
      checked: probeOn,
      label: t('healthProbeLabel'),
      disabled: props.disabled,
      onChange: function (next) { setProbeOn(next) },
    }),
  },
    probeOn
      ? h('div', { className: 'dsh-router-field-grid' },
          h(StackedField, { label: t('healthProbeIntervalLabel'), hint: t('healthProbeIntervalHint') },
            h(NumberInput, {
              label: t('healthProbeIntervalLabel'),
              value: probeInterval,
              disabled: props.disabled,
              onChange: function (next) { setProbeInterval(String(Math.max(0, Math.round(next)))) },
            })),
          h(StackedField, { label: t('healthProbeTimeoutLabel'), hint: t('healthProbeTimeoutHint') },
            h(NumberInput, {
              label: t('healthProbeTimeoutLabel'),
              value: probeTimeout,
              disabled: props.disabled,
              onChange: function (next) { setProbeTimeout(String(Math.max(1, Math.round(next)))) },
            })))
      : null,
    probeOn
      ? h(StackedField, { label: t('healthProbePromptLabel'), hint: t('healthProbePromptHint') },
          h(Input, {
            type: 'text',
            placeholder: String(DEFAULT_PROBE_PROMPT),
            'aria-label': t('healthProbePromptLabel'),
            value: probePrompt,
            disabled: props.disabled,
            onChange: function (event) { setProbePrompt(event.target.value) },
          }))
      : null,
    probeOn
      ? h('div', { className: 'dsh-router-modal-stack' },
          h('div', { className: 'dsh-router-modal-field' },
            h('div', { className: 'dsh-router-modal-field-copy' },
              h('span', { className: 'dsh-router-label' }, t('healthProbePromptsLabel')),
              h('span', { className: 'dsh-router-hint' }, t('healthProbePromptsHint'))),
            h(Button, {
              variant: 'outline',
              size: 'sm',
              disabled: props.disabled || routeChoices.length === 0,
              onClick: function () {
                setPromptOverrides(function (current) {
                  var free = routeChoices.filter(function (route) {
                    return !current.some(function (entry) { return entry.route === route })
                  })
                  return current.concat([{ route: free[0] ?? '', prompt: '' }])
                })
              },
            }, t('healthProbeOverrideAdd'))),
          overrideRows)
      : null)

  var presetChips = BREAKER_CODE_PRESETS.map(function (preset) {
    var exists = rules.some(function (rule) { return rule.code === preset.code && !rule.message })
    return h(Button, {
      key: preset.code,
      variant: 'outline',
      size: 'sm',
      disabled: props.disabled || exists,
      title: exists ? t('breakerAlreadyAdded') : t(preset.descKey),
      onClick: function () {
        setRules(function (current) {
          return current.concat([{ code: preset.code, message: '', cooldownSeconds: preset.seconds, scope: DEFAULT_BREAKER_SCOPE }])
        })
      },
    }, preset.code)
  })

  var ruleRows = rules.map(function (rule, index) {
    return h('div', { key: 'br' + index, className: 'dsh-router-breaker-row' },
      h(Input, {
        type: 'text',
        className: 'dsh-router-breaker-code',
        placeholder: t('breakerCodePlaceholder'),
        'aria-label': t('breakerCodeLabel'),
        value: rule.code,
        disabled: props.disabled,
        onChange: function (event) { patchRule(index, { code: event.target.value }) },
      }),
      h(Input, {
        type: 'text',
        placeholder: t('breakerMessagePlaceholder'),
        'aria-label': t('breakerMessageLabel'),
        value: rule.message,
        disabled: props.disabled,
        onChange: function (event) { patchRule(index, { message: event.target.value }) },
      }),
      h(NumberInput, {
        label: t('breakerCooldownLabel'),
        value: String(rule.cooldownSeconds),
        disabled: props.disabled,
        onChange: function (next) { patchRule(index, { cooldownSeconds: Math.max(1, Math.round(next)) }) },
      }),
      h('span', { className: 'dsh-router-muted' }, t('breakerSecondsUnit')),
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
      }),
      h('button', {
        type: 'button',
        className: 'dsh-router-icon-btn dsh-router-icon-btn-danger',
        title: t('breakerRemoveRule'),
        'aria-label': t('breakerRemoveRule'),
        disabled: props.disabled,
        onClick: function () {
          setRules(function (current) {
            var next = current.slice()
            next.splice(index, 1)
            return next
          })
        },
      }, h(Icon, { d: ICON_TRASH, size: 12 })))
  })

  var breakerSection = h(Section, {
    key: 'breaker',
    title: t('breakerLabel'),
    hint: t('breakerHint'),
    switch: h(Switch, {
      checked: breakerOn,
      label: t('breakerLabel'),
      disabled: props.disabled,
      onChange: function (next) { setBreakerOn(next) },
    }),
  },
    breakerOn
      ? h('div', { className: 'dsh-router-modal-stack' },
          h('p', { className: 'dsh-router-modal-section-hint' }, t('breakerSharedHint')),
          h('div', { className: 'dsh-router-chip-row' }, presetChips),
          ruleRows.length === 0
            ? h('p', { className: 'dsh-router-empty' }, t('breakerRulesEmpty'))
            : h('div', null, ruleRows),
          h(Button, {
            variant: 'ghost',
            size: 'sm',
            disabled: props.disabled,
            onClick: function () {
              setRules(function (current) {
                return current.concat([{ code: '', message: '', cooldownSeconds: DEFAULT_BREAKER_COOLDOWN_SECONDS, scope: DEFAULT_BREAKER_SCOPE }])
              })
            },
          }, t('breakerAddRule')),
          hasEmptyRule
            ? h('p', { className: 'dsh-router-notice dsh-router-notice-error', role: 'alert' }, t('problemBreakerEmptyRule'))
            : null)
      : null)

  return h(Modal, {
    open: true,
    className: MODAL_CLASS,
    contentClassName: MODAL_CONTENT,
    title: t('healthModalTitle'),
    closeLabel: t('close'),
    onClose: props.onClose,
    footer: h('div', { className: 'dsh-router-footer-actions' },
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
              prompt: probePrompt.trim().length > 0 ? probePrompt.trim() : DEFAULT_PROBE_PROMPT,
              timeoutSeconds: Math.max(1, Math.round(Number(probeTimeout)) || DEFAULT_PROBE_TIMEOUT_SECONDS),
              // 逐路由覆盖：路由与内容都填满才算一条——空路由是用户还没选完，
              // 空内容是用户刚删了字，两种情况都不该落一条进配置。
              prompts: promptOverrides
                .filter(function (entry) { return entry.route.length > 0 && entry.prompt.trim().length > 0 })
                .map(function (entry) { return { route: entry.route, prompt: entry.prompt.trim() } }),
            },
            breaker: { enabled: breakerOn, rules },
            timelineBucketSeconds: timelineBucketSeconds,
          })
          props.onClose()
        },
      }, t('applyChanges'))),
  },
    h('div', { className: 'dsh-router-modal-body' },
      passiveSection,
      discoverSection,
      probeSection,
      breakerSection))
}

/**
 * Pick fallback candidates from the model catalog.
 *
 * One list, not two tabs. The catalog is `session/modelCatalog()` — the same
 * projection DSH's own model switcher reads — so every model DSH can address is
 * already listed here. A hand-typed model id was a second path to routes that
 * only resolved on adapters with pass-through ids (`llm-deepseek`), and became
 * `UNKNOWN_MODEL` before any request on the rest (`llm-pi-ai`), which is what
 * this plugin's channels mostly are. Registering the model under
 * Settings → Models is the one place that makes an id real; there is no second
 * source of truth to offer here.
 *
 * Note: 为何删掉「自定义模型 ID」Tab —— 见
 * .agents/notes/implemented/2026-10-20-remove-manual-model-id-tab.md
 */
export function AddCandidateModal(props) {
  var t = props.t
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

  return h(Modal, {
    open: true,
    className: MODAL_CLASS,
    contentClassName: MODAL_CONTENT,
    title: t('addCandidateModalTitle'),
    closeLabel: t('close'),
    onClose: props.onClose,
    footer: h('div', { className: 'dsh-router-footer-actions' },
      h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
      h(Button, {
        variant: 'primary',
        disabled: selectedCount === 0,
        onClick: function () {
          if (selectedCount === 0) return
          props.onAdd(Object.keys(selected).map(routeParts))
          props.onClose()
        },
      }, t('adoptSelected') + (selectedCount > 0 ? ' (' + selectedCount + ')' : ''))),
  },
    h('div', { className: 'dsh-router-modal-body' },
      h(Input, {
        type: 'search',
        placeholder: t('searchModelPlaceholder'),
        'aria-label': t('searchModelPlaceholder'),
        value: query,
        onChange: function (event) { setQuery(event.target.value) },
      }),
      props.catalog === null ? h('p', { className: 'dsh-router-modal-section-hint' }, t('catalogLoading')) : null,
      entries.length === 0 && props.catalog !== null
        ? h('p', { className: 'dsh-router-empty' }, query ? t('noMatchingProfiles') : t('addCandidateEmpty'))
        : entries.map(function (entry) {
            return h('div', { key: entry.group.id, className: 'dsh-router-catalog-group' },
              h('div', { className: 'dsh-router-catalog-group-title' }, entry.group.name),
              entry.models.map(function (m) {
                var route = routeKeyOf(entry.group.id, m.id)
                return h('div', { key: route, className: 'dsh-router-catalog-row' },
                  h(Checkbox, {
                    checked: Boolean(selected[route]),
                    label: m.name,
                    onChange: function () {
                      // 更新器形式：读渲染期闭包里的 selected，同一 tick 的两次点击
                      // 会互相覆盖（用户看得见却存不上）。
                      setSelected(function (current) {
                        var next = Object.assign({}, current)
                        if (next[route]) delete next[route]
                        else next[route] = true
                        return next
                      })
                    },
                  }),
                  h('code', null, m.id))
              }))
          })))
}

/**
 * The running release's notes, shown once after an update.
 *
 * DSH Market owns the update check and the one-click install; it does not pop a
 * changelog after the new version comes up. This dialog is the only extra step:
 * the notes were embedded at build time (scripts/embed-changelog.mjs), so they
 * describe the artifact actually loaded, not the repository's current HEAD.
 * The same dialog backs the permanent "What's new" button in the page head.
 *
 * @param props.version - the running package version.
 * @param props.notes - that version's CHANGELOG section, as plain text.
 * @param props.onClose - dismiss and remember this version.
 */
export function WhatsNewModal(props) {
  var t = props.t
  return h(Modal, {
    open: true,
    className: MODAL_CLASS,
    contentClassName: MODAL_CONTENT,
    title: fill(t('whatsNewTitle'), { version: props.version }),
    closeLabel: t('close'),
    onClose: props.onClose,
    footer: h('div', { className: 'dsh-router-footer-actions' },
      h(Button, { variant: 'primary', onClick: props.onClose }, t('whatsNewClose'))),
  },
    h('div', { className: 'dsh-router-modal-body' },
      h('p', { className: 'dsh-router-modal-section-hint' }, t('whatsNewHint')),
      h('div', { className: 'dsh-router-release-notes' },
        h(MarkdownText, {
          text: props.notes,
          variant: 'compact',
          labels: {
            code: { copyLabel: t('notesCopy'), copiedLabel: t('notesCopied') },
            footnotes: t('notesFootnotes'),
          },
        }))))
}
