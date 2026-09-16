/**
 * The side-chat state store: `contexts.json` under the deployment state
 * root — the contextKey → agent-session mapping, display labels, the latest
 * consumer prompt segment, and the pending refs. One version-guarded JSON
 * document, read and written as a whole (the canvas board's own pattern,
 * scaled down to a mapping file).
 *
 * The fence is the canvas `store.ts` precedent, NOT datasets' bare `node:fs`:
 * the state dir is deployment-level state that no session workspace can hold,
 * so writes keep the mounted `ctx.fs` (version guards, atomic writes, the
 * observation trail) and re-root the writable boundary at the plugin's own
 * state dir. The calling session — when a wire gesture carries one — resolves
 * the MODE (a read-only session still denies) and lends its id; host-side
 * calls with no session resolve the deployment default mode. Either way the
 * boundary is exactly the plugin's state root, and bare `node:fs` appears
 * nowhere here.
 *
 * A composition without `ctx.fs` degrades to memory-only state: the service
 * keeps working, the mapping simply does not survive a restart.
 *
 * @module @khorsheed/dsh-sidechat/store
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, type FsTarget, type FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  emptyContextsDoc, normalizeContextsDoc, SIDECHAT_CONTEXTS_FILE_NAME, SIDECHAT_STATE_DIR_NAME,
  type SideChatContextsDoc,
} from './types.ts'

/**
 * Resolve the side-chat state root (the datasets `defaults.ts` precedent): an
 * explicit value wins, then `$DSH_HOME/state/sidechat`, then
 * `<cwd>/.dsh-sidechat`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the state root directory.
 */
export function resolveSideChatStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', SIDECHAT_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-sidechat')
}

/** The document as one JSON text (the canvas board's trailing-newline shape). */
function serializeDoc(doc: SideChatContextsDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** The store's read result: the document plus the freshness token the next write presents. */
export interface SideChatStoreRead {
  readonly doc: SideChatContextsDoc
  /** The fs version token; `null` means the file does not exist yet. */
  readonly version: FsVersion | null
}

/** Thrown when the file exists but does not parse — never clobbered, the canvas rule. */
export class SideChatStoreError extends Error {
  constructor(message: string, readonly code: 'io') {
    super(message)
    this.name = 'SideChatStoreError'
  }
}

/**
 * The contexts document's IO core. Stateless apart from the borrowed context
 * (the mounted filesystem is probed once) and the state root it fences at.
 */
export class SideChatStore {
  /** The resolved state root (also the writable boundary of every fence). */
  readonly stateRoot: string

  /** The mounted filesystem, or `undefined` when the composition mounts none. */
  private readonly fs: Context['fs'] | undefined

  /** The per-session policy home, captured only when the mounted filesystem actually confines. */
  private readonly sandboxPolicy: SandboxPolicyService | undefined

  /**
   * @param ctx - host context (the filesystem is probed, never injected).
   * @param config - optional state-root override.
   */
  constructor(ctx: Context, config: { stateRoot?: string } = {}) {
    this.stateRoot = resolveSideChatStateRoot(config.stateRoot)
    this.fs = ctx.get('fs')
    this.sandboxPolicy = this.fs?.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  }

  /** Whether persistence is available at all (without it the service runs memory-only). */
  get available(): boolean {
    return this.fs !== undefined
  }

  /** The `contexts.json` target under the state root. */
  private target(): Promise<FsTarget> {
    if (this.fs === undefined) throw new SideChatStoreError('sidechat: no filesystem is mounted', 'io')
    return this.fs.resolve(join(this.stateRoot, SIDECHAT_CONTEXTS_FILE_NAME))
  }

  /**
   * The policy one write carries: the caller's session — when there is one —
   * resolves the MODE and stamps its id, while the writable boundary is the
   * plugin's state root. Without a session (a host-side `openWith`) the
   * deployment default mode applies; a read-only deployment still denies.
   * `undefined` means the mounted backend does not confine.
   * @param session - the session that owns the gesture, when one carried it.
   * @returns the policy to stamp onto the call.
   */
  private policyOf(session: Session | undefined): SandboxExecutionPolicy | undefined {
    const resolved = this.sandboxPolicy?.resolve(session === undefined ? {} : { session })
    if (resolved === undefined) return undefined
    return { ...resolved, workspaceRoot: this.stateRoot }
  }

  /**
   * Read the document tolerantly. A missing file reads as the empty document
   * with a `null` token; a corrupt one refuses with `io` (never rewritten —
   * an operator's hand-edit stays visible until fixed).
   * @returns the document and its freshness token.
   */
  async read(): Promise<SideChatStoreRead> {
    if (this.fs === undefined) return { doc: emptyContextsDoc(), version: null }
    let target: FsTarget
    try {
      target = await this.target()
    } catch (error) {
      if (error instanceof FsError) return { doc: emptyContextsDoc(), version: null }
      throw error
    }
    const info = await this.fs.stat(target)
    if (info === undefined || info.type !== 'file') return { doc: emptyContextsDoc(), version: null }
    try {
      return { doc: normalizeContextsDoc(JSON.parse(await this.fs.readText(target))), version: info.version }
    } catch (error) {
      if (error instanceof FsError) throw error
      throw new SideChatStoreError(
        `sidechat: ${target.displayPath} does not parse — fix or remove it by hand`,
        'io',
      )
    }
  }

  /**
   * Write the document under the version guard from the last read (the state
   * dir's parents are the mounted backend's business, the canvas pad's own
   * reliance). A stale token surfaces as `FS_STALE_VERSION` for the caller's
   * one re-apply.
   * @param doc - the document to publish.
   * @param version - the token the last read returned (`null` for first write).
   * @param session - the session that owns the gesture, when one carried it.
   * @returns the new freshness token.
   */
  async write(doc: SideChatContextsDoc, version: FsVersion | null, session: Session | undefined): Promise<FsVersion> {
    if (this.fs === undefined) throw new SideChatStoreError('sidechat: no filesystem is mounted', 'io')
    const receipt = await this.fs.writeText(
      await this.target(),
      serializeDoc(doc),
      version === null ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version },
      undefined,
      this.policyOf(session),
    )
    return receipt.version
  }
}
