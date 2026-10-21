#!/usr/bin/env node
/**
 * Mirror the root READMEs into the npm package.
 *
 * npm renders `packages/dsh-models-router/README.md`, which is a different file
 * from the repository's front page. Keeping two hand-maintained copies is how
 * the package page ended up without the banner, the screenshots, or the Chinese
 * default. The root file is the only authored copy; this script rewrites its
 * repository-relative links to absolute GitHub URLs (npm cannot resolve them)
 * and writes the package copy before every build.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/Imzl-zl/dsh-models-router'
const RAW = 'https://raw.githubusercontent.com/Imzl-zl/dsh-models-router/master'

/**
 * Rewrite one root README for the package page.
 * @param {string} text - the root README.
 * @param {'README.md' | 'README.en.md'} name - which language file this is.
 * @returns {string} the npm-facing copy.
 */
export function mirrorReadme(text, name) {
  const other = name === 'README.md' ? 'README.en.md' : 'README.md'
  return text
    // Images are rendered by npm from the package root, where docs/ is not shipped.
    .replaceAll('src="docs/assets/', `src="${RAW}/docs/assets/`)
    .replaceAll('](docs/assets/', `](${RAW}/docs/assets/`)
    .replaceAll('](docs/design/)', `](${REPO}/tree/master/docs/design/)`)
    .replaceAll('](CHANGELOG.md)', `](${REPO}/blob/master/CHANGELOG.md)`)
    .replaceAll('](LICENSE)', `](${REPO}/blob/master/LICENSE)`)
    .replaceAll(`href="${other}"`, `href="${REPO}/blob/master/${other}"`)
}

const root = new URL('../', import.meta.url)
for (const name of ['README.md', 'README.en.md']) {
  const text = readFileSync(new URL(name, root), 'utf8')
  const target = fileURLToPath(new URL(`packages/dsh-models-router/${name}`, root))
  writeFileSync(target, mirrorReadme(text, name))
  console.log(`mirrored ${name} into the package`)
}
