/**
 * The in-memory `ctx.fs` the manuscript specs run on: the board spec's fake
 * (version-guarded writes, the dsh-fs-sandbox fence with its mode, a subtree
 * remover standing in for `rm -r`), shared so a new spec does not grow a
 * sixth copy.
 */
import { dirname, join, normalize } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The fence one write carried, as the service passed it. */
export type SeenPolicy = { mode: string; workspaceRoot: string; sessionId?: string } | undefined

/** The deployment fallback root (a call with no policy lands here). */
export const HOST_CWD = '/host-cwd'

/** The minimal `ctx.fs` the services touch, over a path → entry map. */
export class FakeFs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]])
  private seq = 0

  /** Present only when this fake stands in for a confining backend (dsh-fs-sandbox). */
  sandboxMode: 'workspace-write' | 'read-only' | 'danger-full-access' | undefined

  /** The fence each write carried, in call order (the fifth `writeText` argument). */
  readonly policies: SeenPolicy[] = []

  /** Drop a whole subtree (stands in for the store's on-disk `rm -r`). */
  removeTree(path: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.entries.delete(key)
    }
  }

  /** Plant a file directly (setup for corruption cases). */
  seed(path: string, content: string): void {
    this.mkdirp(dirname(path))
    this.entries.set(path, { kind: 'file', content, version: ++this.seq })
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<string> {
    return path.startsWith('/') ? normalize(path) : normalize(join(opts?.cwd ?? '/', path))
  }

  processPath(target: string): string {
    return target
  }

  contains(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`)
  }

  async stat(target: string): Promise<{ version: string; type: 'file'; size: number } | undefined> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') return undefined
    return { version: String(entry.version), type: 'file', size: entry.content.length }
  }

  async readText(target: string): Promise<string> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') {
      throw new FsError(`no file at ${target}`, 'FS_NOT_FOUND')
    }
    return entry.content
  }

  async writeText(
    target: string,
    content: string,
    expected?: { kind: string; version?: string },
    _signal?: unknown,
    policy?: SeenPolicy,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    this.policies.push(policy)
    // Mirrors dsh-fs-sandbox's fence, mode included: read-only denies
    // everything; workspace-write contains under the policy's root (the
    // deployment's own when the call carries none).
    if (this.sandboxMode === 'read-only') {
      throw new FsError(`denied: ${target}`, 'FS_SANDBOX_DENIED')
    }
    if (this.sandboxMode !== undefined) {
      const root = policy?.workspaceRoot
        ?? (this.sandboxMode === 'danger-full-access' ? undefined : HOST_CWD)
      if (root !== undefined && target !== root && !target.startsWith(`${root}/`)) {
        throw new FsError(`denied: ${target}`, 'FS_SANDBOX_DENIED')
      }
    }
    const existing = this.entries.get(target)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`already exists: ${target}`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.kind !== 'file' || String(existing.version) !== expected.version) {
        throw new FsError(`stale: ${target}`, 'FS_STALE_VERSION')
      }
    }
    this.mkdirp(dirname(target))
    const before = existing !== undefined && existing.kind === 'file' ? existing.content : null
    this.entries.set(target, { kind: 'file', content, version: ++this.seq })
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: String(this.seq),
      before,
      after: content,
    }
  }

  async listDir(target: string): Promise<Array<{ name: string; type: 'file' | 'directory'; target: string }>> {
    if (this.entries.get(target) === undefined) {
      throw new FsError(`no directory at ${target}`, 'FS_NOT_FOUND')
    }
    const prefix = target === '/' ? '/' : `${target}/`
    const out = new Map<string, { name: string; type: 'file' | 'directory'; target: string }>()
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix) || path === target) continue
      const rest = path.slice(prefix.length)
      const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
      if (out.has(name)) continue
      const childPath = `${prefix}${name}`
      const isDirectory = rest.includes('/') || entry.kind === 'dir'
      out.set(name, { name, type: isDirectory ? 'directory' : 'file', target: childPath })
    }
    return [...out.values()]
  }

  private mkdirp(dir: string): void {
    if (dir === '/' || dir === '.') return
    if (this.entries.get(dir)?.kind === 'dir') return
    this.mkdirp(dirname(dir))
    this.entries.set(dir, { kind: 'dir' })
  }
}

