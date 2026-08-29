/**
 * Capability-catalog client plugin, browser half. Mounts the generated
 * `capabilityCatalog` Remote namespace and registers a standalone settings
 * section (`settings.section`) named 工具与技能, which lists the registered
 * skills as collapsible cards.
 * @module @khorsheed/dsh-capability-catalog/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-settings' SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the generated Remote namespace merge for capabilityCatalog.
import type {} from '@khorsheed/dsh-capability-catalog/remote'
import catalogRemote from '@khorsheed/dsh-capability-catalog/remote'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { CapabilityCatalogSnapshot } from '@khorsheed/dsh-capability-catalog/types'
import { en, NS, zh } from './locales.ts'
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
  readonly refresh: () => Promise<void>
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, and the
 * settings card.
 * @param ctx - client root context.
 * @returns disposer unwinding the mounted Remote namespace.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(catalogRemote))
  } catch (error) {
    ctx.logger.error(error)
  }
  const remote = ctx.get('remote.capabilityCatalog') as CapabilityCatalogRemote | undefined

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-catalog: dictionaries')
  const t = ctx.locale.bind(NS)

  // A tiny external store holding the last snapshot; refreshed on open.
  let snapshot: CapabilityCatalogSnapshot | undefined
  const listeners = new Set<() => void>()
  const refresh = async (): Promise<void> => {
    try {
      const carried = await remote?.snapshot(undefined)
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
    detail: async (name) => {
      const carried = await remote?.detail(name, undefined)
      return carried !== undefined && carried.ok ? carried.value : undefined
    },
    readSkillFile: async (name, path) => {
      const carried = await remote?.readSkillFile(name, path, undefined)
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
    deleteSkill: async (name) => {
      const carried = await remote?.deleteSkill(name, undefined)
      return carried !== undefined && carried.ok ? carried.value : { ok: false, error: 'remote absent' }
    },
    listSkillRoots: async () => {
      const carried = await remote?.listSkillRoots()
      return carried !== undefined && carried.ok ? carried.value : []
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
