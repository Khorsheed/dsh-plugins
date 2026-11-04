# Agent Note: A kimi member recovers from a session lock its dead process left behind

Status: implemented

## Problem

Kimi Code CLI (`kimi acp`, 2.4.x) claims `<KIMI_CODE_HOME>/locks/sessions/<sessionId>.lock` while a process holds a session, as JSON naming the holder's `pid`, `hostname`, `token` and client. After a host restart in the middle of a round, a member's next `session/load` failed with JSON-RPC `-32603 "Internal error"`, whose `data.details` read "This session is in use by another Kimi Code CLI instance…". Three things went wrong at once:

- The driver dropped `data`, so the room showed only `subagent-kimi live: Internal error`.
- Nothing in the driver looked at the lock. Moving it aside by hand was the only fix.
- Every later round failed in a few milliseconds without spawning a process. The core's member configuration control persists a native-start failure as `status: 'failed'` (`packages/local-agent/src/member-control.ts`), and every later admission throws that stored error until the user retries. Only a refusal by the admission's own check retries itself.

A probe against kimi 2.4.1 on this machine established the CLI's lock behavior:

- A clean exit on stdin EOF releases the lock, even mid-turn, in about 40 ms.
- SIGTERM and SIGKILL leave it behind, because the exit handler that removes it does not run on signal death.
- kimi reclaims a lock itself when its hostname matches and its pid is dead. It refuses when the hostname differs, when the pid is alive (EPERM counts as alive), or when the holder started after the last boot and still runs.

So a refusal means kimi judged the holder alive at that moment, or the lock named another hostname.

## Decision

`packages/local-agent-kimi/src/session-lock.ts` reads and classifies a session's lock:

- `absent`
- `unreadable`: cannot be read or parsed, or the pid is not a positive integer
- `foreign-host`
- `alive`: `kill(pid, 0)` succeeds or fails with anything other than ESRCH
- `stale`: this machine's hostname and a pid that is gone

`setAsideKimiSessionLock` renames a stale lock to `<name>.stale-<timestamp>` in the same directory. Afterwards it re-reads the moved file and puts the lock back (link, never overwrite) if the token changed in between.

The live driver's `loadSession` wraps every `session/load`: round start, compaction, prepare, 立即载入 and reload all go through it.

1. Before the load, a provably stale lock is moved aside, unless a runtime this driver owns, other than the one loading, holds that session. A host warn names the session, the dead pid and the aside file.
2. On kimi's "in use" refusal, matched on `data.details`:
   - If one of this driver's own runtimes holds the session and is retiring, the load waits up to 5 s for it to exit, then retries.
   - Otherwise the lock is re-inspected. If it is now stale (and gets cleared) or absent, the load is retried once.
   - Otherwise the load fails with `KimiSessionOccupiedError`: kimi's sentence plus who holds the session ("process N on this machine still holds it", "held from another machine: H", "its lock file could not be read"). The error carries `beforePrompt: true`.

Every JSON-RPC error response becomes an `AcpRequestError` with `code` and `details`. Its message is `subagent-kimi live: <data.details | data.message | data | message>`, so kimi's own sentence reaches the room.

A runtime whose `session/load` failed clears its `sessionId`. If it were ever reused, the next ensure loads again rather than prompting an unloaded session. The existing reclaim after a failed accept still removes it.

Shutdown hygiene: reclaim already closes stdin first, the exit that releases the lock, and waits 1 s before the SIGTERM ladder. When the ladder has to run, the runtime's `onForcedExit` hook moves its now-stale lock aside, because a signalled kimi leaves it behind.

## Alternatives considered

- **Delete the stale lock.** Rejected: a rename is just as atomic. kimi only ever reads the exact `<id>.lock` path, so the aside copy is inert. The aside file also keeps the evidence of which process held the session. The cost is a few small files in `locks/sessions/`.
- **Clear any lock kimi refuses on, including a live pid (assume pid reuse).** Rejected: a live holder may be a real orphaned `kimi acp` still writing the session. Taking over would interleave two writers on one wire, which kimi's own UI warns "may mix up the history". The user decides that.
- **Treat a hostname mismatch as stale.** Rejected for the same reason. A shared home across machines is legitimate, and kimi itself treats it as alive.
- **Fix the ms-fast retries in the driver.** Not possible: the stored failure lives in the core's member control (S4 territory). Recovering inside the native start keeps a stale lock from ever reaching it. A genuine occupied failure still lands there, now with a readable reason and the `beforePrompt` marker the core can use to classify it as auto-retryable.

## Consequences

- A lock left by a dead member process on this machine no longer blocks the member, whether or not kimi's own stale check would have caught it.
- A truly held session fails with a sentence the user can act on, instead of "Internal error".
- The core still persists a failed native start; until it reads `beforePrompt` or the error class, a member refused by a live holder needs the user's retry after the holder exits.
- `.stale-*` files accumulate in the kimi home's `locks/sessions/` directory, one per recovery.

## Testing

`packages/local-agent-kimi/tests/live-driver.spec.ts`, describe "kimi session lock left by a dead process", against the mock ACP server with temp homes:

- A real dead pid with this hostname: the lock is moved aside, the load succeeds, and the warn is logged.
- Kimi's refusal is re-checked: a holder that died in between is cleared and the load is retried once.
- A live pid (the test process): the lock is untouched, and the error carries kimi's sentence and the holder. No runtime is left behind.
- Another hostname: untouched.
- An unparsable lock: untouched.
- `data.details` propagates for a non-lock ACP error.
- After a failure, the next round spawns afresh and loads.
- A process that ignores EOF is terminated, and the lock it left is cleared.
