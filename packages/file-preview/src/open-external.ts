/**
 * Native "open this file in a specific application" dispatch used by the
 * file-preview Remote's `openExternal` method (the "open in IDE" gesture).
 *
 * The official open-in-app route (`POST /open-in-app/open`) only accepts
 * directories — a file path 404s — so file-exact opens carry their own
 * dispatch here. macOS only: `open -a <App> <path>` through the official
 * `@deepseek-ai/dsh-native-command` runner (no shell, abort propagation),
 * mirroring `reveal.ts`'s discipline. The browser picks the application by
 * official open-in-app catalog id (probed from `/open-in-app/apps`); the
 * id → `.app` name map below mirrors the official catalog's darwin entries
 * (packages/host/open-in-app/src/catalog.ts at 0.1.5-rc.1 — re-check on every
 * host upgrade). Other platforms and unknown ids answer unsupported, and the
 * client hides the gesture.
 * @module @khorsheed/dsh-file-preview
 */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** Injectable platform facts for deterministic adapter tests. */
export interface OpenExternalInternals {
  platform?: NodeJS.Platform
  run?: NativeCommandRunner
}

/** Official catalog id → macOS application name (darwin entries of the official catalog). */
const MAC_APP_NAMES: Readonly<Record<string, string>> = {
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

/** The application name one catalog id maps to, or undefined when unknown. */
export function macAppName(appId: string): string | undefined {
  return MAC_APP_NAMES[appId]
}

/**
 * Open one file in the named application. Throws when the platform is not
 * macOS or the catalog id is unknown — the caller maps both to an
 * `unsupported`/`unknown-app` answer and the client hides the gesture. A
 * launch failure propagates as the runner's rejection.
 * @param path - absolute path in the host's execution world (caller owns
 *   resolution, typically `FileSystem.processPath`).
 * @param appId - official open-in-app catalog id (e.g. `cursor`).
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - platform seam for deterministic tests.
 */
export async function openExternalNative(
  path: string,
  appId: string,
  signal: AbortSignal,
  internals: OpenExternalInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new Error(`open-in-app is unsupported on ${platform}`)
  }
  const app = macAppName(appId)
  if (app === undefined) throw new Error(`unknown application id "${appId}"`)
  const run = internals.run ?? runNativeCommand
  await run('open', ['-a', app, path], signal, 'visible')
}
