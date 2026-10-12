import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeCredentialDecls, skillRowFrom, deleteSkillDir, readSkillFileContent, resolveBundleTarget, type RegistrySlice, type SkillDefinitionLike } from '../src/skills.ts'

/** A registry stub whose `get` always answers the same definition. */
function registryOf(def: SkillDefinitionLike): RegistrySlice {
  return {
    snapshot: async () => ({ skills: [], complete: true }),
    get: async () => def,
  }
}

/** A directory-backed definition rooted at `bundleDir`. */
function bundleDef(bundleDir: string): SkillDefinitionLike {
  return {
    name: 'demo',
    description: 'demo skill',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-dsh',
    provider: 'filesystem',
    content: '# demo',
    resourceBase: { kind: 'directory', path: bundleDir },
  }
}

describe('decodeCredentialDecls', () => {
  it('returns empty for missing / non-array metadata.credentials', () => {
    expect(decodeCredentialDecls(undefined)).toEqual([])
    expect(decodeCredentialDecls({})).toEqual([])
    expect(decodeCredentialDecls({ credentials: 'nope' })).toEqual([])
  })

  it('parses a credentials declaration', () => {
    const decls = decodeCredentialDecls({ credentials: [{ key: 'wechat-reading/api-key', label: '微信读书 API Key' }] })
    expect(decls).toEqual([{ key: 'wechat-reading/api-key', label: '微信读书 API Key' }])
  })

  it('drops decls without a key', () => {
    const decls = decodeCredentialDecls({ credentials: [{ label: 'no key' }] })
    expect(decls).toEqual([])
  })
})

describe('skillRowFrom', () => {
  it('projects a summary onto a wire row preserving source/provider/invocation', () => {
    const row = skillRowFrom({
      name: 'dsh-badge',
      description: 'Add the badge',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: 'skill-badge',
    })
    expect(row).toMatchObject({
      name: 'dsh-badge',
      source: 'bundled',
      provider: 'skill-badge',
      modelInvocable: true,
      userInvocable: true,
    })
  })

  it('carries whenToUse when present and omits absent optional fields', () => {
    const row = skillRowFrom({
      name: 'x',
      description: 'd',
      invocation: { modelInvocable: false, userInvocable: true },
      source: 'user-agents',
      provider: 'filesystem',
      whenToUse: 'when x',
    })
    expect(row.whenToUse).toBe('when x')
    expect(row.modelInvocable).toBe(false)
    expect('path' in row).toBe(false)
    expect('rank' in row).toBe(false)
  })

  it('carries updatedAt when provided', () => {
    const row = skillRowFrom({ name: 'x', description: 'd', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'filesystem' }, 1700000000000)
    expect(row.updatedAt).toBe(1700000000000)
  })
})

describe('deleteSkillDir', () => {
  it('rejects built-in / plugin-provided sources before touching the filesystem', async () => {
    const res = await deleteSkillDir({ source: 'runtime', resourceBase: { kind: 'directory', path: '/x' } } as never)
    expect(res.ok).toBe(false)
  })

  it('rejects a skill with no bundle directory', async () => {
    const res = await deleteSkillDir({ source: 'user-dsh' } as never)
    expect(res.ok).toBe(false)
  })
})

describe('bundle file containment', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.()
  })

  /** A temp parent with a `bundle` dir, returned with the paths a case needs. */
  async function fixture() {
    const parent = await mkdtemp(join(tmpdir(), 'catalog-bundle-'))
    cleanups.push(async () => rm(parent, { recursive: true, force: true }))
    const bundle = join(parent, 'bundle')
    await mkdir(bundle, { recursive: true })
    return { parent, bundle }
  }

  it('resolves a plain file inside the bundle', async () => {
    const { bundle } = await fixture()
    await writeFile(join(bundle, 'notes.md'), '# notes\n')
    // The answer is a realpath (a tmpdir may itself be symlinked).
    expect(await resolveBundleTarget(bundle, 'notes.md')).toBe(await realpath(join(bundle, 'notes.md')))
  })

  it('rejects a symlink that escapes the bundle', async () => {
    const { parent, bundle } = await fixture()
    await writeFile(join(parent, 'secret.txt'), 'top secret')
    await symlink(join(parent, 'secret.txt'), join(bundle, 'leak.md'))
    expect(await resolveBundleTarget(bundle, 'leak.md')).toBeUndefined()
  })

  it('rejects a sibling-prefix lookalike (`bundle-evil` never contain-matches `bundle`)', async () => {
    const { parent } = await fixture()
    const evil = join(parent, 'bundle-evil')
    await mkdir(evil, { recursive: true })
    await writeFile(join(evil, 'secret.txt'), 'top secret')
    // A raw startsWith check matches `<bundle>-evil/…` against `<bundle>`; the
    // separator-terminated realpath comparison must not.
    await symlink(join('..', 'bundle-evil', 'secret.txt'), join(parent, 'bundle', 'leak.md'))
    expect(await resolveBundleTarget(join(parent, 'bundle'), 'leak.md')).toBeUndefined()
  })

  it('reads a bundle file through the catalog reader, and only a bundle file', async () => {
    const { parent, bundle } = await fixture()
    await writeFile(join(bundle, 'notes.md'), '# notes\n')
    await writeFile(join(parent, 'secret.txt'), 'top secret')
    await symlink(join(parent, 'secret.txt'), join(bundle, 'leak.md'))
    const registry = registryOf(bundleDef(bundle))
    expect(await readSkillFileContent(registry, 'demo', 'notes.md', undefined)).toEqual({ content: '# notes\n' })
    // Lexical escapes are refused by sanitize…
    expect(await readSkillFileContent(registry, 'demo', '../secret.txt', undefined)).toBeUndefined()
    // …and a symlinked escape by the realpath containment.
    expect(await readSkillFileContent(registry, 'demo', 'leak.md', undefined)).toBeUndefined()
  })
})
