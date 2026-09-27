# Agent Note: The web-eval evaluation pins belong to the pack, not the user layer

Status: implemented

## Problem

`cordis.patch.yml` is, by convention across the dsh profiles, **the user's layer**: `install.sh` seeds it once and `update.sh` never touches it again. dsh-web-dev states that plainly, and for a development pack it is right — the layer holds preferences, and overwriting a person's preferences on update is hostile.

dsh-web-eval inherited the same file with the same rule, and the same file is where its evaluation pins have to live. Those pins are not preferences. They are the execution points of the pack's [frozen decisions](../../../../profiles/web-eval/README.md#冻结决策): the drive is exec-only (decision 2), the sandbox tier is uniform across the four harnesses (decision 3), the reasoning effort is explicitly pinned per harness (decision 4), and the model tools are open by domain (decision 12). Every one of them decides whether "these two cells differ in exactly one factor" is a true statement about a run.

Under the user-layer rule, a single `update.sh` can silently change the sandbox tier or the reasoning effort of an instance while `run.meta` still records the values from before. Nothing fails, nothing prints — and the report's third invariant, "the subject under test is the same", quietly stops meaning anything. The apparatus would be user-editable state that no hash covers: condition hashes do not reach provider configuration (only I4's `provision` folds a scoped home into `home.sha`), so a change at this layer is invisible to every hash the run records.

The open question was left explicitly to I1 in the README ("I1 决定它们进 pack 自带的 patch 层还是 `cordis.patch.yml` 用户层") and was still open when I2 · T15 needed the pins to exist.

## Decision

For **dsh-web-eval only**, `cordis.patch.yml` belongs to the pack. It ships the evaluation pins, and both installers overwrite it: it was already in `install.sh`'s `PROFILE_FILES`, and it is now also in `update.sh`'s `UPDATE_FILES`. Personal overrides go in a preset layer, which the pack does not touch. dsh-web-dev and dsh-basic are unchanged — there the layer is still the user's, because a development pack has no apparatus to protect.

The file itself carries the reasoning, decision by decision, so an operator reading only the profile directory learns why an ordinary user layer is not one here. The seven rows it ships:

| Row | Pin | Frozen decision |
|---|---|---|
| `mission` | `tools: read` | 12 — the four queue queries only; every write verb is the orchestrator's service face |
| `datasets` | `tools: authoring` | 12 — read plus `put_item`; `worktree_path` stays on the service face |
| `eval` | `tools: all` | 12 — the package registers only its three read tools, so `all` *is* read-only |
| `local-agent-codex` | `live: false`, `sandbox: workspace-write` | 2, 3 |
| `local-agent-claude-code` | `live: false`, `permissionMode: skip`, `baseUrl`, `proxyUrl` | 2, 3, 5 |
| `local-agent-kimi` | `live: false`, `thinkingEffort: high` | 2, 4 |
| `local-agent-dsh` | `live: false` | 2 |

Three rows deserve their reasons stated rather than inferred.

**`kimi thinkingEffort: high` duplicates the package's own default.** Writing it anyway is the point of decision 4: an effort that holds because a package happens to default to it is not pinned, it is unobserved. A default can move in a patch release without anyone noticing; a row in a git-tracked file cannot.

**`claude baseUrl` is pinned at all, and to the official endpoint.** Decision 5 says the endpoint enters the condition. Without the pin the provider falls back to the host process environment's `ANTHROPIC_BASE_URL`, which makes it "whatever the shell that launched the instance happened to export" — restarting from another terminal silently swaps the upstream while `run.meta` still records the old one. The pin makes the endpoint apparatus; the condition document copies the same value into `model.endpoint`.

The *value* is the official endpoint plus `proxyUrl` for egress, matching the 3080 production profile, and that is forced rather than chosen. The third-party address the host environment exports authenticates by API key; `delegationEnv` allows 25 environment names through to a delegation and `ANTHROPIC_API_KEY` is not among them, nor does the provider have a knob to pass one. A delegation can therefore only ever present the subscription OAuth grant, and that grant is rejected by the third-party endpoint (measured: 401). `proxyUrl` is not a spawn variable — `provisionClaudeHome` writes it into the scoped home's `settings.json` env block, because a supervisor-spawned instance carries none of the user's shell proxy variables.

**`codex sandbox: workspace-write`, not `danger-full-access`.** Decision 3 hands the sandbox to the container boundary and calls for `danger-full-access` inside it. I2 runs on the host, where there is no boundary — full access there would put an evaluation's side effects into a real home. The pack therefore ships the narrower tier for the host-direct stage, and each run's `methodology.md` declares the asymmetry as a known deviation. I3's containers restore `danger-full-access`, and only then do the four harnesses actually sit on one tier.

## Alternatives considered

**Ship the pins in the pack's own bundle patch and leave `cordis.patch.yml` to the user.** This is the other half of the question the README posed, and it is the more conventional shape — every member package already self-mounts through its own `cordis.patch.yml`. It was rejected because the profile is not a package: it has no `dsh.bundle.patch` of its own to carry a patch layer, so the pins would have to be pushed down into the member packages, where they would apply to *every* profile that mounts those members — dsh-web-dev included. The pins are apparatus for one pack, not behavior for a plugin.

**Leave the layer to the user and check the composed values at run time.** The orchestrator could read the effective provider configuration and refuse a run whose pins do not match a declaration. That is strictly better as a *verification* and worth building, but it is not a substitute: it detects drift at the moment of a run, while the failure it must prevent is drift that has already happened to a run and is only visible in a report nobody re-derives. It also does not exist yet, and the pins were needed for T15. The natural home for the check is I4's `provision`, which is already the step that turns a declaration into a real scoped home and hashes it — at that point the pins fold into `home.sha` and are covered by the condition hash, which is the durable fix.

**Fold the pins into the condition documents instead.** Semantically attractive — a condition already is "the subject under test", and sandbox tier and reasoning effort clearly belong to it. But `dataseek.condition/1` describes a subject, and the orchestrator has no way to apply a condition's declaration to a running instance's provider configuration before I4. Until it does, a condition field for the sandbox tier would be a declaration nothing enforces, which is the very failure mode the judge condition already documents for `model.declared`. Keeping the pins in the profile and *declaring* them in `methodology.md` states no more than is true.

## Consequences

An operator who put personal settings in `$DSH_HOME/profiles/web-eval/cordis.patch.yml` loses them on the next `update.sh`. This is the cost, and it is paid only by web-eval operators, for whom the profile is a measurement instrument rather than a workspace. The README says so in both languages, in the two places that describe the file.

The pins are now reviewable in git and quotable in a methodology, which is what "the configuration is public before the run and unchanged after it" (`docs/dimensions.md`'s first methodological bottom line) requires. They are still **not** covered by any hash — the condition hash does not reach them — so the discipline that actually protects a run is "apparatus config lives in git and does not change mid-run", not a mechanical check. I4's `provision` is where that becomes mechanical.

The `codex` tier makes the four harnesses non-uniform for the whole host-direct stage: codex runs `workspace-write` while claude runs `skip` and dsh runs unrestricted. This is a real asymmetry in every I2 result, is declared per run, and is a reason I2 conclusions are explicitly not for publication.
