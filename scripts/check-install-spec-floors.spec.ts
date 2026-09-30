import { describe, expect, it } from 'vitest'
import { caretIncludes, findInstallSpecs, newer, parseVersion, scan } from './check-install-spec-floors.ts'

const v = parseVersion

describe('parseVersion', () => {
  it('parses stable and rc versions', () => {
    expect(v('0.3.3')).toEqual({ major: 0, minor: 3, patch: 3, rc: null })
    expect(v('0.1.0-rc.8')).toEqual({ major: 0, minor: 1, patch: 0, rc: 8 })
  })
  it('rejects shapes this repo never publishes', () => {
    expect(() => v('1.2.3.4')).toThrow()
    expect(() => v('0.1.0-beta.1')).toThrow()
  })
})

describe('caretIncludes (0.x caret: same major+minor, patch ≥ floor)', () => {
  it('admits same-line stable patches and floats', () => {
    expect(caretIncludes(v('0.3.3'), v('0.3.3'))).toBe(true)
    expect(caretIncludes(v('0.3.3'), v('0.3.9'))).toBe(true)
  })
  it('rejects the next minor line (the rot this checker exists for)', () => {
    expect(caretIncludes(v('0.3.3'), v('0.4.0'))).toBe(false)
    expect(caretIncludes(v('0.3.3'), v('1.0.0'))).toBe(false)
  })
  it('rejects floors newer than the package', () => {
    expect(caretIncludes(v('0.3.4'), v('0.3.3'))).toBe(false)
  })
  it('mirrors npm prerelease admission', () => {
    // rc floor: same-triple later rcs and the stable release are admitted
    expect(caretIncludes(v('0.1.0-rc.8'), v('0.1.0-rc.9'))).toBe(true)
    expect(caretIncludes(v('0.1.0-rc.8'), v('0.1.0'))).toBe(true)
    expect(caretIncludes(v('0.1.0-rc.8'), v('0.1.0-rc.7'))).toBe(false)
    // a different triple's rc is never admitted
    expect(caretIncludes(v('0.1.0-rc.8'), v('0.1.1-rc.1'))).toBe(false)
    // a stable floor admits no rc at all
    expect(caretIncludes(v('0.3.3'), v('0.3.4-rc.1'))).toBe(false)
  })
})

describe('findInstallSpecs', () => {
  it('reads floored specs, ignores bare names and old-line pins are still specs', () => {
    const text = '装 `@khorsheed/dsh-quote`，旧线用 `@khorsheed/dsh-quote@^0.1.2`，英文同款 `@khorsheed/dsh-ui-shortcuts@^0.2.4`。'
    expect(findInstallSpecs(text)).toEqual([
      { name: '@khorsheed/dsh-quote', floor: '0.1.2' },
      { name: '@khorsheed/dsh-ui-shortcuts', floor: '0.2.4' },
    ])
  })
})

describe('the real tree', () => {
  it('every profile-pack README floor covers its package’s current version', () => {
    expect(scan(false)).toEqual([])
  })
})

describe('newest-line judgement', () => {
  it('old-line pins never flag: only the highest floor per package is judged', () => {
    expect(newer(v('0.2.0'), v('0.1.0'))).toEqual(v('0.2.0'))
    expect(newer(v('0.1.0-rc.8'), v('0.1.0'))).toEqual(v('0.1.0'))
    expect(newer(v('0.1.0-rc.8'), v('0.1.0-rc.9'))).toEqual(v('0.1.0-rc.9'))
  })
})
