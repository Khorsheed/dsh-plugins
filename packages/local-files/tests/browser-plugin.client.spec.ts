// @vitest-environment jsdom
/**
 * The browser half on a real cordis Context with fake remote / locale / slots
 * / sidebarRightTabs faces: the plugin must land the `files` tab type in the
 * registry and its body in the keyed `sidebar.right.pane.tab` seat. Written
 * for the 673b1d7 regression where the sidebar entry silently vanished —
 * pinning the registration end to end beats re-deriving cordis resolution
 * rules by hand.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { LOCAL_FILES_KIND, LOCAL_FILES_TAB_ID } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'

/** Boot the plugin over fake faces; the tab-type registry records registrations. */
async function bench() {
  const ctx = new Context()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const mount = vi.fn(async () => () => {})
  Object.assign(ctx.remote, { $mount: mount })
  ctx.provide('remote.localFiles', {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const registered: SidebarRightTabDefinition[] = []
  ctx.provide('sidebarRightTabs', {
    register: (definition: SidebarRightTabDefinition) => {
      registered.push(definition)
      return () => { registered.splice(registered.indexOf(definition), 1) }
    },
  })
  await ctx.plugin(SlotRegistry).await()
  // Declare the target seat (normally declared by ui-sidebar-right).
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, mount, registered }
}

describe('local-files browser plugin', () => {
  it('registers the files tab type and its body in the pane seat', async () => {
    const b = await bench()
    expect(b.mount).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(b.registered.map(d => d.id)).toContain(LOCAL_FILES_TAB_ID)
    })
    const definition = b.registered.find(d => d.id === LOCAL_FILES_TAB_ID)
    expect(definition?.kind).toBe(LOCAL_FILES_KIND)
    await vi.waitFor(() => {
      const entries = b.ctx.slots.entries('sidebar.right.pane.tab')
      expect(entries.map(entry => entry.options.key)).toContain(LOCAL_FILES_TAB_ID)
    })
    await b.fiber.dispose()
    expect(b.registered).toHaveLength(0)
  })
})
