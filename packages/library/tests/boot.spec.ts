/**
 * The host half's boot, against a real Cordis context.
 *
 * Every other host test here drives a pure function or a service on a
 * hand-built ctx; this one drives the plugin bodies. That distinction is the
 * whole point (the reader precedent): a plugin whose `apply` forgets
 * `ctx.provide('library')` leaves every Remote call throwing into a proxy,
 * and a `./tool` row whose deferred registrations never fire grants nothing —
 * both defects live exactly in the wiring pure tests cannot see.
 *
 * The contexts here are deliberately minimal: no `attachments`, and for the
 * tool row only the registries it injects into. Those are the composition
 * shapes that must survive.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import type { LibraryService } from '../src/service.ts'
import * as toolEntry from '../src/tool.ts'

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
  // The Remote mount is a fiber waiting on `inject: ['library']`; settle the
  // lifecycle before reading what it registered.
  await ctx.fiber.await()
  return ctx
}

describe('the core row', () => {
  it('boots with no optional capability and provides the working service', async () => {
    const ctx = await boot()
    const library = ctx.get('library') as LibraryService
    expect(library).toBeDefined()
    expect(name).toBe('library')
    // The Remote face mounted (the fiber settled past it).
    expect(ctx.get('libraryRemote')).toBeDefined()
    // The service works end to end through the provided handle.
    const created = await library.createProject({ name: '神经科学' })
    expect(created.ok).toBe(true)
    const stored = await library.storeBook({
      projectId: created.ok ? created.project.id : '',
      title: '认知神经科学',
      source: { kind: 'upload', ref: 'cog.epub' },
      format: 'epub',
      chapters: [{ title: '概论', html: '<p>神经系统由神经元构成。</p>' }],
    })
    expect(stored.ok).toBe(true)
    const chapter = await library.getChapterBody({
      projectId: created.ok ? created.project.id : '',
      bookId: stored.ok ? stored.book.id : '',
      chapter: 1,
    })
    expect(chapter.ok && chapter.html).toContain('神经元')
  })
})

describe('the ./tool row', () => {
  it('declares the core inject (the preset-mount ordering rule) and grants the three tagged tools + section + skill', async () => {
    expect(toolEntry.inject).toEqual(['library'])
    expect(toolEntry.name).toBe('library-tool')

    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { stateRoot: stateRoot() })
    await ctx.fiber.await()

    const registered: { name: string }[] = []
    const sections: { name: string; order: number; text: string }[] = []
    const skills: { name: string; provider?: string }[] = []
    ctx.provide('tools', { register: (definition: { name: string }) => { registered.push(definition); return () => {} } })
    ctx.provide('systemPrompt', { section: (section: { name: string; order: number; text: string }) => { sections.push(section); return () => {} } })
    ctx.provide('skills', { register: (skill: { name: string; provider?: string }) => { skills.push(skill); return () => {} } })

    toolEntry.apply(ctx, {})
    await ctx.fiber.await()
    // The deferred injections fire against the registries mounted above.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(registered.map(definition => definition.name)).toEqual(['library_read', 'library_write', 'library_assess'])
    for (const definition of registered) {
      expect((definition as Record<symbol, unknown>)[TOOL_ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-library' })
    }
    expect(sections.map(section => section.name)).toEqual(['tool:library'])
    expect(sections[0]?.order).toBe(114)
    expect(sections[0]?.text).toContain('library_assess')
    expect(skills.map(skill => skill.name)).toEqual(['library'])
    expect(skills[0]?.provider).toBe('@khorsheed/dsh-library')
  })

  it('tools: none registers nothing at all', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { stateRoot: stateRoot() })
    await ctx.fiber.await()
    const registered: unknown[] = []
    ctx.provide('tools', { register: (definition: unknown) => { registered.push(definition); return () => {} } })
    ctx.provide('systemPrompt', { section: () => { registered.push('section'); return () => {} } })
    ctx.provide('skills', { register: (skill: unknown) => { registered.push(skill); return () => {} } })
    toolEntry.apply(ctx, { tools: 'none' })
    await ctx.fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registered).toEqual([])
  })

  it('a missing core degrades to a log line, never a boot failure', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    // No `library` provided: the direct-call guard is the whole story.
    expect(() => toolEntry.apply(ctx, {})).not.toThrow()
    await ctx.fiber.await()
  })
})
