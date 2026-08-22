#!/usr/bin/env node
/**
 * pack-all-dist — pack every bundle package in the monorepo through pack-dist.
 *
 * Exists for two callers: CI (exercises the whole packing path on every push,
 * so artifact-level regressions — dropped globs, missing hashed chunks, lost
 * family edges — fail a PR instead of a prod boot) and release waves (one
 * command produces every tarball). pack-dist's post-pack verification
 * (verifyTarball) is what makes this a gate and not just a batch job.
 *
 * Usage:
 *   pnpm exec tsx scripts/pack-all-dist.ts            # pack all to /tmp/pack-all-dist
 *   pnpm exec tsx scripts/pack-all-dist.ts --out DIR  # explicit output dir
 * @module scripts/pack-all-dist
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outIdx = process.argv.indexOf('--out')
const outDir = resolve(outIdx === -1 ? '/tmp/pack-all-dist' : process.argv[outIdx + 1]!)

let packed = 0
for (const entry of readdirSync('packages', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join('packages', entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (pkg.private === true) continue
  if (pkg.dsh?.bundle?.patch === undefined) continue
  const family = [...new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ].filter(d => d.startsWith('@khorsheed/')))]
  const args = ['tsx', 'scripts/pack-dist.ts', '--package', join('packages', entry.name), '--scope', '@khorsheed', '--version', pkg.version, '--out', outDir]
  if (family.length > 0) args.push('--family', family.join(','))
  execFileSync('npx', args, { stdio: 'inherit' })
  packed++
  process.stdout.write(`pack-all-dist: ${pkg.name}@${pkg.version} ✓\n`)
}
process.stdout.write(`pack-all-dist: ${packed} package(s) packed and verified into ${outDir}\n`)
