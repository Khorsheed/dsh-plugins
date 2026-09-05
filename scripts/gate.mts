#!/usr/bin/env node
/**
 * gate — the pre-merge gate a package owner runs in their worktree before
 * merging to main.
 *
 * CI runs on push, and pushes are batched by the human, so CI feedback is
 * infrequent by design. This gate is what makes that safe: it runs every CI
 * check that is reproducible locally, cheapest first, and stops at the first
 * failure.
 *
 * **Scoped by default.** A whole-repo run costs about nine minutes on an
 * 8-core machine, and measurement showed 46% of that is one package's
 * process-spawning suite — a cost every change paid, including changes that
 * touched no package source at all. The default now builds, tests and packs
 * only the packages a change touched plus everything that depends on them
 * (pnpm's own `...[ref]` selector, so the dependency closure is pnpm's
 * reckoning and not ours). `--all` restores the whole-repo sweep.
 *
 * The scoped/full split maps onto the ownership split: an owner runs scoped
 * while iterating, mainline runs `--all` before pushing, CI runs everything
 * unconditionally. A subset never becomes the last word.
 *
 * Three CI steps cannot be reproduced from a warm checkout — a COLD
 * `pnpm install --frozen-lockfile`, the harness pinned to CI's tag, and the
 * harness's own build. `check-build-scripts-declared` and the harness ref
 * advisory cover the failure modes those have produced; `--full` closes the
 * rest by running the real workflow under `act`.
 *
 * The mirror `--check` gates are deliberately absent: mirror drift is
 * mainline's to fix (syncing needs push rights to the mirror repo), so it
 * must not block an owner's merge. CI keeps them.
 *
 * Usage: pnpm gate [--all] [--since <ref>] [--full]
 * @module scripts/gate
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const full = argv.includes('--full')
const all = argv.includes('--all')
const sinceIdx = argv.indexOf('--since')
const requestedBase = sinceIdx === -1 ? undefined : argv[sinceIdx + 1]

function sh(command: string): void {
  execSync(command, { cwd: root, stdio: 'inherit', shell: '/bin/bash' })
}

function capture(command: string): string {
  try {
    return execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** The ref changes are measured against. `origin/main` is the honest base for
 * a gate whose whole point is "is this safe to merge and push"; a checkout
 * without it falls back to local main. */
function baseRef(): string | undefined {
  for (const ref of [requestedBase, 'origin/main', 'main']) {
    if (ref !== undefined && capture(`git rev-parse --verify --quiet ${ref}`) !== '') return ref
  }
  return undefined
}

/** Paths that invalidate scoping: they change how every package builds or
 * tests, while touching no package directory, so pnpm's changed-package
 * selector reports nothing. A shared vitest preset edit that skipped every
 * test would be a silent false green — the one failure mode scoping must
 * not have. */
const GLOBAL_PATHS = ['build/', 'scripts/', 'tsconfig.base.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package.json', '.github/']

interface Scope { readonly filter: string | undefined; readonly dirs: string[]; readonly why: string }

function resolveScope(): Scope {
  if (all) return { filter: undefined, dirs: [], why: '--all: whole repo' }
  const base = baseRef()
  if (base === undefined) return { filter: undefined, dirs: [], why: 'no base ref found — falling back to whole repo' }

  const changed = capture(`git diff --name-only ${base}...HEAD`).split('\n').filter((p) => p !== '')
  const dirty = capture('git status --porcelain').split('\n').filter((l) => l !== '').map((l) => l.slice(3))
  const touched = [...new Set([...changed, ...dirty])]

  const global = touched.filter((p) => GLOBAL_PATHS.some((g) => p.startsWith(g)))
  if (global.length > 0) {
    return { filter: undefined, dirs: [], why: `whole repo — shared-layer paths changed (${global.slice(0, 3).join(', ')}${global.length > 3 ? ', …' : ''})` }
  }

  const selector = `...[${base}]`
  const listed = capture(`pnpm --filter "${selector}" list --depth -1 --parseable`)
    .split('\n').filter((p) => p !== '' && p !== root)
  const dirs = listed.map((p) => p.split('/').pop()!).sort()
  if (dirs.length === 0) return { filter: 'NONE', dirs: [], why: `no package changed since ${base}` }
  return { filter: selector, dirs, why: `${dirs.length} package(s) changed since ${base} (with dependents): ${dirs.join(', ')}` }
}

/** A merge that adds a dependency leaves this checkout's node_modules behind,
 * and the build then fails minutes later as an unresolvable import — a message
 * naming neither the cause nor the fix (observed 2026-09-05: a merge declared
 * `@deepseek-ai/dsh-agent-default-model`, the build died on TS2307 after 197
 * seconds, `pnpm install --frozen-lockfile` fixed it in five).
 *
 * pnpm's own `verify-deps-before-run` does not cover this: it compares each
 * manifest against the lockfile, and the lockfile was already correct — only
 * node_modules was short. So the check is what the build actually needs, done
 * cheaply: every declared non-optional dependency has a directory to resolve.
 *
 * Peers are skipped. The convention here is wide optional peers on official
 * packages (AGENTS.md), so an absent peer is legal; `dependencies` and
 * `devDependencies` are not.
 *
 * Reported, never repaired: a repo-root `pnpm install` under concurrent agents
 * resolves multiple peer variants and produces `constraint 'never'` errors
 * (docs/development.md conflict rule 3), so the fix is named and left to a
 * human who knows whether anyone else is mid-build.
 */
function installFreshness(): void {
  const missing: string[] = []
  for (const dir of readdirSync(join(root, 'packages'))) {
    const manifest = join(root, 'packages', dir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!existsSync(join(root, 'packages', dir, 'node_modules', name))) missing.push(`${dir} → ${name}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} declared dependenc(ies) are not installed — run: pnpm install --frozen-lockfile\n  `
      + missing.slice(0, 5).join('\n  ') + (missing.length > 5 ? `\n  … and ${missing.length - 5} more` : ''))
  }
  process.stdout.write('  = every declared dependency resolves\n')
}

/** The harness ref CI pins, read from the workflow so the two cannot drift. */
function ciHarnessRef(): string | undefined {
  return /^\s*ref:\s*(\S+)\s*$/m.exec(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'))?.[1]
}

/** Advisory, never fatal: a local harness ahead of CI's tag is normal (guard
 * checkpoint commits land there), but it means the types you just compiled
 * against are not the types CI will use. */
function harnessAdvisory(): void {
  const harness = process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')
  const pinned = ciHarnessRef()
  if (!existsSync(harness)) {
    process.stdout.write(`  ! DSH_HARNESS not found at ${harness} — typert/test resolution will fall back\n`)
    return
  }
  const described = capture(`git -C ${harness} describe --tags`) || '(untagged)'
  const aligned = pinned !== undefined && described === pinned
  process.stdout.write(`  ${aligned ? '=' : '!'} harness ${described}${aligned ? '' : ` vs CI's ${pinned ?? '(unpinned)'}`}\n`)
}

/** Run the test step through a tee so the per-package durations can be ranked
 * afterwards. Without this the slowest package is invisible and everyone
 * blames "the gate" instead of the one suite that is 46% of it. */
function testStep(scope: Scope): void {
  const log = join(mkdtempSync(join(tmpdir(), 'gate-')), 'test.log')
  const filter = scope.filter === undefined ? '-r' : `--filter "${scope.filter}"`
  try {
    sh(`set -o pipefail; pnpm ${filter} --if-present run test 2>&1 | tee ${log}`)
  } finally {
    const durations = [...readFileSync(log, 'utf8').matchAll(/^packages\/([a-z-]+) test: +Duration +([0-9.]+)s/gm)]
      .map(([, pkg, secs]) => ({ pkg: pkg!, secs: Number(secs) }))
      .sort((a, b) => b.secs - a.secs)
    if (durations.length > 0) {
      const total = durations.reduce((sum, d) => sum + d.secs, 0)
      process.stdout.write(`\n  slowest suites (serial sum ${total.toFixed(0)}s across ${durations.length}):\n`)
      for (const d of durations.slice(0, 5)) {
        process.stdout.write(`    ${d.secs.toFixed(1).padStart(7)}s  ${d.pkg}  (${((d.secs / total) * 100).toFixed(0)}%)\n`)
      }
    }
    rmSync(join(log, '..'), { recursive: true, force: true })
  }
}

function actStep(): void {
  try {
    execFileSync('act', ['--version'], { stdio: 'ignore' })
  } catch {
    process.stderr.write('gate --full needs act (runs the real workflow in Docker):\n  brew install act\n')
    process.exit(2)
  }
  sh('act push -W .github/workflows/ci.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest')
}

export function main(): void {
  const scope = resolveScope()
  const filter = scope.filter === undefined ? '-r' : `--filter "${scope.filter}"`
  const skipPackages = scope.filter === 'NONE'

  // Recorded now, re-checked at the end: a nine-minute gate reads the working
  // tree the whole way through, so an edit mid-run produces a verdict about
  // neither the state it started on nor the one it ended on.
  const treeAtStart = createHash('sha1').update(`${capture('git rev-parse HEAD')}\n${capture('git status --porcelain')}`).digest('hex')

  const steps: { name: string; run: () => void }[] = [
    { name: 'install freshness', run: installFreshness },
    { name: 'harness ref (advisory)', run: harnessAdvisory },
    { name: 'workflow refs', run: () => sh('pnpm exec tsx scripts/check-workflow-refs.ts') },
    { name: 'build scripts declared', run: () => sh('pnpm exec tsx scripts/check-build-scripts-declared.ts') },
    { name: 'repo hygiene (full tree)', run: () => sh('pnpm check:hygiene --all') },
    { name: 'plugin independence', run: () => sh('pnpm check:plugins') },
    { name: 'doc gates', run: () => {
      sh('pnpm run verify-agent-note-format')
      sh('pnpm run verify-agent-note-classification')
      sh('pnpm run verify-translation-pairing')
    } },
    { name: "script tests (checkers' own specs)", run: () => sh('pnpm run test:scripts') },
  ]
  if (!skipPackages) {
    steps.push(
      { name: 'build', run: () => sh(`pnpm ${filter} --if-present run build`) },
      { name: 'test', run: () => testStep(scope) },
      { name: 'pack bundles', run: () => sh(
        scope.dirs.length === 0
          ? 'pnpm exec tsx scripts/pack-all-dist.ts'
          : `pnpm exec tsx scripts/pack-all-dist.ts --only ${scope.dirs.join(',')}`) },
    )
  }
  if (full) steps.push({ name: 'full CI under act', run: actStep })

  process.stdout.write(`gate scope: ${scope.why}\n`)
  if (skipPackages) process.stdout.write('  build / test / pack skipped — no package source changed\n')

  const started = Date.now()
  const timings: { name: string; secs: number }[] = []
  for (const [index, step] of steps.entries()) {
    process.stdout.write(`\n[${index + 1}/${steps.length}] ${step.name}\n`)
    const stepStart = Date.now()
    try {
      step.run()
    } catch (error) {
      const detail = error instanceof Error && error.message !== '' && !error.message.startsWith('Command failed')
        ? `\n  ${error.message}` : ''
      process.stderr.write(`\ngate FAILED at: ${step.name} (after ${((Date.now() - stepStart) / 1000).toFixed(0)}s)${detail}\n`)
      process.exit(1)
    }
    timings.push({ name: step.name, secs: (Date.now() - stepStart) / 1000 })
  }

  process.stdout.write('\nstep timings:\n')
  for (const t of [...timings].sort((a, b) => b.secs - a.secs)) {
    if (t.secs >= 1) process.stdout.write(`  ${t.secs.toFixed(0).padStart(5)}s  ${t.name}\n`)
  }

  const treeAtEnd = createHash('sha1').update(`${capture('git rev-parse HEAD')}\n${capture('git status --porcelain')}`).digest('hex')
  if (treeAtEnd !== treeAtStart) {
    process.stderr.write('\ngate WARNING: the working tree changed while the gate ran.\n'
      + '  This result describes neither the state it started on nor the one it ended on. Re-run.\n')
    process.exit(1)
  }

  process.stdout.write(`\ngate PASSED (${steps.length} steps, ${Math.round((Date.now() - started) / 1000)}s)`
    + `${scope.filter === undefined && !full ? ' — cold install is still CI-only; `pnpm gate --full` covers it' : ''}`
    + `${scope.filter !== undefined && scope.filter !== 'NONE' ? ' — scoped; `pnpm gate --all` before pushing' : ''}\n`)
}

main()
