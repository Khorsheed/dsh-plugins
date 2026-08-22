#!/usr/bin/env node
/**
 * verify-package — pre-publish smoke: does this package boot in a CLEAN image?
 *
 * For each package: clean rebuild → pack-dist (with its own verification)
 * → a throwaway profile under the vanilla toolchain home (npm-installed
 * official dsh, zero plugins, no repo links) → `dsh plugin add <tgz>` →
 * boot on a free port → assert the composition comes up AND the package's
 * row is in the composed config. This is the "runs in a clean image" gate
 * every package passes before npm (docs/ops.md release waves).
 *
 * Usage:
 *   pnpm verify:package --package packages/<dir> [--package <dir2> ...]
 *
 * Requires the vanilla toolchain (~/.dsh-vanilla/toolchain, npm official
 * dsh) — the point is proving the tarball works WITHOUT the repo.
 * @module scripts/verify-package
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const HOME = homedir()
const VANILLA_HOME = join(HOME, '.dsh-vanilla')
const TOOLCHAIN_BIN = join(VANILLA_HOME, 'toolchain', 'node_modules', '.bin', 'dsh')
const PUB = resolve('dist-publish')

function run(cmd, argv, options = {}) {
  return execFileSync(cmd, argv, { stdio: 'inherit', ...options })
}

const args = process.argv.slice(2)
const packages = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--package') packages.push(args[++i])
  else if (args[i]?.startsWith('--package=')) packages.push(args[i].slice('--package='.length))
}
if (packages.length === 0) {
  process.stderr.write('usage: verify-package --package packages/<dir> [--package <dir2> ...]\n')
  process.exit(2)
}
if (!existsSync(TOOLCHAIN_BIN)) {
  process.stderr.write(`verify-package: vanilla toolchain not found at ${TOOLCHAIN_BIN}\n`)
  process.exit(2)
}

let failures = 0
for (const dir of packages) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const name = pkg.name
  const version = pkg.version
  process.stdout.write(`\n=== verify ${name}@${version} ===\n`)
  const env = { ...process.env, GEN_TYPERT_ONLY: name }

  // 1. clean rebuild + pack (pack-dist verifies the artifact itself).
  rmSync(join(dir, 'lib'), { recursive: true, force: true })
  run('pnpm', ['--filter', name, 'build'], { env })
  const family = [...new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ].filter(d => d.startsWith('@khorsheed/')))]
  const packArgs = ['tsx', 'scripts/pack-dist.ts', '--package', dir, '--scope', '@khorsheed', '--version', version, '--out', PUB]
  if (family.length > 0) packArgs.push('--family', family.join(','))
  run('npx', packArgs)
  const tgz = join(PUB, `${name.replace('@khorsheed/', 'khorsheed-')}-${version}.tgz`)

  // 2. throwaway profile on the vanilla toolchain (npm dsh, zero repo links).
  const profileName = `verify-${name.replace('@khorsheed/dsh-', '')}-${process.pid}`
  const profileDir = join(VANILLA_HOME, 'profiles', profileName)
  mkdirSync(profileDir, { recursive: true })
  cpSync(join(VANILLA_HOME, 'profiles', 'vanilla', 'package.json'), join(profileDir, 'package.json'))
  cpSync(join(VANILLA_HOME, 'profiles', 'vanilla', 'pnpm-workspace.yaml'), join(profileDir, 'pnpm-workspace.yaml'))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')

  const toolchainEnv = { ...process.env, DSH_HOME: VANILLA_HOME }
  try {
    run(TOOLCHAIN_BIN, ['plugin', '--profile', profileName, 'add', tgz], { env: toolchainEnv })

    // 3. boot on a free port and read the composed config.
    const port = 38900 + (process.pid % 500)
    const logPath = join('/tmp', `verify-${process.pid}.log`)
    const child = execFileSync('bash', ['-c', `${TOOLCHAIN_BIN} --profile ${profileName} --port ${port} --no-open > ${logPath} 2>&1 & echo $!`], { env: toolchainEnv, encoding: 'utf8' }).trim()
    let up = false
    for (let i = 0; i < 24; i++) {
      execFileSync('sleep', ['5'])
      try {
        const code = execFileSync('curl', ['-s', '--noproxy', '*', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', `http://127.0.0.1:${port}/`], { encoding: 'utf8' }).trim()
        if (code === '200') { up = true; break }
      } catch { /* booting */ }
    }
    execFileSync('kill', [child], { stdio: 'ignore' })
    if (!up) {
      process.stderr.write(`verify-package: ${name} — profile did not boot within 120s; see ${logPath}\n`)
      failures++
      continue
    }

    // 4. the package's row must be in the composed config.
    const dump = execFileSync('bash', ['-c', `DSH_HOME=${VANILLA_HOME} ${TOOLCHAIN_BIN} --profile ${profileName} --dump-config 2>/dev/null | grep -c "${name}" || true`], { encoding: 'utf8' }).trim()
    if (Number(dump) === 0) {
      process.stderr.write(`verify-package: ${name} — booted but its row is absent from the composed config\n`)
      failures++
      continue
    }
    process.stdout.write(`verify-package: ${name}@${version} ✓ boots on the clean image, row mounted\n`)
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
}
if (failures > 0) {
  process.stderr.write(`verify-package: ${failures} package(s) failed\n`)
  process.exit(1)
}
process.stdout.write('\nverify-package: all clean-image checks passed\n')
