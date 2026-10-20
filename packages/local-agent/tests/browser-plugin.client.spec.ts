/**
 * ui-kimi plugin halves: the browser entry's dictionary and header-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the「本机 Agent 委派」
 * family card: one `plugins.item` entry gated on the core row's own served
 * namespace, with the harness-card registry exposed on the localAgentUi
 * service.
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
 * and the plugins.item list. `served` names the namespaces the configForms
 * stub's whileServed gate sees; 'legacy' boots without configForms at all
 * (the pre-alpha.2 line — the family card must stay silent there).
 */
async function bench(line: { served: readonly string[] } | 'legacy' = { served: ['local-agent'] }): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
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
  if (line !== 'legacy') {
    const served = new Set(line.served)
    ctx.provide('configForms', {
      get: () => { throw new Error('unused') },
      whileServed: (namespaces: readonly string[], register: () => () => void) =>
        namespaces.some(ns => served.has(ns)) ? register() : () => {},
    } as never)
  }
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

  it('registers the「本机 Agent 委派」family card on the Plugins page while the core row is served, and fiber teardown removes it', async () => {
    const { ctx, fiber } = await bench({ served: ['local-agent'] })
    expect(pluginItemIds(ctx)).toContain('local-agent')
    await fiber.dispose()
    expect(pluginItemIds(ctx)).not.toContain('local-agent')
  })

  it('registers no family card when the core row is not served, nor on the pre-configForms line', async () => {
    const { ctx } = await bench({ served: [] })
    expect(pluginItemIds(ctx)).toEqual([])
    const legacy = await bench('legacy')
    expect(pluginItemIds(legacy.ctx)).toEqual([])
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
