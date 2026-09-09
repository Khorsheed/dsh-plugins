# Agent Note: named scoped homes — one harness, several logins

Status: implemented

English | [中文](2026-09-10-local-agent-named-scoped-homes.zh.md)

## Problem

A local-agent harness had exactly one scoped home: `homeDir(name)` returned `<homesRoot>/<name>`, and every consumer — login, status, session listing, `delegations.jsonl`, the CLI-version probe, the live driver, kimi's member-bridge `mcp.json`, dsh's sub-profile, and each provider's per-round CLI launch — resolved that one directory from the harness NAME alone. One harness therefore meant one account.

The evaluation is where that stopped being enough. A container run mounts `faces.localAgent.homeDir(<condition's harness>)` as the cell's credential directory, so two conditions naming the same harness mount the same directory: they can differ in model or reasoning effort — factors that do not live in the scoped home — but they cannot differ in *which login*. A run that wants two accounts of one harness, or two harness configurations that are provisioned differently, could not be expressed at all. Three queued tasks (per-delegation model, per-condition provisioning, and a two-preset pilot on one harness) each need "one scoped home per condition" before they can start.

## Decision

- **A scope is a NAME, and its directory is a SIBLING.** `homeDir(name, scope?)`: without a scope, `<homesRoot>/<name>`, byte for byte what it always was; with one, `<homesRoot>/<name>@<scope>`. The scope must match `[a-z0-9-]` — never a path — so the directory can only ever be under the homes root. It is deliberately not nested inside the default home: that directory belongs to the harness's own CLI, which prunes and rewrites it.
- **Materialized lazily, on the read.** The first time anything names a scope — `/<harness> login|status|sessions|logout --scope <name>`, a delegation carrying `scope`, or the evaluation resolving its mount source — the registry creates the directory 0700, loads that directory's own `delegations.jsonl`, and runs the harness's provisioning through a new optional `LocalAgentHarness.provision(homeDir)` hook (codex's `config.toml` credential-store pin, kimi's provider/model config followed by its permission rules, claude's eager home creation, dsh's sub-profile). Once per (harness, scope) per host process. The DEFAULT scope's provisioning does not move: each harness bundle's `apply` still owns it, so nothing about the default path changes.
- **Credentials are never copied.** A fresh scope is empty, reports `credentialState: absent`, and fails a delegation exactly as an unauthenticated harness does today. `/<harness> login --scope <name>` logs it in. claude's keychain item is keyed by the config directory's path, so a named scope gets its own item for free — the one credential store among the four that is path-isolated by nature. That is stated in the READMEs rather than assumed.
- **The scope rides the delegation intent and is anchored by the record.** `DelegationCallOptions.scope` reaches the provider through the staged intent (fresh and resume alike, the channel `cwd` and `exec` already use), the provider resolves `homeDir(<harness>, scope)` for the round's env, readback and records, and `LocalAgentDelegationRecord.scope` persists it. `assertResumeScopeUnchanged` — the twin of `assertResumeCwdUnchanged` — refuses a resume that names a different scope, INCLUDING naming none against a scoped record and a scope against a default one. The facade refuses before staging; each provider repeats the check where it checks the cwd anchor. Continuing one CLI session under another account's credentials is not repairable after the fact.
- **Everything else that reads a directory takes one.** `LocalAgentHarness.effectiveSettings` now receives the scoped home as a parameter instead of closing over the apply-time default, so a status read or an evaluation snapshot of a named scope reports the configuration THAT scope's rounds would run with. `statusOf`, `sessionsOf`, `effectiveSettings`, the Remote `status`, and the logins / auth-failure / auth-success maps are all keyed by (harness, scope) — the same string the directory is named after. `LocalAgentStatus.scope` is set only for a named scope, so every surface written before this reads exactly what it read.
- **`delegations.jsonl` belongs to the directory.** A scoped round's mapping is appended to that scope's own file and loaded when the scope is materialized; the default scope's file and load timing are unchanged. A line without a `scope` field is a default-scope record — which is what every line written before this change is — and a line found inside a named scope's file is restored as that scope's.
- **claude's login argv is built per login.** Its pty declaration pins `CLAUDE_CONFIG_DIR` ON the argv (`env NAME=VALUE` outranks the spawn environment), so the pty variant's `args` may now be a factory taking the home being logged in. With a fixed array, `--scope` would have authorized the default directory while claiming to authorize the scope.
- **Boundaries, named rather than half-built.** A scoped delegation is exec-only: the resident drivers are started per member against the default scoped home, so a scoped round meeting an active live driver is refused (`assertScopeExecOnly`) rather than silently downgraded. A scoped kimi round carries no member channel — the bridge declaration is written INTO a scoped home's `mcp.json` and `member-bridge.sock` is a single homes-root socket. dsh's sub-profile follows the directory and needs nothing special.
- **The evaluation contract gains one optional field.** A condition may declare a top-level `scope` (same `[a-z0-9-]` rule, checked by `validate` as `SCOPE_NAME` because the schema subset has no `pattern`). It selects the mount source (`homeDir(harness, scope)`), the delegation options of every round of that condition's cells, the readiness probe's own scope, and the judge's when a judge condition declares one. `run.meta.unit.scopedHomes` records it per condition. It enters the condition hash — two conditions differing only in `scope` are two subjects, because they log in as two accounts — so the protocol goes to **v1-rev8**.

## What run.meta does and does not carry

The brief expected `run.meta.unit.scopedHomes` to already record each condition's HOST directory; it does not, and that is deliberate — the host credential root is an operator fact and `run.meta` travels inside the exported bundle. The entries gained the `scope` NAME instead, which is what makes two cells of one harness legible as two directories without putting a host path into a shared artifact. The host paths remain visible where they are already visible: the run log's credential check and the readiness records.

## Real-machine verification

Two codex delegations on this machine through the real registry, the real `codex-local` provider and the real codex CLI 0.144.0 (`packages/local-agent/scratch-t29-verify.mts`, untracked), homes root `~/.dsh/local-agent`:

| Check | Result |
|---|---|
| Named scope materialized | `codex@eval-b` created 0700 with the provisioned `config.toml` (the credential-store pin) — the default home untouched |
| Its own login | `codex login --device-auth` under that directory: `Successfully logged in`, `auth.json` in the scope, nothing copied and nothing changed in the default home |
| Status per scope | before the login: default `present-unverified`, `eval-b` `absent` — each with its own `homeDir` and its own `cliVersion 0.144.0` probe |
| Two delegations | both `completed` with output `4`; the records read back `{cwd, observedModel: gpt-5.6-sol, cliVersion: 0.144.0}` each, and only the scoped one carries `scope: eval-b` |
| Rollouts | each round's rollout landed under ITS OWN directory (`codex/sessions/…` vs `codex@eval-b/sessions/…`), and each scope's `delegations.jsonl` holds only its own mappings |
| Resume across scopes | all three shapes refused before any spawn: scoped record + no scope, scoped record + other scope, default record + a scope |

And one host-path evaluation run (`run-20260910023131-1uv1`) over two conditions that differ ONLY in `scope` — `codex-scope-a` (default) and `codex-scope-b` (`scope: eval-b`), P0 × 1 rep, two stages:

| Check | Result |
|---|---|
| Two subjects | condition hashes `952272033e56…` and `7be51283faf2…` — the scope is a factor, on real files |
| Readiness | both ready in the same run (19.5s / 18.7s, `model gpt-5.6-sol`), each probe against its OWN scope: the `codex-scope-b` probe proves the credential its cells will use |
| Where every round ran | each cell's child sessions resolve to its own directory — cell a's two rounds in `codex`, cell b's in `codex@eval-b`, and the two readiness probes likewise |
| Cells | `codex-scope-b` reached **`archived`** (stage1 + stage2 written and checkpointed, one infrastructure retry); `codex-scope-a` was skipped after exhausting its retry budget |

The skipped cell is the machine's network, not the change: this host reaches `chatgpt.com` through a local proxy that was dropping long streaming requests all through the run (`stream disconnected before completion … /backend-api/codex/responses`, reproducible with a bare `codex exec` outside any of this code). Short rounds went through — both readiness probes, both 2+2 delegations, and cell b's whole two-stage walk — while the minutes-long stage rounds were cut mid-stream. The readiness gate refused two earlier attempts on the same cause without executing a cell, which is the behavior it exists for.

The default scope's own output is unchanged where it is checked hardest: recomputing the pilot-a-round1 export bundle (`dsh-eval report`) on this branch and on `main` produces a byte-identical `results.jsonl` (sha256 `a05244bc…`) and a byte-identical `usage.jsonl`; `summary.md` differs only in its generation timestamp line.

## Testing

- Core (`packages/local-agent/tests/scoped-home.spec.ts`): both `homeDir` values, every rejected scope shape, lazy materialization with 0700 + provisioning exactly once, the default scope's untouched provisioning path, per-scope credential grading, per-scope effective settings and session records, `--scope` on status/logout, the refusals for a bad scope name and a flag with no value, both flag spellings, a harness subcommand receiving the raw input, per-directory `delegations.jsonl` with a restart, and the resume-scope and exec-only assertions.
- Facade (`delegation-facade.spec.ts`): the scope on both staged intents, and a resume naming another scope (or none) refused before anything is staged.
- Providers (`scoped-home.spec.ts` in all four): the scoped round's env variable pointing at the scoped directory, the record carrying (or not carrying) the scope, the cross-scope resume refusal, the live-driver refusal, and — for kimi — the member channel present by default and absent under a scope.
- Evaluation (`run.spec.ts`, `schema.spec.ts`): two conditions differing only in `scope` produce two hashes, two mount sources, two readiness probes each naming its own scope, scoped stage rounds, and two `run.meta.unit.scopedHomes` entries; plus the `SCOPE_NAME` diagnostics and the hash's treatment of `scope` versus `notes`.

## Alternatives considered

**Let `DelegationCallOptions` carry a host PATH instead of a name.** Rejected. A path is unbounded: the family would have to defend against `..`, symlinks and any directory on the machine, and the answer to "where do this harness's scopes live" would move from the family to every caller. A name keeps the directory under the homes root by construction, and it is also the thing that can be written into a reviewed condition file — a host path in a dataset document is exactly what the container path already refuses to write.

**Copy credentials from the default scope into a new one.** Rejected. It is the one behavior that would make a scope look ready when it is not: a copied token is a second live credential nobody logged in for, its refresh writes back to whichever copy the CLI happened to open, and revoking one leaves the other silently working. "A new scope is empty and needs its own login" is a sentence a person can act on; "a new scope inherits your login, sometimes" is not. It also would not survive claude's keychain, where the item is keyed by the config directory's path.

**Nest a named scope inside the default home (`<homesRoot>/<name>/scopes/<scope>`).** Rejected. That directory is the harness CLI's own state tree — codex writes `sessions/`, kimi its wire logs, claude its settings and projects — and each of those CLIs enumerates, prunes and rewrites it. A second state tree inside it is a bet that none of the four ever walks its own home; the sibling `<name>@<scope>` costs one character in the directory name and makes the bet unnecessary.

**Make `homeDir` pure and add an explicit `ensureScope()` for materialization.** Rejected: every consumer would have to remember to call it, and the one that forgets gets a plausible path to a directory that does not exist — the same silent-empty failure mode the evaluation's mount source already paid for once. Materializing on the read makes "a scope exists once something names it" true for every caller at once, and the mkdir is idempotent and once-per-process.

**Give the eval condition a `home` object (path + variable) rather than a `scope` name.** Rejected: the condition contract already refuses to name host directories (`unit.scopedHome` deliberately carries only the in-container side), and a scope name is the smallest thing that makes two conditions two subjects while leaving the host side to the instance.

**Let a scoped round keep the live driver by starting a second resident runtime per scope.** Rejected for this change: the resident drivers key their runtimes by member, and adding a scope dimension to that lifetime (idle reclaim, generation drain, breaker state) is a change to the live path's own bookkeeping with no caller asking for it — the evaluation pins `drive: exec`. A refusal that names the reason is what a scoped caller gets instead.

## Consequences

- One harness can now hold several logins, and an evaluation can compare two accounts of one harness in a single run. The three queued tasks that needed a per-condition scoped home are unblocked.
- The default scope is unchanged in every path that matters: same directory, same provisioning timing, same records, same argv. The existing suites pass unmodified except where the two deliberate contract changes reach them (`effectiveSettings(homeDir)` and claude's pty `args` factory).
- `LocalAgentHarness.effectiveSettings` and the pty `args` factory are contract changes for harness authors. Both are narrow and both are compile-time visible.
- A scoped delegation gives up the live driver, and on kimi the member channel. Both are refusals or documented absences, not degradations discovered at run time.
- The condition hash changes for any condition that adds `scope`; a lock recorded before it goes stale, which is the existing "adding a factor re-provisions" rule.
