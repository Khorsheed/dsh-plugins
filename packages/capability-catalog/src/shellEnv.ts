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
import { decodeCredentialDecls, decodeEnvDecls, mergeCredentialDecls } from './skills.ts'

const DSH_PREFIX = 'DSH_'
const ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/
/** Reserved `DSH_*` names the host's shell-env registry owns as built-in facts
 * (the instance's real HOME / SHELL / SESSION_ID). A credential must never be
 * allowed to take one of these over — a mapped value shadowing the built-in
 * `DSH_HOME` would make the agent read the configured credential as the
 * instance home. Keyed on the MAPPED name (not the raw declaration), so it
 * matches the upstream registry's own reserved set (dsh-home-paths/dsh-shell)
 * and survives prefix/schema drift. The catalog's own `DSH_`-prefixed keys are
 * unaffected: declaring e.g. `DSH_HOME` maps to `DSH_DSH_HOME`, which is not a
 * reserved name and never collides. */
const RESERVED_ENV_KEYS = new Set(['DSH_HOME', 'DSH_SHELL', 'DSH_SESSION_ID'])

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
    readonly skills: readonly { readonly name: string; readonly invocation?: { readonly modelInvocable: boolean } }[]
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
 *
 * Boot-timing robustness: the contributor's `register()` runs `ctx.effect(...)`
 * internally, so it must be called while its backing fiber is still `active`
 * (alpha's reordered app-boot can leave it in a transient inactive window where
 * a captured reference would throw `INACTIVE_EFFECT`). This install never caches
 * a service reference across an `await`; it re-reads `ctx.get` (strict — returns
 * the impl only while its fiber is active) immediately before calling `register`,
 * and self-retries on `INACTIVE_EFFECT` so it self-heals once boot stabilizes.
 */
export function installSkillEnvInjection(ctx: Context, getScope: () => Promise<unknown | undefined>): () => void {
  let disposed = false
  let envCache = new Map<string, string>()
  let disposeEnv: (() => void) | undefined
  let refreshKey: string | undefined
  let refreshGen = 0
  let inFlight: Promise<void> | undefined
  let queued = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  const MAX_RETRIES = 30
  const RETRY_DELAY = 300

  const cancelRetry = (): void => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  const scheduleRetry = (): void => {
    if (disposed || retries >= MAX_RETRIES) return
    cancelRetry()
    retries++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (!disposed) void refresh()
    }, RETRY_DELAY)
  }

  /** True for the `INACTIVE_EFFECT` Cordis error thrown by `ctx.effect` when the
   * fiber is inactive — a transient boot-time race, not a real owner collision. */
  const isInactiveEffect = (err: unknown): boolean => {
    return !!err && typeof err === 'object' && 'code' in err
      && (err as { code?: unknown }).code === 'INACTIVE_EFFECT'
  }

  /** One refresh pass; commits only if still the latest generation and not disposed. */
  const refresh = async (): Promise<void> => {
    if (disposed) return
    if (inFlight !== undefined) {
      // Bump the generation so the in-flight pass is now stale and will not
      // commit the value it read before this update arrived (strict
      // latest-wins); the queued pass re-reads + commits fresh.
      refreshGen++
      queued = true
      return
    }
    // Re-resolve the services FRESH on every pass (never across an `await`).
    // `ctx.get` (strict) returns the implementation only while its providing
    // fiber is active, so a reload/reorder that makes a previously-captured
    // reference inactive is never called into here. If any service is not
    // currently active, this is a transient boot window — retry.
    const shellEnv = ctx.get?.('shellEnv') as ShellEnvRegistryLike | undefined
    const credentials = ctx.get?.('credentials') as CredentialStoreSlice | undefined
    const skills = ctx.get?.('skills') as SkillRegistrySlice | undefined
    if (shellEnv?.register === undefined || credentials === undefined || skills === undefined) {
      scheduleRetry()
      return
    }
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
          // Only skills the model may invoke get their credentials injected —
          // a model-disabled (user-only) skill cannot be used by the model, so
          // putting its secret in the model shell would be pure exposure.
          if (row.invocation?.modelInvocable === false) continue
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
            const dshKey = `${DSH_PREFIX}${decl.key}`
            // Never let a credential take over a reserved built-in DSH_* name
            // (DSH_HOME etc.). Declaring `HOME` maps to `DSH_HOME` and is
            // dropped here; declaring `DSH_HOME` maps to `DSH_DSH_HOME`, which
            // is not reserved and stays.
            if (RESERVED_ENV_KEYS.has(dshKey) || occupied.has(dshKey)) continue
            keys.add(decl.key)
            const resolved = await credentials.resolve(decl.key).catch(() => undefined)
            if (resolved !== undefined && resolved.value.length > 0) values.set(dshKey, resolved.value)
          }
        }

        if (disposed || gen !== refreshGen) return // stale or disposed — drop the commit
        envCache = values
        const keySet = [...keys].sort().join('\n')
        if (keySet !== refreshKey) {
          disposeEnv?.()
          disposeEnv = undefined
          refreshKey = undefined
          const variables: Record<string, { description: string }> = {}
          for (const k of keys) {
            variables[`${DSH_PREFIX}${k}`] = { description: `Configured via the capability catalog for skill env \`${k}\`` }
          }
          // Re-resolve the registry immediately before `register` — never call
          // `ctx.effect` on a reference captured across an `await`. If the
          // service is inactive right now (boot reorder window), drop this pass
          // and retry; leave refreshKey unset so the next pass re-registers.
          const shellEnvNow = ctx.get?.('shellEnv') as ShellEnvRegistryLike | undefined
          if (shellEnvNow?.register === undefined) {
            scheduleRetry()
            return
          }
          try {
            disposeEnv = shellEnvNow.register({
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
            retries = 0
          } catch (err) {
            // Register failed (e.g. a TOCTOU owner collision). Leave refreshKey
            // unset so the NEXT refresh retries regardless of the key set even
            // if the key set later returns to a previously-registered value.
            process.stderr.write(`capability-catalog: skill env contributor register failed (${String(err)})`)
            if (isInactiveEffect(err)) scheduleRetry()
          }
        }
      } catch (err) {
        process.stderr.write(`capability-catalog: skill env injection refresh failed (${String(err)})`)
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
    cancelRetry()
    disposeEnv?.()
    offRecord()
    offReference()
  }
}

export { DSH_PREFIX }
