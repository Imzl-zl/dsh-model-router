/**
 * The zero-token connectivity check, run inside the Host.
 *
 * It asks DSH's own model discovery for a provider's model list — the same
 * call the Models page's "fetch available models" button makes. It sends no
 * content, so it costs no tokens, and it proves three things a stale config
 * cannot: the endpoint answers, the credential is accepted, and this model id
 * is advertised.
 *
 * Why this lives on the Host and not in the browser half (it used to):
 * `LlmRuntime.discoverModels` raises `LlmError` with a stable, machine-routable
 * `code` (packages/llm/llm/src/error.ts — "route on this, never by parsing
 * `message`"), but `remoteDiscoverModels` wraps every failure in
 * `RemoteError('llm/model-discovery-rejected', message)`
 * (packages/llm/llm/src/index.ts:639-647). The wrapper's `details` carry only
 * `settingsNs` and `baseURL`, and `cause` survives in-process only — so by the
 * time the refusal reaches the browser the code is gone and nothing there can
 * tell "DSH has no discovery registered for this namespace" (`NO_DISCOVERY`)
 * apart from "the endpoint refused the listing". Classifying on the message
 * instead would route on prose DSH may reword at any time, which is exactly
 * what the HarnessError contract forbids. The Host is the last layer where the
 * code is still alive, so the classification happens here and the browser
 * receives an already-classified verdict.
 *
 * Note: 取舍与被否方案（为何搬宿主、为何封闭集合只有两个码、为何 UI 不禁用按钮）
 * —— 见 .agents/notes/implemented/2026-10-16-connectivity-no-discovery-is-not-a-refusal.md
 */
import type {
  LlmConfigurableProvider,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
} from '@deepseek-ai/dsh-llm'
import type { ConnectivityVerdict, ProbeRoute } from './types.ts'
import { routeKeyOf } from './routes.ts'

/** The llm face the check needs: the directory, and one discovery call. */
export interface ConnectivityLlm {
  listConfigurableProviders(): readonly LlmConfigurableProvider[]
  discoverModels(
    settingsNs: string,
    request: LlmModelDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<readonly LlmDiscoveredModel[]>
}

/** The settings face the check reads the stored baseURL through. */
export interface ConnectivitySettings {
  describe(options?: { redactSecrets?: boolean }): readonly { ns: string; value: unknown }[]
}

/**
 * DSH failure codes that mean the llm runtime never invoked a discovery at all.
 *
 * Both are guards `LlmRuntime.discoverModels` applies **before** handing the
 * request to any registered discovery
 * (packages/llm/llm/src/index.ts:594-602), so no request ever exists:
 *
 * - `NO_DISCOVERY`: no discovery is registered for the settings namespace.
 *   This is the whole DeepSeek family — `registerDeepSeekProvider` only calls
 *   `registerAdapter` (packages/llm/llm-deepseek/src/host.ts:55) and never
 *   `registerModelDiscovery`; only `llm-pi-ai` does
 *   (packages/llm/llm-pi-ai/src/index.ts:275). The provider is configurable
 *   and fully usable, and a connectivity check is still structurally
 *   impossible for it.
 * - `INVALID_DISCOVERY`: the request named neither a provider route nor a
 *   baseURL, so there is nothing to ask about. Unreachable from this plugin's
 *   own call, which always names the configured provider; it is collected so
 *   that a future call shape which forgets the provider lands in the honest
 *   bucket rather than in "the endpoint did not answer".
 *
 * The set is deliberately closed and deliberately small. A code a *discovery
 * implementation* raises is that implementation's answer about this route and
 * stays `unreachable`: pi-ai's `DISCOVERY_FAILED` ("pi-ai ships no catalog for
 * provider X … set a baseURL", packages/llm/llm-pi-ai/src/discovery.ts:288),
 * `DISCOVERY_UNSUPPORTED` (:301) and `INVALID_CREDENTIAL` (:243) are all
 * raised after the runtime decided to invoke it, and each names something the
 * user can act on for this channel. The line is mechanically decidable: the
 * code is one the runtime raises before it calls `discover()`.
 */
const NEVER_DISCOVERED_CODES: ReadonlySet<string> = new Set([
  'NO_DISCOVERY',
  'INVALID_DISCOVERY',
])

/** One verdict for a check that could not run at all. */
function unavailable(route: ProbeRoute, reason: string): ConnectivityVerdict {
  return { provider: route.provider, model: route.model, kind: 'unavailable', reason }
}

/**
 * The stored baseURL of one configurable provider, read through DSH's own
 * settings service. Absent when the namespace or the profile cannot be read —
 * the discovery still gets the provider route, which is the other half of what
 * identifies an endpoint, so a missing read degrades the request instead of
 * refusing the check.
 */
function storedBaseURL(
  settings: ConnectivitySettings | undefined,
  entry: LlmConfigurableProvider,
): string | undefined {
  if (settings === undefined) return undefined
  const namespace = settings.describe({ redactSecrets: true }).find(row => row.ns === entry.settingsNs)
  if (namespace === undefined) return undefined
  let profile: unknown = namespace.value
  for (const segment of entry.settingsPath) {
    profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, segment) : undefined
  }
  return typeof profile === 'object' && profile !== null && typeof Reflect.get(profile, 'baseURL') === 'string'
    ? Reflect.get(profile, 'baseURL') as string
    : undefined
}

/**
 * Check one route: ask its provider's settings namespace for a model list.
 *
 * @param llm - the Host llm service (injected so unit tests can supply a fake).
 * @param settings - the Host settings service, or undefined where it is absent.
 * @param route - the physical route to check.
 * @param signal - cancels the discovery; an aborted check rethrows instead of
 *   answering, because "we stopped asking" is not "the endpoint did not answer".
 * @returns the route's verdict; a discovery that refuses becomes `unreachable`
 *   carrying its provider-neutral code — unless the code says the runtime never
 *   invoked a discovery at all (see {@link NEVER_DISCOVERED_CODES}), which is
 *   `unavailable`, and a provider with no configurable-provider declaration is
 *   `unavailable` because there is no namespace to interrogate.
 */
export async function checkConnectivity(
  llm: ConnectivityLlm,
  settings: ConnectivitySettings | undefined,
  route: ProbeRoute,
  signal?: AbortSignal,
): Promise<ConnectivityVerdict> {
  const entry = llm.listConfigurableProviders().find(candidate => candidate.provider === route.provider)
  // Not in the directory: DSH has no settings namespace to interrogate for this
  // route, so there is no endpoint to ask. This says nothing about the channel.
  if (entry === undefined) return unavailable(route, 'notConfigurable')
  const request: LlmModelDiscoveryRequest = { provider: route.provider }
  const baseURL = storedBaseURL(settings, entry)
  if (baseURL !== undefined) request.baseURL = baseURL
  try {
    const models = await llm.discoverModels(entry.settingsNs, request, signal)
    return models.some(model => model.id === route.model)
      ? { provider: route.provider, model: route.model, kind: 'reachable' }
      : { provider: route.provider, model: route.model, kind: 'notAdvertised', advertised: models.length }
  } catch (error) {
    // 调用方取消了这一轮：中止不是"端点没应答"。原样抛回去，让远程调用以拒绝
    // 结束——客户端本就跑在拒绝路径上（忙态收尾、计数不变）。
    if (signal?.aborted) throw error
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && NEVER_DISCOVERED_CODES.has(code)) {
      return { provider: route.provider, model: route.model, kind: 'unavailable', reason: 'noDiscovery', error: code }
    }
    const reason = typeof code === 'string' && code.length > 0
      ? code
      : error instanceof Error ? error.message : String(error)
    return { provider: route.provider, model: route.model, kind: 'unreachable', error: reason }
  }
}
