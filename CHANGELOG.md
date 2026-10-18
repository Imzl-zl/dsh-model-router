# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions below `1.0.0` are pre-stable: the minor digit marks a delivery
milestone, and the plugin's DSH peer range (`0.2.0-rc.2`) moves together with
it.

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

[0.1.0]: https://github.com/Imzl-zl/dsh-model-router/releases/tag/v0.1.0
