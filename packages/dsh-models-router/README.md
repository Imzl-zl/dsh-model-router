# dsh-models-router

<p>
  <a href="https://www.npmjs.com/package/dsh-models-router"><img src="https://img.shields.io/npm/v/dsh-models-router?color=4A65E8" alt="npm"></a>
  <a href="https://github.com/Imzl-zl/dsh-models-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
  <a href="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml"><img src="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
</p>

Transparent cross-provider failover for DSH Agent main requests, with per-session
fallback chains.

You pick a model in the official selector as usual. When that model fails, this
plugin retries the request against your ordered list of physical
provider/model candidates and tells you — in Chinese, in the conversation —
what happened and why. Requests for models without a configured chain behave
exactly as they do without the plugin.

## Install

```bash
dsh plugin add dsh-models-router
```

DSH `0.2.0-rc.2` or newer. The `@deepseek-ai/*` and `zod` peers resolve from
your DSH installation, so nothing is bundled twice.

## How it works

The plugin owns exactly two seams of the Agent loop:

- **`agent/request`** (`prepend: true`) selects the physical route for every
  attempt. It runs outside `installModelSelection`, so its override wins over
  the write-back of your selection.
- **`agent/request-error`** (`prepend: true`, outermost) sees every failed
  attempt first. For a code your chain switches on, the plugin waits and retries
  **itself** — the configured number is the real number, with no provider-policy
  ceiling on top. For any other code it delegates to DSH, so `llm-retry` keeps
  owning those retries and its own cap.

Both seams register on the plugin's own context and take the agent from the
payload, so unloading or reloading the plugin (any config save) removes and
replaces them; a live session never keeps a handle to a dead instance.

Two more things the plugin adds:

- **Capability pre-check**: before returning a candidate, the route config is
  validated through `ctx.llm.resolveCallConfig()` (the same path
  `selectModel` uses). A candidate that cannot serve this exact request — for
  example one that does not support the selected reasoning effort — is skipped
  before any call. Without this, `prepareCall` would throw
  `UNSUPPORTED_REASONING_EFFORT`, which terminates the step outright and no
  recovery plugin can catch.
- **The reason notice**: each failover appends a Chinese `form: 'notice'`
  message to the durable log; it renders in the trajectory view (the chat
  conversation does not surface context rows in this DSH build — the same
  presentation DSH's own model-selection notice gets). DSH's own English
  "model changed" notice also appears; both are factual.

## Chains

A chain is a complete fallback order: its candidates, which failure codes switch,
the first hop's retry budget, the start strategy and the image-sticky window. The
first hop is always the model you selected in DSH — it is not part of the config —
so a chain only answers "where next".

```yaml
enabled: true
defaultChainId: default          # sessions with no choice of their own use this
chains:
  - id: default                  # stable id: sessions bind to it, renaming never breaks them
    name: ""                     # empty = "default chain" in the UI
    candidates:                  # fallbacks; the selected model is the implicit first hop
      - { provider: deepseek-official, model: deepseek-v4-flash, maxRetries: 1, needs: { images: false } }
      - { provider: pi-ai-gpt, model: gpt-5, maxRetries: 0, needs: { images: true } }
      - { provider: pi-ai-claude, model: claude-sonnet-5, maxRetries: 0, needs: { minContextTokens: 120000 } }
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false, auth: true, quota: true }
    firstHopMaxRetries: 0        # retries after the first hop's first call
    stickyTurns: 0               # no-image turns to keep the image route after an image turn
    strategy: order
  - id: coding
    name: Write code
    candidates: [...]
```

- `maxRetries` / `firstHopMaxRetries` count retries **after** the first call; 0 means
  the first failure moves on. The first hop is always the model you selected in DSH.
- Explicitly configured `needs` conditions apply to every candidate, including the
  first hop (skipping it is honoring your configuration, and it is announced); it
  stays exempt only from the automatic gates (breaker cooldowns, capability
  pre-validation).
- There is no request-wide cap. A step costs at most the sum of the candidates'
  own budgets, and each retry inside a candidate is executed by this plugin (see
  the retry bullet under Known Limitations).
- Each switch to the next candidate is immediate: no backoff is inserted between
  candidates. The wait between two tries on the *same* candidate copies the
  provider's `retryPolicy` (`initialDelayMs`, `maxDelayMs`, `jitterRatio`, and a
  `Retry-After` when the failure carries one).
- **What counts as a failure is `switchOn`.** Defaults follow DSH's own retryable set
  (`RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`, `EMPTY_RESPONSE`) plus `AUTH` and
  `QUOTA`: a dead key or a spent quota is the channel's own fault, and another channel
  carries its own credentials, so switching usually rescues the request immediately —
  and the breaker then skips that channel on later requests. `ABORTED` (you pressed
  stop) and `NO_ADAPTER` never switch; `INVALID_REQUEST` is opt-in because capability
  classification is provider-dependent. Classification uses `LlmFailure.code` only,
  never message text.

The settings panel manages the chains: edit the one marked "editing", rename it,
copy it (candidates, switch-on rules and budgets come along), make it the
default, or remove it. The last chain cannot be removed, and a rename never
touches a session binding because bindings point at the id.

## Per-session chains

A session can route on its own chain instead of the default one:

- **In the composer**: the chip at the left of the tool row (after the Plan and
  permission controls, before the model selector) names the chain this
  conversation routes on. Click it to pick another chain, or to set this
  session's retry count per route.
- **In the settings panel**: the "session routing" tab lists every session with
  its chain (and its retry overrides), so several sessions can be assigned
  without opening each conversation. Rows whose session no longer exists keep
  their binding and offer a "clear binding" action.

Semantics worth knowing:

- **A binding replaces, it does not merge.** A session bound to `coding` uses the
  whole `coding` chain, never a mix with the default chain.
- **Bindings live in a storageDomain sidecar** (`model_router_sessions`), keyed by
  `sessionId`: they are not in the plugin config, do not enter the session log,
  and are invisible to the model. Without the storage domain they live in process
  memory and the UI says so; they do not survive a restart then.
- **Retry overrides are per route**: `session override ?? candidate maxRetries`,
  keyed by `provider/model`, 0..9. Empty means "follow the chain"; **0 means "do
  not retry this route"** — the two are different answers.
- A binding that names a deleted chain routes on the default chain and leaves a
  notice in the conversation, instead of silently rerouting. Fork does not
  inherit a binding (it is keyed by `sessionId`, and a fork is a new session).

### Routing images to a vision model

DSH rejects an image prompt at **send admission** when the selected model does
not declare the image modality (`MODEL_DOES_NOT_SUPPORT_IMAGES`,
`api/session-controller/src/commands.ts:336-348`) — that check runs before any
request exists, so no plugin can route around it. What the router can do is gate
the **fallbacks** on the request's shape, using the fact that the admission gate
reads the *declaration*, not the real capability:

1. In DSH's model settings, tick `input: [text, image]` for the text model you
   usually select, so image prompts pass admission.
2. Put the vision model in the chain with `needs: { images: true }`, and add
   `invalidRequest` to `switchOn` so a text model that refuses the image hands
   the request on to it.

The **first hop cannot be gated**: it is your own selection, which the plugin
does not own, so it is always tried first. Consequence worth knowing: with the
text model selected, an image request only reaches the vision candidate after the
text model fails — which is why the practical setup is still "select the vision
model when you are working with images", or a chain per task. `stickyTurns` then
keeps the vision route for a few no-image turns when you follow up about an image
you just sent.

The image condition is turn-scoped and covers images that arrive mid-turn
through a tool result (`read_image`), not just the messages claimed for the
step.

## Known Limitations and Deferred Work

- **Tool capability is not pre-checked.** DSH exposes no machine-readable
  "supports function calling" metadata (`LlmModelInfo` carries only
  `inputModalities`). A candidate that rejects the request's tools fails at
  runtime with `INVALID_REQUEST` (deepseek) or `PI_AI_ERROR` (pi-ai); enable
  `invalidRequest` in `switchOn` to let the chain continue past it. The
  classification is provider-dependent and not guaranteed.
- **Retries on a routed step belong to this plugin, alone.** For a code listed in
  `switchOn`, the plugin waits and retries the same route itself and returns
  `{ kind: 'retry' }` — the configured `maxRetries` is the real number, with no
  provider-policy ceiling on top. The wait copies DSH's curve from the provider's
  `retryPolicy` (`initialDelayMs`, `maxDelayMs`, `jitterRatio`, and the failure's
  `Retry-After`; a `Retry-After` beyond the ceiling gives up instead of waiting).
  A code **not** in `switchOn` is passed down to DSH unchanged, so `llm-retry`
  still owns those retries and its own cap. Two consequences worth knowing: the
  trajectory shows no `llm/retry` rows for routed steps (those retries are not
  `llm-retry`'s), while every failed attempt is still recorded as
  `assistant/attempt`; and a provider whose policy is `always` (unbounded) is
  rejected at load.
- **The candidate cursor is process memory.** It resets on restart; the
  durable attempt lineage is rebuilt from the session log, not from the
  cursor. Cross-restart continuation is deferred.
- **The failover ledger.** Every route switch is folded from the durable log
  (`request/header` with `reason: 'change'` plus the preceding failed attempt)
  into a plugin-owned session projection (`router/failover-history`), bounded
  to the last 20 entries. The config page's drawer reads it through
  `ctx.remote.session.list()` plus per-session `projections()` reads. A
  user-initiated model switch (a `change` header with no preceding failure) is
  deliberately not an entry.
- **Channel health is three tiers, all visible in one workspace.** Passive
  observation folds real conversation outcomes per physical route
  (`router/channel-health`, merged across the 20 most recent sessions so the
  availability rate is a global fact about the channel); the connectivity check
  asks DSH's own `discoverModels` for a model list (0 tokens); the end-to-end
  probe sends one minimal message and stops at the first content byte
  (`maxTokens: 1`, so the cost is bounded) to measure time-to-first-token. The
  probe's schedule is user config and defaults to off — it spends tokens on
  every tick, so how often is the caller's decision. Probe outcomes are three
  distinct things: reachable (with a TTFT), unreachable (with the
  provider-neutral code), and unavailable (the check could not run at all),
  which the UI never reads as a fault. A probe never influences routing: one
  synthetic message says nothing about a channel under real load, so route
  selection still reads only real conversation outcomes and explicit user
  conditions.
  Per-route probe prompts (`health.probe.prompts`) are edited in the health settings
  modal (a route picker plus a content field); the Host applies them per route and
  `tests/remote.mjs` asserts the text each route actually received.
- **Agent main requests only.** Compaction and session-title calls keep their
  own DSH-provided model configuration and are not routed by this plugin.
- **`needs` conditions are turn-scoped for images, step-scoped for tokens.**
  `images` accumulates across a turn's steps (a tool-loop turn's later steps
  claim no new input) and also counts images that arrive through a tool result
  (`read_image`); `minContextTokens` reads the context-pressure projection's
  estimate for the next request, which is present only after the first usage
  sample — an unmeasured request counts as unmet, and the estimate
  systematically under-counts CJK text. Explicit conditions apply to
  `candidates[0]` too.
- **Image routing cannot bypass DSH's send admission.** See "Routing images to
  a vision model" above: the supported shape requires ticking `input: [text,
  image]` for the text model in DSH's model settings. A known gap: a no-image
  turn in a session whose history still carries retained image blocks routes
  to the text model and the API rejects the image loudly — the router cannot
  see the request history at routing time (`agent/request` carries no
  messages). DSH's offload eventually turns old images into text references;
  starting a new session for image topics avoids it.
- **Conditional routing does not cover tool support.** DSH exposes no
  machine-readable tool capability, so a tools-incompatible candidate fails at
  runtime (`INVALID_REQUEST`/`PI_AI_ERROR`) and is handled by `switchOn`.
- **A provider uninstalled after configuration degrades gracefully**: its
  candidates are skipped at runtime with a warning; structural config errors
  (duplicate ids, illegal caps, unpinned `candidates[0]`) fail loudly at load.

## Development

```sh
npm install                       # repo root: installs the DSH CLI + peers
npm test                          # all four suites: unit, client-controller, remote, run
npm run bundle --prefix packages/dsh-models-router   # build lib/ (host + client + typert)
node packages/dsh-models-router/tests/unit.mjs    # pure decision logic
node packages/dsh-models-router/tests/run.mjs     # Loader composition tests
node packages/dsh-models-router/tests/client-controller.mjs   # browser-half controller (runs the built lib/client.js)
npx tsc --noEmit --skipLibCheck --strict --module nodenext \
  --moduleResolution nodenext --target es2022 --allowImportingTsExtensions \
  packages/dsh-models-router/src/index.ts
```

The browser half and the host face are consumed from the build output, so
`npm run bundle` must run after any source change before a browser or
`--dump-config` check sees it. The composition tests boot the real headless
Loader with a deterministic stub adapter and assert on the durable session log
— the real Cordis Loader composition the DSH package rules require, not
hand-built contexts. The web profile is verified by installing the bundle
(`dsh plugin --profile web add <dir>`) and driving the Plugins page in a
browser. A live-gateway check (`tests/real-run.mjs`, credentials in a
gitignored local file, machine proxy required) has verified the failover
end-to-end against a real upstream 500: two same-route retries, one
cross-channel switch, a Chinese notice, and a completed turn.
