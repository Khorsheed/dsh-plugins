#!/usr/bin/env node
/**
 * check-workflow-refs — every repo file and npm script a CI workflow invokes
 * must exist.
 *
 * CI is the one place where a dangling reference stays invisible locally: the
 * workflow only runs after a push, so a commit that retires a script while
 * leaving the step that calls it looks green on every developer machine.
 * (2026-09-01: cc31c1a retired taskpilot's tsconfig.paths.json mechanism and
 * deleted scripts/sync-harness-paths.mjs, but the CI step calling it stayed —
 * the first CI run in a week died on MODULE_NOT_FOUND.)
 *
 * Steps carrying `working-directory` are skipped: they run against the cloned
 * harness checkout, not this repo.
 *
 * Usage: tsx scripts/check-workflow-refs.ts
 * @module scripts/check-workflow-refs
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export interface Finding {
  readonly workflow: string
  readonly step: string
  readonly reference: string
  readonly reason: string
}

/** `node scripts/x.mjs`, `tsx scripts/x.ts`, `pnpm exec tsx scripts/x.mts`. */
const FILE_REF_RE = /(?:^|\s)(?:node|tsx)\s+(?:--[\w-]+\s+)*\.?\/?((?:scripts|build)\/[\w./-]+)/g
/** `pnpm run <name>` / `npm run <name>` — a script that must be in package.json. */
const SCRIPT_REF_RE = /(?:^|\s)(?:pnpm|npm)\s+run\s+([\w:.-]+)/g

/** Every `run:` block in a workflow, paired with its step name. Parsed with a
 * line scanner rather than a YAML library: the workflow's `${{ }}` templates
 * are not YAML values, and the shape here (steps with `name:`/`run:`) is
 * stable enough that a scanner costs less than a dependency. */
export function runBlocks(yaml: string): { step: string; run: string; scoped: boolean }[] {
  const blocks: { step: string; run: string; scoped: boolean }[] = []
  const lines = yaml.split('\n')
  let step = '(unnamed)'
  let scoped = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const named = /^\s*-?\s*name:\s*(.+)$/.exec(line)
    if (named !== null) {
      step = named[1]!.trim()
      scoped = false
    }
    if (/^\s*working-directory:/.test(line)) scoped = true
    const inline = /^\s*run:\s*(.+)$/.exec(line)
    if (inline !== null && !inline[1]!.startsWith('|') && !inline[1]!.startsWith('>')) {
      blocks.push({ step, run: inline[1]!, scoped })
      continue
    }
    if (/^\s*run:\s*[|>]/.test(line)) {
      const indent = (/^(\s*)/.exec(lines[i + 1] ?? '') ?? ['', ''])[1]!.length
      const body: string[] = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]!
        if (next.trim() !== '' && (/^(\s*)/.exec(next) ?? ['', ''])[1]!.length < indent) break
        body.push(next)
      }
      blocks.push({ step, run: body.join('\n'), scoped })
    }
  }
  return blocks
}

export function checkWorkflow(path: string, yaml: string, scripts: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = []
  for (const { step, run, scoped } of runBlocks(yaml)) {
    // A scoped step runs inside the cloned harness, whose files are not ours.
    if (scoped) continue
    for (const [, ref] of run.matchAll(FILE_REF_RE)) {
      if (!existsSync(join(root, ref!))) {
        findings.push({ workflow: path, step, reference: ref!, reason: 'file does not exist' })
      }
    }
    for (const [, name] of run.matchAll(SCRIPT_REF_RE)) {
      if (!scripts.has(name!)) {
        findings.push({ workflow: path, step, reference: name!, reason: 'not a script in package.json' })
      }
    }
  }
  return findings
}

export function main(): void {
  const scripts = new Set(Object.keys(
    (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {},
  ))
  const workflows = globSync('.github/workflows/*.{yml,yaml}', { cwd: root })
  const findings = workflows.flatMap((w) => checkWorkflow(w, readFileSync(join(root, w), 'utf8'), scripts))
  for (const f of findings) {
    process.stderr.write(`${f.workflow} › ${f.step}: ${f.reference} — ${f.reason}\n`)
  }
  process.stdout.write(`workflow-refs: scanned ${workflows.length} workflow(s), ${findings.length} finding(s)\n`)
  if (findings.length > 0) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) main()
