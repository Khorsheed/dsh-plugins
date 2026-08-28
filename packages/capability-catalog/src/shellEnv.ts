/**
 * Skill env injection via the official `ctx.shellEnv` seam.
 *
 * The catalog lets a user configure a credential for a skill's declared env var
 * (e.g. `$WEREED_API_KEY`), stored in the dsh credential store. That value is
 * NOT in `process.env` — the launch env is a read-only snapshot and never
 * injects credentials. To make it reach the model's shell execution without a
 * host change, we register a `ctx.shellEnv` contributor that exposes the value
 * as a trusted, per-execution `DSH_<KEY>` variable.
 *
 * Constraints (shell-env/src/index.ts): keys must start `DSH_` and match
 * `/^[A-Z][A-Z0-9_]*$/`; one owner per key; reserved built-ins
 * (`DSH_HOME`/`DSH_SHELL`/`DSH_SESSION_ID`) are not ownable, and `resolve()`
 * must be synchronous. Reading the credential store is async, so this module
 * keeps a synchronous cache (`envCache`) populated by refreshing the cache on
 * apply and on every `credentials/*-updated` event plus the catalog's own
 * `setCredential`; `resolve()` only reads that cache.
 *
 * Security note: this makes the value visible to the model-driven shell (an
 * `echo $DSH_*` would reveal it) — the catalog also exposes the same credential
 * to the model via `credentials` anyway. For "never let the model read the raw
 * value", prefer a catalog-owned narrow tool that reads it internally.
 * @module @khorsheed/dsh-capability-catalog/shellEnv
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { decodeCredentialDecls, decodeEnvDecls, mergeCredentialDecls } from './skills.ts'

const DSH_PREFIX = 'DSH_'
const ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/** The `ctx.shellEnv` registry slice this module consumes (optional). */
export interface ShellEnvRegistryLike {
  register: (contributor: {
    name: string
    variables: Record<string, { description: string }>
    resolve: (execution: unknown) => Record<string, string>
  }) => () => void
}

/** The credential-store slice this module reads (optional). */
interface CredentialStoreSlice {
  readRecord: (
    key: string,
  ) => Promise<{ kind: 'api-key'; key?: string; env?: Readonly<Record<string, string>> } | { kind: 'grant'; payload: unknown } | undefined>
}

/** The skills-registry slice this module reads (optional). */
interface SkillRegistrySlice {
  snapshot: (options?: { cwd?: string; scope?: unknown; signal?: AbortSignal }) => Promise<{
    readonly skills: readonly { readonly name: string }[]
    readonly complete: boolean
  }>
  get: (name: string, options?: { cwd?: string; scope?: unknown; signal?: AbortSignal }) => Promise<{
    readonly content?: string
    readonly metadata?: Readonly<Record<string, unknown>>
  } | undefined>
}

/**
 * Install the skill env injection contributor. Returns a disposer for the
 * resources this call owns; the `ctx.on` and `shellEnv.register` disposers are
 * additionally effect-scoped to the calling fiber, so they also auto-clean.
 * Degrades silently (a no-op) when `shellEnv`, `credentials`, or `skills` is
 * absent in the composition.
 */
export function installSkillEnvInjection(ctx: Context, getScope: () => Promise<unknown | undefined>): () => void {
  const shellEnv = ctx.get?.('shellEnv') as ShellEnvRegistryLike | undefined
  const credentials = ctx.get?.('credentials') as CredentialStoreSlice | undefined
  const skills = ctx.get?.('skills') as SkillRegistrySlice | undefined
  if (shellEnv?.register === undefined || credentials === undefined || skills === undefined) {
    return () => {}
  }

  let disposed = false
  let envCache = new Map<string, string>()
  let disposeEnv: (() => void) | undefined
  let refreshKey: string | undefined

  /** Recompute the declared keys + cached values; re-register on key-set change. */
  const refresh = async (): Promise<void> => {
    if (disposed) return
    const scope = await getScope().catch(() => undefined)
    const snapshotOptions = scope === undefined ? {} : { scope }
    try {
      const snapshot = await skills.snapshot(snapshotOptions)
      const keys = new Set<string>()
      const values = new Map<string, string>()
      for (const row of snapshot.skills) {
        let def
        try {
          def = await skills.get(row.name, snapshotOptions)
        } catch {
          continue
        }
        if (def === undefined) continue
        const decls = mergeCredentialDecls(
          decodeCredentialDecls(def.metadata),
          decodeEnvDecls(def.content ?? ''),
        )
        for (const decl of decls) {
          if (!ENV_KEY_SUFFIX.test(decl.key)) continue
          keys.add(decl.key)
          const record = await credentials.readRecord(decl.key).catch(() => undefined)
          if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key.length > 0) {
            values.set(`${DSH_PREFIX}${decl.key}`, record.key)
          }
        }
      }
      envCache = values

      const keySet = [...keys].sort().join('\n')
      if (keySet !== refreshKey) {
        disposeEnv?.()
        const variables: Record<string, { description: string }> = {}
        for (const k of keys) {
          variables[`${DSH_PREFIX}${k}`] = { description: `Configured via the capability catalog for skill env \`${k}\`` }
        }
        disposeEnv = shellEnv.register({
          name: 'capability-catalog',
          variables,
          resolve: () => {
            const out: Record<string, string> = {}
            for (const [k, v] of envCache) {
              if (Object.hasOwn(variables, k)) out[k] = v
            }
            return out
          },
        })
        refreshKey = keySet
      }
    } catch (err) {
      ctx.logger.warn(`capability-catalog: skill env injection refresh failed (${String(err)})`)
    }
  }

  void refresh()
  const offRecord = ctx.on('credentials/record-updated', () => { void refresh() })
  const offReference = ctx.on('credentials/reference-updated', () => { void refresh() })

  return () => {
    disposed = true
    disposeEnv?.()
    offRecord()
    offReference()
  }
}

export { DSH_PREFIX }
