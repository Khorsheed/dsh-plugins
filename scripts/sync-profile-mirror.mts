#!/usr/bin/env node
/**
 * sync-profile-mirror — push a monorepo profile pack to its standalone mirror
 * repo as one sync commit.
 *
 * The monorepo is the single source of truth; the mirror is the "clone and
 * install" front door. A pack's root IS the profile (package.json,
 * cordis.patch.yml, pnpm-*.yaml) plus the distribution wrapper that delivers
 * it (scripts, bilingual README, CHANGELOG, docs/screenshots), so the mirror
 * needs no path rewriting — it is a byte copy.
 *
 * The sync preserves the mirror's own history: wipe everything except .git and
 * MIRROR_FILES, copy the pack in, commit only when something changed.
 *
 * `--check` is the CI gate. Without it a "single source of truth" quietly
 * drifts into two truths, which is the risk the manually-triggered ankh-guard
 * mirror already carries; a red build is cheaper than a silent divergence.
 *
 * Usage: npx tsx scripts/sync-profile-mirror.mts <name> [--dry-run|--check]
 *   name: the pack directory under profiles/, e.g. web-basic
 * Requires: push rights to Khorsheed/dsh-<name> for the push mode; `--check`
 * clones over https and needs no credentials, so CI can run it unattended.
 * @module scripts/sync-profile-mirror
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const check = args.includes('--check')

if (name === undefined) {
  process.stderr.write('usage: sync-profile-mirror.mts <name> [--dry-run|--check]\n')
  process.exit(2)
}

const src = join(root, 'profiles', name)
if (!existsSync(src)) {
  process.stderr.write(`sync-profile-mirror: profiles/${name} does not exist\n`)
  process.exit(2)
}

/** Kept in the mirror across a wipe: its own git state and ignore rules. */
const MIRROR_FILES = new Set(['.git', '.gitignore'])

/** Never mirrored: install state and OS noise. A profile is a live directory. */
const SKIP = new Set(['node_modules', '.DS_Store'])

const MIRROR_README_NOTE = (n: string): string =>
  `> 镜像仓：与 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 的 \`profiles/${n}\` 自动同步。Issue 欢迎提在本仓；PR 请提交到 monorepo。\n>\n> `

function run(cmd: string, cmdArgs: string[], cwd: string): string {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8' }).trim()
}

const headSha = run('git', ['rev-parse', 'HEAD'], root)
const work = mkdtempSync(join(tmpdir(), `profile-mirror-${name}-`))
try {
  // Read-only modes clone over https so CI needs no deploy key; pushing uses ssh.
  const remote = check
    ? `https://github.com/Khorsheed/dsh-${name}.git`
    : `git@github.com:Khorsheed/dsh-${name}.git`
  run('git', ['clone', '--depth', '1', remote, '.'], work)

  for (const entry of readdirSync(work)) {
    if (MIRROR_FILES.has(entry)) continue
    rmSync(join(work, entry), { recursive: true, force: true })
  }
  for (const entry of readdirSync(src)) {
    if (SKIP.has(entry)) continue
    cpSync(join(src, entry), join(work, entry), { recursive: true })
  }
  // The mirror ignores install state only — screenshots are tracked content
  // here, unlike the monorepo where images are ignored and force-added.
  writeFileSync(join(work, '.gitignore'), 'node_modules/\n.DS_Store\n')

  const readme = join(work, 'README.md')
  const text = readFileSync(readme, 'utf8')
  const firstBreak = text.indexOf('\n\n')
  writeFileSync(readme, text.slice(0, firstBreak + 2) + MIRROR_README_NOTE(name) + text.slice(firstBreak + 2))

  run('git', ['add', '-A'], work)
  const diff = run('git', ['status', '--porcelain'], work)
  if (diff === '') {
    process.stdout.write(`mirror dsh-${name} already up to date\n`)
  } else if (check) {
    process.stderr.write(`mirror dsh-${name} is behind profiles/${name}:\n${diff}\n\nrun: pnpm exec tsx scripts/sync-profile-mirror.mts ${name}\n`)
    process.exit(1)
  } else if (dryRun) {
    process.stdout.write(`${run('git', ['status', '--short'], work)}\n(dry run — not pushed)\n`)
  } else {
    run('git', ['commit', '-m', `sync from dsh-plugins @ ${headSha.slice(0, 7)}`], work)
    run('git', ['push', 'origin', 'HEAD'], work)
    process.stdout.write(`mirror dsh-${name} synced @ ${headSha.slice(0, 7)}\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
