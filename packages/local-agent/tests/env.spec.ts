import { describe, expect, it } from 'vitest'
import { delegationEnv } from '@khorsheed/dsh-local-agent'

/** Run `body` with `process.env` replaced by `env`, restoring it afterwards. */
function withEnv(env: Record<string, string>, body: () => void): void {
  const saved = process.env
  process.env = { ...env }
  try {
    body()
  } finally {
    process.env = saved
  }
}

describe('delegationEnv', () => {
  it('tombstones ambient keys outside the allowlist', () => {
    withEnv({ PATH: 'bin', HOME: 'home-dir', USER: 'root', ANTHROPIC_BASE_URL: 'https://evil', npm_config_cache: 'npm-cache' }, () => {
      const env = delegationEnv({ CLAUDE_CONFIG_DIR: '/scoped' })
      // Allowlisted keys are absent: they reach the child by the seam's
      // inheritance merge, not through the explicit layer.
      expect(env).not.toHaveProperty('PATH')
      expect(env).not.toHaveProperty('HOME')
      expect(env.USER).toBeUndefined()
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(env.npm_config_cache).toBeUndefined()
      expect(env.CLAUDE_CONFIG_DIR).toBe('/scoped')
      // Tombstones are present as own keys so the seam removes the entries.
      expect(Object.keys(env)).toEqual(expect.arrayContaining(['USER', 'ANTHROPIC_BASE_URL']))
    })
  })

  it('lets explicit entries win over both the allowlist and tombstones', () => {
    withEnv({ PATH: 'bin', USER: 'root' }, () => {
      const env = delegationEnv({ PATH: '/child/bin', USER: 'kept-deliberately' })
      expect(env.PATH).toBe('/child/bin')
      expect(env.USER).toBe('kept-deliberately')
    })
  })

  it('passes proxy variables through by inheritance in both casings', () => {
    withEnv({ PATH: 'bin', http_proxy: 'http://127.0.0.1:6152', HTTPS_PROXY: 'http://127.0.0.1:6152' }, () => {
      const env = delegationEnv({})
      expect(env).not.toHaveProperty('http_proxy')
      expect(env).not.toHaveProperty('HTTPS_PROXY')
    })
  })

  it('honours a caller tombstone without re-adding the key', () => {
    withEnv({ PATH: 'bin', EDITOR: 'vim' }, () => {
      const env = delegationEnv({ EDITOR: undefined })
      expect(Object.keys(env)).toContain('EDITOR')
      expect(env.EDITOR).toBeUndefined()
    })
  })
})
