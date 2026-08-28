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
    const registrations: Array<{ name: string; description: string; content: string; source?: string; provider?: string; resourceBase?: { kind: 'directory'; path: string } }> = []
    ctx.provide('skills', {
      register: (skill: { name: string; description: string; content: string; provider?: string; resourceBase?: { kind: 'directory'; path: string } }) => {
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
    // Capability-catalog bundle visibility: the registration names the
    // provider and exposes the shipped skills directory as a resource base so
    // the catalog's source browser (and the model's relative-resource
    // resolution) can reach the bundle, not just a content block.
    expect(registrations[0]?.provider).toBe('file-preview')
    expect(registrations[0]?.resourceBase?.kind).toBe('directory')
    expect(registrations[0]?.resourceBase?.path.endsWith(join('skills', '3d-artifact'))).toBe(true)
    // The registry validates `source` at LOAD time — a registration without
    // it lists fine in the catalog but explodes on invocation (the published
    // ankh-guard 8.9 failure). Pin it here.
    expect(registrations[0]?.source).toBe('runtime')
  })

  it('the registered skill survives the real registry round-trip (catalog list + body load)', async () => {
    // The catalog lists registrations even when a required field is missing;
    // the registry validates at LOAD time. Exercise the real registry so a
    // payload contract drift cannot pass on a recording stub.
    const ctx = new Context()
    Object.assign(ctx, { fs: fsStub })
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    const registry = new SkillRegistry(ctx as never)
    new FilePreviewService(ctx)
    const cwd = tmpDir('file-preview-skill-')
    const names = (await registry.list({ cwd })).map((skill: { name: string }) => skill.name)
    expect(names).toContain('3d-artifact')
    const loaded = await registry.get('3d-artifact', { cwd })
    expect(loaded?.content).toContain('GLB')
  })

  it('skips registration when the skills service is absent — with a boot-log warning', () => {
    const ctx = new Context()
    Object.assign(ctx, { fs: fsStub })
    const warn = vi.fn()
    Object.assign(ctx, { logger: { warn } })
    expect(() => new FilePreviewService(ctx)).not.toThrow()
    // A silent skip would hide a host-API migration that dropped/renamed the
    // skills service; the warn is the discoverability line (same diagnostic
    // as ankh-guard's restart-skill registration).
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skills capability absent'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3d-artifact skill is not registered'))
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
