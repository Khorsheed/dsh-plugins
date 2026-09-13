/**
 * The canvas service core: the pad's data face. `ctx.canvasStore` exposes
 * this; the Remote service is a thin adapter that delegates here, and the
 * browser half never touches the filesystem itself.
 *
 * Every path goes through the mounted `ctx.fs`, so the deployment's sandbox
 * mode fences each write and the observation policy sees every mutation. A
 * mutation also stamps the CALLING SESSION's resolved policy onto the write:
 * a fenced backend given no per-call policy falls back to the deployment's own
 * workspace root (`process.cwd()` of the host process), which is not the
 * caller's workspace, so `workspace-write` would deny every pad file. The
 * service never deletes: the archive set lives in the pad's own `.index.json`
 * (the same shape the official workspace registry uses to hide an archived
 * session) and leaves the file — the pad's items are the operator's documents
 * first and the plugin's records second.
 *
 * @module @khorsheed/dsh-canvas
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, FsVersion, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  CANVAS_KINDS, EMPTY_INDEX, INDEX_FILE_NAME, PAD_DIR_NAME,
  kindDirectoryName, kindOfItemName, normalizeIndex, orderItemNames,
  itemNameOf, sanitizeItemTitle, titleOfItemName,
  type CanvasArchiveRequest, type CanvasArchiveResult, type CanvasCreateRequest,
  type CanvasError, type CanvasIndex, type CanvasListItem, type CanvasListResult,
  type CanvasReadOutcome, type CanvasReadRequest,
  type CanvasWriteRequest, type CanvasWriteResult,
} from './types.ts'

export type * from './types.ts'
export {
  PAD_DIR_NAME, ARTICLE_DIR_NAME, CARD_DIR_NAME, INDEX_FILE_NAME, ITEM_EXTENSION,
} from './types.ts'

/**
 * Map one filesystem failure onto the wire vocabulary. Only the error code is
 * consulted — the message stays host-side.
 * @param error - whatever `ctx.fs` threw.
 * @returns the shared error code.
 */
export function canvasErrorOf(error: unknown): CanvasError {
  if (error instanceof FsError) {
    switch (error.code) {
      case 'FS_STALE_VERSION': return 'stale'
      // `createIfAbsent` reports an existing target this way (dsh-fs types.ts).
      case 'FS_NOT_OBSERVED': return 'exists'
      case 'FS_NOT_FOUND': return 'missing'
      case 'FS_SANDBOX_DENIED':
      case 'FS_PERMISSION_DENIED': return 'denied'
      default: return 'io'
    }
  }
  return 'io'
}

/**
 * The inspiration pad's service core. Stateless apart from the context it
 * borrows for `ctx.fs` and the policy home it resolves each caller's fence
 * through.
 */
export class CanvasService {
  static inject = ['fs']

  /**
   * The per-session policy home, captured only when the mounted filesystem
   * actually confines: the bare local backend has no policy to resolve, and
   * every write there is unfenced by construction. The read is lazy, so a
   * composition that mounts the confining backend without the policy home
   * (which no graded deployment does) still loads and simply writes unfenced
   * by policy — the backend's own fallback then decides.
   */
  private readonly sandboxPolicy: SandboxPolicyService | undefined

  /** @param ctx - host context carrying the mounted filesystem. */
  constructor(private readonly ctx: Context) {
    this.sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  }

  private get fs(): Context['fs'] {
    return this.ctx.fs
  }

  /**
   * The policy one mutation must carry: the caller's own session resolves the
   * mode and the workspace boundary (the pad lives inside that workspace), and
   * `undefined` means the mounted backend does not confine.
   * @param session - the session that owns the gesture.
   * @returns the policy to stamp onto the call.
   */
  private policyOf(session: Session): SandboxExecutionPolicy | undefined {
    return this.sandboxPolicy?.resolve({ session })
  }

  /** The pad directory for one workspace root. */
  private padRoot(dir: string): string {
    return join(dir, PAD_DIR_NAME)
  }

  /**
   * Resolve one item name inside the pad, refusing anything that is not a
   * two-segment `<kindDir>/<title>.md` name or that resolves outside the pad.
   * @param dir - workspace root.
   * @param name - pad-relative item name.
   * @returns the resolved target, or undefined when the name is not usable.
   */
  private async itemTarget(dir: string, name: string): Promise<FsTarget | undefined> {
    if (kindOfItemName(name) === undefined) return undefined
    const pad = await this.fs.resolve(this.padRoot(dir))
    const target = await this.fs.resolve(name, { cwd: this.padRoot(dir) })
    if (!this.fs.contains(pad, target)) return undefined
    return target
  }

  /** Read the pad index, degrading to empty on absence or unreadable content. */
  private async readIndex(dir: string): Promise<CanvasIndex> {
    try {
      const target = await this.fs.resolve(INDEX_FILE_NAME, { cwd: this.padRoot(dir) })
      const info = await this.fs.stat(target)
      if (info === undefined) return EMPTY_INDEX
      return normalizeIndex(JSON.parse(await this.fs.readText(target)))
    } catch {
      return EMPTY_INDEX
    }
  }

  /**
   * Write the pad index; `writeText` creates the pad directory on the way.
   * @param dir - workspace root.
   * @param index - the index to persist.
   * @param policy - the fence this caller resolves to, already resolved once.
   */
  private async writeIndex(dir: string, index: CanvasIndex, policy: SandboxExecutionPolicy | undefined): Promise<void> {
    const target = await this.fs.resolve(INDEX_FILE_NAME, { cwd: this.padRoot(dir) })
    // `expected` and `signal` are positional: the policy is the fifth argument.
    await this.fs.writeText(target, `${JSON.stringify(index, null, 2)}\n`, undefined, undefined, policy)
  }

  /**
   * Record a freshly created name at the head of the display order. Editing an
   * item already in the order changes nothing, so an edit never reorders the
   * pad — and unarchiving restores the position the index already holds.
   * @param dir - workspace root.
   * @param name - the pad-relative item name just created.
   * @param policy - the fence this caller resolves to, already resolved once.
   */
  private async remember(dir: string, name: string, policy: SandboxExecutionPolicy | undefined): Promise<void> {
    const index = await this.readIndex(dir)
    if (index.order.includes(name)) return
    await this.writeIndex(dir, { order: [name, ...index.order], archivedIds: index.archivedIds }, policy)
  }

  /**
   * List one workspace's pad. A missing pad (no item ever written) is an empty
   * list, not an error.
   * @param dir - absolute workspace root.
   * @returns active items and the archive set, each in display order.
   */
  async list(dir: string): Promise<CanvasListResult> {
    const index = await this.readIndex(dir)
    const names: string[] = []
    for (const kind of CANVAS_KINDS) {
      const directory = kindDirectoryName(kind)
      const entries = await this.fs
        .listDir(await this.fs.resolve(directory, { cwd: this.padRoot(dir) }))
        .catch(() => [])
      for (const entry of entries) {
        if (entry.type !== 'file') continue
        const name = `${directory}/${entry.name}`
        if (kindOfItemName(name) === undefined) continue
        names.push(name)
      }
    }
    const archivedSet = new Set(index.archivedIds)
    const items: CanvasListItem[] = []
    const archived: CanvasListItem[] = []
    for (const name of orderItemNames(names, index.order)) {
      const target = await this.itemTarget(dir, name)
      /* v8 ignore next -- `name` came from a listed kind directory, so it always resolves */
      if (target === undefined) continue
      const info = await this.fs.stat(target)
      const item: CanvasListItem = {
        name,
        title: titleOfItemName(name),
        kind: kindOfItemName(name)!,
        archived: archivedSet.has(name),
        absolutePath: this.fs.processPath(target),
        relativePath: join(PAD_DIR_NAME, name),
        size: info?.size ?? null,
      }
      if (item.archived) archived.push(item)
      else items.push(item)
    }
    return { items, archived }
  }

  /**
   * Read one item's text with the freshness token a later write must present.
   * @param request - workspace root and pad-relative name.
   * @returns the item, or the failure code.
   */
  async read(request: CanvasReadRequest): Promise<CanvasReadOutcome> {
    try {
      const target = await this.itemTarget(request.dir, request.name)
      if (target === undefined) return { ok: false, error: 'invalid-name' }
      const info = await this.fs.stat(target)
      if (info === undefined) return { ok: false, error: 'missing' }
      return {
        ok: true,
        content: await this.fs.readText(target),
        version: info.version,
        absolutePath: this.fs.processPath(target),
        relativePath: join(PAD_DIR_NAME, request.name),
      }
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
    }
  }

  /**
   * Create one item. A title that already exists is refused with `exists`
   * rather than silently overwritten — that is the whole of the name-collision
   * rule.
   * @param request - workspace root, kind, title, and initial body.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the new item's receipt, or the failure code.
   */
  async create(request: CanvasCreateRequest, session: Session): Promise<CanvasWriteResult> {
    const title = sanitizeItemTitle(request.title)
    if (title === undefined) return { ok: false, error: 'invalid-name' }
    return this.writeGuarded(request.dir, itemNameOf(request.kind, title), request.content, undefined, session)
  }

  /**
   * Overwrite one item under a version guard. A stale version is refused —
   * never overwritten unconditionally.
   * @param request - workspace root, name, body, and the version last read.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the write receipt, or the failure code.
   */
  async write(request: CanvasWriteRequest, session: Session): Promise<CanvasWriteResult> {
    return this.writeGuarded(request.dir, request.name, request.content, request.version, session)
  }

  /** The one place a pad file is written; `version` absent means create. */
  private async writeGuarded(
    dir: string,
    name: string,
    content: string,
    version: string | undefined,
    session: Session,
  ): Promise<CanvasWriteResult> {
    const target = await this.itemTarget(dir, name)
    if (target === undefined) return { ok: false, error: 'invalid-name' }
    const policy = this.policyOf(session)
    try {
      // The token crossed the wire as a string; re-branding it is the only way
      // to hand it back to `writeText`, and it still came from a real stat.
      const expected = version === undefined
        ? { kind: 'createIfAbsent' as const }
        : { kind: 'replaceIfVersion' as const, version: FsVersion(version) }
      const outcome = await this.fs.writeText(target, content, expected, undefined, policy)
      if (outcome.operation === 'create') {
        try {
          await this.remember(dir, name, policy)
        } catch {
          // The body landed; a failed index write only costs display order.
        }
      }
      return {
        ok: true,
        name,
        title: titleOfItemName(name),
        version: outcome.version,
        operation: outcome.operation,
        absolutePath: this.fs.processPath(target),
        relativePath: join(PAD_DIR_NAME, name),
      }
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
    }
  }

  /**
   * Move one item in or out of the archive set. The file is not touched: this
   * is the official session-archive semantics ("hide from grouping surfaces"),
   * applied to a pad item.
   * @param request - workspace root, name, and the target archived state.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async setArchived(request: CanvasArchiveRequest, session: Session): Promise<CanvasArchiveResult> {
    if (kindOfItemName(request.name) === undefined) return { ok: false, error: 'invalid-name' }
    const policy = this.policyOf(session)
    try {
      const index = await this.readIndex(request.dir)
      const already = index.archivedIds.includes(request.name)
      if (already === request.archived) return { ok: true }
      const archivedIds = request.archived
        ? [...index.archivedIds, request.name]
        : index.archivedIds.filter(name => name !== request.name)
      const order = index.order.includes(request.name)
        ? index.order
        : [request.name, ...index.order]
      await this.writeIndex(request.dir, { order, archivedIds }, policy)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: canvasErrorOf(error) }
    }
  }
}

export default CanvasService
