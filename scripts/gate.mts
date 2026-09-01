#!/usr/bin/env node
/**
 * gate — the pre-merge gate a package owner runs in their worktree before
 * merging to main.
 *
 * CI runs on push, and pushes are batched by the human, so CI feedback is
 * infrequent by design. This gate is what makes that safe: it runs every CI
 * check that is reproducible locally, plus the two checkers that stand in for
 * the ones that are not (see below), in cheapest-first order so a failure
 * surfaces in seconds rather than minutes.
 *
 * Three CI steps cannot be reproduced from a warm checkout — a COLD
 * `pnpm install --frozen-lockfile`, the harness checkout pinned to CI's tag,
 * and the harness's own build. `check-build-scripts-declared` and the harness
 * ref advisory cover the failure modes those have actually produced;
 * `--full` closes the rest by running the real workflow under `act`.
 *
 * The mirror `--check` gates are deliberately absent: mirror drift is
 * mainline's to fix (syncing needs push rights to the mirror repo), so it
 * must not block an owner's merge. CI keeps them.
 *
 * Usage: pnpm gate [--full]
 * @module scripts/gate
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const full = process.argv.includes('--full')

/** The harness ref CI pins, read from the workflow so the two cannot drift. */
function ciHarnessRef(): string | undefined {
  const yaml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  return /^\s*ref:\s*(\S+)\s*$/m.exec(yaml)?.[1]
}

/** Advisory, never fatal: a local harness ahead of CI's tag is the normal
 * state (guard checkpoint commits land there), but it means the types you
 * just compiled against are not the types CI will use. */
function harnessAdvisory(): void {
  const harness = process.env.DSH_HARNESS ?? join(homedir(), 'code/deepseek-harness')
  const pinned = ciHarnessRef()
  if (!existsSync(harness)) {
    process.stdout.write(`  ! DSH_HARNESS not found at ${harness} — typert/test resolution will fall back\n`)
    return
  }
  let described = '(untagged)'
  try {
    described = execFileSync('git', ['describe', '--tags'], { cwd: harness, encoding: 'utf8' }).trim()
  } catch { /* a shallow or tagless checkout still runs */ }
  const aligned = pinned !== undefined && described === pinned
  process.stdout.write(`  ${aligned ? '=' : '!'} harness ${described}${aligned ? '' : ` vs CI's ${pinned ?? '(unpinned)'}`}\n`)
}

interface Step { readonly name: string; readonly run: () => void }

const steps: Step[] = [
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
  { name: 'build', run: () => sh('pnpm run build') },
  { name: 'test', run: () => sh('pnpm run test') },
  { name: 'pack all bundles', run: () => sh('pnpm exec tsx scripts/pack-all-dist.ts') },
]

function sh(command: string): void {
  execSync(command, { cwd: root, stdio: 'inherit' })
}

/** The cold-install layer: the real workflow, in a container, via act. */
function actStep(): void {
  try {
    execFileSync('act', ['--version'], { stdio: 'ignore' })
  } catch {
    process.stderr.write(
      'gate --full needs act (runs the real workflow in Docker):\n'
      + '  brew install act\n'
      + 'Without it the cold-install layer stays CI-only.\n',
    )
    process.exit(2)
  }
  sh('act push -W .github/workflows/ci.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest')
}

const plan = full ? [...steps, { name: 'full CI under act', run: actStep }] : steps
const started = Date.now()
for (const [index, step] of plan.entries()) {
  process.stdout.write(`\n[${index + 1}/${plan.length}] ${step.name}\n`)
  try {
    step.run()
  } catch {
    process.stderr.write(`\ngate FAILED at: ${step.name}\n`)
    process.exit(1)
  }
}
process.stdout.write(`\ngate PASSED (${plan.length} steps, ${Math.round((Date.now() - started) / 1000)}s)`
  + `${full ? '' : ' — cold install is still CI-only; `pnpm gate --full` covers it'}\n`)
