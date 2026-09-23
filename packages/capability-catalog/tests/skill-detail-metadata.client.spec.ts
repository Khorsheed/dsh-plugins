/**
 * The skill detail modal's frontmatter metadata block.
 *
 * Two rules are pinned here, both of them things the user sees:
 *
 * - a metadata key that ALREADY has a dedicated surface above (the preset-scope
 *   editor, the credential form) must not reappear as a raw JSON dump — that is
 *   what made an `metadata` block appear for a skill whose only metadata was a
 *   credential declaration;
 * - whatever does get printed has secret-shaped VALUES redacted, so the day
 *   someone inlines a token in frontmatter the panel does not display it.
 */
import { describe, expect, it } from 'vitest'
import { formatMetadata, hasUnrenderedMetadata, redactMetadataSecrets } from '../src/client/SkillDetailModal.tsx'

describe('hasUnrenderedMetadata', () => {
  it('is false for a skill with no metadata at all', () => {
    expect(hasUnrenderedMetadata('{}')).toBe(false)
  })

  it('is false when every key already has a dedicated surface', () => {
    expect(hasUnrenderedMetadata(JSON.stringify({ presetScope: ['dsh-writing'], credentials: [{ key: 'X' }] }))).toBe(false)
  })

  it('is false for a credential declaration alone', () => {
    expect(hasUnrenderedMetadata(JSON.stringify({ credentials: [{ key: 'WECHAT_KEY' }] }))).toBe(false)
  })

  it('is true for any other key', () => {
    expect(hasUnrenderedMetadata(JSON.stringify({ presetScope: [], version: '1.1.0' }))).toBe(true)
  })

  it('is true for unparsable or non-object metadata', () => {
    expect(hasUnrenderedMetadata('not json')).toBe(true)
    expect(hasUnrenderedMetadata('["a"]')).toBe(true)
    expect(hasUnrenderedMetadata('null')).toBe(true)
  })
})

describe('redactMetadataSecrets', () => {
  it('replaces a value whose key looks secret-shaped, at any depth', () => {
    expect(redactMetadataSecrets({
      apiKey: 'sk-live-123',
      auth: { token: 'gulp-abc', mode: 'bearer' },
      nested: [{ password: 'pw' }],
    })).toEqual({
      apiKey: '···',
      auth: { token: '···', mode: 'bearer' },
      nested: [{ password: '···' }],
    })
  })

  it('leaves ordinary keys alone, including values that merely look long', () => {
    const value = { version: '1.1.0', description: 'a very long ordinary string', tags: ['keynote', 'tokenizer'] }
    expect(redactMetadataSecrets(value)).toEqual(value)
  })

  it('keeps the shape of arrays and primitives', () => {
    expect(redactMetadataSecrets([1, 'two', null])).toEqual([1, 'two', null])
    expect(redactMetadataSecrets('plain')).toBe('plain')
  })
})

describe('formatMetadata', () => {
  it('pretty-prints with secret-shaped values redacted', () => {
    const text = formatMetadata(JSON.stringify({ version: '1.0.0', apiKey: 'sk-live' }))
    expect(text).toContain('"version": "1.0.0"')
    expect(text).toContain('"apiKey": "···"')
    expect(text).not.toContain('sk-live')
  })

  it('passes unparsable metadata through unchanged', () => {
    expect(formatMetadata('not json')).toBe('not json')
  })
})
