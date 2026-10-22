/**
 * Test fixture: writes one session's routing binding before its first request.
 *
 * The composition tests (tests/run.mjs) spawn a real headless CLI per scenario,
 * so nothing outside that process can invoke a Remote. This module is the
 * in-composition caller: it calls the plugin service's own `setSessionBinding`
 * — the same host method the browser's chip reaches through the gateway, so the
 * write path under test is the production one, not a test-only backdoor — and
 * then reads the binding back through `sessionBinding`.
 *
 * The observation is written to a JSON file because that is what the spawned
 * runner can read: the scenario asserts both the routing effect (in the durable
 * log) and the Host's own answer about durability (`persistent`), which differs
 * between a composition with the storage family and one without it.
 *
 * Config (from the overlay row):
 *
 *   chain: string | null            — the binding's chain field
 *   retries: { 'provider/model': n } — per-route retries (0..99)
 *   observe: '<abs path>'           — where to write what was observed
 */

import { writeFileSync } from 'node:fs'

/** Cordis plugin name. */
export const name = 'stub-session-binding'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ chain?: string | null, retries?: Record<string, number>, observe: string }} config
 */
export function apply(ctx, config) {
  ctx.on('agent/created', ({ agent }) => {
    let written = false
    agent.ctx.on('agent/pre-step', async (payload, next) => {
      // Once per session, and before the first agent/request: the router freezes
      // a step's retry budget when that step's first request resolves the chain,
      // and pre-step is the one awaited seam that runs before it.
      if (!written) {
        written = true
        const router = ctx.get('modelRouter')
        if (router === undefined) throw new Error('stub-session-binding: the modelRouter service is not mounted')
        const sessionId = agent.session.id
        const request = { sessionId, chain: config.chain ?? null, retries: config.retries ?? {} }
        const stored = await router.setSessionBinding(request)
        const readBack = await router.sessionBinding(sessionId)
        writeFileSync(config.observe, JSON.stringify({ sessionId, request, stored, readBack }, null, 2))
      }
      return next()
    })
  })
}
