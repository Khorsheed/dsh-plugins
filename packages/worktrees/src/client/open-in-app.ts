/**
 * Browser face of the official open-in-app capability (host 0.1.5,
 * `@deepseek-ai/dsh-host-open-in-app`): a once-per-page probe of the apps
 * route decides whether the external-open gestures render, and the gestures
 * themselves POST the open route. The route constants and wire payloads
 * mirror the official `./shared` module verbatim — the client bundle purity
 * gate forbids a value import of a host package, and a mirrored constant
 * degrades to "gestures hidden" rather than a boot failure if the host routes
 * ever move. A host without open-in-app answers the probe with 404 (or the
 * request fails outright), which reads exactly like "no apps": the gestures
 * stay hidden, silently. The same probe replaced the 0.1.2-line
 * `canOpenPath` host-description gate, which could never confirm on that
 * line (the capability had become an RPC probe).
 *
 * @module @khorsheed/dsh-worktrees/client
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** GET route serving the probed application ids (official shared.ts). */
export const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps'

/** POST route launching one application on one directory (official shared.ts). */
export const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open'

/** Apps-route response: catalog ids probed as installed, in menu order. */
export interface OpenInAppAppsPayload {
  readonly apps: readonly string[]
}

/** Open-route request body. */
export interface OpenInAppOpenPayload {
  readonly app: string
  readonly path: string
}

/** The published app-id feed: null until the host answered, the probed list after. */
export type OpenInAppSource = SnapshotStore<readonly string[] | null>

/**
 * Catalog ids (official catalog.ts) that open a directory in the host's file
 * manager. In catalog order, so the first present id is the platform's own
 * manager (Finder / Explorer / the Linux default handler).
 */
const FILE_MANAGER_IDS: readonly string[] = ['finder', 'explorer', 'filemanager']

/**
 * Pick the catalog id backing one gesture: the first listed id the host
 * probed as installed, or undefined when the host has none (the gesture hides).
 * @param apps - probed app ids in the host's menu order.
 * @param ids - candidate catalog ids in preference order.
 * @returns the chosen catalog id, or undefined.
 */
function pickApp(apps: readonly string[], ids: readonly string[]): string | undefined {
  return ids.find(id => apps.includes(id))
}

/**
 * The file-manager catalog id for the "open folder" gesture.
 * @param apps - probed app ids in the host's menu order.
 * @returns the chosen catalog id, or undefined when no file manager resolved.
 */
export function pickFileManager(apps: readonly string[]): string | undefined {
  return pickApp(apps, FILE_MANAGER_IDS)
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/**
 * Owns the once-per-page apps probe and the launch POST. The probe publishes
 * through a snapshot store: null until the host answered, the probed id list
 * after. A failed read publishes an empty list, which hides the gestures —
 * the same degrade the official header split button renders.
 */
export class OpenInAppProbe {
  /** Installed app ids in host menu order; null until the host answered. */
  readonly apps: OpenInAppSource = createSnapshotStore<readonly string[] | null>(null)

  private loading: Promise<void> | undefined

  /**
   * @param fetcher - HTTP carrier for the apps read and the launch POST.
   */
  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {}

  /**
   * Read availability once per probe life; concurrent calls share the read.
   * @returns after availability is published.
   */
  load(): Promise<void> {
    this.loading ??= this.run()
    return this.loading
  }

  /**
   * Launch one installed app on a directory.
   * @param appId - catalog id from the availability list.
   * @param path - an absolute directory path (the open route refuses files).
   * @returns true when the host acknowledged the launch, false on any failure.
   */
  async open(appId: string, path: string): Promise<boolean> {
    try {
      const body: OpenInAppOpenPayload = { app: appId, path }
      const response = await this.fetcher(new URL(OPEN_IN_APP_OPEN_ROUTE, hostBase()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.ok
    } catch {
      // Swallows network failures: a host that accepted the probe can still
      // vanish mid-session; the native app surfaces its own launch errors.
      return false
    }
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = []
    try {
      const response = await this.fetcher(new URL(OPEN_IN_APP_APPS_ROUTE, hostBase()), {
        headers: { accept: 'application/json' },
      })
      if (response.ok) {
        const payload = await response.json() as OpenInAppAppsPayload
        if (Array.isArray(payload.apps)) apps = payload.apps.filter(id => typeof id === 'string')
      }
    } catch {
      // Swallows network failures: a host without open-in-app (404) or an
      // unreachable host reads as no apps, and the gestures simply stay hidden.
    }
    this.apps.set(apps)
  }
}
