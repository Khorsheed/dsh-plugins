import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/client/config.ts'

describe('resolveConfig', () => {
  it('applies every documented default when no config arrives', () => {
    expect(resolveConfig(undefined)).toEqual({
      enabled: true,
      includeSteering: true,
      panelWidth: 360,
      initialPages: 5,
    })
  })

  it('passes explicit values through', () => {
    expect(resolveConfig({
      enabled: false,
      includeSteering: false,
      panelWidth: 400,
      initialPages: 3,
    })).toEqual({
      enabled: false,
      includeSteering: false,
      panelWidth: 400,
      initialPages: 3,
    })
  })

  it('clamps out-of-range numbers into the legal bounds', () => {
    expect(resolveConfig({ panelWidth: 5, initialPages: 99 })).toEqual({
      enabled: true,
      includeSteering: true,
      panelWidth: 120,
      initialPages: 20,
    })
  })
})
