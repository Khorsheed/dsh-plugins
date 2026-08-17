#!/usr/bin/env node
/**
 * Repo hygiene checker.
 *
 * Fails when files that are about to be committed (staged, default) — or the
 * whole tracked tree (`--all`) — would publish anything a public repo should
 * not carry:
 *
 *   1. absolute local paths        `/Users/<name>/…`, `/home/<name>/…`,
 *                                  `C:\Users\<name>\…`
 *                                  (the `/home/user` placeholder used in
 *                                  sanitized fixtures is allowed)
 *   2. credential-shaped strings   API keys, private-key headers, GitHub
 *                                  tokens, `key = "long value"` assignments
 *   3. tooling / scratch state     `.playwright-mcp/`, `scratch-*`,
 *                                  `*.tsbuildinfo`, `*.log`, `.DS_Store`,
 *                                  `node_modules/`, package `lib/`, `.env`
 *
 * Wired as the repo pre-commit hook (`.githooks/pre-commit`, install once with
 * `pnpm hooks:install`). Run by hand:
 *
 *   pnpm check:hygiene          # staged files (what a commit would publish)
 *   pnpm check:hygiene --all    # every tracked file (full audit / CI)
 *   pnpm check:hygiene -- <path>…   # explicit paths
 *
 * Exit code 0 = clean; 1 = findings (each printed as `<path>:<line>: <match>`).
 * @module scripts/check-repo-hygiene
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Absolute-home-path matcher; group 1 is the username (drive part for Windows). */
export const ABSOLUTE_PATH_RE = /(?:\/Users\/|\/home\/|C:\\Users\\)([A-Za-z0-9_.-]+)/g

/**
 * Credential-shaped content matchers. Kept deliberately narrow: the key must
 * look like a key and the value must look like a value, so design notes that
 * merely mention "OAuth token" or "apiKeySource": "none" do not trip it.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
  { name: 'openai-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github token', re: /\b(?:ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'private-key header', re: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP|ENCRYPTED) PRIVATE KEY-----/g },
  {
    name: 'key=value credential',
    re: /["']?(?:api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token|bearer|authorization)["']?\s*[:=]\s*["'][^"']{16,}["']/gi,
  },
]

/** Path shapes that must never enter the tree, even with `git add -f`. */
export const FORBIDDEN_PATH_RES: ReadonlyArray<RegExp> = [
  /(^|\/)\.playwright-mcp\//,
  /(^|\/)scratch-/,
  /\.tsbuildinfo$/,
  /(^|\/)\.DS_Store$/,
  /\.log$/,
  /(^|\/)node_modules\//,
  /(^|\/)lib\//,
  /(^|\/)\.env($|\.)/,
]

export interface Finding {
  readonly path: string
  readonly line: number
  readonly kind: string
  readonly match: string
}

/** Collect absolute local paths, allowing only the `/home/user` fixture placeholder. */
export function detectAbsolutePaths(content: string): string[] {
  const out: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const re = new RegExp(ABSOLUTE_PATH_RE.source, ABSOLUTE_PATH_RE.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const username = m[1]
      if (username === 'user') continue // sanitized fixture placeholder
      out.push(m[0])
    }
  }
  return [...new Set(out)]
}

/** Collect credential-shaped strings. */
export function detectSecrets(content: string): string[] {
  const out: string[] = []
  for (const { re } of SECRET_PATTERNS) {
    const copy = new RegExp(re.source, re.flags)
    let m: RegExpExecArray | null
    while ((m = copy.exec(content)) !== null) out.push(m[0])
  }
  return [...new Set(out)]
}

/** Whether a file path is a tooling/scratch shape that must stay untracked. */
export function isForbiddenPath(path: string): boolean {
  return FORBIDDEN_PATH_RES.some((re) => re.test(path))
}

/** Run every content check on one file, with line numbers. */
export function scanFile(path: string): Finding[] {
  const raw = readFileSync(path)
  if (raw.includes(0)) return [] // binary — skip
  const content = raw.toString('utf8')
  const findings: Finding[] = []
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const m of detectAbsolutePaths(line)) {
      if (m.length > 0) findings.push({ path, line: i + 1, kind: 'absolute path', match: m })
    }
    for (const m of detectSecrets(line)) {
      if (m.length > 0) findings.push({ path, line: i + 1, kind: 'credential', match: m })
    }
  }
  return findings
}

function stagedFiles(): string[] {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
}

function main(): void {
  const args = process.argv.slice(2)
  let files: string[]
  if (args.includes('--all')) {
    files = trackedFiles()
  } else {
    const explicit = args.filter((a) => !a.startsWith('--'))
    files = explicit.length > 0 ? explicit : stagedFiles()
  }

  const findings: Finding[] = []
  for (const path of files) {
    if (isForbiddenPath(path)) {
      findings.push({ path, line: 0, kind: 'forbidden path', match: 'tooling/scratch state must stay untracked' })
      continue
    }
    try {
      findings.push(...scanFile(path))
    } catch (error) {
      const e = error as NodeJS.ErrnoException
      if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw error
    }
  }

  for (const f of findings) {
    const loc = f.line > 0 ? `:${f.line}` : ''
    process.stderr.write(`hygiene: ${f.path}${loc}: ${f.kind} — ${f.match}\n`)
  }
  process.stdout.write(`hygiene: scanned ${files.length} file(s), ${findings.length} finding(s)\n`)
  process.exit(findings.length > 0 ? 1 : 0)
}

// Only run the CLI when invoked directly; importing (e.g. from the spec)
// must not exit the host process.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
