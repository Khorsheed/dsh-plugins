/**
 * A Codex member runs under its own session's sandbox mode unless the plugin
 * config names one: a full-access session's member was confined to
 * workspace-write (bcc89add, 10-27) and Blender crashed under the seatbelt.
 */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CodexCliProvider, sessionSandboxMode } from '../src/codex-cli-provider.ts'

function withMode(id: string, mode?: string): Session {
  const session = Session.create(SessionId(id))
  if (mode !== undefined) session.append('sandbox/mode' as never, { mode } as never)
  return session
}
function ctxWith(...sessions: Session[]) {
  const store = new Map(sessions.map(s => [String(s.id), s]))
  return { get: (name: string) => name === 'sessions' ? { get: (id: string) => store.get(String(id)) } : undefined } as never
}

describe('Codex sandbox follows the member\'s session', () => {
  it('reads the delegating session\'s standing mode first', () => {
    const parent = withMode('parent', 'danger-full-access')
    const child = withMode('child', 'workspace-write')
    expect(sessionSandboxMode(ctxWith(parent, child), child, 'parent')).toBe('danger-full-access')
  })

  it('falls back to the child\'s inherited mode, the latest one winning', () => {
    const child = withMode('child', 'read-only')
    child.append('sandbox/mode' as never, { mode: 'danger-full-access' } as never)
    expect(sessionSandboxMode(ctxWith(child), child, 'gone')).toBe('danger-full-access')
  })

  it('says nothing when no session records a mode, or records an unknown one', () => {
    expect(sessionSandboxMode(ctxWith(), withMode('child'), undefined)).toBeUndefined()
    expect(sessionSandboxMode(ctxWith(), withMode('child', 'whatever'), undefined)).toBeUndefined()
  })

  it('an explicit plugin policy wins; unset follows the session, else workspace-write', () => {
    const parent = withMode('parent', 'danger-full-access')
    const ctx = ctxWith(parent)
    expect(new CodexCliProvider(ctx, 'read-only').sandboxFor(undefined, 'parent')).toBe('read-only')
    expect(new CodexCliProvider(ctx, undefined).sandboxFor(undefined, 'parent')).toBe('danger-full-access')
    expect(new CodexCliProvider(ctxWith(), undefined).sandboxFor(undefined, 'parent')).toBe('workspace-write')
  })
})
