/**
 * The skill env-hint's durable-write contract: the injected context message
 * must carry a producer-owned source kind. The 0.1.5-era
 * `{kind: 'plugin', plugin: 'capability-catalog'}` wrapper is RETIRED — the
 * rc.1 native source admission (session-format-v3-to-v4 message-sources)
 * rejects it at the append encode, which killed the whole turn the moment a
 * credentialed skill loaded (real 3093 reproduction, 2026-09-24).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installSkillEnvHint } from '../src/envHint.ts'

interface Captured {
  handler: (
    exec: { name?: string; arguments?: unknown; agent?: unknown },
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

  it('reads the skill at the caller\'s scope, so a preset-scoped skill still gets its hint', async () => {
    const agent = { marker: 'learning-agent' }
    const captured: Captured = { handler: undefined as never }
    const ctx = {
      inject: (_names: readonly string[], cb: () => void) => cb(),
      on: (_event: string, handler: Captured['handler']) => { captured.handler = handler },
      get: (name: string) => {
        if (name === 'skills') {
          return {
            // Visible only at the caller's own scope — the catalog's settings
            // scope must not be the read position.
            get: async (_name: string, options?: { scope?: unknown }) =>
              options?.scope === agent
                ? { metadata: { credentials: [{ key: 'WEREAD_API_KEY' }] }, content: 'x' }
                : undefined,
          }
        }
        if (name === 'credentials') return { describe: async () => ({ configured: true }) }
        return undefined
      },
    }
    installSkillEnvHint(ctx as never, async () => undefined)
    const decision = await captured.handler(
      { name: 'skill', arguments: { name: 'weread-skills' }, agent },
      undefined,
      async () => 'next',
    ) as { kind: string; additionalContexts: Array<{ content: Array<{ text: string }> }> }
    expect(decision.kind).toBe('accept')
    expect(decision.additionalContexts[0]?.content[0]?.text).toContain('DSH_WEREAD_API_KEY')
  })

  it('lists a scoped-delivered skill\'s bundle files when the caller\'s scope carries the reader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-envhint-'))
    try {
      await writeFile(join(dir, 'SKILL.md'), '---\nname: weread-skills\ndescription: d\n---\nSee notes.md.\n')
      await writeFile(join(dir, 'notes.md'), '# notes\n')
      const captured: Captured = { handler: undefined as never }
      const ctx = {
        inject: (_names: readonly string[], cb: () => void) => cb(),
        on: (_event: string, handler: Captured['handler']) => { captured.handler = handler },
        get: (name: string) => {
          if (name === 'skills') {
            return {
              get: async () => ({
                metadata: undefined,
                content: 'See notes.md.',
                provider: 'capability-catalog',
                resourceBase: { kind: 'directory', path: dir },
              }),
            }
          }
          if (name === 'tools') return { schemas: () => [{ name: 'read_skill_file' }] }
          return undefined
        },
      }
      installSkillEnvHint(ctx as never, async () => undefined)
      const decision = await captured.handler(
        { name: 'skill', arguments: { name: 'weread-skills' }, agent: {} },
        undefined,
        async () => 'next',
      ) as { kind: string; additionalContexts: Array<{ content: Array<{ text: string }> }> }
      expect(decision.kind).toBe('accept')
      const text = decision.additionalContexts[0]?.content[0]?.text ?? ''
      expect(text).toContain('notes.md')
      expect(text).toContain('read_skill_file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names no reader the caller\'s scope does not carry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-envhint-'))
    try {
      await writeFile(join(dir, 'SKILL.md'), '---\nname: weread-skills\ndescription: d\n---\nSee notes.md.\n')
      await writeFile(join(dir, 'notes.md'), '# notes\n')
      const captured: Captured = { handler: undefined as never }
      const ctx = {
        inject: (_names: readonly string[], cb: () => void) => cb(),
        on: (_event: string, handler: Captured['handler']) => { captured.handler = handler },
        get: (name: string) => {
          if (name === 'skills') {
            return {
              get: async () => ({
                metadata: undefined,
                content: 'See notes.md.',
                provider: 'capability-catalog',
                resourceBase: { kind: 'directory', path: dir },
              }),
            }
          }
          if (name === 'tools') return { schemas: () => [] }
          return undefined
        },
      }
      installSkillEnvHint(ctx as never, async () => undefined)
      const decision = await captured.handler(
        { name: 'skill', arguments: { name: 'weread-skills' }, agent: {} },
        undefined,
        async () => 'next',
      )
      // No configured credential and no reader in scope: nothing to hint.
      expect(decision).toBe('next')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
