/**
 * Language-hint unit tests: the content view's CodeBlock must receive a
 * prism language for known extensions and undefined (plain text) otherwise.
 */
import { describe, expect, it } from 'vitest'
import { languageFor } from '../src/client/language.ts'

describe('languageFor', () => {
  it('maps known extensions to prism languages', () => {
    expect(languageFor('src/index.ts')).toBe('typescript')
    expect(languageFor('src/App.tsx')).toBe('typescript')
    expect(languageFor('package.json')).toBe('json')
    expect(languageFor('README.md')).toBe('markdown')
    expect(languageFor('build/vitest.ts')).toBe('typescript')
    expect(languageFor('script.sh')).toBe('bash')
  })

  it('is case-insensitive on the extension', () => {
    expect(languageFor('src/INDEX.TS')).toBe('typescript')
  })

  it('returns undefined for unknown or extensionless paths', () => {
    expect(languageFor('Dockerfile')).toBeUndefined()
    expect(languageFor('LICENSE')).toBeUndefined()
    expect(languageFor('some.unknown-ext')).toBeUndefined()
  })
})
