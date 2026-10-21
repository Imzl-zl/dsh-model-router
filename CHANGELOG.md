# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions below `1.0.0` are pre-stable: the minor digit marks a delivery
milestone, and the plugin's DSH peer range (`0.2.0-rc.2`) moves together with
it.

## [0.2.1] — 2026-10-21

Packaging and process only; no runtime behaviour changed. The first release
published by CI through the npm trusted publisher (OIDC) rather than a manual
`npm publish`.

### Changed

- **Releases are tag-driven.** Pushing `v*.*.*` runs
  `.github/workflows/release.yml`: it refuses a tag that differs from the package
  version, builds, publishes with provenance, and opens the GitHub release from
  this file's matching section.
- **CI** runs on every push to `master` and every pull request: the build, the
  host type-check, and each of the four suites as its own step.
- npm metadata (`keywords`, `homepage`, `bugs`, `author`, `engines`) and the
  README badges; `dsh-models-router` replaces `dsh-model-router` everywhere,
  including the repository name.

### Fixed

- The client bundle no longer leaves its own `./remote` artifact as an external
  `require` on a clean checkout (the host face now builds first).
- The legacy-config composition scenario generates its overlay at run time
  instead of shipping Windows absolute paths.

## [0.2.0] — 2026-10-21

The release that makes routing per-conversation: several named chains, a session
that can pick one, and retry counts that can be overridden per session. Published
under the name `dsh-models-router` (`dsh-model-router` on npm belongs to another
publisher).

### Added

- **Named chains.** `chains[]` + `defaultChainId`; a chain carries its own
  candidates, switch-on rules, first-hop budget, sticky window and start
  strategy. The settings page can add, rename, copy (candidates and budgets come
  along), make default and remove chains; the last one cannot be removed.
- **Per-session chain binding.** A chip in the composer tool row (after the Plan
  and permission controls, before the model selector) picks the chain for the
  current conversation, and a "session routing" tab lists every session so
  several can be assigned without opening them. Bindings live in the
  `model_router_sessions` storageDomain sidecar, keyed by `sessionId`; without
  the storage domain they fall back to process memory and the UI says so.
- **Per-route retry overrides** in the session popover and the session tab:
  `session override ?? candidate maxRetries`, keyed by `provider/model`, 0..9.
  Empty follows the chain; `0` means "do not retry this route".
- **Batch binding read/write Remotes** (`sessionBindings`,
  `deleteSessionBinding`) for the session list and its cleanup of deleted
  sessions.

### Changed

- **Retries on a routed step are executed by this plugin.** For a code listed in
  `switchOn`, the configured `maxRetries` is the real number, with no
  provider-policy ceiling on top; the wait copies DSH's curve. Codes outside
  `switchOn` still go to `llm-retry`.
- A chain's `needs` gates the fallbacks; the first hop is the user's selection
  and is never gated (README documents the consequence for image routing).

### Fixed

- **Legacy configs are actually adopted.** The shape is now read from the raw
  config (`chains` → `chain` → `profiles` → `default`), so a user whose config
  predates the named chains keeps routing instead of silently being read as an
  empty chain.
- **A reloading or disabled plugin no longer breaks turns.** The per-agent seams
  are owned by the plugin fiber and take the agent from the payload, so they are
  removed on unload and replaced on reload; a closed storage domain now answers
  "no binding" on reads and a plain retryable error on writes instead of leaking
  `DomainError('closed')`, and a restart retries a transiently `already-open`
  domain.

## [0.1.0] — 2026-10-19

First tagged release. The plugin has been feature-complete since 2026-10-16 and
is published here as one baseline rather than a running count of pre-release
commits: everything below landed between the first commit (2026-10-13) and this
tag, verified against a real DSH Loader and, where behaviour is visual, a real
browser session.

### Added

- **Transparent cross-provider failover for Agent main requests.** `agent/request`
  (`prepend: true`) selects the physical route for every attempt; when a model
  fails, the request moves along an ordered chain of physical
  `provider/model` candidates. Models without a configured rule behave exactly
  as they do without the plugin.
- **Two-layer attempt budget.** Same-route retries and their backoff stay owned
  by DSH's `llm-retry` (durable `llm/retry` records included); cross-candidate
  failover and the hard total cap belong to this plugin. Neither layer can
  starve or duplicate the other.
- **Pre-fire validation.** Before a candidate is returned, its route config is
  resolved through `ctx.llm.resolveCallConfig()` — the same path `selectModel`
  uses — so a candidate that cannot serve this exact request is skipped before
  any real call. Pre-check failures are tiered by who can fix them
  (request shape / route missing / adapter defect).
- **Conditional routing.** Per-candidate `images` and `minContextTokens`
  conditions, plus per-`switchOn` failure-code switches. The image condition
  exists so a text-first route can hand a sudden image turn to a vision
  candidate with no extra click.
- **Chinese, in-conversation notices** for every switch: the failure code, the
  candidate that answered, and why the switch was allowed. Notices ride the
  durable log into the trajectory view.
- **Channel health workspace** in the sidebar footer dialog: passive zero-token
  observation of real latency and throughput, opt-in 1-token TTFT probes,
  per-channel circuit breakers (route- and channel-scoped, with cooldown), a
  24-point timeline, and a failover-history drawer that rebuilds itself through
  session forks.
- **Bilingual configuration UI** (zh/en) with the full settings surface inline:
  chain ordering and drag-reorder, per-candidate attempt caps, switch-on codes,
  breaker rules, probe settings, and an unsaved-changes save bar.

### Changed

- **The UI has exactly one carrier**: a sidebar footer entry that opens a
  dialog. The `plugins.bundle.config` page registration was removed on
  2026-10-16 — measurement showed a page cannot fit DSH's settings column
  (868.9px min-content against a 647.1px column at a 768px viewport).
- **Semantic colour has one source.** Tone colours enter dots and borders only;
  badge text is always `label-primary`. `--dsh-router-accent` is defined once,
  and accent-as-text resolves per theme (`--dsh-router-accent-text`) so contrast
  stays above AA in both themes.
- **Height comes from the container chain**, never from `calc(100vh …)`; a
  source-level guard rejects the latter.

### Verified

- Composition (real headless Loader, stub adapter, assertions on the durable
  log): **21 scenarios, 0 failures**.
- Unit (pure decision logic): **121 tests**.
- Client controller: **48 tests**.
- Remote service: **14 tests**.
- `npm run bundle` (including `tsc -p tsconfig.json`) and `node --check`: clean.
- The DSH reference checkout is strictly read-only across the whole history:
  `git -C <checkout> status --porcelain` is 0 lines.

### Known limitations

- **Agent main requests only.** Compaction and session-title calls keep their
  own DSH configuration and are not routed.
- **Tool capability is not pre-checked.** DSH exposes no machine-readable
  "supports function calling" metadata.
- **Not on npm.** The name `dsh-model-router` on the public registry belongs to
  an unrelated package; this plugin is installed from this repository.

[0.1.0]: https://github.com/Imzl-zl/dsh-models-router/releases/tag/v0.1.0
