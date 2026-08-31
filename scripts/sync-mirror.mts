#!/usr/bin/env node
/**
 * sync-mirror — push a monorepo artifact (package, profile pack, or skill)
 * to its standalone mirror repo as one sync commit.
 *
 * The monorepo is the single source of truth; each mirror is its audience's
 * living home (issues, releases, clone-to-install). One mechanism serves all
 * three artifact kinds; the kind registry below carries only what differs —
 * source dir, mirror-only keep set, skip set, the mirror's .gitignore.
 *
 * The sync preserves the mirror's own history: wipe everything except the
 * keep set, copy the artifact in, commit only when something changed.
 * `--check` (CI gate) clones over https and needs no credentials.
 *
 * Usage: npx tsx scripts/sync-mirror.mts <package|profile|skill> <name> [--dry-run|--check]
 *   e.g. sync-mirror.mts skill plugin-upgrade
 * Requires: push rights to Khorsheed/dsh-<name> for the push mode.
 * @module scripts/sync-mirror
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

/** Per-kind sync contract. `keep` survives the wipe in the mirror; `skip`
 * never crosses over; `gitignore` is what the mirror's own .gitignore holds. */
const KINDS = {
  package: {
    srcDir: (name) => join(root, 'packages', name),
    // ankh-guard's mirror owns its standalone vitest config and demo assets.
    keep: new Set(['.git', '.gitignore', 'vitest.config.ts', 'assets']),
    skip: new Set(['node_modules', 'lib', '.DS_Store']),
    gitignore: 'node_modules/\nlib/\n*.tsbuildinfo\n.DS_Store\n',
  },
  profile: {
    srcDir: (name) => join(root, 'profiles', name),
    keep: new Set(['.git', '.gitignore']),
    skip: new Set(['node_modules', '.DS_Store']),
    gitignore: 'node_modules/\n.DS_Store\n',
  },
  skill: {
    srcDir: (name) => join(root, 'skills', name),
    keep: new Set(['.git', '.gitignore']),
    skip: new Set(['node_modules', '.DS_Store']),
    gitignore: 'node_modules/\n.DS_Store\n',
  },
}

const args = process.argv.slice(2)
const kind = args.find((a) => !a.startsWith('--'))
const name = args.filter((a) => !a.startsWith('--'))[1]
const dryRun = args.includes('--dry-run')
const check = args.includes('--check')

const spec = KINDS[kind]
if (spec === undefined || name === undefined) {
  process.stderr.write(`usage: sync-mirror.mts <${Object.keys(KINDS).join('|')}> <name> [--dry-run|--check]\n`)
  process.exit(2)
}
const src = spec.srcDir(name)
if (!existsSync(src)) {
  process.stderr.write(`sync-mirror: ${kind}s/${name} does not exist\n`)
  process.exit(2)
}

const MIRROR_README_NOTE = `> 镜像仓：与 [Khorsheed/dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 的 \`${kind}s/${name}\` 自动同步。Issue 欢迎提在本仓；PR 请提交到 monorepo。\n>\n> `

function run(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8' }).trim()
}

const headSha = run('git', ['rev-parse', 'HEAD'], root)
const work = mkdtempSync(join(tmpdir(), `mirror-${name}-`))
try {
  // Read-only modes clone over https so CI needs no deploy key; push uses ssh.
  const remote = check
    ? `https://github.com/Khorsheed/dsh-${name}.git`
    : `git@github.com:Khorsheed/dsh-${name}.git`
  run('git', ['clone', ...(check ? ['--depth', '1'] : []), remote, '.'], work)

  for (const entry of readdirSync(work)) {
    if (spec.keep.has(entry)) continue
    rmSync(join(work, entry), { recursive: true, force: true })
  }
  for (const entry of readdirSync(src)) {
    if (spec.skip.has(entry)) continue
    cpSync(join(src, entry), join(work, entry), { recursive: true })
  }
  writeFileSync(join(work, '.gitignore'), spec.gitignore)

  const readme = join(work, 'README.md')
  const text = readFileSync(readme, 'utf8')
  const firstBreak = text.indexOf('\n\n')
  writeFileSync(readme, text.slice(0, firstBreak + 2) + MIRROR_README_NOTE + text.slice(firstBreak + 2))

  run('git', ['add', '-A'], work)
  const diff = run('git', ['status', '--porcelain'], work)
  if (diff === '') {
    process.stdout.write(`mirror dsh-${name} already up to date\n`)
  } else if (check) {
    process.stderr.write(`mirror dsh-${name} is behind ${kind}s/${name}:\n${diff}\n\nrun: pnpm exec tsx scripts/sync-mirror.mts ${kind} ${name}\n`)
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
