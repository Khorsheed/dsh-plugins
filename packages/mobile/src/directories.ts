import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { MobileDirectoryListing } from './protocol.ts'

/** Read-only companion for native-picker hosts; never changes the shared picker backend. */
export async function listMobileDirectory(path: string | undefined, signal: AbortSignal): Promise<MobileDirectoryListing> {
  if (path !== undefined && (!path || path.length > 4096 || path.includes('\0') || !isAbsolute(path)
    || (process.platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)))) throw new Error('invalid-path')
  signal.throwIfAborted()
  const target = resolve(path ?? homedir())
  const entries: MobileDirectoryListing['entries'] = []
  let scanned = 0, truncated = false
  for await (const entry of await opendir(target)) {
    signal.throwIfAborted()
    if (++scanned > 10000 || entries.length >= 1000) { truncated = true; break }
    const child = join(target, entry.name)
    if (entry.isDirectory() || (entry.isSymbolicLink() && await stat(child).then(s => s.isDirectory(), () => false))) {
      entries.push({ name: entry.name, path: child, hidden: entry.name.startsWith('.') })
    }
  }
  signal.throwIfAborted()
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return { path: target, parent: dirname(target) === target ? null : dirname(target), entries, truncated }
}

export async function directoryResponse(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).searchParams.get('path') ?? undefined
    return Response.json(await listMobileDirectory(path, request.signal), { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const invalid = error instanceof Error && error.message === 'invalid-path'
    return Response.json({ error: invalid ? 'invalid-path' : 'directory-unavailable' }, {
      status: request.signal.aborted ? 499 : invalid ? 400 : 422, headers: { 'cache-control': 'no-store' },
    })
  }
}
