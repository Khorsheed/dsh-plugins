#!/usr/bin/env node
/**
 * sync-ankh-guard-mirror — push the monorepo's packages/ankh-guard to the
 * standalone Khorsheed/dsh-ankh-guard repo as one sync commit.
 *
 * The monorepo is the single source of truth; the standalone repo is the
 * single-plugin audience's living home (issues, releases, clone-to-install).
 * ankh-guard is fully self-contained (package-local tsconfig/tsdown config,
 * no workspace deps, public devDeps, prepare builds lib/), so a mirror clone
 * builds and installs from the public registry alone.
 *
 * The sync preserves the mirror's own history: wipe everything except .git
 * and MIRROR_FILES, copy the package in, commit only when something changed.
 *
 * Usage: npx tsx scripts/sync-ankh-guard-mirror.mts [--dry-run]
 * Requires: gh auth with push rights to Khorsheed/dsh-ankh-guard.
 * @module scripts/sync-ankh-guard-mirror
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const dryRun = process.argv.includes('--dry-run')

/** Files that live only in the mirror (never overwritten by the sync):
 * vitest.config.ts makes the mirror's tests runnable standalone (the monorepo
 * package uses the repo-root preset instead); assets/ holds mirror-local demo
 * images referenced by its own README history. If the monorepo package ever
 * gains same-named entries, drop them from this set so the sync takes over. */
const MIRROR_FILES = new Set(['.git', '.gitignore', 'vitest.config.ts', 'assets'])

const MIRROR_README_NOTE = `> 镜像仓：与 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 的 \`packages/ankh-guard\` 自动同步。Issue 欢迎提在本仓；PR 请提交到 monorepo。
>
> `

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim()
}

const headSha = run('git', ['rev-parse', 'HEAD'], root)
const version = JSON.parse(readFileSync(join(root, 'packages/ankh-guard/package.json'), 'utf8')).version

const work = mkdtempSync(join(tmpdir(), 'ankh-mirror-'))
try {
  run('git', ['clone', 'git@github.com:Khorsheed/dsh-ankh-guard.git', '.'], work)

  // Wipe mirrored content (keep .git and mirror-only files), then copy the package in.
  for (const entry of readdirSync(work)) {
    if (MIRROR_FILES.has(entry)) continue
    rmSync(join(work, entry), { recursive: true, force: true })
  }
  const src = join(root, 'packages/ankh-guard')
  for (const entry of readdirSync(src)) {
    if (entry === 'node_modules' || entry === 'lib') continue // build output / install state
    cpSync(join(src, entry), join(work, entry), { recursive: true })
  }
  writeFileSync(join(work, '.gitignore'), 'node_modules/\nlib/\n*.tsbuildinfo\n.DS_Store\n')

  // The mirror README is the package README plus the sync note under the title.
  const readme = join(work, 'README.md')
  const text = readFileSync(readme, 'utf8')
  const firstBreak = text.indexOf('\n\n')
  writeFileSync(readme, text.slice(0, firstBreak + 2) + MIRROR_README_NOTE + text.slice(firstBreak + 2))

  run('git', ['add', '-A'], work)
  const dirty = run('git', ['status', '--porcelain'], work) !== ''
  if (!dirty) {
    process.stdout.write('mirror already up to date\n')
  } else if (dryRun) {
    process.stdout.write(run('git', ['status', '--short'], work) + '\n(dry run — not pushed)\n')
  } else {
    run('git', ['commit', '-m', `sync from dsh-plugins @ ${headSha.slice(0, 7)} (v${version})`], work)
    run('git', ['push', 'origin', 'HEAD'], work)
    process.stdout.write(`mirror synced to v${version} @ ${headSha.slice(0, 7)}\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
