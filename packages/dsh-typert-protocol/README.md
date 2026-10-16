# @deepseek-ai/dsh-typert-protocol — analyzer-only registration stub

This directory is **not** a runtime package. Nothing imports it at runtime; the
plugin resolves the real `@deepseek-ai/dsh-typert-protocol` from `node_modules`
(the package tsconfig carries no `paths`).

## Why it exists

The Typert generator recognizes a `@Remote` marker only when the marker's symbol
resolves to a declaration inside a **registered** `@deepseek-ai/dsh-typert-protocol`
package (`packages/typert/generator/src/analyzer.ts:1978-1993`, and the same
requirement in `lookupDeclarations` for `TypertLookupMap` / `TypertContextMap`
members). Registrations come from `<root>/tsconfig.host.json` project
references whose package root lives under `<root>/packages`
(`analyzer.ts:485-497`).

In the DSH monorepo the mapping is `tsconfig.base.json`'s
`paths: { "@deepseek-ai/dsh-typert-protocol": ["./packages/typert/protocol/src/index.ts"] }`
— a registered workspace package holding the protocol's own source. An
out-of-tree package has no such source tree, so this directory supplies the
equivalent: the project-root `tsconfig.host.json` maps the specifier here, and
the declarations below are what the analyzer's program resolves.

A partial mirror does not work: every protocol type another DSH package
references in a `declare module` augmentation (`TypertLookup`,
`TypertContext`, `RemoteErrorDetailsMap`, …) must also declare inside the
registration, so the whole published declaration surface is copied.

## Refreshing

The declarations are a verbatim copy of the pinned package's published types.
After bumping `@deepseek-ai/dsh-typert-protocol` in the plugin's
`peerDependencies`, re-copy:

```powershell
Copy-Item node_modules\@deepseek-ai\dsh-typert-protocol\lib\types\*.d.ts packages\dsh-typert-protocol\src\ -Force
```

Drift is loud rather than silent: a missing invocation changes the generated
artifact, and the `./remote` export would then point at a file that was never
emitted — which fails at load.
