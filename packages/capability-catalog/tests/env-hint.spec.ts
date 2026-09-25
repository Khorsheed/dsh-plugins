/**
 * The skill env-hint's durable-write contract: the injected context message
 * must carry a producer-owned source kind. The 0.1.5-era
 * `{kind: 'plugin', plugin: 'capability-catalog'}` wrapper is RETIRED — the
 * rc.1 native source admission (session-format-v3-to-v4 message-sources)
 * rejects it at the append encode, which killed the whole turn the moment a
 * credentialed skill loaded (real 3093 reproduction, 2026-09-24).
 */
import { describe, expect, it } from 'vitest'
import { installSkillEnvHint } from '../src/envHint.ts'

interface Captured {
  handler: (
    exec: { name?: string; arguments?: unknown },
    result: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>
}

/** A minimal context: the deferred tools inject, the event hook, and the two services the hint reads. */
function bench(options: { configured: boolean }) {
  const captured: Captured = { handler: undefined as never }
  const ctx = {
    inject: (_names: readonly string[], cb: () => void) => cb(),
    on: (_event: string, handler: Captured['handler']) => { captured.handler = handler },
    get: (name: string) => {
      if (name === 'skills') {
        return {
          get: async () => ({ metadata: undefined, content: 'Call it as `$MY_KEY` from the shell.' }),
        }
      }
      if (name === 'credentials') {
        return { describe: async () => ({ configured: options.configured }) }
      }
      return undefined
    },
  }
  installSkillEnvHint(ctx as never, async () => undefined)
  return captured
}

describe('installSkillEnvHint (skill env hint)', () => {
  it('stamps the injected context with the plugin-owned source kind, never the retired plugin wrapper', async () => {
    const { handler } = bench({ configured: true })
    const decision = await handler(
      { name: 'skill', arguments: { name: 'guarded-skill' } },
      undefined,
      async () => 'next',
    ) as { kind: string; additionalContexts: Array<{ source: { kind: string } }> }
    expect(decision.kind).toBe('accept')
    expect(decision.additionalContexts).toHaveLength(1)
    expect(decision.additionalContexts[0]?.source.kind).toBe('capability-catalog')
  })

  it('passes through untouched when no declared credential is configured', async () => {
    const { handler } = bench({ configured: false })
    const decision = await handler(
      { name: 'skill', arguments: { name: 'guarded-skill' } },
      undefined,
      async () => 'next',
    )
    expect(decision).toBe('next')
  })

  it('ignores non-skill tool executions', async () => {
    const { handler } = bench({ configured: true })
    const decision = await handler({ name: 'read', arguments: {} }, undefined, async () => 'next')
    expect(decision).toBe('next')
  })
})
