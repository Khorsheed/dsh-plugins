/**
 * The host half's boot, against a real Cordis context.
 *
 * Every other host test here drives a pure function or a service on a
 * hand-built ctx; this one drives the plugin bodies. That distinction is the
 * whole point (the reader precedent): a plugin whose `apply` forgets
 * `ctx.provide('library')` leaves every Remote call throwing into a proxy,
 * and a `./tool` row whose deferred registrations never fire grants nothing —
 * both defects live exactly in the wiring pure tests cannot see.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import type { LibraryService } from '../src/service.ts'
import * as toolEntry from '../src/tool.ts'
import { LIBRARY_TOOL_NAMES } from '../src/tool-definition.ts'

/** The origin-tag key, read straight from the global symbol registry (no import edge). */
const TOOL_ORIGIN = Symbol.for('dsh.tool.origin')

const roots: string[] = []
const contexts: Context[] = []

/** A throwaway state root; the plugin never touches the real deployment's. */
function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-library-boot-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the host half on a fresh context and settle its injection. */
async function boot(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  apply(ctx, { stateRoot: stateRoot() })
  await ctx.fiber.await()
  return ctx
}

/** Registries the tool row injects into, recording what it registers. */
function registries(ctx: Context) {
  const registered: { name: string }[] = []
  const sections: { name: string; order: number; text: string }[] = []
  const contextsSeen: { name: string; text: (context: unknown) => string }[] = []
  const denied: string[][] = []
  ctx.provide('tools', {
    register: (definition: { name: string }) => { registered.push(definition); return () => {} },
    restrict: (filter: { deny: string[] }) => { denied.push(filter.deny); return () => {} },
  })
  ctx.provide('systemPrompt', {
    section: (section: { name: string; order: number; text: string }) => { sections.push(section); return () => {} },
    context: (context: { name: string; text: (context: unknown) => string }) => { contextsSeen.push(context); return () => {} },
  })
  return { registered, sections, contexts: contextsSeen, denied }
}

describe('the core row', () => {
  it('boots with no optional capability and provides the working service', async () => {
    const ctx = await boot()
    const library = ctx.get('library') as LibraryService
    expect(name).toBe('library')
    expect(ctx.get('libraryRemote')).toBeDefined()
    const created = await library.createProject({ name: '神经科学' })
    expect(created.ok).toBe(true)
    const book = await library.putBook({
      projectId: created.ok ? created.project.id : '',
      title: 'Principles of Neural Science',
      bookKind: 'knowledge',
      toc: [{ title: 'Ion Channels' }],
      tocSource: { by: 'model' },
    })
    expect(book.ok).toBe(true)
    // No attachment store: photos degrade to a refusal, never a throw.
    const saved = await library.savePhoto({ data: '', mediaType: 'image/png' })
    expect(!saved.ok && saved.error).toBe('unavailable')
  })
})

describe('the ./tool row', () => {
  it('declares the core inject and grants the tagged tools, the guidance and the bound context', async () => {
    expect(toolEntry.inject).toEqual(['library'])
    expect(toolEntry.name).toBe('library-tool')
    const ctx = await boot()
    const seen = registries(ctx)
    toolEntry.apply(ctx, {})
    await ctx.fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seen.registered.map(definition => definition.name)).toEqual(LIBRARY_TOOL_NAMES)
    for (const definition of seen.registered) {
      expect((definition as Record<symbol, unknown>)[TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-library' })
    }
    expect(seen.sections.map(section => section.name)).toEqual(['tool:library'])
    expect(seen.sections[0]?.text).toContain('library_assess')
    expect(seen.contexts.map(context => context.name)).toEqual(['library:binding'])
    expect(seen.contexts[0]?.text({})).toBe('')
    expect(seen.contexts[0]?.text({ agent: { session: { id: 's1' } } })).toMatch(/not bound/)
  })

  it('quiets its scope when configured: blank sections, masked tools', async () => {
    const ctx = await boot()
    const seen = registries(ctx)
    toolEntry.apply(ctx, { hideSections: ['harness:source', 'app:web-surface'], denyTools: ['list_capabilities'] })
    await ctx.fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen.sections.filter(section => section.text === '').map(section => section.name)).toEqual(['harness:source', 'app:web-surface'])
    expect(seen.denied).toEqual([['list_capabilities']])
  })

  it('tools: none registers nothing at all', async () => {
    const ctx = await boot()
    const seen = registries(ctx)
    toolEntry.apply(ctx, { tools: 'none' })
    await ctx.fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect([...seen.registered, ...seen.sections, ...seen.contexts]).toEqual([])
  })

  it('a missing core degrades to a log line, never a boot failure', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    expect(() => toolEntry.apply(ctx, {})).not.toThrow()
    await ctx.fiber.await()
  })
})
