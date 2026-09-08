# Agent Note: the CLI version probe and the credential grade

Status: implemented

English | [中文](2026-09-08-cli-version-and-credential-state.zh.md)

## Problem

Two things the family's status surface could not say, both of which the
evaluation depends on.

**`cliVersion` was reserved and always empty.** `LocalAgentEffectiveSettings`
declared the field with a comment saying no family probe ships yet, because a
probe would mean spawning every CLI at status time. The condition hash
therefore had to take `harness.version` from whatever the CLI self-reported
inside a delegation — which is the single largest confounder in the hash: two
runs of "the same condition" can be two different codex builds and the hash
cannot tell.

**`authenticated` is a shape check wearing a liveness answer's clothes.** It
reports whether a credential record exists in the scoped home. An expired
grant that no longer refreshes has exactly the same shape as a working one, so
it reads `yes` and a run starts against a credential that will fail on its
first round. The existing `reportAuthFailure` mark helps only AFTER a
delegation has already failed — by which point the run has spent its setup.

## Decision

### The version comes from the CLI, probed once per binary

`probeCliVersion` (`packages/local-agent/src/cli-version.ts`) spawns one
`<cli> --version` through the shared subprocess seam and parses the first
version-shaped token out of the banner — every family CLI wraps its version
differently (`codex-cli 0.144.0`, `2.1.263 (Claude Code)`, a bare `0.39.1`,
`0.1.1-rc.2`) and the token, not the banner, is what is parsed.

The result is cached against the EXECUTABLE'S OWN IDENTITY: the resolved path
(searched along `PATH` exactly as the spawn seam will resolve it) plus mtime
and size, for `argv[0]` and for every later argv entry that names an existing
file. That last part is what makes a launcher argv work: the sub-dsh's launch
is `node … bin.js --version`, where node never changes across a harness upgrade
and the entry script does. An upgrade rewrites one of those files, which
changes the key, which re-probes — so the field is never stale and a steady
state never spawns twice. Concurrent callers share one in-flight probe.

A FAILED probe is remembered for only `CLI_VERSION_FAILURE_TTL_MS` (60 s), not
until the next upgrade: a timeout on a loaded machine is transient, and an
absent field that can never recover is worse than one extra spawn a minute.

Everything degrades to `undefined`: an unresolvable executable, a composition
with no subprocess seam, a non-zero exit, the timeout, or a banner with no
version token. A non-zero exit deliberately does NOT parse the output — an
error message like `requires node >= 22.19.0` would otherwise become the
reported version.

### Where each harness's version comes from

The effective-settings snapshot is a LIVE read of what a round would run with
right now, so all four report the probe. A SETTLED ROUND is a different
question — what actually ran — and there the CLI's own record wins:

| harness | round read-back | status snapshot |
|---|---|---|
| codex | `session_meta.payload.cli_version` from the round's rollout | `codex --version` |
| claude-code | `claude_code_version` on the stream-json init event | `claude --version` |
| kimi | (wire log names no build) → the probe | `kimi --version` |
| dsh | (sub-dsh session log names no build) → the probe | the delegation's own launch argv, asked `--version` |

codex and claude-code therefore never guess a round's build: the record was
written by the process that served it. kimi and dsh have no such channel, and
the probe of the executable a round spawns is the honest second-best — recorded
as such here rather than left to look like a first-class read-back.

The version rides `LocalAgentRunProgress`'s `settled` payload and merges into
`LocalAgentDelegationRecord.cliVersion` the same way `observedModel` does.

### `credentialState`: four grades, and the boolean stays

`LocalAgentStatus` gains a required `credentialState`:

- `absent` — no credential record (or no probe declared).
- `present-unverified` — a record exists and nothing in this host process has
  exercised it. **This is the grade the whole change exists for**: it is what
  an expired, unrefreshable credential looks like, and what a fresh host
  process knows about a perfectly good one.
- `verified` — a delegation round reached the endpoint and completed since the
  last login/logout.
- `rejected` — a round's endpoint rejected the credential and no fresh login
  has rewritten the credential marker since.

`authenticated` is unchanged and is exactly `verified || present-unverified`,
so the settings card, the auth-status bus, and the T15 evaluation driver keep
reading the boolean they always read. The status text prints the grade.

A completed round OUTRANKS a stale rejection: `verified` is checked before
`rejected`, because a round that reached the endpoint is stronger evidence than
a mark from before it. Providers report it from the same settle path that
already reports auth failures — `markCredentialVerified` on a `completed` stop
reason, duck-typed against the registry so a provider paired with an older core
loses the grade rather than the run.

Both marks are cleared when a login STARTS and when a logout lands, because
both change which account the scoped home holds. They are deliberately per host
process: after a restart a present credential reports `present-unverified`,
which is what is actually known. **An eager pre-run liveness probe is not this
field's job** — that is T23's one minimal delegation. This change only makes the
status stop claiming to know something it does not.

## Testing

`packages/local-agent/tests/cli-version.spec.ts` covers the four real banner
shapes, one spawn per executable identity across concurrent callers, a re-probe
after the binary is rewritten, the launcher-argv entry script keying the cache,
and every degradation path (non-zero exit with a version-shaped token in the
error text, timeout, throwing seam, the failure TTL, an uninstalled CLI).
`local-agent.spec.ts` walks a harness through all four grades and back, checks
that a completed round outranks a stale rejection, that starting a login
forgets what rounds observed, and that the status text prints the grade.
`claude-cli-provider.spec.ts` covers the init event's build-info object.

## Alternatives considered

**Read the version from a package manifest instead of spawning.** It names
whatever the host happens to resolve, not the binary a delegation spawns —
which is exactly the confounder the field exists to remove. For the sub-dsh the
two even diverge by design (a configured `cliLaunch` override).

**Cache the probe by time (a TTL) rather than by binary identity.** A TTL is
wrong in both directions: it re-spawns while nothing changed, and it reports a
stale version for the whole window after an upgrade. Binary identity is exact,
and it is what upgrades actually change. The TTL survives only for failures,
where there is no identity change to wait for.

**Probe lazily on first delegation only, not at status time.** It would leave
the condition-hash field empty exactly where an orchestrator reads it (before
starting), which is the case that matters.

**Have the CORE probe on every harness's behalf.** Each harness needs its own
argv, scoped-home env, and (for dsh) launch replication; a core-side probe
would have to grow a registry of all four. The seam-based helper keeps the
family generic and each provider owns its own three-line adapter.

**Make `credentialState` optional so no consumer has to change.** The registry
is the only producer, so a required field costs nothing and means no consumer
has to handle "the grade is missing" — a state that would itself need a
meaning.

**Invalidate `verified` when the credential marker's mtime changes.** Correct
in spirit, wrong in practice: CLIs rewrite the marker on ordinary token
refresh, including during the very round that verified it, so a verification
would be discarded moments after being earned. Clearing on login/logout targets
the actual account change.

**Probe the credential's liveness at status time.** That is a real network call
per status read, and the status surface is polled by the settings card. The
pre-run liveness probe belongs to T23, once, at the point a run is about to
spend real budget.

## Consequences

All four harnesses report a `cliVersion` in `/<harness> status`, so the
condition hash's largest confounder is now an input rather than a guess. The
cost is one process spawn per CLI binary per host process (plus one per minute
while a CLI is missing or failing).

Two harnesses read their round's build back from the CLI's own record and two
report the probed executable's version; the table above is the record of which
is which, so a later reader does not have to assume all four are equally
authoritative.

`credentialState` makes "there is a record, nobody has tried it" sayable, which
is the honest answer for most of a host process's life. It also means a status
that used to read as a plain yes now distinguishes two situations a person
cares about differently — worth the extra vocabulary on the surface. Nothing
about the boolean changed, so no existing surface had to move.

Related: [the codex rollout read-back fix](../bug-fix/2026-09-08-codex-rollout-readback-tail-window.md),
[the observed-model read-back and cwd override](2026-09-06-local-agent-observed-model-cwd.md).
