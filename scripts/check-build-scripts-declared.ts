#!/usr/bin/env node
/**
 * check-build-scripts-declared — every dependency carrying an install script
 * must have an explicit verdict in pnpm-workspace.yaml's `allowBuilds`.
 *
 * pnpm >= 11 defaults `strictDepBuilds` to true: an install that finds an
 * unreviewed dependency build script fails with ERR_PNPM_IGNORED_BUILDS. A
 * warm node_modules never re-raises it, so the failure is invisible locally
 * and surfaces only on a cold CI install. (2026-09-01: room's devDependency
 * on the official session-persistence package pulled koffi in on 08-29; the
 * next CI run — a week later — was the first thing to notice.)
 *
 * Either verdict clears the gate: `true` runs the script, `false` declines it.
 * What fails is the absence of a decision.
 *
 * Limitation: reads the installed tree, so a dependency that only installs on
 * another platform is invisible here. CI's cold install remains the backstop.
 *
 * Usage: tsx scripts/check-build-scripts-declared.ts
 * @module scripts/check-build-scripts-declared
 */
import { globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'] as const

/** Declared verdicts in `allowBuilds:` — parsed with a line scanner so the
 * checker stays dependency-free (the repo ships no YAML parser). */
export function declaredBuilds(yaml: string): Set<string> {
  const names = new Set<string>()
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => /^allowBuilds:\s*$/.test(l))
  if (start === -1) return names
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const entry = /^\s+'?([@\w./-]+)'?:\s*(?:true|false)\s*$/.exec(line)
    if (entry !== null) names.add(entry[1]!)
  }
  return names
}

/** Installed dependencies that carry an install hook. */
export function packagesWithInstallScripts(): string[] {
  const names = new Set<string>()
  // Segment-precise patterns only: each .pnpm/<key>/node_modules/ holds the
  // package itself plus symlinks to its dependencies, and both are wanted —
  // but a `**/package.json` walk descends into every package's own nested
  // node_modules tree (thousands of manifests read and then discarded by the
  // two-segment filter), which is what made this scan multi-second and
  // timeout-flaky under load.
  const manifests = [
    ...globSync('node_modules/.pnpm/*/node_modules/*/package.json', { cwd: root }),
    ...globSync('node_modules/.pnpm/*/node_modules/@*/*/package.json', { cwd: root }),
  ]
  for (const manifest of manifests) {
    let parsed: { name?: string; scripts?: Record<string, string> }
    try {
      parsed = JSON.parse(readFileSync(join(root, manifest), 'utf8')) as typeof parsed
    } catch {
      continue
    }
    const scripts = parsed.scripts ?? {}
    if (parsed.name !== undefined && INSTALL_HOOKS.some((h) => scripts[h] !== undefined)) names.add(parsed.name)
  }
  return [...names].sort()
}

export function main(): void {
  const declared = declaredBuilds(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  const found = packagesWithInstallScripts()
  const undeclared = found.filter((name) => !declared.has(name))
  for (const name of undeclared) {
    process.stderr.write(`${name}: has an install script with no allowBuilds verdict — add \`${name}: true\` or \`${name}: false\` to pnpm-workspace.yaml\n`)
  }
  process.stdout.write(`build-scripts: ${found.length} dependenc(ies) with install scripts, ${undeclared.length} undeclared\n`)
  if (undeclared.length > 0) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) main()
