/**
 * The declaration-versus-scope check: one condition document against the
 * fairness-relevant effective settings of the scoped home it names.
 *
 * `home.sha` hashes the scoped home's config CONTENT — it proves two homes are
 * byte-identical, and says nothing about whether either one is configured the
 * way the condition says it is. Nothing checked that until T31: a condition
 * could declare `permissions: "read-only"` against a scope running
 * `danger-full-access` and hash, lock, and run without a word.
 *
 * So the comparison lives here, as a pure function over two JSON shapes, and
 * BOTH readers call it: `conditions provision` before it writes a lock, and
 * `validate` against the snapshot the lock recorded. One rule in one place —
 * the same discipline `resolveConditionReadiness` already holds for "ready".
 *
 * Two fields are graded ERROR and the rest WARNING, and the split is not
 * arbitrary: `permissions` is the approval boundary (frozen decision 3) and
 * `model.endpoint` is the upstream route (frozen decision 5). Those two ARE
 * the subject under test, so a disagreement means the condition describes an
 * experiment nobody ran. A model that differs from the harness default is
 * expected since T30b (the declaration is requested per delegation), a
 * reasoning knob the harness lacks is an honest absence, and a CLI version is
 * a fact to record rather than to enforce.
 * @module @khorsheed/dsh-eval
 */
import type { LocalAgentEffectiveSettingsFace } from './faces.ts'

/**
 * How `model.endpoint` spells "the harness's own endpoint, no base URL in
 * force". Any other declared value is compared against the endpoint's
 * HOSTNAME, which is the only endpoint fact the snapshot carries — a full URL
 * path can name a tenant or a project, so the family never reports one.
 */
export const ENDPOINT_DEFAULT = 'default'

/**
 * The scope-side values a lock records and a declaration is checked against —
 * the facade snapshot flattened into the condition's own vocabulary. Every
 * field is nullable because absence is a real answer ("this harness has no
 * such knob"), never a substituted default.
 */
export interface EffectiveSnapshot {
  cliVersion: string | null
  model: string | null
  reasoningEffort: string | null
  /** The harness's permission knob, spelled in the condition's vocabulary. */
  permissions: string | null
  /** {@link ENDPOINT_DEFAULT}, or the endpoint's hostname. */
  endpoint: string | null
  /**
   * False when the harness declares no snapshot at all. Every field is then
   * null for the same reason, and the checks say so rather than reporting
   * five separate missing knobs.
   */
  available: boolean
}

/** One field's verdict from the declaration-versus-scope check. */
export interface ProvisionCheck {
  /** The condition field, as a dotted path. */
  field: string
  /** What the condition declares; null when it declares nothing yet. */
  declared: string | null
  /** What the scope reads back; null when the harness has no such knob. */
  effective: string | null
  /**
   * - `match` — the two agree.
   * - `mismatch` — they disagree.
   * - `backfilled` — the declaration is null and the observed value goes into
   *   the lock instead (the condition document is never rewritten).
   * - `unknown` — nothing to compare: the declaration is null, or the harness
   *   declares no knob for it.
   */
  status: 'match' | 'mismatch' | 'backfilled' | 'unknown'
  /** How a `mismatch` or an uncomparable field is graded; null when it is fine. */
  severity: 'error' | 'warning' | null
  detail: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The dsh sub-profile's permission preset spelled as the protocol's word for
 * it. `unrestricted` is the only word §6.2 gives the dsh harness, and
 * `danger-full-access` is the only preset that earns it; every other preset
 * is returned VERBATIM so a scope still confining its sub-dsh reads as the
 * mismatch it is against a condition claiming the container is the boundary.
 */
function dshPermissionsOf(sandbox: string | undefined): string | null {
  if (sandbox === undefined) return null
  return sandbox === 'danger-full-access' ? 'unrestricted' : sandbox
}

/**
 * The harness's permission knob, spelled in the condition's own vocabulary
 * (protocol §6.2). `null` means this scope answers nothing for it — the
 * harness has no such knob, or its deployment pins none.
 *
 * dsh's knob only exists when the deployment pins one: a sub-profile with no
 * permission layer runs whatever `dsh-base` composes, and this family reports
 * absence rather than transcribing a default nobody chose. Until T59 that was
 * the only answer dsh could give, and it read as "no knob" against a
 * condition whose `unrestricted` was, in the evaluation unit, simply untrue.
 *
 * kimi's knob is a boolean, so its false side needs a word of its own:
 * `no-auto-approve` is outside the vocabulary on purpose, so a condition
 * declaring `auto-approve` against a scope that does not auto-approve reads as
 * the mismatch it is rather than as "no knob".
 * @param harness - the harness name.
 * @param effective - that scope's snapshot.
 */
export function effectivePermissionsOf(harness: string, effective: LocalAgentEffectiveSettingsFace): string | null {
  if (harness === 'codex') return effective.sandbox ?? null
  if (harness === 'claude-code') return effective.permissionMode ?? null
  if (harness === 'kimi') return effective.autoApprove === undefined ? null : (effective.autoApprove ? 'auto-approve' : 'no-auto-approve')
  if (harness === 'dsh') return dshPermissionsOf(effective.sandbox)
  return null
}

/**
 * The endpoint the scope actually routes to: {@link ENDPOINT_DEFAULT} when no
 * base URL is in force, else the endpoint's hostname. `null` when a base URL
 * IS in force but did not parse to a hostname — uncomparable, never guessed.
 * @param effective - that scope's snapshot.
 */
export function effectiveEndpointOf(effective: LocalAgentEffectiveSettingsFace): string | null {
  return effective.baseUrlSet ? effective.baseUrlHost ?? null : ENDPOINT_DEFAULT
}

/**
 * A declared `model.endpoint` reduced to what can actually be compared.
 *
 * The family reports a HOSTNAME and nothing more — a URL's path can carry a
 * tenant or project id, so it never leaves the harness. A condition that
 * declares the full URL (`https://api.anthropic.com`) means the same endpoint
 * as one that declares the host, so the URL form is reduced rather than
 * refused. Anything that is not a URL is compared verbatim, which is what
 * makes {@link ENDPOINT_DEFAULT} work and what makes a label like `"proxy"`
 * the mismatch it is: a label names no endpoint anyone can check.
 * @param declared - the condition's `model.endpoint`.
 */
export function declaredEndpointOf(declared: string): string {
  try {
    const host = new URL(declared).hostname
    return host === '' ? declared : host
  } catch {
    return declared
  }
}

/**
 * Flatten one harness's facade snapshot into the condition's vocabulary.
 * @param harness - the harness name (it decides which permission knob applies).
 * @param effective - the snapshot, or undefined when the harness declares none.
 */
export function flattenEffective(harness: string, effective: LocalAgentEffectiveSettingsFace | undefined): EffectiveSnapshot {
  if (effective === undefined) {
    return { cliVersion: null, model: null, reasoningEffort: null, permissions: null, endpoint: null, available: false }
  }
  return {
    cliVersion: effective.cliVersion ?? null,
    model: effective.model ?? null,
    reasoningEffort: effective.reasoningEffort ?? null,
    permissions: effectivePermissionsOf(harness, effective),
    endpoint: effectiveEndpointOf(effective),
    available: true,
  }
}

/** Build one check row from a declaration, an observation, and the field's grading. */
function check(
  field: string,
  declared: string | null,
  effective: string | null,
  options: {
    severity: 'error' | 'warning'
    /** Why the field could not be compared (the scope answers nothing for it). */
    noKnob: string
    /** Record the observed value in the lock when the declaration is null. */
    backfill?: boolean
    mismatch: (declared: string, effective: string) => string
  },
): ProvisionCheck {
  if (declared === null) {
    return options.backfill === true && effective !== null
      ? {
          field,
          declared,
          effective,
          status: 'backfilled',
          severity: null,
          detail: `declared null — the observed value ${JSON.stringify(effective)} goes into the lock (the condition document is not rewritten)`,
        }
      : { field, declared, effective, status: 'unknown', severity: null, detail: 'declared null — unresolved, nothing to compare' }
  }
  if (effective === null) {
    return { field, declared, effective, status: 'unknown', severity: 'warning', detail: options.noKnob }
  }
  if (declared === effective) {
    return { field, declared, effective, status: 'match', severity: null, detail: `declaration and scope agree on ${JSON.stringify(declared)}` }
  }
  return { field, declared, effective, status: 'mismatch', severity: options.severity, detail: options.mismatch(declared, effective) }
}

/**
 * Check one condition document against one scope's flattened settings, field
 * by field, in contract order.
 * @param condition - a contract-valid condition document.
 * @param snapshot - what the scope reads back (from {@link flattenEffective},
 *   or from a lock's `provisioned.effective` record).
 * @returns five verdicts; `severity: 'error'` is what refuses a lock.
 */
export function checkAgainstEffective(condition: Record<string, unknown>, snapshot: EffectiveSnapshot): ProvisionCheck[] {
  const harness = isPlainObject(condition['harness']) ? condition['harness'] : {}
  const model = isPlainObject(condition['model']) ? condition['model'] : {}
  const reasoning = isPlainObject(condition['reasoning']) ? condition['reasoning'] : {}
  const harnessName = stringOrNull(harness['name']) ?? ''
  const noSnapshot = `harness ${JSON.stringify(harnessName)} declares no effective-settings snapshot — this field could not be checked against the scope`
  const permissions = stringOrNull(condition['permissions'])
  // Reduced to the comparable half BEFORE the check, so the row's `declared`
  // shows what was actually compared rather than a URL the reader then has to
  // reduce in their head.
  const rawEndpoint = stringOrNull(model['endpoint'])
  const endpointDeclaration = rawEndpoint === null ? null : declaredEndpointOf(rawEndpoint)
  return [
    check('harness.version', stringOrNull(harness['version']), snapshot.cliVersion, {
      severity: 'warning',
      backfill: true,
      noKnob: snapshot.available
        ? 'the CLI could not be asked for its version (not installed, non-zero exit, or no version-shaped token in its banner) — the declaration stands unchecked'
        : noSnapshot,
      mismatch: (d, e) => `the condition declares CLI ${JSON.stringify(d)} but the scope's CLI reports ${JSON.stringify(e)} — the run would record a version it is not running`,
    }),
    check('model.declared', stringOrNull(model['declared']), snapshot.model, {
      severity: 'warning',
      noKnob: snapshot.available
        ? 'the harness reports no configured model — with a declared model that is fine, since the declaration is REQUESTED per delegation (T30b)'
        : noSnapshot,
      mismatch: (d, e) => `the condition declares ${JSON.stringify(d)} while the harness's own default is ${JSON.stringify(e)}`
        + ' — not a fault: the declaration is requested per delegation (T30b), and the read-back still refuses a run that served something else',
    }),
    check('reasoning.effort', stringOrNull(reasoning['effort']), snapshot.reasoningEffort, {
      severity: 'warning',
      noKnob: snapshot.available
        ? 'the scope reports no default reasoning effort; explicit native effort must be validated and pinned by per-round admission before generation'
        : noSnapshot,
      mismatch: (d, e) => `the condition pins effort ${JSON.stringify(d)} while the scope default is ${JSON.stringify(e)}; the explicit value must be requested and verified at round admission`,
    }),
    check('permissions', permissions, snapshot.permissions, {
      severity: 'error',
      noKnob: snapshot.available
        ? `the harness declares no permission knob, so ${JSON.stringify(permissions)} cannot be verified against the scope`
        : noSnapshot,
      mismatch: (d, e) => `the condition declares permissions ${JSON.stringify(d)} but the scope is configured ${JSON.stringify(e)}`
        + ' — the approval boundary IS part of the subject under test (frozen decision 3)',
    }),
    check('model.endpoint', endpointDeclaration, snapshot.endpoint, {
      severity: 'error',
      noKnob: snapshot.available
        ? 'a base URL is in force but did not parse to a hostname — the endpoint could not be compared'
        : noSnapshot,
      mismatch: (d, e) => `the condition declares endpoint ${JSON.stringify(rawEndpoint)}${d === rawEndpoint ? '' : ` (host ${JSON.stringify(d)})`}`
        + ` but the scope routes to ${JSON.stringify(e)}`
        + ` — spell it ${JSON.stringify(ENDPOINT_DEFAULT)} (no base URL in force) or as the endpoint's URL or hostname`
        + ' (frozen decision 5: the endpoint belongs to the subject under test)',
    }),
  ]
}
