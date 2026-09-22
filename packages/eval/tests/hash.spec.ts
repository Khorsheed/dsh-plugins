import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson, hashConditionDocument, hashHome } from '../src/hash.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

const T1_CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'dsh', version: null, drive: 'exec' },
  model: { declared: null, endpoint: null },
  reasoning: { effort: 'default' },
  permissions: 'unrestricted',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: ['DEEPSEEK_API_KEY'] },
}

describe('canonicalJson', () => {
  it('sorts keys recursively and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 0, c: null }] })).toBe('{"a":[2,{"c":null,"d":0}],"b":1}')
  })

  it('is order- and encoding-stable', () => {
    const left = { x: '中文', nested: { p: true, q: 1.5 } }
    const right = { nested: { q: 1.5, p: true }, x: '中文' }
    expect(canonicalJson(left)).toBe(canonicalJson(right))
    expect(canonicalJson([])).toBe('[]')
    expect(canonicalJson(null)).toBe('null')
  })
})

describe('hashConditionDocument', () => {
  it('preserves the pre-effort-control frozen baseline digest', () => {
    expect(hashConditionDocument(T1_CONDITION)).toBe('3afb40c930e0eaff946f7ee920b8b50db03a4db4e77a9a2cf896fdc01a328b55')
  })

  it('is deterministic: same document twice, same digest', () => {
    expect(hashConditionDocument(T1_CONDITION)).toBe(hashConditionDocument(structuredClone(T1_CONDITION)))
  })

  it('ignores key order and notes, but not contract fields', () => {
    const shuffled = {
      notes: 'later text',
      env: T1_CONDITION.env,
      home: T1_CONDITION.home,
      skills: T1_CONDITION.skills,
      preset: T1_CONDITION.preset,
      instructions: T1_CONDITION.instructions,
      permissions: T1_CONDITION.permissions,
      reasoning: T1_CONDITION.reasoning,
      model: T1_CONDITION.model,
      harness: T1_CONDITION.harness,
      schema: T1_CONDITION.schema,
    }
    expect(hashConditionDocument(T1_CONDITION)).toBe(hashConditionDocument(shuffled))

    const reworded = { ...structuredClone(T1_CONDITION), notes: 'a completely different comment' }
    expect(hashConditionDocument(T1_CONDITION)).toBe(hashConditionDocument(reworded))

    const different = { ...structuredClone(T1_CONDITION), permissions: 'normal' }
    expect(hashConditionDocument(T1_CONDITION)).not.toBe(hashConditionDocument(different))
  })

  it('produces 64-hex sha256', () => {
    expect(hashConditionDocument(T1_CONDITION)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses non-objects', () => {
    expect(() => hashConditionDocument([1, 2])).toThrow(/JSON object/)
    expect(() => hashConditionDocument('nope')).toThrow(/JSON object/)
  })
})

describe('hashHome', () => {
  const HEX = /^[0-9a-f]{64}$/

  /** A scoped home covering every deny-list rule. */
  function writeHome(root: string, settings: string): string {
    const home = join(root, 'home')
    mkdirSync(join(home, 'credentials'), { recursive: true })
    mkdirSync(join(home, 'oauth'), { recursive: true })
    mkdirSync(join(home, 'sessions'), { recursive: true })
    mkdirSync(join(home, 'nested', 'deep'), { recursive: true })
    writeFileSync(join(home, 'settings.json'), settings)
    writeFileSync(join(home, 'nested', 'deep', 'config.toml'), 'level = "deep"\n')
    writeFileSync(join(home, 'nested', 'config.yaml'), 'other: 1\n')
    writeFileSync(join(home, 'auth.json'), '{"credential": "never"}')
    writeFileSync(join(home, 'credentials', 'cookies.json'), '{"c": 1}')
    writeFileSync(join(home, 'oauth', 'tokens.json'), '{"t": 1}')
    writeFileSync(join(home, 'sessions', 'transcript.json'), '{"s": 1}')
    writeFileSync(join(home, 'api-keys.txt'), 'never')
    writeFileSync(join(home, '.env'), 'SECRET=1')
    writeFileSync(join(home, 'notes.md'), '# prose is not config')
    writeFileSync(join(home, 'binary.bin'), 'not config either')
    return home
  }

  it('hashes only deny-list-clean config files; the result carries no names or content', async () => {
    const { sha, files, denied } = await hashHome(writeHome(tmpTree(), '{"model": "opus"}'))
    expect(sha).toMatch(HEX)
    expect(files).toBe(3) // settings.json + nested/deep/config.toml + nested/config.yaml
    expect(denied).toBe(8) // auth.json, credentials/, oauth/, sessions/, api-keys.txt, .env, notes.md, binary.bin
    expect(Object.keys({ sha, files, denied }).sort()).toEqual(['denied', 'files', 'sha'])
  })

  it('is stable across rebuilds and sensitive to content', async () => {
    const first = await hashHome(writeHome(tmpTree(), '{"model": "opus"}'))
    const second = await hashHome(writeHome(tmpTree(), '{"model": "opus"}'))
    expect(first.sha).toBe(second.sha)
    expect(first.sha).toMatch(HEX)

    const changed = await hashHome(writeHome(tmpTree(), '{"model": "sonnet"}'))
    expect(changed.sha).not.toBe(first.sha)
  })

  it('skips symlinks and refuses a missing directory', async () => {
    const root = tmpTree()
    const home = join(root, 'home')
    mkdirSync(join(home, 'real'), { recursive: true })
    writeFileSync(join(home, 'real', 'config.json'), '{}')
    symlinkSync(join(home, 'real', 'config.json'), join(home, 'real', 'link.json'))
    const result = await hashHome(home)
    expect(result.files).toBe(1)
    expect(result.denied).toBe(1)

    await expect(hashHome(join(root, 'absent'))).rejects.toThrow(/does not exist/)
  })
})
