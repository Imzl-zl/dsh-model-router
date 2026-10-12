# dsh-model-router

Transparent cross-provider failover for DSH Agent main requests.

You pick a model in the official selector as usual. When that model fails, this
plugin retries the request against your ordered list of physical
provider/model candidates and tells you — in Chinese, in the conversation —
what happened and why. Requests for models without a configured rule behave
exactly as they do without the plugin.

## How it works

The plugin owns exactly two seams of the Agent loop:

- **`agent/request`** (registered with `prepend: true`) selects the physical
  route for every attempt. It runs outside `installModelSelection`, so its
  override wins over the write-back of your selection.
- **`agent/request-error`** (registered on `agent.ctx` at `agent/created`,
  without prepend) sits inside DSH's `llm-retry`: same-route retries with
  backoff and their durable records stay owned by `llm-retry`; when it gives
  up, its `next()` hands the failure to this plugin, which moves the chain to
  the next candidate.

Two more things the plugin adds:

- **Capability pre-check**: before returning a candidate, the route config is
  validated through `ctx.llm.resolveCallConfig()` (the same path
  `selectModel` uses). A candidate that cannot serve this exact request — for
  example one that does not support the selected reasoning effort — is skipped
  before any call. Without this, `prepareCall` would throw
  `UNSUPPORTED_REASONING_EFFORT`, which terminates the step outright and no
  recovery plugin can catch.
- **The reason notice**: each failover appends a Chinese `form: 'notice'`
  message to the conversation. DSH's own English "model changed" notice also
  appears; both are factual.

## Configuration

```yaml
enabled: true                 # master switch
profiles:                     # matched by exact provider/model
  - id: coding-main
    when: { provider: deepseek-official, model: deepseek-v4-flash }
    candidates:               # [0] is pinned to the when model
      - { provider: deepseek-official, model: deepseek-v4-flash, maxAttempts: 2 }
      - { provider: pi-ai-gpt, model: gpt-5, maxAttempts: 1, needs: { images: true } }
      - { provider: pi-ai-claude, model: claude-sonnet-5, maxAttempts: 1, needs: { minContextTokens: 120000 } }
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
    maxTotalAttempts: 6
default:                      # pure fallback pool for unconfigured models
  enabled: false
  candidates:
    - { provider: deepseek-official, model: deepseek-chat, maxAttempts: 1 }
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false }
  maxTotalAttempts: 3
```

- `candidates[0]` of a matched profile must be the `when` model — your own
  selection always attempts first, so a switch never happens without a failure.
- The default pool is pure fallback: the model you picked is always the first
  hop, with one attempt.
- Backoff is not configurable: it belongs to `llm-retry`. Each switch is
  preceded by one backoff wait (about 0.5–10 s with the default policy).
- Unchecked `switchOn` codes never move the chain; DSH still retries the same
  route per its own default policy (up to 5 times for the default retryable
  codes) before the request terminates.

## Known Limitations and Deferred Work

- **Tool capability is not pre-checked.** DSH exposes no machine-readable
  "supports function calling" metadata (`LlmModelInfo` carries only
  `inputModalities`). A candidate that rejects the request's tools fails at
  runtime with `INVALID_REQUEST` (deepseek) or `PI_AI_ERROR` (pi-ai); enable
  `invalidRequest` in `switchOn` to let the chain continue past it. The
  classification is provider-dependent and not guaranteed.
- **The attempt budget has two layers.** `maxTotalAttempts` caps the attempts
  this plugin initiates. `llm-retry` keeps its own per-provider budget
  (default 5, reset when the route changes), so a retryable failure can add
  same-route attempts beyond the configured cap before the chain terminates.
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
- **No channel health view.** The drawer shows failover history only — no
  latency/success-rate/cooldown telemetry exists, and none is planned without
  a global health subsystem.
- **Agent main requests only.** Compaction and session-title calls keep their
  own DSH-provided model configuration and are not routed by this plugin.
- **`needs` conditions are read once per step and the user's own route is
  exempt.** `images` reads the step's admitted user messages
  (`agent/pre-step`); `minContextTokens` reads the context-pressure
  projection's estimate for the next request, which is present only after the
  first usage sample — an unmeasured request counts as unmet, and the estimate
  systematically under-counts CJK text.
- **Conditional routing does not cover tool support.** DSH exposes no
  machine-readable tool capability, so a tools-incompatible candidate fails at
  runtime (`INVALID_REQUEST`/`PI_AI_ERROR`) and is handled by `switchOn`.
- **A provider uninstalled after configuration degrades gracefully**: its
  candidates are skipped at runtime with a warning; structural config errors
  (duplicate ids, illegal caps, unpinned `candidates[0]`) fail loudly at load.

## Development

```sh
npm install                       # repo root: installs the DSH CLI + peers
node packages/dsh-model-router/tests/unit.mjs    # pure decision logic
node packages/dsh-model-router/tests/run.mjs     # Loader composition tests
npx tsc --noEmit --skipLibCheck --strict --module nodenext \
  --moduleResolution nodenext --target es2022 --allowImportingTsExtensions \
  packages/dsh-model-router/src/index.ts
```

The composition tests boot the real headless Loader with a deterministic stub
adapter and assert on the durable session log — the real Cordis Loader
composition the DSH package rules require, not hand-built contexts. The web
profile is verified by installing the bundle (`dsh plugin --profile web add
<dir>`) and driving the Plugins page in a browser.
