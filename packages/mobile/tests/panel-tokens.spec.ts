import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOBILE_CSS } from '../src/client/styles.ts'

describe('shared panel type tokens', () => {
  it('raises every --dsh-panel-* token on touch, under the mobile root only', () => {
    const rule = MOBILE_CSS.split('\n').find(line => line.includes('--dsh-panel-text-body'))
    expect(rule?.startsWith('html[data-dsh-mobile] body {')).toBe(true)
    for (const token of ['--dsh-panel-text-title', '--dsh-panel-text-body', '--dsh-panel-text-meta', '--dsh-panel-text-reading', '--dsh-panel-reading-line-height']) {
      expect(rule).toContain(`${token}:`)
    }
  })

  it('sets the tokens without depending on the panel kit', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, Record<string, string> | undefined>
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
    expect(Object.keys(deps)).not.toContain('@khorsheed/dsh-client-ui-panel-kit')
  })
})
