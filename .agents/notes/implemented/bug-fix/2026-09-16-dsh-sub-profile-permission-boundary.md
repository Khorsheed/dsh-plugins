# Agent Note: the sub-dsh's permission boundary is a file in the scope directory

Status: implemented

## Problem

Inside a web-eval container unit the dsh player had no shell. Every `bash`
call came back refused, and the agent said so in its own answer:

> 本会话 shell 不可用——宿主无可用 sandbox 后端且无审批通道，bash 全部被拒；
> 我改用文件/检索工具完成了读取与结构校验，因此 JSON 未经过解析器验证

(I5·T39's walkthrough, gap G14.) The P0 placeholder item needs no shell, so
the walkthrough passed over it; F2 and F3 both hand in shell scripts and run
tests, so on the real items the condition would have scored zero for a reason
that has nothing to do with the model.

Reproduced in a unit — the two refusals verbatim:

```
Error: sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access.
Error: sandbox escalation to "danger-full-access" requires approval, but no approval channel is available
```

Both halves of the diagnosis are real and independent:

- **No usable backend.** `dsh-sandbox-local`'s Linux chain is bwrap, then
  Landlock. The evaluation image installs no bubblewrap, and the Landlock rung
  is present but unusable — `@deepseek-ai/node-addon-system/landlock-run`'s own
  `probe()` returns `"unusable"` under the container's kernel. The seam then
  fails closed, which is correct: it refuses rather than running unconfined.
- **No approval channel.** `dsh-base` composes `user-approval` with `ask`, and
  the model's one sanctioned escalation retry needs a human on the other end.
  A headless sub-dsh has nobody there, so the retry fails closed too.

Neither is a defect. The defect is that nothing decided the sub-dsh's
boundary. `local-agent-dsh` had **no permission knob at all**, so the
sub-profile ran whatever `dsh-base` composes — `workspace-write` plus `ask` —
and the frozen decision that sandboxing is the container boundary had, for
this one harness of the four, no execution point. The condition file's
`permissions: "unrestricted"` was a declaration with nothing behind it, and
`effectiveSettings` reported no knob, so the provision gate graded it
unverifiable instead of wrong. On the host nobody noticed: macOS has Seatbelt,
the sandbox comes up, `bash` works.

## Decision

Provisioning writes the boundary into the scope's sub-profile, as one more
generated patch layer beside the preset roster.

`local-agent-dsh`'s config gains `permissions`, spelled in dsh's own
three-word vocabulary (`read-only` / `workspace-write` / `danger-full-access`
— the keys of `dsh-base`'s `permission-presets` table). Given one,
`provisionDshSubProfile` appends:

```yaml
# --- permission boundary (written by local-agent-dsh provisioning) ---
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: danger-full-access
    workspaceRoot: !!js process.cwd()
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: never
```

Three properties of that text are load-bearing. They are **patch** rows, not
inserts: both ids already exist in the `dsh-base` layer this profile stacks
on, and this layer lands after it. Each row re-states every key it owns,
because `applyEntryPatches` assigns `target[key] = value` — a whole-value
replace, so writing `mode` alone would silently drop `workspaceRoot`. And each
carries `name`, so a foreign plugin holding the id makes the loader warn and
skip rather than take this config. A base that mounts neither row warns
"entry not found" and skips: a sub-dsh that boots with the composition it has
beats one that fails to boot over a knob.

The two rows move together, from `dsh-base`'s own preset table:
`danger-full-access` pairs with `never`, the other two with `ask`. Pinning
them separately and letting them drift would build a boundary nobody can run
inside and nobody can be asked about — which is exactly the state G14 found.

**Absent means absent.** With no `permissions`, no layer is written and the
patch file is byte-identical to before: every existing host scope keeps
`workspace-write` + `ask`. The key is opt-in because on a developer's machine
the sub-dsh shares the real home.

`effectiveSettings` reports the configured preset as `sandbox` — the field
codex already uses for the same meaning — and `dsh-eval` maps it into the
condition vocabulary: `danger-full-access` becomes `unrestricted`, the one
word protocol §6.2 gives this harness, and every other preset is returned
verbatim so a still-confining scope reads as the mismatch it is. Absence
still maps to `null`. The `permissions` row of the provision gate is graded
ERROR, so from here a dsh condition claiming `unrestricted` against a scope
that confines its sub-dsh writes no lock.

The evaluation instrument pins `permissions: danger-full-access` in
`profiles/web-eval/cordis.patch.yml`, next to codex's `sandbox` and claude's
`permissionMode`, completing frozen decision 3's fourth harness. That pin and
the container path are a pair, the same way codex's is: whoever runs stages
one and two on the host must change it back first.

## Why the scope directory and not the spawn env

`dsh-base` reads both rows from `DSH_PERMISSION_MODE`, so a container round
could have carried the value as one more `-e`. It does not, for two reasons.

The value is part of the subject under test, and the scope directory is where
subject-defining state already lives: `home.sha` hashes `cordis.patch.yml`
(`.yml` is a config extension), so the boundary enters the condition's
identity by the same door the preset roster does. A bind-mounted scoped home
then carries its own boundary into the unit with no orchestrator cooperation.

And the unit's composite fingerprint counts **every env name**. The evaluation
already spends one name on dsh alone (`NODE_OPTIONS=--use-env-proxy`) and
records it in `effectiveSettings.containerNodeOptions` precisely so the
asymmetry is visible; adding a second would make "these two cells differ in
exactly one factor" harder to say, for a fact that is not about the
environment at all.

A side effect worth stating: because the generated layer lands after the base
layer, the literal wins over `DSH_PERMISSION_MODE`. A pinned scope's boundary
no longer depends on the environment of whoever spawned the process.

## Alternatives considered

**Inject `DSH_PERMISSION_MODE` on container rounds only.** The smallest
change, and it has the appealing property that host rounds keep
`workspace-write` automatically — the boundary would follow the presence of a
container rather than a config key. Rejected on the fingerprint and identity
grounds above, and on a third: it would make the boundary invisible to
`home.sha` and to anyone reading the scope, which is how G14 stayed invisible
for two iterations. The task's frozen decision named the sub-profile as the
place.

**Install bubblewrap in the evaluation image.** Would give the unit a working
backend and let the sub-dsh keep confining itself. Rejected because it answers
the wrong question: frozen decision 3 says the unit IS the sandbox, and the
other three harnesses are already pinned to their full-access rung. A second
boundary inside the first would put dsh alone on a stricter setting, which is
the asymmetry the decision exists to remove — and it would bake the answer
into an image digest rather than into the condition.

**Bake the rows into the image's profile.** The unit already carries a
sub-profile shape. Rejected because the value would then be a property of the
environment, invisible to the condition and unchangeable without a rebuild;
`permissions` is a factor a person should be able to vary between two cells.

**Report `autoApprove` as well as `sandbox`.** The approval half is a real
fact and the family has a field for it. Rejected because `autoApprove` is
kimi's boolean knob and `effectivePermissionsOf` keys on the harness name: a
second dsh field would give the same boundary two spellings. The preset word
already implies the policy, because `dsh-base`'s table is what pairs them.

## Testing

`packages/local-agent-dsh/tests/provision.spec.ts` pins the generated layer:
that absence writes nothing at all, that `danger-full-access` emits both rows
with `policy: never`, that the confining presets keep `ask`, that
`workspaceRoot` is re-stated, that a word outside the vocabulary throws, that
the layer stacks after the preset roster with both readable, and that
withdrawing the pin drops the layer again on the next provisioning.
`packages/eval/tests/provision.spec.ts` pins the three dsh rows of the
permission-vocabulary table.

Measured end to end in an `eval-env:pinned` unit against the bind-mounted
`dsh-exec` scoped home. Before, `bash -c 'echo ok'` returned the two refusals
quoted under Problem. After re-provisioning with the pin, the composed config
inside the unit reads `mode: danger-full-access` / `policy: never` and the
same round answers:

> The command ran successfully. Full result verbatim:
>
> ```
> ok
> ```
>
> Exit code: 0 (no `[exit code: N]` marker was present, indicating success). The tool did not refuse.

On the host, a scope provisioned without the key composes
`mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` and the
`ask`/`never` ternary — `dsh-base`'s own expressions, untouched.

## Consequences

The dsh player can run a shell inside a unit, which is what F2 and F3 need
before a real-item round means anything. Frozen decision 3 has an execution
point for all four harnesses, and the condition field that carries it is
checkable rather than unverifiable: a scope that silently confines its sub-dsh
now blocks its own lock.

The cost is that `home.sha` changes for every dsh scope the pin touches. Both
dsh conditions (`dsh-exec`, `judge-dsh-v4-pro`) need re-provisioning and a
`home.sha` write-back before they are ready again — the same two-step G7
already records. Measured on the T22 smoke scope: `da8d8088…` → `a348cd3d…`.

The pin also applies to host rounds of a pinned deployment, judge delegations
included. That is deliberate — both dsh conditions declare `unrestricted`, so
before this change the judge's declaration was untrue too — but it means a
pinned instance grants its sub-dsh full access to the real scoped home.
The web-eval patch says so where the pin is, beside the identical warning
codex's row already carries.

Not addressed: the sub-dsh's member-bridge row still fails to start inside a
unit (`DSH_MEMBER_BRIDGE_ENTRY` is empty there by design, and the resulting
`node ''` prints a `SyntaxError` to stderr). It is the intended
`failOnStartupError: false` degrade path and costs the round nothing, but it
is noise on every container round's stderr.

## Related

- [capability snapshots by preset, and the sub-dsh preset roster](../feature/2026-09-11-capability-hash-and-sub-dsh-preset.md) — the other generated layer this one stacks beside.
