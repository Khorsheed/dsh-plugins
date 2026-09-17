# Agent Note: The claude credential sync must never move the chain backward

Status: proposed

English | [中文](2026-09-17-claude-credential-sync-newer-wins.zh.md)

## Problem

A containerized claude round logs the whole instance out. T33e observed it (host round ready in 12.0 s, container round NOT READY, `.credentials.json` emptied at the probe moment: both tokens empty strings, `expiresAt` 0), and it is the same failure the dataset repository's pilot log recorded as G9. Recovery needs a human at a terminal.

Three facts have to be true at once, and all three are:

1. **Two stores, one-way sync.** On macOS the OAuth credential lives both in the keychain (an item per config-dir path hash) and in `<homeDir>/.credentials.json`. claude 2.1.236+ WRITES the keychain and READS the file, so `syncClaudeCredentialFile` mirrors keychain → file and only that direction. It runs from four places: `claude-cli-provider.ts` before every exec spawn, `live-driver.ts` before every resident spawn, `claudeAuthenticated` (so every status and readiness probe), and the login watch.
2. **The unit is a second writer to the same file.** Since T20c the container round bind-mounts the instance's own scoped home read-write, and `acquireSpecFor` declares exactly that one mount. Inside the unit there is no keychain, so claude reads and writes the mounted file: access token expired → refresh → the rotated blob is written back through the bind mount onto the host.
3. **The sync runs against the HOST directory even on a container round.** The provider builds `env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir })` with the host path, and `containerExecSpawn` substitutes the in-container path only for the `docker exec -e` forwarding. So `startClaudeCliRun`'s pre-spawn `syncClaudeCredentialFile(configDir)` operates on the host scoped home, moments before the unit reads that very file through the mount.

The chain that follows is forced: the unit rotates the refresh token and writes generation N+1 to the file; the keychain still holds N; the next sync writes N back over N+1; the next use presents the already-consumed refresh token; the endpoint rejects it; claude clears the file. The instance is logged out because the cleared file IS the instance's credential.

The state is still on disk in the lab home today. The file was rewritten at 15:59 local on 2026-09-16, three hours after the wiping run, and now holds a blob whose access expiry is 2026-09-09 and whose refresh expiry is 2026-10-08 — a pre-rotation generation restored over the cleared shell by a later sync. `credentialFileExpiry` returns the LATER of the two expiries, so `claudeAuthenticated` still answers yes for a credential that cannot actually refresh.

The in-container CLI really is the second writer: the unit image installs claude 2.1.272 and sets the unit user's home to an ordinary home directory with no `.claude` symlink, and the condition passes `CLAUDE_CONFIG_DIR=/creds/claude`; pilot B's claude scored 4 in a real unit off that mount. The provider's own comment about upstream #47661 (Linux reads the default home, writes the scoped dir) does not describe what 2.1.272 does here — a determination step below re-confirms it rather than trusting either reading.

The defect is not that two writers exist. It is that the sync is unconditional: it is the only participant that can move the credential chain BACKWARD, and it does so immediately before the other writer runs.

## Proposal

**Make `syncClaudeCredentialFile` newer-wins.** One function in `records.ts`; all four call sites keep calling it exactly as they do.

Today the function reads the keychain and, with a usable blob, overwrites the file unless the bytes already match. The change: read both stores, compare `claudeAiOauth.expiresAt` (the access-token expiry — a refresh always mints a later one), and write only when the keychain's blob is the later of the two. A file that is not `credentialUsable` never wins, so the existing heal-the-shell and remove-the-shell paths keep working unchanged. When either side carries no `expiresAt` the keychain wins, which is today's behavior and therefore the safe fallback.

Concretely, the decision table the implementation owes:

| file | keychain | action |
|---|---|---|
| absent / unusable | usable | write the keychain blob (today) |
| absent / unusable | none | remove a shell if present, report false (today) |
| usable | none | leave the file alone, report true (today leaves it but reports false) |
| usable, same bytes | usable | no write (today) |
| usable, earlier `expiresAt` | later `expiresAt` | write the keychain blob (today) |
| usable, later `expiresAt` | earlier `expiresAt` | **leave the file alone — the new case** |
| either side has no `expiresAt` | usable | write the keychain blob (today) |

The return value changes meaning from "the file holds the current keychain credential" to "a usable credential is in the file after the call". No caller reads it — the two spawn sites swallow it with `.catch(() => false)`, the login watch re-probes, and `claudeAuthenticated` reads the file itself — so this is a docstring change plus its tests, not a behavior change for callers.

**Add two warn lines, no secrets.** One when the sync declines to overwrite (the file is ahead of the keychain — the container-rotated case, which should be rare and should be visible when it happens), one when it heals a cleared shell from the keychain. Each names the scoped home and the two expiries, never token material. Today both events are silent, which is why G9 had to be reconstructed from a file mtime.

**The eval mount stays read-write.** Not merely for the refresh: claude writes its transcripts into `projects/` under the scoped home, and the eval's model read-back parses exactly those files off the host side of the same mount. A read-only mount would return `model.observed` null for every containerized claude cell.

**Keychain write-back is deliberately NOT in this change.** See alternative (a2).

Scope of the diff: `packages/local-agent-claude-code/src/records.ts` and its tests, plus the package README's credential section and its bilingual sidecar. `packages/eval` is not touched — the mount is already read-write and must stay so.

## Alternatives considered

**(a2) Newer-wins plus write-back to the keychain.** When the file is ahead, also push it into the keychain (`security add-generic-password -U`). It keeps the keychain a valid recovery copy rather than letting it drift arbitrarily far behind. Rejected for this change: the package has only ever READ the keychain, a write is a new capability with its own authorization-prompt behavior, and it is not needed for correctness — after the file wins once, the next host round refreshes from the file and writes the keychain itself, so the stores re-converge on their own. Worth revisiting if the keychain is ever wanted as a restore path.

**(b) A container-only named scope.** T29 gives every condition a `scope` field, so claude's container conditions could run against `claude-code@<scope>`, synced once at login and never again, leaving the unit the sole writer. It is the only candidate that removes the concurrent-refresh race entirely, and it matches the standing rule that each scope logs in separately. Rejected as this task's fix for three reasons: it costs a human login per container scope; the sync would still have to be suppressed for that scope, because `claudeAuthenticated` syncs on every status and readiness probe, so (a)-shaped work is needed anyway; and the eval side cannot currently request a named scope for a condition — the condition files have the field but the Remote face has no `conditionsProvision`, which is T33f's territory, not this package's. Recommended as the follow-on once that path exists.

**(c) Read-only mount, refresh held in memory.** Dead on arrival for a reason independent of credentials: the scoped home is also where claude writes `projects/<cwd-slug>/*.jsonl`, and the eval's `readClaudeTranscriptModel` read-back parses those from the host side of the mount. Read-only loses every containerized claude round's observed model. Whether claude tolerates a read-only credential directory at all is therefore not worth determining.

**(d1) A kimi-style sentinel backup.** kimi's `credential-guard.ts` snapshots a valid credential and restores it over an exact empty shell. claude already has the equivalent — the keychain IS the other copy, and the sync already restores from it — and that restore is precisely what produced the stale blob sitting in the lab home now. Adding a third copy would add a third way to resurrect a consumed token. Rejected; the warn lines above deliver the part that was actually missing, which is visibility.

**(d2) Skip the pre-spawn sync when the target is a container exec.** Cheap — one condition at each of the two spawn sites, keyed on `spec.exec !== undefined`. But it fixes only the spawn sites: `claudeAuthenticated` syncs from every status read and every readiness probe, and T20c made the readiness probe a real delegation, so the clobber survives the change. Rejected as a partial fix that would read like a whole one.

**(d3) Stage a per-run copy of the credential into a scratch directory.** Rejected against the standing credential rule — credentials are not copied, they live in the 0600 file and the keychain and nowhere else — and it would also break the transcript read-back, which needs the round's output in the instance's own scoped home.

## Acceptance criteria

1. A container round that rotates the credential leaves the file rotated: a host sync immediately afterwards does not revert it, and the scope's next host round succeeds.
2. The ordinary host-only rotation still works: with the keychain ahead of the file, the sync updates the file exactly as it does today.
3. A cleared shell is still healed from the keychain, and a shell with no usable keychain blob is still removed.
4. After a container round reports ready for a scope, the same instance's host round for that scope is still ready and `/claude-code status` still reports authenticated.
5. `local-agent-claude-code` tests all green; `gate` green.
6. No token material in any log line, test fixture, Agent Note, or report.

## Verification recipe

The timing cannot wait for a real expiry, so it is staged. Nothing below writes a token; the only credential-file edit is to a clock field.

**Unit level, first.** `records.spec.ts` already swaps `internals.exec` for a fake `security`, so every row of the decision table above is a unit test against a temp home: file-ahead (untouched), keychain-ahead (rewritten), shell plus usable keychain (healed), shell plus nothing (removed), usable file plus no keychain (untouched), identical bytes (no write, mtime unchanged), and a blob missing `expiresAt` (keychain wins). This is where the fix is actually proven; the staged run below proves the wiring.

**Determination step.** Before staging anything, confirm which process writes the mounted file: acquire one unit against a scratch scope, run a single `docker exec` claude round in it, and check whether the mounted `.credentials.json` mtime moves. This settles the #47661 question for the image's claude 2.1.272 and tells us whether the wipe is host-side or unit-side. Both attributions are covered by the fix, but the note should state which one happened rather than leave two readings.

**Staged end-to-end**, on a throwaway named scope, not the default one — a rehearsal that goes wrong must not log the instance out a second time:

1. Fingerprint, no secrets: a node snippet printing `sha256(refreshToken)` truncated to 8 hex chars, `expiresAt`, and the file mtime. Call it before and after each step; this is the only credential read anything records.
2. Force the unit to refresh: rewrite ONLY `claudeAiOauth.expiresAt` to a moment in the past, every other field byte-identical, mode still 0600. This is a clock edit, not a credential edit — claude then treats the access token as expired and refreshes on its next run.
3. Run one container round against that scope. The refresh-token fingerprint must CHANGE and `expiresAt` must move into the future: the unit rotated the chain and wrote through the mount.
4. Trigger a host sync at once — `/claude-code status --scope <name>` goes through `claudeAuthenticated` → `syncClaudeCredentialFile`. Before the fix the fingerprint reverts to step 2's value, which is the resurrection observed directly; after the fix it still equals step 3's.
5. A host round on that scope then succeeds, proving the surviving file is the live chain.
6. Reverse direction, so the fix cannot pass by simply never writing: set the FILE's `expiresAt` to the past, run a HOST round (which refreshes into the keychain), and confirm the next sync updates the file.

Then, on the default scope, the acceptance run: container round ready, host round ready, status unchanged. That scope needs a fresh login first — the blob it holds today is a pre-rotation generation and cannot refresh — so the login is a precondition of step 2's acceptance, not a consequence of it.

**Evidence discipline.** Logs, the Agent Note, and the report carry fingerprints, expiries, mtimes and booleans only. The credential file is never printed, and the keychain is never dumped into a transcript.

## Risks

- **The concurrent-refresh race remains.** Newer-wins removes the systematic resurrection — a sync that hands back a consumed token — but two processes that refresh the same single-use token at the same moment still lose one of the chains. A host round overlapping a container round can still do this; the container path is serial per cell, so the window is small but real. Only alternative (b) removes it, and it is the recommended follow-on for exactly this reason.
- **`expiresAt` as the freshness key.** It assumes a refresh always mints a later access expiry. A blob missing the field falls back to keychain-wins, which is today's behavior; a file hand-edited to a future expiry would win wrongly, which only an operator can cause, and step 2 of the recipe deliberately edits the other way.
- **A dead credential still reads as authenticated.** `credentialFileExpiry` returns the later of the access and refresh expiries, so a blob whose access token expired in early September but whose refresh expiry is October — exactly the lab home today — reports authenticated until a round fails. This is a separate defect and this change does NOT touch it: tightening the probe would turn currently-ready scopes not-ready, which is a call for the coordinator, not a side effect to smuggle in.
- **Stores drift apart without write-back.** Declining to overwrite lets the keychain fall arbitrarily far behind. Harmless while the host CLI reads the file, but a future claude that reads the keychain first would resurrect the old blob by a different route. (a2) is the answer if that happens.

## Other harnesses

- **codex**: `provisionCodexConfig` pins `cli_auth_credentials_store = "file"`, so there is exactly ONE store and the host and unit share it through the mount — one chain, no resurrection path, no fork. Its T33e failure was present on the host round too, so it is not this bug and is not addressed here.
- **kimi**: file-only store, no keychain, so no fork either. Its `credential-guard.ts` can replay a consumed refresh token by restoring its `.bak` over an empty shell — the same family — but it restores only over an exact shell, never over a usable file, and its own note bounds the damage at one more loud failure. No change proposed.
- **dsh**: API key injected through the environment, no refresh flow. Unaffected.

## Relation to T33f

T33f is dsh's problem of one scope shared by both sides and how it heals; it is an observation item and this task does not touch it. Worth stating plainly: the recommendation deliberately does NOT stop claude from sharing one scope across both sides — it makes that sharing survivable. Alternative (b) would have cut claude's two-side sharing as a side effect; choosing (a) means claude's sharing stays exactly as T33f describes it for dsh, and a later decision there applies to claude on the same terms.
