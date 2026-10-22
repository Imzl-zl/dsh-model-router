/**
 * "Is there a newer release?" — the one question behind the workbench's
 * 检查更新 button.
 *
 * Two sources, and they answer different questions:
 *
 * - **npm registry** (`/dsh-models-router/latest`) is the authority on WHICH
 *   version is the newest published one. It is the same registry the user
 *   installs from, so "latest" here means "what `dsh plugin update` would
 *   fetch" — not "what GitHub's newest tag says".
 * - **GitHub releases** carry the notes. The release body is generated from
 *   this repository's CHANGELOG by scripts/release-notes.mjs, so the body of
 *   `v<latest>` is exactly the section the next build will embed.
 *
 * The running version's own notes are NOT fetched: they are embedded in the
 * artifact (src/release.generated.ts), which is why a dialog can show them
 * offline, and why the embedded copy can never disagree with what is installed.
 *
 * Nothing here guesses: a version that cannot be parsed is not a version, a
 * registry that cannot be reached is an error the UI must show, and a release
 * whose body is empty is "no notes", never "no changes".
 *
 * Note: 为何版本以 registry 为准、为何新版本的说明取自 release body —— 见
 * .agents/notes/implemented/2026-10-22-check-update-instead-of-a-changelog-button.md
 */

import type { UpdateCheck } from './types.ts'

/** Where the published package lives. The registry path is the package name. */
const REGISTRY_PACKAGE = 'dsh-models-router'
/** The repository whose releases carry the notes. */
const REPO = 'Imzl-zl/dsh-models-router'

/** How long one request may take before the check gives up and says so. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Compare two semver-shaped versions.
 *
 * Only the shape this project publishes is understood: `major.minor.patch`
 * with an optional `-prerelease`. Anything else is not a version, and the
 * caller must not treat it as one — a package whose "version" is `latest` or
 * `1.2` must not be compared as if it were a release.
 *
 * @param a - left version.
 * @param b - right version.
 * @returns negative when a < b, zero when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index]
  }
  // A prerelease is older than the release it precedes (npm's rule).
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  return comparePrerelease(left.pre, right.pre)
}

interface ParsedVersion {
  readonly core: readonly [number, number, number]
  /** The prerelease identifiers, in order. */
  readonly pre: readonly string[]
}

/** Parse `1.2.3` / `1.2.3-rc.1`; null for anything else. */
function parseVersion(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two prerelease identifier lists, npm's way.
 *
 * Identifiers are compared one by one: numeric ones by VALUE (so `rc.2` is older
 * than `rc.10` — the string order would say the opposite), alphanumeric ones by
 * ASCII order, a numeric identifier is older than an alphanumeric one, and a
 * shorter list is older when every shared identifier is equal.
 */
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length)
  for (let index = 0; index < shared; index += 1) {
    const left = a[index]
    const right = b[index]
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const difference = Number(left) - Number(right)
      if (difference !== 0) return difference < 0 ? -1 : 1
      continue
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    if (left !== right) return left < right ? -1 : 1
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? -1 : 1
}

/** The fetch shape this module needs; `globalThis.fetch` satisfies it. */
type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** How a check is performed; injectable so the tests never touch the network. */
export interface CheckOptions {
  /** The fetch implementation; defaults to the runtime's. */
  fetchImpl?: FetchLike
  /** Cancels the check (the browser's remote cancellation arrives this way). */
  signal?: AbortSignal
  /** The registry base URL; overridable for tests and mirrors. */
  registryBase?: string
  /** The GitHub API base URL; overridable for tests. */
  githubBase?: string
}

/**
 * Ask the registry whether a newer version exists, and read that version's
 * notes.
 *
 * The two requests are independent: a registry that answers and a release that
 * does not still leave the version answer usable, and a registry that does not
 * answer means the version question itself is unknown — never "up to date".
 *
 * @param current - the version this artifact carries.
 * @param options - injectable fetch, cancellation, and endpoint overrides.
 * @returns what the check found.
 */
export async function checkForUpdate(current: string, options: CheckOptions = {}): Promise<UpdateCheck> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const registryBase = options.registryBase ?? 'https://registry.npmjs.org'
  const githubBase = options.githubBase ?? 'https://api.github.com'
  const timeout = (): AbortSignal => AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal === undefined
    ? timeout()
    : AbortSignal.any([options.signal, timeout()])

  const empty: UpdateCheck = {
    current,
    latest: null,
    newer: false,
    publishedAt: null,
    notes: null,
    error: null,
    notesError: null,
  }

  let latest: string
  try {
    const response = await fetchImpl(`${registryBase}/${REGISTRY_PACKAGE}/latest`, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-models-router' },
      signal,
    })
    if (!response.ok) throw new Error(`registry answered ${String(response.status)}`)
    const body = await response.json() as { version?: unknown }
    if (typeof body.version !== 'string' || parseVersion(body.version) === null) {
      throw new Error('registry named no usable version')
    }
    latest = body.version
  } catch (error) {
    return { ...empty, error: describe(error) }
  }

  const newer = (compareVersions(latest, current) ?? 0) > 0
  if (!newer) {
    // 已是最新：不需要联网去读一份用不上的说明，当前版本的说明就在产物里。
    return { ...empty, latest, newer: false }
  }

  try {
    const response = await fetchImpl(`${githubBase}/repos/${REPO}/releases/tags/v${latest}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-models-router' },
      signal,
    })
    if (!response.ok) throw new Error(`release notes answered ${String(response.status)}`)
    const body = await response.json() as { body?: unknown; published_at?: unknown }
    return {
      current,
      latest,
      newer: true,
      publishedAt: typeof body.published_at === 'string' ? body.published_at : null,
      notes: typeof body.body === 'string' && body.body.trim() !== '' ? body.body : null,
      error: null,
      notesError: null,
    }
  } catch (error) {
    // 版本已经知道了，只是说明没读到：分开说，别把两者揉成一句"检查失败"。
    return { ...empty, latest, newer: true, notesError: describe(error) }
  }
}

/** One failure, as a sentence the UI can show. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return '请求超时'
    return error.message
  }
  return String(error)
}
