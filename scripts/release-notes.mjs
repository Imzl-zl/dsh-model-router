#!/usr/bin/env node
/**
 * Print one release's section of CHANGELOG.md.
 *
 * The release workflow feeds this to `gh release create --notes-file`, so the
 * GitHub release and the npm page say what the changelog says — one source.
 * Usage: node scripts/release-notes.mjs v0.2.0 | 0.2.0
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const tag = process.argv[2]
if (tag === undefined || tag === '') {
  console.error('usage: node scripts/release-notes.mjs <tag|version>')
  process.exit(1)
}
const version = tag.replace(/^v/, '')
const changelog = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8')
const lines = changelog.split('\n')
const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
const rest = lines.slice(start + 1)
const end = rest.findIndex(line => line.startsWith('## ['))
const section = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
if (section === '') {
  console.error(`CHANGELOG.md's section for ${version} is empty`)
  process.exit(1)
}
process.stdout.write(`${section}\n`)
