/**
 * The blank-room registry: `createRoom`'s reuse-or-create memory. A room that
 * has never run a turn is blank under the official `sessionBlank` semantics
 * (no `turn/start` event), and the sidebar shows a blank session only while
 * it is current — so an invited-but-never-run room vanishes from the list on
 * refresh. The registry remembers exactly those blank rooms (sessionId → cwd
 * key) so a later「新建 Room」under the same cwd reuses the room instead of
 * stacking a new one. Entries leave the registry when the room stops being
 * blank (the host `session/event` listener drops the id on its first
 * `turn/start`) or prove stale at validation time (deleted session, log no
 * longer a room). Storage is one tiny JSON file at the harness home (the
 * bundle patch resolves it with `dshHomePath`, the same seam the session
 * backend's root uses); without a configured file the registry runs
 * in-memory — reuse survives within one boot.
 * @module @khorsheed/dsh-room/registry
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class BlankRoomRegistry {
  /** sessionId → cwd key ('' for a cwd-less room); undefined until first read. */
  private entries: Map<string, string> | undefined

  /**
   * @param file - the JSON backing file, or undefined for in-memory only.
   */
  constructor(private readonly file: string | undefined) {}

  /** Lazily read the backing file once; every later call hits the memory map. */
  private load(): Map<string, string> {
    if (this.entries !== undefined) return this.entries
    this.entries = new Map()
    if (this.file !== undefined) {
      try {
        const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
        if (typeof raw === 'object' && raw !== null) {
          for (const [id, cwd] of Object.entries(raw)) {
            if (typeof cwd === 'string') this.entries.set(id, cwd)
          }
        }
      } catch {
        // An absent or corrupt file is an empty registry, never a boot failure.
      }
    }
    return this.entries
  }

  /**
   * The registered blank-room ids under one cwd key.
   * @param cwd - the cwd key ('' matches cwd-less rooms).
   * @returns candidate session ids, oldest registration first.
   */
  ofCwd(cwd: string): string[] {
    const hits: string[] = []
    for (const [id, key] of this.load()) {
      if (key === cwd) hits.push(id)
    }
    return hits
  }

  /**
   * Register a freshly created blank room.
   * @param id - the room session id.
   * @param cwd - the cwd key ('' for none).
   */
  track(id: string, cwd: string): void {
    this.load().set(id, cwd)
    this.persist()
  }

  /**
   * Forget one id (turn started, stale record, archived reuse).
   * @param id - the session id.
   */
  drop(id: string): void {
    if (this.load().delete(id)) this.persist()
  }

  /** Rewrite the backing file (no-op for the in-memory registry). */
  private persist(): void {
    if (this.file === undefined) return
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.load())))
  }
}
