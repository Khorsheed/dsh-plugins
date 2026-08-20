/** The 3d-artifact skill registration: pull-based generation-side contract.
 * Mirrors the ankh-guard restart-skill pattern — the skill ships with the
 * package under `skills/3d-artifact/SKILL.md` (globbed into `files`) and the
 * service registers it at apply through the optional `skills` service; a
 * missing capability or malformed file degrades, never crashes a boot. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FilePreviewService } from '@khorsheed/dsh-file-preview'

const cleanups: Array<() => void> = []
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

/** Minimal fs stand-in: the constructor only stores it (attaches lazily). */
const fsStub = {} as unknown as FileSystem

describe('3d-artifact skill registration', () => {
  it('registers the skill when the skills service is present', () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: fsStub })
    const registrations: Array<{ name: string; description: string; content: string }> = []
    ctx.provide('skills', {
      register: (skill: { name: string; description: string; content: string }) => {
        registrations.push(skill)
        return () => {}
      },
    } as never)
    new FilePreviewService(ctx)
    expect(registrations.map(skill => skill.name)).toEqual(['3d-artifact'])
    expect(registrations[0]?.description).toContain('3D')
    expect(registrations[0]?.description).toContain('sandbox')
    // The contract body carries the hard rules a generating model must obey.
    expect(registrations[0]?.content).toContain('GLB')
    expect(registrations[0]?.content).toContain('connect-src')
    // The shipped skill must not carry machine-specific paths from the
    // development environment it was written on.
    expect(registrations[0]?.content).not.toContain('code/dsh-plugins')
  })

  it('skips registration when the skills service is absent', () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: fsStub })
    expect(() => new FilePreviewService(ctx)).not.toThrow()
  })
})

describe('3d-artifact pack smoke', () => {
  // The skill is a generation-side discovery aid: it only exists for
  // community users if the tarball actually carries it. `files` must glob
  // `skills/**/*.md` in — this packs the real tarball and asserts presence.
  it('the tarball ships skills/3d-artifact/SKILL.md', () => {
    const pkgDir = fileURLToPath(new URL('..', import.meta.url))
    const tmp = tmpDir('file-preview-pack-')
    execFileSync('pnpm', ['pack', '--pack-destination', tmp], { cwd: pkgDir, stdio: 'pipe' })
    const tgz = readdirSync(tmp).find(name => name.endsWith('.tgz'))
    expect(tgz, 'pnpm pack produced a tarball').toBeDefined()
    const unpack = join(tmp, 'unpack')
    mkdirSync(unpack)
    execFileSync('tar', ['-xzf', join(tmp, tgz!), '-C', unpack], { stdio: 'pipe' })
    expect(existsSync(join(unpack, 'package', 'skills', '3d-artifact', 'SKILL.md')),
      'the 3d-artifact skill is missing from the tarball').toBe(true)
    expect(existsSync(join(unpack, 'package', 'lib', 'index.js')),
      'lib/index.js missing from the tarball — run the host build first').toBe(true)
  })
})
