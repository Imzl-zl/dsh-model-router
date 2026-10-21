<p align="center">
  <img src="docs/assets/banner.svg" alt="dsh-models-router" width="760">
</p>

<p align="center">
  <a href="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml"><img src="https://github.com/Imzl-zl/dsh-models-router/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="https://www.npmjs.com/package/dsh-models-router"><img src="https://img.shields.io/npm/v/dsh-models-router?color=4A65E8" alt="npm"></a>
  <a href="https://github.com/Imzl-zl/dsh-models-router/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4A65E8.svg" alt="License: MIT"></a>
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
git clone https://github.com/Imzl-zl/dsh-models-router.git
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

## Project layout

| Path | What it is |
|---|---|
| `packages/dsh-models-router/src/` | The plugin: Host half (`index.ts`, `router.ts`, `bindings.ts`, `chain.ts`, …) and browser half (`src/client/`). |
| `packages/dsh-models-router/tests/` | Four suites: `unit`, `client-controller`, `remote` (in-process production profile) and `run` (real headless Loader composition per scenario). |
| `docs/design/` | Current design: routing proposal, source map, capability boundary, per-session chains, release notes policy. |
| `.agents/notes/` | Decision notes (why, what was rejected, what it cost). Status is the directory. |
| `spike/` | Phase 1 evidence kept as-is; not part of the package. |

## Development

```sh
npm install                                                  # root: the DSH CLI + peers
npm ci --prefix packages/dsh-models-router --legacy-peer-deps # package: tsc, tsdown, typert generator
npm run bundle --prefix packages/dsh-models-router           # build lib/ (host + client + typert)
npm test                                                     # the four suites
```

Individual suites (each takes its own file, the composition suite a scenario name):

```sh
node packages/dsh-models-router/tests/unit.mjs
node packages/dsh-models-router/tests/client-controller.mjs
node packages/dsh-models-router/tests/remote.mjs
node packages/dsh-models-router/tests/run.mjs [scenario]
```

The package keeps the built `lib/` out of git (it is in `files`, so npm ships
it); `npm run bundle` must run before a browser or a Loader sees a source
change, and the composition tests load that artifact on purpose.

## Releasing

```sh
npm version minor --prefix packages/dsh-models-router   # 0.2.0 → 0.3.0, no tag yet
# move the CHANGELOG's "Unreleased" content under the new version heading
git add -A && git commit -m "chore(release): 0.3.0"
git tag -a v0.3.0 -m "dsh-models-router 0.3.0" && git push origin master v0.3.0
```

Pushing the tag is the whole release:

- `.github/workflows/release.yml` refuses the tag unless it equals the package
  version, builds `lib/`, publishes to npm with provenance (`--provenance`,
  public access) and opens the GitHub release with the matching CHANGELOG
  section (`scripts/release-notes.mjs`).
- It needs one repository secret, `NPM_TOKEN`: a granular npm token with
  "Read and write" on `dsh-models-router` and 2FA bypass. Nothing else is
  configured in the repository.
- `.github/workflows/ci.yml` runs on every push to `master` and every pull
  request: the build, the host type-check and the four suites.

The version policy is the CHANGELOG's: below `1.0.0` the minor digit marks a
delivery milestone, and the plugin's DSH peer range moves with it.

The package is `dsh-models-router`: the public registry's `dsh-model-router`
belongs to another publisher, so install commands, badges and the bundle patch
use the plural name.

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
