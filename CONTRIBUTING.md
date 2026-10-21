# Contributing

This repository is one DSH plugin (`packages/dsh-models-router/`) plus the design
and decision records around it. Before changing behaviour, read
[`AGENTS.md`](AGENTS.md) — it is the rulebook — and
[`.agents/notes/AGENTS.md`](.agents/notes/AGENTS.md) for how decisions are
recorded.

## Ground rules

- **One source per fact.** A value, a list, or a rule lives in one module; the
  Host half and the browser half import it instead of copying it. If you find
  the same fact twice, the change is to remove one of them.
- **No silent fallbacks.** A failure surfaces as an error, a notice, or a red
  test — never as an empty default that looks like "nothing happened".
- **A non-trivial change needs a decision note** in
  [`.agents/notes/implemented/`](.agents/notes/implemented/), committed with the
  code, and a one-line `Note:` back-reference at the code entry it governs.
- **Tests are the specification.** Do not make a failing suite green by
  weakening an assertion or deleting a case; assertion values come from the
  production path, a real wire capture, or an external spec.
- **DSH is read-only here.** Source facts are cited by path and line against the
  DSH checkout named in `AGENTS.md`; nothing in that tree is modified.

## Validation

```sh
npm install
npm ci --prefix packages/dsh-models-router --legacy-peer-deps
npm run bundle --prefix packages/dsh-models-router
npm test
```

`npm test` runs the four suites (unit, client-controller, remote, Loader
composition). The composition and remote suites run the **built** artifact, so
`npm run bundle` must run after a source change. The host entry also has a
standalone type-check:

```sh
npx tsc --noEmit --skipLibCheck --strict \
  --module nodenext --moduleResolution nodenext \
  --target es2022 --allowImportingTsExtensions \
  packages/dsh-models-router/src/index.ts
```

## Releases

Tag-driven; see the README's "Releasing" section. The tag must equal
`packages/dsh-models-router/package.json`'s version, and the CHANGELOG section
for that version becomes the GitHub release notes.
