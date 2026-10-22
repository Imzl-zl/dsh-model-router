/**
 * Route display names: the catalog's own names for a channel, never the raw ids
 * when the catalog knows the route.
 *
 * A route is identified as `provider/model`, and both halves are frequently
 * opaque. A provider id is a config key the user picked once; a relay's model id
 * is often `<uuid>:<model>` — the shape DSH's own model settings write, where
 * the readable half is the model's `name` (`LunaRoute:deepseek-4.1-flash`) and
 * the `id` is what the wire carries. The user maps names precisely so the rows
 * are tellable apart, and DSH's own model picker (the composer seat and the
 * `/model` popup) already labels rows with `group.name` + `model.name`. So every
 * surface in this plugin that names a route reads those same two names from the
 * same catalog — one naming rule, not one per view.
 *
 * The fallback is the raw half, never a guess: a route the catalog does not list
 * (dropped from DSH's model settings, or the catalog has not answered yet) reads
 * as its id — honest, and still diagnosable. Each surface additionally keeps the
 * raw `provider/model` key in the row's `title`, so a name never hides which
 * channel a row actually addresses.
 *
 * Note: 为何显示名与原始 id 并存、为何缺名不猜测 —— 见
 * .agents/notes/implemented/2026-10-22-catalog-names-on-every-surface.md
 */

import { routeKeyOf } from '../routes.ts'

/** One provider group of the model catalog, as far as naming needs it. */
interface CatalogGroup {
  readonly id?: unknown
  readonly name?: unknown
  readonly models?: unknown
}

/** One model entry of the model catalog, as far as naming needs it. */
interface CatalogModel {
  readonly id?: unknown
  readonly name?: unknown
}

/** The display names of one route, resolved against one catalog snapshot. */
export interface RouteNames {
  /** The provider's display name, or the raw provider id. */
  provider(provider: string): string
  /** The model's display name, or the raw model id. */
  model(provider: string, model: string): string
  /** `Provider · Model` on one line, for a select option or a one-line notice. */
  route(provider: string, model: string): string
}

/** A non-empty string, or `''` — the catalog is wire data, so nothing is assumed. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One group's display name and its models' display names, or `undefined`. */
interface GroupNames {
  readonly name: string
  readonly models: Map<string, string>
}

/**
 * Build the naming lookup for one catalog snapshot.
 *
 * @param catalog - the `session/modelCatalog()` value, or null/undefined while
 *   it is unloaded or failed. Anything unreadable yields the raw ids, which is
 *   the same answer as "this route is not in the catalog".
 * @returns the lookup every surface names routes through.
 */
export function routeNames(catalog: unknown): RouteNames {
  const groups = new Map<string, GroupNames>()
  const source = catalog !== null && typeof catalog === 'object'
    ? (catalog as { groups?: unknown }).groups
    : undefined
  if (Array.isArray(source)) {
    for (const entry of source as readonly CatalogGroup[]) {
      const id = text(entry?.id)
      if (id === '') continue
      const models = new Map<string, string>()
      const entries = Array.isArray(entry?.models) ? (entry.models as readonly CatalogModel[]) : []
      for (const model of entries) {
        const modelId = text(model?.id)
        if (modelId === '') continue
        models.set(modelId, text(model?.name))
      }
      groups.set(id, { name: text(entry?.name), models })
    }
  }

  function provider(provider: string): string {
    const group = groups.get(provider)
    return group !== undefined && group.name !== '' ? group.name : provider
  }

  function model(provider: string, model: string): string {
    const group = groups.get(provider)
    const name = group === undefined ? '' : (group.models.get(model) ?? '')
    return name !== '' ? name : model
  }

  return {
    provider,
    model,
    route: function (providerId, modelId) {
      const head = provider(providerId)
      const tail = modelId === '' ? '' : model(providerId, modelId)
      // 两半都没有名字：印原始路由键。那串字符就是日志、配置与宿主 notice 里的同一条
      // 路由，换一个分隔符只会让它认不出来。半条路由（记录损坏、模型被删）只有
      // provider 一半，也不印悬空的分隔符。
      if (modelId === '') return head
      if (head === providerId && tail === modelId) return routeKeyOf(providerId, modelId)
      return head + ' · ' + tail
    },
  }
}
