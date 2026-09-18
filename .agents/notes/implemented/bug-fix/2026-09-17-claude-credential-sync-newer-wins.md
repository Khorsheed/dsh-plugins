# Agent Note: The claude credential sync never moves the chain backward

Status: implemented

English | [中文](2026-09-17-claude-credential-sync-newer-wins.zh.md)

## Problem

A containerized claude round logged the whole instance out. T33e observed it — host round ready in 12.0 s, container round NOT READY, `.credentials.json` emptied at the probe moment (both tokens empty strings, `expiresAt` 0) — and it is the failure the dataset repository's pilot log recorded as G9. Recovery needed a human at a terminal.

Three facts had to be true at once, and all three were:

1. **Two stores, one-way sync.** On macOS the OAuth credential lives both in the keychain (an item per config-dir path hash) and in `<homeDir>/.credentials.json`. claude 2.1.236 WROTE the keychain and READ the file, so `syncClaudeCredentialFile` mirrored keychain → file and only that direction. (Which store the CLI itself uses turned out to be version-dependent, and the 2.1.236 reading does NOT hold for current macOS — see the correction under Consequences.) It runs from four places: the exec spawn site, the resident live-driver spawn site, `claudeAuthenticated` (so every status read and every readiness probe), and the login watch.
2. **The unit is a second writer to the same file.** Since T20c the container round bind-mounts the instance's own scoped home read-write, and `acquireSpecFor` declares exactly that one mount. There is no keychain inside a unit, so the CLI there reads and writes the mounted file: access token expired → refresh → the rotated blob lands back on the host through the mount.
3. **The sync runs against the HOST directory even on a container round.** The provider builds `env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir })` with the host path, and `containerExecSpawn` substitutes the in-container path only for the `docker exec -e` forwarding. So the pre-spawn `syncClaudeCredentialFile(configDir)` operated on the host scoped home moments before the unit read that very file through the mount.

The chain that followed was forced: the unit rotates the refresh token and writes generation N+1; the keychain still holds N; the next sync writes N back over N+1; the next use presents an already-spent refresh token; the endpoint rejects it; the CLI clears the file. The instance is logged out because that file IS the instance's credential.

The defect was never that two writers exist. It was that the sync was unconditional — the one participant that could move the credential chain BACKWARD, doing so immediately before the other writer ran.

**Both open questions were settled by measurement, with no real credentials involved.** A scratch directory holding obviously fake tokens and a past access expiry was mounted at the condition's in-container path and one round was run in `eval-env:pinned` on the eval network. Two things came back:

- The round answered `Failed to authenticate: OAuth session expired and could not be refreshed` and **the mounted file was left with both tokens empty and `expiresAt` 0** — byte-for-byte the shape T33e observed. So the clearing writer is the CLI INSIDE the unit, not anything on the host, and claude 2.1.272 honors `CLAUDE_CONFIG_DIR` for the credentials file on Linux. The provider's inherited comment about upstream #47661 (Linux reads the default home) does not describe this version; the README's Known Limitations entry is left as it stands because only the container case was measured here.
- The same run created `projects/`, `sessions/`, `backups/` and `telemetry/` inside the mounted directory. The round's transcripts land there, and the evaluation's model read-back parses them from the host side of the same mount.

## Decision

`syncClaudeCredentialFile` is **newer-wins**. One function in `records.ts`; all four call sites keep calling it.

It now reads both stores and compares `claudeAiOauth.expiresAt` — the ACCESS-token expiry, via a new `credentialAccessExpiry` helper. Deliberately not `credentialFileExpiry`: that one answers "is this credential still usable" and takes the LATER of the access and refresh expiries, so two generations of one grant share a refresh expiry and compare equal. A refresh always mints a later access expiry, which is exactly what tells the generations apart.

The keychain blob is written only when it is not older than the file's:

| file | keychain | action |
|---|---|---|
| absent / unusable | usable | write the keychain blob (unchanged) |
| absent / unusable | none | remove a shell if present, report false (unchanged) |
| usable | none | leave the file alone, report **true** (reported false before) |
| usable, same bytes | usable | no write (unchanged) |
| usable, earlier `expiresAt` | later `expiresAt` | write the keychain blob (unchanged) |
| usable, later `expiresAt` | earlier `expiresAt` | **leave the file alone — the new row** |
| either side has no `expiresAt` | usable | write the keychain blob (unchanged) |

An unusable file never wins however late its expiry, so a cleared credential is still healed from the keychain and a shell with nothing usable behind it is still removed.

**Two decisions that used to be silent now log.** The function takes an optional warn channel. One line when it declines to overwrite — the file is ahead of the keychain, the signature of a containerized round having rotated the grant. One line when it heals a cleared credential, saying that if the next round still fails to authenticate then this grant was already spent and the scope needs a fresh login. Both carry the scoped home and the two expiries and never token material; a test asserts neither store's tokens appear in the line. Reconstructing the previous occurrence took a file mtime and a pilot log, which is why silence was itself part of the defect.

The channel is wired where a logger exists: both spawn sites, the login watch, and — through `claudeAuthenticated`'s new optional second parameter — the authentication probe. That last one matters most: it is the clobber site the spawn sites do not cover, because T20c made the readiness check a real delegation and the probe runs on every status read.

The return value now answers "a usable credential is in the file after the call" rather than "the file holds the current keychain credential". No caller reads it — the spawn sites swallow it with `.catch(() => false)`, the login watch re-probes, and `claudeAuthenticated` reads the file itself.

**The eval mount stays read-write**, and `packages/eval` is untouched. Read-only was measured to be a dead end for a reason unrelated to credentials: the transcripts the model read-back parses are written into that same directory.

## Consequences

- A containerized round can rotate the grant without the host handing the next run a spent token. The systematic resurrection is gone.
- The keychain may now drift arbitrarily far behind the file.
- **A correction, measured after this note shipped.** The two sentences that used to follow the line above — that the drift is harmless because the host CLI reads the file, and that the stores re-converge once the next host round refreshes from the file — are both FALSE on current macOS. Measured on 2.1.274: the host CLI reads and writes the KEYCHAIN. It therefore never refreshes from the file, the stores do not re-converge, and a rotation on either side invalidates the other's token family outright. Newer-wins remains correct and necessary for everything that reads the FILE (a container round, and this package's own probes), and that half was verified live; it simply cannot speak for the keychain side. The answer is not a write-back but a separation — see [the container-scope note](2026-09-18-claude-container-scope.md).
- A rare, real event is now visible in the log instead of reconstructible from a file mtime.
- On a Linux host, where the keychain does not exist, a usable file is no longer reported as an unusable credential.
- WHICH keychain item this reconcile compares against is decided by the service enumeration's newest-first ordering, and that ordering had a defect of its own — it never parsed the stamp `security` prints, so it returned whichever usable item the dump listed first. Newer-wins is only as good as the item it is handed; see [the keychain stamp ordering note](2026-09-17-keychain-stamp-ordering.md).

## Alternatives considered

**Newer-wins plus write-back to the keychain.** When the file is ahead, also push it into the keychain (`security add-generic-password -U`), keeping the keychain a valid recovery copy. Deferred here, and later REFUSED outright: `security` takes the secret only as an argv value (or an interactive prompt, useless headlessly), so closing one credential-exposure path would open another. See [the container-scope note](2026-09-18-claude-container-scope.md).

**A container-only named scope.** T29 gives every condition a `scope` field, so claude's container conditions could run against `claude-code@<scope>`, leaving the unit the sole writer of that grant. Not taken here, for reasons that were right about the cost and wrong about the necessity: it costs a human login per container scope, and newer-wins-shaped work is needed anyway. It was recorded as the follow-on — and it became the decision once the host CLI was measured to read the keychain, because separation is then the only thing that works. See [the container-scope note](2026-09-18-claude-container-scope.md).

**Read-only mount, refresh held in memory.** Measured dead: the same round that would be denied its credential write is also denied `projects/`, and the evaluation's `readClaudeTranscriptModel` read-back parses exactly those files from the host side of the mount. Whether claude tolerates a read-only credential directory never had to be determined.

**A kimi-style sentinel backup.** kimi's `credential-guard.ts` snapshots a valid credential and restores it over an exact empty shell. claude already has the equivalent — the keychain IS the other copy and the sync already restores from it — and that restore is what leaves a stale generation on disk after a wipe. A third copy would add a third way to resurrect a spent token. The warn lines deliver the part that was actually missing, which is visibility.

**Skipping the pre-spawn sync when the target is a container exec.** Cheap — one condition at each spawn site keyed on `spec.exec !== undefined` — but it fixes only the spawn sites. The authentication probe reconciles from every status read and every readiness check, so the clobber would survive a change that reads like a whole fix.

**Staging a per-run copy of the credential into a scratch directory.** Refused against the standing credential rule — credentials are not copied, they live in the 0600 file and the keychain and nowhere else — and it would break the transcript read-back, which needs the round's output in the instance's own scoped home.

## Testing

`records.spec.ts` gains a `newer wins` suite, one case per row of the decision table, on a temp home with `internals.exec` stubbed as a fake `security`: a file ahead of the keychain is kept and reported, a keychain ahead of the file still writes, a blob with no access expiry still lets the keychain write, an unusable file never wins however late its expiry, identical blobs do not touch the file's mtime, and a rotated file survives `claudeAuthenticated` as well as the sync. The warn assertions check that neither store's token values appear in the emitted line. One pre-existing case changed its expectation with the return-value meaning: a usable file with nothing usable in the keychain now reports true.

Not covered by tests, and the reason it is not: a REAL rotation inside a unit needs a real grant, which no test may hold. The determination run above exercises the unit's read-and-clear behavior with fake tokens; the host half is exercised by the suite; the seam between them — a live container refresh followed by a host reconcile — is a staged rehearsal on a throwaway named scope, which needs an interactive login and therefore a person.

## Risks

- **~~The concurrent-refresh race remains.~~ It is not a race.** This note called a shared grant a narrow timing window; measurement showed it is the guaranteed outcome of sharing at all. The endpoint invalidates the whole token family on rotation, so a container round that refreshes kills the host's copy whether or not the two overlap in time. Only the named-scope separation removes it, and that is now the rule — see [the container-scope note](2026-09-18-claude-container-scope.md).
- **`expiresAt` as the freshness key** assumes a refresh always mints a later access expiry. A blob missing the field falls back to keychain-wins; a file hand-edited to a future expiry would win wrongly, which only an operator can cause.
- **A dead credential still reads as authenticated.** `credentialFileExpiry` returns the later of the access and refresh expiries, so a blob whose access token expired days ago but whose refresh expiry is weeks out reports authenticated until a round fails. Untouched here on purpose: tightening the probe would turn currently-ready scopes not-ready, which is a separate decision. Recorded as an observation.
  One consequence was then measured: the login watch syncs and then probes, so a stale-but-"authenticated" blob makes the watch declare success and stop. On the instance this note came from it stopped 51 seconds BEFORE the fresh login reached the keychain — the file's write stamp preceded the new item's by that much — and nothing mirrored the real credential afterwards.

## Other harnesses

- **codex**: `provisionCodexConfig` pins `cli_auth_credentials_store = "file"`, so there is exactly ONE store and the host and unit share it through the mount — one chain, no resurrection path, no fork. Its T33e failure was present on the host round too, so it is not this bug.
- **kimi**: file-only store, no keychain, so no fork either. Its `credential-guard.ts` can replay a spent refresh token by restoring its `.bak` over an empty shell — the same family — but it restores only over an exact shell, never over a usable file, and its own note bounds the damage at one more loud failure. Recorded as an observation; unchanged.
- **dsh**: API key injected through the environment, no refresh flow. Unaffected.

## Relation to T33f

T33f is dsh's problem of one scope shared by both sides and how it heals; it is an observation item and this change does not touch it. Stated plainly: newer-wins deliberately does NOT stop claude from sharing one scope across both sides — it makes that sharing survivable. The named-scope alternative would have cut claude's two-side sharing as a side effect; taking newer-wins instead means claude's sharing stays exactly as T33f describes it for dsh, and a later decision there applies to claude on the same terms.
