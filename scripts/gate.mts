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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireTestResource } from '../packages/ankh-guard/scripts/test-resource.mjs'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const full = argv.includes('--full')
const all = argv.includes('--all')
const sinceIdx = argv.indexOf('--since')
const requestedBase = sinceIdx === -1 ? undefined : argv[sinceIdx + 1]

function sh(command: string): void {
  execSync(command, { cwd: root, stdio: 'inherit', shell: '/bin/bash' })
}

/** A command's outcome, with failure distinguished from empty output.
 * Collapsing the two is how a scoping bug becomes a false green: a `pnpm
 * --filter` that errors looks exactly like "nothing changed". */
export interface Outcome { readonly ok: boolean; readonly out: string }

export type Runner = (command: string) => Outcome

/** Trailing newlines only — deliberately NOT `.trim()`.
 *
 * Column 1 of `git status --porcelain` carries meaning: ` M path` is a
 * modification that has not been staged. Trimming the whole output ate that
 * leading space on the FIRST line, and the parser below then read that line one
 * column short — `scripts/gate.mts` came back as `cripts/gate.mts`, which
 * belongs to no shared layer, so an unstaged edit to a root `scripts/` file
 * scoped to NONE and the gate skipped build, test and pack entirely: exactly
 * the false green scoping must not have. Observed 2026-09-15 (T51), where a
 * clean checkout with one unstaged `scripts/` file passed in 11 steps.
 *
 * Every other caller only ever wanted the trailing newline gone, so narrowing
 * the trim for all of them is a smaller change than teaching the runner which
 * commands have significant leading whitespace. */
export function trimTrailingNewlines(out: string): string {
  return out.replace(/\n+$/, '')
}

const gitRunner: Runner = (command) => {
  try {
    return { ok: true, out: trimTrailingNewlines(execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
  } catch {
    return { ok: false, out: '' }
  }
}

/** Every path a porcelain line refers to.
 *
 * A porcelain v1 line is `XY<space>path`: two status columns — either of which
 * may itself be a space — then one separator. Matching that shape, rather than
 * slicing a fixed three characters, is what keeps a line whose columns are not
 * where they should be from yielding a path short one character: a path that is
 * merely wrong belongs to no shared layer, and reads exactly like "nothing
 * shared changed". It assumes column 1 survived the runner — see
 * `trimTrailingNewlines`, which is the other half of this fix.
 *
 * A rename prints `R  old -> new`, and checking only the head of that string
 * tests the OLD path — so a file renamed INTO a shared layer would not trigger
 * the fallback. Both ends are returned. */
export function porcelainPaths(porcelain: string): string[] {
  const paths: string[] = []
  for (const line of porcelain.split('\n')) {
    const rest = /^.. (.+)$/.exec(line)?.[1]
    if (rest === undefined) continue
    const arrow = rest.indexOf(' -> ')
    if (arrow === -1) paths.push(rest)
    else paths.push(rest.slice(0, arrow), rest.slice(arrow + 4))
  }
  return paths.map((p) => p.replace(/^"|"$/g, ''))
}

/** Paths that change how every package builds or tests while touching no
 * package directory. pnpm reports no changed package for them, so scoping
 * would skip every test and report green — the one failure mode scoping must
 * not have. Checked before pnpm is consulted at all. */
export const GLOBAL_PATHS = ['build/', 'scripts/', 'tsconfig.base.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package.json', '.github/']

/** The same, for a layer whose path carries a variable segment.
 *
 * `profiles/` as a whole is NOT global — a profile's template, patch and docs
 * are that profile's own business. Its `scripts/` are not: install.sh builds
 * and packs every unpublished member from the checkout, so an edit there
 * changes how the whole repo ships while touching no package directory, which
 * is exactly the case GLOBAL_PATHS exists for. Observed 2026-09-14 (T49): a
 * change to profiles/web-eval/scripts/install.sh scoped to nothing and the
 * gate ran 11 steps, skipping build, test and pack entirely. */
export const GLOBAL_PATH_PATTERNS = [/^profiles\/[^/]+\/scripts\//]

/** Whether one repo-relative path belongs to a shared layer. */
export function isGlobalPath(path: string): boolean {
  return GLOBAL_PATHS.some((g) => path.startsWith(g)) || GLOBAL_PATH_PATTERNS.some((re) => re.test(path))
}

export interface Scope { readonly filter: string | undefined; readonly dirs: string[]; readonly why: string }

/** Exclude the root orchestrator from execution as well as the displayed list:
 * its recursive build/test scripts would escape the selected dependency closure. */
export function packageFilter(filter: string | undefined): string {
  return `${filter === undefined ? '-r' : `--filter "${filter}"`} --filter '!.'`
}

/** Resolve what to build, test and pack.
 *
 * The base defaults to LOCAL `main`, not `origin/main`: pushes are batched by
 * the human, so local main runs far ahead (64 commits when this was written)
 * and its accumulated shared-layer commits would push every owner's gate back
 * to a whole-repo run — scoping that never scopes. `origin/main` remains the
 * right base for mainline's own pre-push sweep, via `--since`.
 *
 * Every uncertainty resolves to the whole repo. A scope that is wrong in the
 * narrowing direction is a false green; one that is wrong in the widening
 * direction only costs time.
 */
export function resolveScope(run: Runner, opts: { all: boolean; since?: string }): Scope {
  if (opts.all) return { filter: undefined, dirs: [], why: '--all: whole repo' }

  const base = [opts.since, 'main', 'origin/main']
    .find((ref) => ref !== undefined && run(`git rev-parse --verify --quiet ${ref}`).ok)
  if (base === undefined) return { filter: undefined, dirs: [], why: 'whole repo — no base ref resolved' }

  const diff = run(`git diff --name-only ${base}...HEAD`)
  const status = run('git status --porcelain')
  if (!diff.ok || !status.ok) return { filter: undefined, dirs: [], why: `whole repo — could not read changes against ${base}` }

  const touched = [...new Set([...diff.out.split('\n').filter((p) => p !== ''), ...porcelainPaths(status.out)])]
  const global = touched.filter(isGlobalPath)
  if (global.length > 0) {
    const shown = global.slice(0, 3).join(', ')
    return { filter: undefined, dirs: [], why: `whole repo — shared-layer paths changed (${shown}${global.length > 3 ? ', …' : ''})` }
  }

  const selector = `...[${base}]`
  const listed = run(`pnpm ${packageFilter(selector)} list --depth -1 --parseable`)
  // Fail closed: a filter that errored is indistinguishable from one that
  // matched nothing, and guessing "nothing" skips the entire build.
  if (!listed.ok) return { filter: undefined, dirs: [], why: `whole repo — the package filter failed against ${base}` }

  const dirs = listed.out.split('\n')
    .filter((p) => p !== '' && p !== root)
    .map((p) => p.split('/').pop()!)
    .sort()
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

/** A fingerprint that moves when the tree's CONTENT moves, not merely when its
 * status listing does. A file already reported as ` M path` keeps that exact
 * line while its contents keep changing — so hashing the porcelain alone misses
 * the likeliest edit of all: another save to the file you are working on. */
function treeFingerprint(): string {
  const hash = createHash('sha1')
  hash.update(gitRunner('git rev-parse HEAD').out)
  const status = gitRunner('git status --porcelain').out
  hash.update(status)
  hash.update(gitRunner('git diff HEAD').out)
  for (const path of porcelainPaths(status)) {
    const abs = join(root, path)
    if (!existsSync(abs)) continue
    const stat = statSync(abs)
    if (stat.isDirectory()) continue
    hash.update(`${path}:${stat.size}:${stat.mtimeMs}`)
  }
  return hash.digest('hex')
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
  const described = gitRunner(`git -C ${harness} describe --tags`).out || '(untagged)'
  const aligned = pinned !== undefined && described === pinned
  process.stdout.write(`  ${aligned ? '=' : '!'} harness ${described}${aligned ? '' : ` vs CI's ${pinned ?? '(unpinned)'}`}\n`)
}

/** Run the test step through a tee so per-package durations can be reported.
 *
 * What is reported is deliberately NOT called wall time. A package that shards
 * its suite (ankh-guard runs four supervise shards concurrently) emits one
 * `Duration` per shard, and summing those counts parallel work as if it were
 * serial: a run whose test step took 240 seconds reported a 1085-second
 * "serial sum". Per-package wall time is not recoverable from this output at
 * all — packages themselves run concurrently — so the summary states what it
 * actually has: the longest shard, and how many there were.
 *
 * The step's own wall time is in the step timings below, and that number is
 * real.
 */
function testStep(scope: Scope): void {
  const log = join(mkdtempSync(join(tmpdir(), 'gate-')), 'test.log')
  const filter = packageFilter(scope.filter)
  let succeeded = false
  try {
    // Workspace concurrency 2 (pnpm's default is 4): each package's vitest
    // instance forks several hundred-MB workers, so 4 instances in flight
    // OOMed 16GB machines. The per-package fork cap lives in build/vitest.ts.
    sh(`set -o pipefail; pnpm ${filter} --workspace-concurrency=2 --if-present run test 2>&1 | tee "${log}"`)
    succeeded = true
  } finally {
    const byPackage = new Map<string, number[]>()
    for (const [, pkg, secs] of readFileSync(log, 'utf8').matchAll(/^packages\/([a-z0-9-]+) test: +Duration +([0-9.]+)s/gm)) {
      byPackage.set(pkg!, [...(byPackage.get(pkg!) ?? []), Number(secs)])
    }
    const rows = [...byPackage].map(([pkg, runs]) => ({ pkg, longest: Math.max(...runs), runs: runs.length }))
      .sort((a, b) => b.longest - a.longest)
    if (rows.length > 0) {
      process.stdout.write(`\n  longest suite per package (not wall time — packages and shards run concurrently):\n`)
      for (const r of rows.slice(0, 5)) {
        process.stdout.write(`    ${r.longest.toFixed(1).padStart(7)}s  ${r.pkg}${r.runs > 1 ? `  (longest of ${r.runs} shards)` : ''}\n`)
      }
    }
    if (succeeded) rmSync(join(log, '..'), { recursive: true, force: true })
    else process.stderr.write(`\n  gate test failure log retained: ${log}\n`)
  }
}

function actStep(): void {
  try {
    execFileSync('act', ['--version'], { stdio: 'ignore' })
  } catch {
    process.stderr.write('gate --full needs act (runs the real workflow in Docker):\n  brew install act\n')
    throw new Error('act is unavailable')
  }
  sh('act push -W .github/workflows/ci.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest')
}

export function main(): void {
  const scope = resolveScope(gitRunner, { all, since: requestedBase })
  const filter = packageFilter(scope.filter)
  const skipPackages = scope.filter === 'NONE'

  // Recorded now, re-checked at the end: a nine-minute gate reads the working
  // tree the whole way through, so an edit mid-run produces a verdict about
  // neither the state it started on nor the one it ended on.
  const treeAtStart = treeFingerprint()

  const steps: { name: string; run: () => void }[] = [
    { name: 'install freshness', run: installFreshness },
    { name: 'harness ref (advisory)', run: harnessAdvisory },
    { name: 'workflow refs', run: () => sh('pnpm exec tsx scripts/check-workflow-refs.ts') },
    { name: 'build scripts declared', run: () => sh('pnpm exec tsx scripts/check-build-scripts-declared.ts') },
    { name: 'repo hygiene (full tree)', run: () => sh('pnpm check:hygiene --all') },
    { name: 'plugin independence', run: () => sh('pnpm check:plugins') },
    { name: 'profile composition', run: () => sh('pnpm check:profiles') },
    { name: 'release groups', run: () => sh('pnpm check:release-groups') },
    { name: 'package map', run: () => sh('pnpm check:packages') },
    { name: 'doc gates', run: () => {
      sh('pnpm run verify-agent-note-format')
      sh('pnpm run verify-agent-note-classification')
      sh('pnpm run verify-translation-pairing')
    } },
    { name: "script tests (checkers' own specs)", run: () => sh('pnpm run test:scripts') },
  ]
  if (!skipPackages) {
    steps.push(
      { name: 'build', run: () => sh(`pnpm ${filter} --workspace-concurrency=2 --if-present run build`) },
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
      process.exitCode = 1
      return
    }
    timings.push({ name: step.name, secs: (Date.now() - stepStart) / 1000 })
  }

  process.stdout.write('\nstep timings:\n')
  for (const t of [...timings].sort((a, b) => b.secs - a.secs)) {
    if (t.secs >= 1) process.stdout.write(`  ${t.secs.toFixed(0).padStart(5)}s  ${t.name}\n`)
  }

  const treeAtEnd = treeFingerprint()
  if (treeAtEnd !== treeAtStart) {
    process.stderr.write('\ngate WARNING: the working tree changed while the gate ran.\n'
      + '  This result describes neither the state it started on nor the one it ended on. Re-run.\n')
    process.exitCode = 1
    return
  }

  process.stdout.write(`\ngate PASSED (${steps.length} steps, ${Math.round((Date.now() - started) / 1000)}s)`
    + `${scope.filter === undefined && !full ? ' — cold install is still CI-only; `pnpm gate --full` covers it' : ''}`
    + `${scope.filter !== undefined && scope.filter !== 'NONE' ? ' — scoped; `pnpm gate --all` before pushing' : ''}\n`)
}

// Importable for the spec — without this guard, importing the module runs the
// entire gate (which is exactly what happened the first time the spec ran).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const release = await acquireTestResource('gate')
  try { main() } finally { release() }
}
