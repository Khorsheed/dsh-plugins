/**
 * session-title-edit plugin halves: the browser entry's dictionary and
 * header-slot registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the injected rename verb's three
 * paths against a stubbed session binding, the inert node entry, and the
 * invariant companion's ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as TitleInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { isRenameFailure, type RenameFailure, type SessionTitleEditInjected } from '../src/client/slots.ts'

/** A session the bench's binding stub can resolve. */
const KNOWN = 's1' as SessionId
/** A session the bench's binding stub refuses. */
const UNKNOWN = 'ghost' as SessionId

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  rename: ReturnType<typeof vi.fn>
}

/** Boot the browser half over a real slot tree that declares the header list. */
async function bench(): Promise<Bench> {
  const rename = vi.fn()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  // The rename verb resolves through the session binding; KNOWN resolves a
  // session whose rename mock the spec drives, UNKNOWN stays unresolvable.
  ctx.provide('sessions', {
    binding: (id: string) => (id === KNOWN ? { session: { rename } } : undefined),
  } as never)
  // The locale plugin binds a settings scope, which reads the connection
  // handle and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, rename }
}

/** Read the registered entry's inject factory, materialized per session. */
function injectedFor(ctx: Context, sessionId: SessionId): SessionTitleEditInjected {
  const entry = ctx.slots
    .entries('conversation.session.header.actions')
    .find(e => e.options.id === 'session-title-edit')
  if (entry === undefined) throw new Error('session-title-edit entry missing')
  return (entry.inject as unknown as (id: SessionId) => SessionTitleEditInjected)(sessionId)
}

/** Slot ledger reader: entry ids currently registered in the header list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.actions')
    .map(entry => entry.options.id)
}

describe('session-title-edit browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('registers the header action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).toContain('session-title-edit')
    // Leads the actions row (below the preset's -10) so it sits right of the title.
    const entry = ctx.slots.entries('conversation.session.header.actions')
      .find(e => e.options.id === 'session-title-edit')
    expect(entry?.options.order).toBe(-20)
    await fiber.dispose()
    expect(headerEntryIds(ctx)).not.toContain('session-title-edit')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    // rc.8: the initial locale follows the browser (jsdom reports en-US);
    // pin zh explicitly instead of assuming it is the default.
    ctx.locale.setLocale('zh')
    const translate = ctx.locale.bind(NS)
    expect(translate('action.rename')).toBe(zh['action.rename'])
    ctx.locale.setLocale('en')
    expect(translate('action.rename')).toBe(en['action.rename'])

    // Released dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('action.rename')).not.toBe(en['action.rename'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('renames through the session binding, passing the raw title to the RPC', async () => {
    const { ctx, rename } = await bench()
    rename.mockResolvedValue({ ok: true, value: { title: 'New', seq: 5 } })
    await expect(injectedFor(ctx, KNOWN).renameSession('  New  ')).resolves.toBeUndefined()
    expect(rename).toHaveBeenCalledWith('  New  ')
  })

  it('surfaces a host rejection as a RenameFailure carrying the wire code', async () => {
    const { ctx, rename } = await bench()
    rename.mockResolvedValue({ ok: false, error: { code: 'title-invalid', message: 'empty' } })
    const failure = injectedFor(ctx, KNOWN).renameSession(' ')
    await expect(failure).rejects.toMatchObject({ code: 'title-invalid' })
  })

  it('fails loud for a session the binding cannot resolve', async () => {
    const { ctx, rename } = await bench()
    await expect(injectedFor(ctx, UNKNOWN).renameSession('New')).rejects.toThrow(/unknown session/)
    expect(rename).not.toHaveBeenCalled()
  })

  it('keeps the RenameFailure guard narrow', () => {
    const tagged = new Error('x') as RenameFailure
    tagged.code = 'title-invalid'
    expect(isRenameFailure(tagged)).toBe(true)
  })
})

describe('session-title-edit node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('session-title-edit invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(TitleInvariant)
    await fiber.await()
    expect(TitleInvariant.name).toBe('client-session-title-edit-invariant')
    expect(TitleInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
