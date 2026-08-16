import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-file-preview node half', () => {
  it('applies without host-side behavior', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
