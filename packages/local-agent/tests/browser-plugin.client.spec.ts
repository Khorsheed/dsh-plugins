/**
 * ui-kimi plugin halves: the browser entry's dictionary and header-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the header list. */
function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.actions')
    .map(entry => entry.options.id)
}

/** Whether the member composer is on the conversation composer chain. */
function composerRegistered(ctx: Context): boolean {
  return ctx.slots.entries('conversation.composer').length > 0
}

/** Boot the browser half over a real slot tree that declares the header list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
    },
  } as never, () => null)
  const execute = vi.fn((_sessionId: string, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const, text: '' } } }))
  const commandsRemote = { execute }
  const localAgentGateway = {
    roster: vi.fn(() => Promise.resolve({ ok: true, value: [{ name: 'kimi', displayName: 'Kimi Code' }] })),
    status: vi.fn(() => Promise.resolve({ ok: true, value: { name: 'kimi', displayName: 'Kimi Code', authenticated: false, homeDir: '/h' } })),
  }
  ctx.provide('remote', { commands: commandsRemote, localAgentGateway })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('remote.localAgentGateway', localAgentGateway)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-local-agent browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('registers the member composer on the conversation chain, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).not.toContain('local-agent')
    expect(composerRegistered(ctx)).toBe(true)
    await fiber.dispose()
    expect(composerRegistered(ctx)).toBe(false)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    // rc.8: the initial locale follows the browser (jsdom reports en-US);
    // pin zh explicitly instead of assuming it is the default.
    ctx.locale.setLocale('zh')
    const translate = ctx.locale.bind(NS)
    expect(translate('list.aria')).toBe(zh['list.aria'])
    ctx.locale.setLocale('en')
    expect(translate('list.aria')).toBe(en['list.aria'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('list.aria')).not.toBe(en['list.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
