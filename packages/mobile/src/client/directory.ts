import { DIRECTORY_PATH, type MobileDirectoryListing } from '../protocol.ts'

/** One pending path choice shared by every mobile caller of the Host picker. */
export class MobileDirectory {
  private pending: { promise: Promise<string | null>; resolve: (path: string | null) => void } | undefined
  private listeners = new Set<() => void>()
  readonly getSnapshot = () => !!this.pending
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly pick = (): Promise<string | null> => {
    if (!this.pending) {
      let resolve!: (path: string | null) => void
      const promise = new Promise<string | null>(done => { resolve = done })
      this.pending = { promise, resolve }
      for (const listener of this.listeners) listener()
    }
    return this.pending.promise
  }
  readonly finish = (path: string | null) => {
    const pending = this.pending; this.pending = undefined
    pending?.resolve(path)
    for (const listener of this.listeners) listener()
  }
  readonly list = async (path: string | undefined, signal: AbortSignal): Promise<MobileDirectoryListing> => {
    const response = await fetch(`${DIRECTORY_PATH}${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`, { signal, credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error('directory-unavailable')
    return response.json()
  }
}

/** Checked public-method fallback until Host offers a pure path-selection UI slot.
 * Scoped to this browser; preserve desktop dispatch and restore only our own wrapper. */
export function installMobileDirectoryPicker(owner: { pickDirectory(): Promise<string | null> }, directory: MobileDirectory, active: () => boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'pickDirectory')
  const original = owner.pickDirectory
  const wrapped = () => active() ? directory.pick() : original.call(owner)
  // A future read-only facade must not prevent the rest of mobile from loading.
  try { owner.pickDirectory = wrapped } catch { return () => { directory.finish(null) } }
  return () => {
    directory.finish(null)
    if (owner.pickDirectory !== wrapped) return
    if (descriptor) Object.defineProperty(owner, 'pickDirectory', descriptor)
    else Reflect.deleteProperty(owner, 'pickDirectory')
  }
}
