/**
 * Browser face of the official open-in-app capability (host 0.1.5,
 * `@deepseek-ai/dsh-host-open-in-app`): a once-per-page probe of the apps
 * route decides whether the products tab's folder/IDE gestures render, and
 * the folder fallback POSTs the open route. Mirrors local-files'
 * `open-in-app.ts` (the client bundle purity gate forbids a cross-plugin
 * value import); the route constants and wire payloads mirror the official
 * `./shared` module verbatim — a mirrored constant degrades to "gestures
 * hidden" rather than a boot failure if the host routes ever move. A host
 * without open-in-app answers the probe with 404 (or the request fails
 * outright), which reads exactly like "no apps": the gestures stay hidden,
 * silently.
 *
 * @module @khorsheed/dsh-client-ui-file-preview
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

/** Open-route request body (directories only — the route 404s a file path). */
export interface OpenInAppOpenPayload {
  readonly app: string
  readonly path: string
}

/**
 * Catalog ids (official catalog.ts) that open a directory in the host's file
 * manager. In catalog order, so the first present id is the platform's own
 * manager (Finder / Explorer / the Linux default handler).
 */
const FILE_MANAGER_IDS: readonly string[] = ['finder', 'explorer', 'filemanager']

/** Catalog ids (official catalog.ts) that open a directory in an editor or IDE, in catalog order. */
const IDE_IDS: readonly string[] = [
  'cursor', 'vscode', 'vscodeinsiders', 'windsurf', 'zed', 'sublimetext', 'xcode',
  'androidstudio', 'intellij', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rider', 'rustrover',
]

/**
 * The file-manager catalog id for the "open folder" gesture.
 * @param apps - probed app ids in the host's menu order.
 * @returns the chosen catalog id, or undefined when no file manager resolved.
 */
export function pickFileManager(apps: readonly string[]): string | undefined {
  return FILE_MANAGER_IDS.find(id => apps.includes(id))
}

/**
 * The editor/IDE catalog id for the "open in IDE" gesture.
 * @param apps - probed app ids in the host's menu order.
 * @returns the chosen catalog id, or undefined when no IDE resolved.
 */
export function pickIde(apps: readonly string[]): string | undefined {
  return IDE_IDS.find(id => apps.includes(id))
}

/** Display names per IDE catalog id (official catalog naming; proper nouns, not localized). */
const IDE_LABELS: Readonly<Record<string, string>> = {
  cursor: 'Cursor',
  vscode: 'Visual Studio Code',
  vscodeinsiders: 'Visual Studio Code - Insiders',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublimetext: 'Sublime Text',
  xcode: 'Xcode',
  androidstudio: 'Android Studio',
  intellij: 'IntelliJ IDEA',
  pycharm: 'PyCharm',
  webstorm: 'WebStorm',
  phpstorm: 'PhpStorm',
  goland: 'GoLand',
  rider: 'Rider',
  rustrover: 'RustRover',
}

/** One probed IDE entry for the split button's menu. */
export interface IdeChoice {
  readonly id: string
  readonly label: string
}

/**
 * Every probed IDE in catalog order, nameable ones only (a catalog id without
 * a known label stays invisible rather than showing a raw id — the official
 * OpenInAppAction's rule).
 * @param apps - probed app ids in the host's menu order.
 */
export function listIdes(apps: readonly string[]): readonly IdeChoice[] {
  return IDE_IDS.filter(id => apps.includes(id) && IDE_LABELS[id] !== undefined)
    .map(id => ({ id, label: IDE_LABELS[id]! }))
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/**
 * Owns the once-per-page apps probe and the folder-fallback POST. The probe
 * publishes through a snapshot store: null until the host answered, the
 * probed id list after. A failed read publishes an empty list, which hides
 * the gestures — the same degrade the official header split button renders.
 */
export class OpenInAppProbe {
  /** Installed app ids in host menu order; null until the host answered. */
  readonly apps: SnapshotStore<readonly string[] | null> = createSnapshotStore<readonly string[] | null>(null)

  private loading: Promise<void> | undefined

  /**
   * @param fetcher - HTTP carrier for the apps read and the folder POST.
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
