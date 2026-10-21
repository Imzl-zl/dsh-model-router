#!/usr/bin/env node
/**
 * Extract one version's section from CHANGELOG.md.
 *
 * One parser for the GitHub release notes (`release-notes.mjs`) and the notes
 * embedded in the plugin build (`embed-changelog.mjs`): the release page, npm,
 * and the in-app dialog must never disagree about what a version changed.
 */

/**
 * @param {string} version - exact version without the leading `v`.
 * @param {string} text - the whole CHANGELOG.md.
 * @returns {string | undefined} the section body, or undefined when the version has none.
 */
export function changelogSection(version, text) {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start < 0) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## ['))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}
