<p align="center">
  <img src="docs/assets/banner.svg" alt="dsh-model-router" width="760">
</p>

<p align="center">
  <a href="https://github.com/Imzl-zl/dsh-model-router/releases/tag/v0.1.0"><img src="https://img.shields.io/badge/version-0.1.0-4A65E8.svg" alt="Version"></a>
  <a href="https://github.com/Imzl-zl/dsh-model-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.2-4A65E8.svg" alt="DSH 0.2.0-rc.2"></a>
</p>

---

<p align="center">
  Select a model in DSH's selector as usual. When it fails, the request moves to the next physical channel in your ordered chain, and the conversation reports the failure code, the candidate that answered, and why the switch was allowed. Models without a configured rule behave exactly as they do without the plugin.
</p>

## Features

- **Ordered candidate chains** — per-model rules over physical `provider/model` channels, with per-candidate attempt caps.
- **Two-layer attempt budget** — same-route retries and backoff stay with DSH's `llm-retry`; cross-candidate failover and the hard total cap stay with this plugin.
- **Pre-fire validation** — every candidate is resolved through `ctx.llm.resolveCallConfig()` before a real call, so an unservable candidate is skipped rather than burned.
- **Conditional routing** — per-candidate `images` and `minContextTokens` gates, plus per-code `switchOn`.
- **Channel health workspace** — zero-token passive latency and throughput, opt-in 1-token probes, route- and channel-scoped circuit breakers, and a failover-history drawer that rebuilds through session forks.
- **Bilingual UI** — Chinese and English, with an unsaved-changes bar.

## Installation

Requires DSH `0.2.0-rc.2`. This package is distributed as source from this repository; it is **not** published on npm (the public registry's `dsh-model-router` is an unrelated package).

```sh
git clone https://github.com/Imzl-zl/dsh-model-router.git
cd dsh-model-router
npm install
npm run bundle --prefix packages/dsh-model-router
dsh plugin --profile web add packages/dsh-model-router
```

Open **dsh-model-router** from the sidebar footer to configure chains.

## Configuration

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
default:                        # fallback pool for unconfigured models
  enabled: false
  candidates:
    - { provider: deepseek-official, model: deepseek-chat, maxAttempts: 1 }
  switchOn: { rateLimit: true, server: true, timeout: true, transport: true }
  maxTotalAttempts: 3
```

## How it works

The plugin owns two seams of the Agent loop:

- **`agent/request`** (`prepend: true`) selects the physical route for every attempt. It runs outside `installModelSelection`, so the model you picked always attempts first and a switch never happens without a failure.
- **`agent/request-error`** receives the failure only after DSH's own same-route retries are exhausted, then advances the chain.

Every switch is folded from the durable session log into a `router/failover-history` projection and surfaced in the failover-history drawer.

## Development

```sh
node packages/dsh-model-router/tests/unit.mjs              # pure decision logic
node packages/dsh-model-router/tests/client-controller.mjs # client controller
node packages/dsh-model-router/tests/run.mjs               # real Loader composition
npm run bundle --prefix packages/dsh-model-router          # build lib/
```

The composition tests boot the real headless Loader with a deterministic stub adapter and assert on the durable session log. The web profile is verified by installing the bundle and driving the UI in a browser.

## Limitations

- **Agent main requests only.** Compaction and session-title calls keep their own DSH configuration and are not routed.
- **Tool capability is not pre-checked.** DSH exposes no machine-readable "supports function calling" metadata; an incompatible candidate fails at runtime and is handled by `switchOn.invalidRequest`.
- **Notices are trajectory-first.** Failover notices ride the durable log into the trajectory view; this DSH build does not surface context rows in the chat conversation.

## Documentation

Design rationale, source-verified capability boundaries, and the decision register live in [`docs/design/`](docs/design/). Release history is in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
