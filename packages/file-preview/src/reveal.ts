/**
 * Cross-platform native "show in folder, selecting the file" dispatch used by
 * the file-preview Remote's `reveal` method.
 *
 * The official host opener only opens a path with the default application —
 * it has no select-in-folder intent — so this plugin carries its own
 * shell-free dispatch: macOS `open -R` (Finder reveals and selects), Windows
 * `explorer /select,<path>` (Explorer reveals and selects), WSL translates the
 * path to the Windows spelling first, and desktop Linux tries the
 * select-capable file managers (`nautilus` / `dolphin` / `nemo` `--select`) in
 * order, falling back to the caller's parent-folder open when none is
 * installed. Every command runs through the official
 * `@deepseek-ai/dsh-native-command` runner — no shell, abort propagation.
 * @module @khorsheed/dsh-file-preview
 */

import { release as osRelease } from 'node:os'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** Injectable platform facts for deterministic adapter tests. */
export interface RevealInternals {
  platform?: NodeJS.Platform
  /** Kernel release override used to distinguish WSL from desktop Linux. */
  osRelease?: string
  /** Environment used for the WSL markers. */
  env?: NodeJS.ProcessEnv
  run?: NativeCommandRunner
}

/** Whether one environment marker is set to a non-empty value. */
function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** Distinguish WSL from desktop Linux using its process and kernel markers. */
function isWsl(internals: RevealInternals): boolean {
  const env = internals.env ?? process.env
  if (present(env.WSL_DISTRO_NAME) || present(env.WSL_INTEROP)) return true
  return (internals.osRelease ?? osRelease()).toLowerCase().includes('microsoft')
}

/** Desktop file managers with a documented `--select <path>` flag, tried in order. */
const SELECT_FILE_MANAGERS: readonly string[] = ['nautilus', 'dolphin', 'nemo']

/**
 * Reveal one path in the host file manager, opening its folder and selecting
 * the path. Throws when the platform cannot select (no select-capable file
 * manager, unsupported platform) — the caller then opens the parent folder.
 * @param path - absolute path in the host's execution world (caller owns
 *   resolution, typically `FileSystem.processPath`).
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - platform and environment seam for deterministic tests.
 */
export async function revealNativePath(
  path: string,
  signal: AbortSignal,
  internals: RevealInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand

  if (platform === 'linux' && isWsl(internals)) {
    const translated = await run('wslpath', ['-w', path], signal)
    signal.throwIfAborted()
    const windowsPath = translated.stdout.replace(/[\r\n]+$/, '')
    if (windowsPath === '') throw new Error('wslpath returned no Windows path')
    await run('explorer.exe', [`/select,${windowsPath}`], signal)
    return
  }
  if (platform === 'darwin') {
    await run('open', ['-R', path], signal)
    return
  }
  if (platform === 'win32') {
    await run('explorer.exe', [`/select,${path}`], signal)
    return
  }
  if (platform === 'linux') {
    let lastError: unknown
    for (const manager of SELECT_FILE_MANAGERS) {
      try {
        await run(manager, ['--select', path], signal)
        return
      } catch (error) {
        // A missing manager (ENOENT) or a failed launch: try the next one.
        lastError = error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('no select-capable file manager found')
  }
  throw new Error(`native path reveal is unsupported on ${platform}`)
}
