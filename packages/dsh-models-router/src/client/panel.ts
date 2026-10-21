/**
 * The main-column panel the sidebar's panel-list row opens.
 *
 * The panel is only a carrier: `RouterPage` owns the page chrome (head, tabs,
 * footer) and the layout contract it follows. There is no panel-level header
 * here — a fixed bar with a second title, a second save and a "back to
 * conversation" button duplicated the page and is not what DSH's own panels
 * (Plugins, Schedule) do; leaving the panel is the sidebar's job.
 *
 * A panel row is not a free-standing button: DSH owns the row and its click, and
 * `layout.selectPanel` throws for an id with no `main` registration
 * (ui-layout/src/client/service.ts:72-78). So this package registers both — the
 * `main` entry rendering this page, and the `sidebar.panellist` entry rendering
 * only the glyph — with the same id.
 */

import { h } from './dom.ts'
import { ModelRouterIcon } from './icons.ts'
import { RouterPage } from './page.ts'

/** The main-slot occupant: the page, unchanged. */
export function ModelRouterPanel(props) {
  return h(RouterPage, props)
}

/**
 * The glyph the sidebar's panel row renders. DSH owns the row, its label and its
 * click; this occupant owns only the mark (SidebarRoot.tsx:70-72 hands it `size`
 * and `active`).
 */
export function ModelRouterPanelIcon(props) {
  return h(ModelRouterIcon, {
    size: props.size ?? 16,
    color: props.active ? 'var(--dsh-router-accent)' : 'currentColor',
  })
}
