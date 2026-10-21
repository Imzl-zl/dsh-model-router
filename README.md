<p align="center">
  <img src="docs/assets/banner.svg" alt="dsh-models-router" width="760">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-models-router"><img src="https://img.shields.io/npm/v/dsh-models-router?color=4A65E8" alt="npm"></a>
  <a href="https://github.com/Imzl-zl/dsh-model-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.2-4A65E8.svg" alt="DSH 0.2.0-rc.2"></a>
</p>

---

<p align="center">
  Select a model in DSH's selector as usual. When it fails, the request moves to the next physical channel in the chain this conversation routes on, and the conversation reports the failure code, the candidate that answered, and why the switch was allowed.
</p>

## Features

- **Named chains, chosen per session** — several fallback chains, each with its own candidates, switch-on rules and budgets; a conversation picks one from the composer chip, or from the session list in the settings panel.
- **Per-route retry overrides** — a session can override a route's retry count: `0` means "do not retry this route", empty means "follow the chain".
- **Retries this plugin executes** — for codes in `switchOn`, the configured number is the real number (no provider-policy ceiling); codes outside `switchOn` still go to DSH's `llm-retry`.
- **Pre-fire validation** — every candidate is resolved through `ctx.llm.resolveCallConfig()` before a real call, so an unservable candidate is skipped rather than burned.
- **Conditional routing** — per-candidate `images` and `minContextTokens` gates, plus per-code `switchOn`.
- **Channel health workspace** — zero-token passive latency and throughput, opt-in 1-token probes, route- and channel-scoped circuit breakers, and a failover-history drawer that rebuilds through session forks.
- **Bilingual UI** — Chinese and English, with an unsaved-changes bar.

## Installation

Requires DSH `0.2.0-rc.2`.

```sh
dsh plugin add dsh-models-router
```

From a checkout instead (the package name is `dsh-models-router`; the public registry's `dsh-model-router` is an unrelated package):

```sh
git clone https://github.com/Imzl-zl/dsh-model-router.git
cd dsh-model-router
npm install
npm run bundle --prefix packages/dsh-models-router
dsh plugin --profile web add packages/dsh-models-router
```

Open **dsh-models-router** from the sidebar's panel list to configure chains.

## Configuration

```yaml
enabled: true
defaultChainId: default          # sessions with no choice of their own
chains:
  - id: default                  # stable id: sessions bind to it
    name: ""                     # empty = "default chain" in the UI
    candidates:                  # fallbacks; the selected model is the implicit first hop
      - { provider: deepseek-official, model: deepseek-v4-flash, maxRetries: 1, needs: { images: false } }
      - { provider: pi-ai-gpt, model: gpt-5, maxRetries: 0, needs: { images: true } }
    switchOn: { rateLimit: true, server: true, timeout: true, transport: true, emptyResponse: false, invalidRequest: false, auth: true, quota: true }
    firstHopMaxRetries: 0        # retries after the first hop's first call
    stickyTurns: 0               # no-image turns to keep the image route after an image turn
    strategy: order
  - id: coding
    name: Write code
    candidates: [...]
```

The first hop is always the model you selected in DSH — it is not part of the config — so a chain only answers "where next". Old single-`chain` configs (and the per-model `profiles` of 2026-10-19-era builds) are migrated to one named chain on read, and the first save stores the new shape.

## How it works

The plugin owns two seams of the Agent loop:

- **`agent/request`** (`prepend: true`) selects the physical route for every attempt. It runs outside `installModelSelection`, so the model you picked always attempts first and a switch never happens without a failure.
- **`agent/request-error`** (`prepend: true`, outermost) sees every failed attempt first: for a code in `switchOn` it waits and retries itself, then advances the chain; for any other code it delegates to DSH, so `llm-retry` keeps its own retries and cap.

Every switch is folded from the durable session log into a `router/failover-history` projection and surfaced in the failover-history drawer.

## Development

```sh
node packages/dsh-models-router/tests/unit.mjs              # pure decision logic
node packages/dsh-models-router/tests/client-controller.mjs # client controller
node packages/dsh-models-router/tests/run.mjs               # real Loader composition
npm run bundle --prefix packages/dsh-models-router          # build lib/
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
