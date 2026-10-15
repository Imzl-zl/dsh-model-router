/** Inline SVG icons and the plugin's Nexus Mesh logo, in DSH design-token colors. */

import { h } from './dom.ts'

export function Icon(props) {
  return h('svg', {
    width: props.size ?? 14,
    height: props.size ?? 14,
    viewBox: '0 0 16 16',
    fill: 'currentColor',
    style: Object.assign({ flexShrink: 0 }, props.style, props.spin ? { animation: 'dsh-spin 1s linear infinite' } : null),
  }, h('path', { d: props.d }))
}

export function ModelRouterIcon(props) {
  var size = props.size ?? 18
  var disabled = Boolean(props.disabled)
  var color = props.color ?? 'currentColor'
  var useGrad = !disabled && (color.indexOf('brand') !== -1 || color.indexOf('#4A65E8') !== -1 || color === 'currentColor')
  var strokeColor = useGrad ? 'url(#dshNexusGrad)' : color
  var nodeA = useGrad ? 'var(--dsh-router-accent, #4A65E8)' : color
  var nodeB = useGrad ? '#3B82F6' : color
  var nodeC = useGrad ? '#06B6D4' : color
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    fill: 'none',
    style: { flexShrink: 0 },
  },
    h('defs', null,
      h('linearGradient', { id: 'dshNexusGrad', x1: '4', y1: '4', x2: '44', y2: '44', gradientUnits: 'userSpaceOnUse' },
        h('stop', { stopColor: 'var(--dsh-router-accent, #4A65E8)' }),
        h('stop', { offset: '0.5', stopColor: '#3B82F6' }),
        h('stop', { offset: '1', stopColor: '#06B6D4' }))),
    h('path', { d: 'M24 4L42 14V34L24 44L6 34V14L24 4Z', stroke: strokeColor, strokeWidth: '2.5', strokeLinejoin: 'round', fill: useGrad ? 'rgba(74,101,232,0.06)' : 'none' }),
    h('circle', { cx: '24', cy: '24', r: '5', fill: strokeColor }),
    h('circle', { cx: '24', cy: '24', r: '2.2', fill: useGrad ? '#FFFFFF' : 'var(--dsw-alias-bg-layer-2, #18191c)' }),
    h('path', { d: 'M24 24L12 16', stroke: strokeColor, strokeWidth: '2.5', strokeLinecap: 'round' }),
    h('circle', { cx: '12', cy: '16', r: '3', fill: nodeA }),
    h('path', { d: 'M24 24L36 17', stroke: strokeColor, strokeWidth: '2.5', strokeLinecap: 'round' }),
    h('circle', { cx: '36', cy: '17', r: '3', fill: nodeB }),
    h('path', { d: 'M24 24L24 38', stroke: strokeColor, strokeWidth: '2.5', strokeLinecap: 'round' }),
    h('circle', { cx: '24', cy: '38', r: '3', fill: nodeC }))
}


export var ICON_SEARCH = 'M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z'

export var ICON_GLOBE = 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.67A6.958 6.958 0 0 0 1 8c0 .252.013.501.038.746h2.17c-.174-.782-.282-1.623-.312-2.5zM8.5 1.077V4h2.355a7.97 7.97 0 0 0-.468-1.068c-.552-1.035-1.218-1.65-1.887-1.855zM11.91 4h1.835a7.025 7.025 0 0 0-3.072-2.472c.218.284.418.598.597.933.255.474.47 1.005.64 1.539zm.582 3.5c-.03.877-.138 1.718-.312 2.5h2.17c.025-.245.038-.494.038-.746 0-.877-.16-1.717-.45-2.5h-2.146c.174.782.282 1.623.312 2.5zM8.5 5v3h3.468c-.027-.872-.138-1.715-.318-2.5H8.5zm0 4v3h2.85c.18-.785.29-1.628.318-2.5H8.5zm-1 0H4.332c.028.872.138 1.715.318 2.5H7.5V9zm0-1V5H4.65c-.18.785-.29 1.628-.318 2.5H7.5zm1 4.923V12h2.355c-.13.398-.288.756-.468 1.068-.552 1.035-1.218 1.65-1.887 1.855zm-1 0c-.67-.204-1.335-.82-1.887-1.855A7.97 7.97 0 0 1 5.145 12H7.5v2.923z'


export var ICON_UP = 'M7.646 4.646a.5.5 0 0 1 .708 0l4.5 4.5a.5.5 0 0 1-.708.708L8 5.707 3.854 9.854a.5.5 0 0 1-.708-.708l4.5-4.5z'

export var ICON_DOWN = 'M7.646 11.354a.5.5 0 0 0 .708 0l4.5-4.5a.5.5 0 0 0-.708-.708L8 10.293 3.854 6.146a.5.5 0 1 0-.708.708l4.5 4.5z'

export var ICON_TRASH = 'M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z'

export var ICON_CLOSE = 'M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z'

export var ICON_WARN = 'M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z'

export var ICON_SAVE = 'M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.5a.5.5 0 0 0-.146-.354l-2.5-2.5A.5.5 0 0 0 12 1H2zm0 1h9.293L13.5 4.207V14H2V2zm3 0v4h6V2H5zm1 1h4v2H6V3zM4 9h8v4H4V9z'

export var ICON_CHECK = 'M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z'

export var ICON_CLOCK = 'M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0-1A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm.5-9a.5.5 0 0 0-1 0v4.293l2.854 1.712a.5.5 0 0 0 .515-.858L8.5 7.82V5z'

export var ICON_UNDO = 'M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1zM8 4.414V1.586a.5.5 0 0 1 .854-.353l2.414 2.414a.5.5 0 0 1 0 .706L8.854 6.768A.5.5 0 0 1 8 6.414V4.414z'

export var ICON_PLUS = 'M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z'

export var ICON_MINUS = 'M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z'

export var ICON_ARROW_DOWN = 'M8 3.5a.5.5 0 0 1 .5.5v6.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.793V4a.5.5 0 0 1 .5-.5z'

export var ICON_SPINNER = 'M8 1.5a6.5 6.5 0 1 0 6.5 6.5A.75.75 0 0 0 13 8a5 5 0 1 1-5-5 .75.75 0 0 0 0-1.5z'

export var ICON_BOLT = 'M8.5 1.5 3 9h4.5L6.5 14.5 13 7H8.5z'

export var ICON_GEAR = 'M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311a1.464 1.464 0 0 1-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.86z'

export var ICON_ROUTE = 'M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 2.5a2.5 2.5 0 0 1 2.5-2.5 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-2.004-1H8.5a2.5 2.5 0 0 0-2.5 2.5v4.004a2.5 2.5 0 1 1-1 0V6.5A3.5 3.5 0 0 1 8.5 3h2.496A2.5 2.5 0 0 1 11 2.5zM2.5 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm1-1.004A2.5 2.5 0 1 1 5 13.5a2.5 2.5 0 0 1-1.5-2.504z'

export var ICON_SHIELD = 'M5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.775 11.775 0 0 1-2.517 2.453 7.159 7.159 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7.158 7.158 0 0 1-1.048-.625 11.777 11.777 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 62.456 62.456 0 0 1 5.072.56z'

export var ICON_CHART = 'M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-4zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2z'
