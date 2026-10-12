import { describe, expect, it } from 'vitest'
import { frontmatterBoolean, isKebabId, parseSkillFrontmatter, splitFrontmatter } from '../src/frontmatter.ts'

/** A SKILL.md-shaped document around one frontmatter block. */
function doc(front: string, body = '\n# body\n'): string {
  return `---\n${front}\n---\n${body}`
}

describe('splitFrontmatter', () => {
  it('splits the block from the body, CRLF-tolerant', () => {
    expect(splitFrontmatter(doc('name: x'))).toEqual({ front: 'name: x', body: '\n# body\n' })
    expect(splitFrontmatter('---\r\nname: x\r\n---\r\nbody')).toEqual({ front: 'name: x', body: 'body' })
  })

  it('returns undefined without a block', () => {
    expect(splitFrontmatter('# no frontmatter')).toBeUndefined()
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads identity and body from one parse', () => {
    const parsed = parseSkillFrontmatter(doc('name: x\ndescription: d'))
    expect(parsed).toMatchObject({ name: 'x', description: 'd', modelInvocable: true, userInvocable: true })
    expect(parsed?.body).toBe('\n# body\n')
  })

  it('reads a quoted name and a folded multi-line description', () => {
    const parsed = parseSkillFrontmatter(doc("name: 'quoted-skill'\ndescription: >\n  A longer description\n  over two lines."))
    expect(parsed?.name).toBe('quoted-skill')
    // A folded scalar keeps its trailing newline (the host's stringField does not trim either).
    expect(parsed?.description).toBe('A longer description over two lines.\n')
  })

  it('reads the invocation flags with the host parser\'s boolean variants', () => {
    // skill-filesystem's frontmatterBoolean takes 1/0, yes/no, on/off beside
    // true/false; js-yaml 4 leaves yes/no/on/off as strings, 1/0 as numbers.
    for (const truthy of ['true', '1', "'1'", 'yes', 'on', "'yes'"]) {
      expect(parseSkillFrontmatter(doc(`name: x\ndescription: d\ndisable-model-invocation: ${truthy}`))?.modelInvocable, truthy).toBe(false)
    }
    for (const falsy of ['false', '0', "'0'", 'no', 'off']) {
      expect(parseSkillFrontmatter(doc(`name: x\ndescription: d\nuser-invocable: ${falsy}`))?.userInvocable, falsy).toBe(false)
    }
  })

  it('reads an invalid flag value as absent rather than rejecting the skill', () => {
    // The host loader ignores the whole file over a bad boolean; the catalog is
    // a management surface and degrades to the default instead.
    const parsed = parseSkillFrontmatter(doc('name: x\ndescription: d\ndisable-model-invocation: banana'))
    expect(parsed?.name).toBe('x')
    expect(parsed?.modelInvocable).toBe(true)
  })

  it('reads presetScope from the canonical metadata key or the legacy top-level key', () => {
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d\nmetadata:\n  presetScope: [dsh-writing, dev]'))?.presetScope)
      .toEqual(['dsh-writing', 'dev'])
    expect(parseSkillFrontmatter(doc("name: x\ndescription: d\npresetScope: 'dsh-writing'"))?.presetScope)
      .toEqual(['dsh-writing'])
  })

  it('reads a presetScope block list', () => {
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d\nmetadata:\n  presetScope:\n    - dsh-writing\n    - dev\n  other: 1'))?.presetScope)
      .toEqual(['dsh-writing', 'dev'])
  })

  it('distinguishes an explicit empty presetScope from an absent key', () => {
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d\npresetScope: []'))?.presetScope).toEqual([])
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d'))?.presetScope).toBeUndefined()
  })

  it('drops preset ids outside the kebab-case grammar and de-duplicates', () => {
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d\npresetScope: [dsh-writing, ../evil, dsh-writing, DEV]'))?.presetScope)
      .toEqual(['dsh-writing'])
  })

  it('prefers the canonical metadata key when both positions declare a scope', () => {
    const parsed = parseSkillFrontmatter(doc('name: x\ndescription: d\npresetScope: [dev]\nmetadata:\n  presetScope: [dsh-writing]'))
    expect(parsed?.presetScope).toEqual(['dsh-writing'])
  })

  it('does not read a presetScope nested under an unrelated key', () => {
    expect(parseSkillFrontmatter(doc('name: x\ndescription: d\nother:\n  presetScope: [dsh-writing]'))?.presetScope).toBeUndefined()
  })

  it('scopes scalar reads to the top level — a nested same-named key does not shadow', () => {
    const parsed = parseSkillFrontmatter(doc('metadata:\n  name: shadow\nname: real-name\ndescription: d'))
    expect(parsed?.name).toBe('real-name')
  })

  it('carries the metadata block verbatim', () => {
    const parsed = parseSkillFrontmatter(doc('name: x\ndescription: d\nmetadata:\n  presetScope: [dsh-writing]\n  credentials:\n    - key: K'))
    expect(parsed?.metadata).toEqual({ presetScope: ['dsh-writing'], credentials: [{ key: 'K' }] })
  })

  it('still parses when the metadata block is malformed, minus the metadata', () => {
    const parsed = parseSkillFrontmatter(doc('name: x\ndescription: d\nmetadata:\n  credentials: [unclosed'))
    expect(parsed?.name).toBe('x')
    expect(parsed?.metadata).toBeUndefined()
  })

  it('rejects a block that is unusable YAML even without its metadata section', () => {
    expect(parseSkillFrontmatter(doc('name: [unclosed\ndescription: d'))).toBeUndefined()
  })

  it('rejects a block that is not a mapping, and a file with no block', () => {
    expect(parseSkillFrontmatter(doc('just words'))).toBeUndefined()
    expect(parseSkillFrontmatter('# no frontmatter')).toBeUndefined()
  })
})

describe('frontmatterBoolean', () => {
  it('accepts the host loader\'s variants case-insensitively', () => {
    expect(frontmatterBoolean({ f: true }, 'f')).toBe(true)
    expect(frontmatterBoolean({ f: 1 }, 'f')).toBe(true)
    expect(frontmatterBoolean({ f: '1' }, 'f')).toBe(true)
    expect(frontmatterBoolean({ f: 'YES' }, 'f')).toBe(true)
    expect(frontmatterBoolean({ f: 'on' }, 'f')).toBe(true)
    expect(frontmatterBoolean({ f: false }, 'f')).toBe(false)
    expect(frontmatterBoolean({ f: 0 }, 'f')).toBe(false)
    expect(frontmatterBoolean({ f: '0' }, 'f')).toBe(false)
    expect(frontmatterBoolean({ f: 'No' }, 'f')).toBe(false)
    expect(frontmatterBoolean({ f: 'off' }, 'f')).toBe(false)
  })

  it('reads an absent or unusable value as undefined', () => {
    expect(frontmatterBoolean({}, 'f')).toBeUndefined()
    expect(frontmatterBoolean({ f: 'banana' }, 'f')).toBeUndefined()
    expect(frontmatterBoolean({ f: [1] }, 'f')).toBeUndefined()
  })
})

describe('isKebabId', () => {
  it('matches the registry\'s id grammar', () => {
    expect(isKebabId('dsh-writing')).toBe(true)
    expect(isKebabId('Not Kebab')).toBe(false)
  })
})
