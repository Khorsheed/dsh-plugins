/**
 * Skill env injection via the official `ctx.shellEnv` seam (service-agnostic).
 *
 * The catalog lets a user configure a credential for a skill's declared env var
 * (e.g. `$WEREED_API_KEY`). That value is NOT in `process.env` — the launch env
 * is a read-only snapshot and never injects credentials. This module registers
 * a `ctx.shellEnv` contributor that exposes each configured credential as a
 * trusted, per-execution `DSH_<KEY>` variable. The model references it by shell
 * expansion (`--key="$DSH_WEREED_API_KEY"`) so the raw value never enters the
 * model's context; it only becomes visible if the model (or a command) actively
 * prints it — a default-hide, not a hard secret boundary.
 *
 * Constraint handling (shell-env/src/index.ts):
 * - keys must start `DSH_` and match `/^[A-Z][A-Z0-9_]*$/`; one owner per key;
 *   reserved built-ins (`DSH_HOME`/`DSH_SHELL`/`DSH_SESSION_ID`) are not ownable.
 * - `resolve()` is synchronous; credential reads are async, so values live in a
 *   cache (`envCache`) refreshed on apply + on `credentials/*-updated`.
 *
 * Robustness (addressed for the review):
 * - read the ref namespace: `credentials.resolve(credentialRef(key))` (value from
 *   the .credentials store that `setCredential` writes) — never `readRecord`.
 * - filter env keys that map onto reserved (`HOME`/`SHELL`/`SESSION_ID`) or are
 *   already owned by another contributor (e.g. `DSH_SESSION_JSONL`) so a single
 *   bad/conflicting key cannot break the whole registration; skip + warn.
 * - use a *declared superset*: register the full valid key set once and keep it;
 *   deleting a credential just makes `resolve` return empty (no delete-then-
 *   re-register window). Re-register only when the key SET changes.
 * - serialise refresh (single in-flight + queued) and gate commits on a
 *   generation counter + `disposed` so a stale run cannot overwrite or
 *   re-register after dispose.
 * @module @khorsheed/dsh-capability-catalog/shellEnv
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { decodeCredentialDecls, decodeEnvDecls, mergeCredentialDecls } from './skills.ts'

const DSH_PREFIX = 'DSH_'
const ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/
/** Env keys that would map onto reserved built-in DSH_* variables. */
const RESERVED_ENV_KEYS = new Set(['HOME', 'SHELL', 'SESSION_ID'])

/** The `ctx.shellEnv` registry slice this module consumes (optional). */
export interface ShellEnvRegistryLike {
  register: (contributor: {
    name: string
    variables: Record<string, { description: string }>
    resolve: (execution: unknown) => Record<string, string>
  }) => () => void
  list: () => readonly { readonly key: string; readonly contributor: string }[]
}

/** The credential-store slice this module reads (optional; ref namespace). */
interface CredentialStoreSlice {
  resolve: (ref: unknown) => Promise<{ readonly value: string; readonly source: string } | undefined>
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
 * Install the skill env injection contributor. Returns a disposer; the `ctx.on`
 * and `shellEnv.register` disposers are also effect-scoped to the calling fiber.
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
  let refreshGen = 0
  let inFlight: Promise<void> | undefined
  let queued = false

  /** One refresh pass; commits only if still the latest generation and not disposed. */
  const refresh = async (): Promise<void> => {
    if (disposed) return
    if (inFlight !== undefined) { queued = true; return }
    const gen = ++refreshGen
    inFlight = (async () => {
      const scope = await getScope().catch(() => undefined)
      const snapshotOptions = scope === undefined ? {} : { scope }
      try {
        const snapshot = await skills.snapshot(snapshotOptions)
        // Keys already owned by another contributor (must not redeclare).
        const occupied = new Set(
          (shellEnv.list?.() ?? []).filter(e => e.contributor !== 'capability-catalog').map(e => e.key),
        )
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
            if (!ENV_KEY_SUFFIX.test(decl.key) || RESERVED_ENV_KEYS.has(decl.key)) continue
            const dshKey = `${DSH_PREFIX}${decl.key}`
            if (occupied.has(dshKey)) continue
            keys.add(decl.key)
            if (!isCredentialRefName(decl.key)) continue
            const resolved = await credentials.resolve(credentialRef(decl.key)).catch(() => undefined)
            if (resolved !== undefined && resolved.value.length > 0) values.set(dshKey, resolved.value)
          }
        }

        if (disposed || gen !== refreshGen) return // stale or disposed — drop the commit
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
      } finally {
        inFlight = undefined
        if (queued && !disposed) { queued = false; void refresh() }
      }
    })()
    await inFlight
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
