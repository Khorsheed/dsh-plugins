import { userInfo } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeKeychainEnv, claudeProcessEnv } from '../src/process-env.ts'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  userInfo: vi.fn(() => ({ username: 'login-user' })),
}))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.unstubAllEnvs(); vi.clearAllMocks() })
function onPlatform(value: string): void { Object.defineProperty(process, 'platform', { value }) }

describe('Claude host keychain identity', () => {
  it('restores macOS USER while continuing to scrub ambient credentials and login names', () => {
    onPlatform('darwin')
    vi.stubEnv('USER', 'authorized-user')
    vi.stubEnv('LOGNAME', 'unrelated-user')
    vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-test-value')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'ambient-test-value')
    const env = claudeProcessEnv({ CLAUDE_CONFIG_DIR: '/home/user/scoped', CLAUDE_CODE_EFFORT_LEVEL: 'high' })
    expect(env).toMatchObject({ USER: 'authorized-user', CLAUDE_CONFIG_DIR: '/home/user/scoped', CLAUDE_CODE_EFFORT_LEVEL: 'high' })
    expect(env.LOGNAME).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(userInfo).not.toHaveBeenCalled()
  })

  it('uses the OS account when a macOS service has no USER', () => {
    onPlatform('darwin'); vi.stubEnv('USER', undefined)
    expect(claudeKeychainEnv()).toEqual({ USER: 'login-user' })
    expect(claudeProcessEnv({}).USER).toBe('login-user')
  })

  it('degrades without inventing an account when OS identity is unavailable', () => {
    onPlatform('darwin'); vi.stubEnv('USER', undefined)
    vi.mocked(userInfo).mockImplementationOnce(() => { throw new Error('no OS identity') })
    expect(claudeKeychainEnv()).toEqual({})
  })

  it.each(['linux', 'win32'])('does not introduce the macOS identity on %s', platform => {
    onPlatform(platform); vi.stubEnv('USER', 'host-user')
    expect(claudeKeychainEnv()).toEqual({})
    expect(claudeProcessEnv({ CLAUDE_CONFIG_DIR: '/home/user/scoped' }).USER).toBeUndefined()
    expect(userInfo).not.toHaveBeenCalled()
  })
})
