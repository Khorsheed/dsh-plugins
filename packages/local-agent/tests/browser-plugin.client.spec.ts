/**
 * ui-local-agent browser half: the browser entry's dictionary and
 * header-slot registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the member composer, and
 * the「本机 Agent 委派」family card: one `plugins.item` entry registered
 * with the client bundle itself, with the harness-card registry exposed on
 * the localAgentUi service. The card carries NO served-namespace gate: the
 * settings describe answer only lists namespaces whose Config schema has a
 * volatile field, this core's Config has none, so gating on it meant the
 * card never mounted (and companions on the new core had already given up
 * their standalone seats — no local-agent card rendered at all).
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

/** Slot ledger reader: entry ids currently on the Plugins-page item list. */
function pluginItemIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('plugins.item').map(entry => entry.options.id)
}

/**
 * Boot the browser half over a real slot tree that declares the header list
 * and the plugins.item list. No configForms service on purpose: the family
 * card must register on every host line the bundle loads on.
 */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'plugins.item': { kind: 'list', scope: 'root' },
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

  it('registers the「本机 Agent 委派」family card on the Plugins page unconditionally — no configForms service needed — and fiber teardown removes it', async () => {
    const { ctx, fiber } = await bench()
    expect(pluginItemIds(ctx)).toContain('local-agent')
    await fiber.dispose()
    expect(pluginItemIds(ctx)).not.toContain('local-agent')
  })

  it('exposes the harness-card registry on the localAgentUi service', async () => {
    const { ctx } = await bench()
    const ui = ctx.get('localAgentUi')
    expect(typeof ui?.registerHarnessCard).toBe('function')
    expect(ui?.harnessCards?.()).toEqual([])
    const unregister = ui!.registerHarnessCard!({
      name: 'codex', order: 120, locale: 'local-agent-codex', label: () => 'Codex', render: () => null,
    })
    expect(ui!.harnessCards!().map(entry => entry.name)).toEqual(['codex'])
    unregister()
    expect(ui!.harnessCards!()).toEqual([])
  })
})
