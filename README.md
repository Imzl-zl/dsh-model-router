<p align="center">
  <img src="packages/dsh-model-router/icon.svg" width="88" height="88" alt="dsh-model-router">
</p>

<h1 align="center">dsh-model-router</h1>

<p align="center">Transparent cross-provider failover for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.</p>

<p align="center">
  <a href="https://github.com/Imzl-zl/dsh-model-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.2-4A65E8.svg" alt="DSH 0.2.0-rc.2"></a>
  <a href="https://github.com/Imzl-zl/dsh-model-router/releases/tag/v0.1.0"><img src="https://img.shields.io/badge/version-0.1.0-4A65E8.svg" alt="Version 0.1.0"></a>
  <img src="https://img.shields.io/badge/tests-121%20unit%20%C2%B7%2021%20composition%20%C2%B7%2048%20client-4A65E8.svg" alt="Tests">
</p>

---

Pick a model in DSH's selector as usual. When that model fails — rate limit,
server error, timeout — the request moves to the next physical channel in your
ordered chain and the conversation tells you what happened: the failure code,
the candidate that answered, and why the switch was allowed. Models without a
configured rule behave exactly as they do without the plugin.

## Install

Requires DSH `0.2.0-rc.2`. The package is distributed as source through this
repository — it is **not** on npm (`dsh-model-router` on the public registry is
an unrelated package by another author).

```sh
git clone https://github.com/Imzl-zl/dsh-model-router.git
cd dsh-model-router
npm install                                       # DSH CLI + peers
npm run bundle --prefix packages/dsh-model-router # build lib/ from src/
dsh plugin --profile web add packages/dsh-model-router
```

Then click **dsh-model-router** in the sidebar footer to configure chains per
model. Config lives in the profile's patch layer and hot-reloads on save.

## Configure

```yaml
enabled: true
profiles:                       # matched by exact provider/model
  - id: coding-main
    when: { provider: deepseek-official, model: deepseek-v4-flash }
    candidates:                 # [0] is pinned to the when model
      - { provider: deepseek-official, model: deepseek-v4-flash, maxAttempts: 2 }
      - { provider: pi-ai-gpt, model: gpt-5, maxAttempts: 1, needs: { images: true } }
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true }
    maxTotalAttempts: 6
default:                        # pure fallback pool for unconfigured models
  enabled: false
  candidates:
    - { provider: deepseek-official, model: deepseek-chat, maxAttempts: 1 }
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true }
  maxTotalAttempts: 3
```

## How it works

Two seams of the Agent loop, nothing else:

- **`agent/request`** (`prepend: true`) picks the physical route for every
  attempt. It runs outside `installModelSelection`, so its override wins over
  the write-back of your selection — the model you picked always attempts
  first, and a switch never happens without a failure.
- **`agent/request-error`** (inside `llm-retry`) receives the failure only when
  DSH's own same-route retries are exhausted, then advances the chain.

Two guarantees fall out of that division:

- **Two-layer budget.** Same-route retries and backoff stay owned by
  `llm-retry`; cross-candidate failover and the hard total cap
  (`maxTotalAttempts`) stay owned by this plugin. Neither layer can starve or
  duplicate the other.
- **No blind switches.** Permanent errors (abort, auth failure, no adapter)
  terminate immediately. Before returning a candidate, its route config is
  validated through `ctx.llm.resolveCallConfig()` — the same path
  `selectModel` uses — so a candidate that cannot serve this exact request
  (e.g. the selected reasoning effort) is skipped before any call.

Every route switch is folded from the durable session log into a
`router/failover-history` projection, surfaced as a failover-history drawer on
the config page — including through forks, where the ledger is rebuilt from the
inherited prefix.

## Development

```sh
npm install                                                    # repo root: DSH CLI + peers
node packages/dsh-model-router/tests/unit.mjs                 # pure decision logic
node packages/dsh-model-router/tests/run.mjs                  # real Loader composition
npx tsc --noEmit --skipLibCheck --strict --module nodenext \
  --moduleResolution nodenext --target es2022 --allowImportingTsExtensions \
  packages/dsh-model-router/src/index.ts
```

The composition tests boot the real headless Loader with a deterministic stub
adapter and assert on the durable session log — the composition the DSH
package rules require, not hand-built contexts. The web profile is verified by
installing the bundle and driving the Plugins page in a browser.

## Limitations

- **Agent main requests only.** Compaction and session-title calls keep their
  own DSH-provided configuration and are not routed.
- **Tool capability is not pre-checked.** DSH exposes no machine-readable
  "supports function calling" metadata; a tools-incompatible candidate fails at
  runtime and is handled by `switchOn.invalidRequest`.
- **The attempt budget has two layers.** `maxTotalAttempts` caps the attempts
  this plugin initiates; `llm-retry` keeps its own per-provider budget on top.
- **Notices are trajectory-first.** Failover notices ride the durable log and
  render in the trajectory view; the chat conversation does not surface context
  rows in this DSH build.
- **Channel health is a sidebar workspace, not a page.** Health lives in the
  sidebar footer entry's dialog: per-channel passive latency, opt-in 1-token
  probes, circuit breakers, and the failover-history drawer. There is no
  separate `plugins.bundle.config` page — that registration was removed on
  2026-10-16 after measurement showed a page cannot fit DSH's settings column.

Design rationale, source-verified capability boundaries, and the decision
register live in [`docs/design/`](docs/design/).

## License

[MIT](LICENSE)
