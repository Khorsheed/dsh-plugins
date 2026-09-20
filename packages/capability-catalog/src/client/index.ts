/**
 * Capability-catalog client plugin, browser half. Mounts the generated
 * `capabilityCatalog` Remote namespace and registers a standalone settings
 * section (`settings.section`) named 工具与技能, which lists the registered
 * skills as collapsible cards.
 * @module @khorsheed/dsh-capability-catalog/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-settings' SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the generated Remote namespace merge for capabilityCatalog.
import type {} from '@khorsheed/dsh-capability-catalog/remote'
import catalogRemote from '@khorsheed/dsh-capability-catalog/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { CapabilityCatalogSnapshot } from '@khorsheed/dsh-capability-catalog/types'
import { en, NS, zh } from './locales.ts'
import { refreshUntilSettled } from './settle.ts'
import type { CapabilityCatalogInjected } from './slots.ts'
import { CapabilityCatalogCard } from './CapabilityCatalogCard.tsx'

/** The capabilityCatalog Remote namespace, as mounted by this plugin. */
export type CapabilityCatalogRemote = TypertRemoteNamespaceMap['capabilityCatalog']

/** Required services: the slot ledger, the remote channel, and the copy. */
export const inject = ['slots', 'remote', 'locale']

/** A hook storing the last catalog snapshot (re-created on structure change). */
interface CatalogHook {
  readonly getSnapshot: () => CapabilityCatalogSnapshot | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly refresh: (presetId?: string) => Promise<void>
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, and the
 * settings card.
 * @param ctx - client root context.
 * @returns disposer unwinding the mounted Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(catalogRemote))
  } catch (error) {
    ctx.logger.error(error)
  }
  const remote = ctx.get('remote.capabilityCatalog') as CapabilityCatalogRemote | undefined

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-catalog: dictionaries')
  const t = ctx.locale.bind(NS)

  // A tiny external store holding the last snapshot; refreshed on open and on
  // every mode switch. `presetId` names the MODE the grid is showing: it rides
  // into the scope of the read, so the panel's data and its mode control can
  // never disagree about which face is on screen.
  let snapshot: CapabilityCatalogSnapshot | undefined
  const listeners = new Set<() => void>()
  const refresh = async (presetId?: string): Promise<void> => {
    try {
      const carried = await remote?.snapshotAt(presetId, undefined)
      if (carried === undefined || !carried.ok) return
      snapshot = carried.value
      for (const l of [...listeners]) l()
    } catch (error) {
      ctx.logger.error(error)
    }
  }
  const catalogHook: CatalogHook = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
  }

  const injected: CapabilityCatalogInjected = {
    hooks: {
      catalog: catalogHook,
    },
    refresh,
    // A skill write reaches the registry through the host's watcher, a moment
    // after the operation returns; one refresh therefore reads stale rows.
    refreshSettled: (settled, presetId) => refreshUntilSettled(() => snapshot, () => refresh(presetId), settled),
    detail: async (name, presetId) => {
      const carried = await remote?.detail(name, undefined, presetId)
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    readSkillFile: async (name, path, presetId) => {
      const carried = await remote?.readSkillFile(name, path, undefined, presetId)
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    listDirSkills: async (dirPath) => {
      const carried = await remote?.listDirSkills(dirPath)
      return carried !== undefined && carried.ok ? carried.value : []
    },
    setCredential: async (key, value) => {
      const carried = await remote?.setCredential({ key, value })
      return carried !== undefined && carried.ok ? carried.value : false
    },
    addSkill: async (request) => {
      const carried = await remote?.addSkill(request)
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
    deleteSkill: async (name, presetId) => {
      const carried = await remote?.deleteSkill(name, undefined, presetId)
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
    pickDirectory: async () => {
      const carried = await remote?.pickDirectory()
      return carried !== undefined && carried.ok ? carried.value : null
    },
    modeFaces: async () => {
      const carried = await remote?.modeFaces(undefined)
      return carried !== undefined && carried.ok ? carried.value : []
    },
    mcpSnapshot: async () => {
      const carried = await remote?.mcpSnapshot()
      return carried !== undefined && carried.ok ? carried.value : { servers: [], tools: {}, credentials: [] }
    },
    mcpAdd: async (config) => {
      const carried = await remote?.mcpAdd(config)
      return carried !== undefined && carried.ok ? carried.value : false
    },
    mcpRemove: async (serverName) => {
      const carried = await remote?.mcpRemove(serverName)
      return carried !== undefined && carried.ok ? carried.value : false
    },
    mcpSetEnabled: async (serverName, enabled) => {
      const carried = await remote?.mcpSetEnabled(serverName, enabled)
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    mcpSetCredential: async (ref, value) => {
      const carried = await remote?.mcpSetCredential(ref, value)
      return carried !== undefined && carried.ok ? carried.value : false
    },
    mcpSetToolEnabled: async (serverName, tool, enabled) => {
      const carried = await remote?.mcpSetToolEnabled(serverName, tool, enabled)
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    mcpDiscover: async (serverName) => {
      const carried = await remote?.mcpDiscover(serverName)
      return carried !== undefined && carried.ok ? carried.value : []
    },
    presetScopeStatus: async () => {
      const carried = await remote?.presetScopeStatus()
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    presetScopeRoster: async () => {
      const carried = await remote?.presetScopeRoster()
      return carried !== undefined && carried.ok ? carried.value : []
    },
    presetScopeSet: async (name, presets) => {
      const carried = await remote?.presetScopeSet({ name, presets })
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
    presetScopeAdopt: async (name, presets) => {
      const carried = await remote?.presetScopeAdopt({ name, presets })
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
    presetScopeRelease: async (name) => {
      const carried = await remote?.presetScopeRelease(name)
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
  }

  void refresh()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'capabilities',
    // After the Plugins section (order 15).
    order: 20,
    label: () => t('section.nav'),
    locale: NS,
    inject: (): CapabilityCatalogInjected => injected,
  }, CapabilityCatalogCard))

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
