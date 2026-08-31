# Agent Note: the give-up crash page must survive an occupied port

Status: implemented

English | [中文](2026-08-31-crash-page-eaddrinuse-park.zh.md)

## Problem

An e2e upgrade rig (2026-08-30) caught the give-up path degrading into a boot-loop fight. The watchdog gave up after counted failures and spawned its crash page — but the port was still occupied (the failure class was EADDRINUSE itself, the common case at give-up), and `page_script`'s `server.listen` had no `error` handler. The page died on the unhandled `error` event, the watchdog's `wait $page_pid` returned instantly, and the loop `continue`d — back into boot attempts, with `failures` already ≥ 4, so every pass re-entered give-up and respawned a page that crashed again. The "park and wait for a human" design silently became "keep boot-attempting forever", and each port-race retry killed the healthy occupant the watchdog had just given up against.

## Decision

The crash page now treats a failed bind as the expected give-up shape, not a fatal one: on `EADDRINUSE` it logs one line ("crash page cannot bind … SIGUSR1 re-arms the boot loop") and retries the bind every 5 s with a fresh server. The page process therefore stays alive, the watchdog's `wait` blocks as designed, and the give-up state is a genuine park: no boot attempts, no `free_port` kills, SIGUSR1 (or the page's own retry button, once the bind succeeds) re-arms the loop. Nothing about the counted-failure or port-race logic changes.

## Alternatives considered

- **Park the watchdog itself when the page fails to bind** (skip the page, sleep until SIGUSR1) — rejected: it forks the give-up state into two shapes (page-parked vs bare-parked) for a corner already covered by making the page itself resilient; one park mechanism is simpler.
- **Exit the watchdog on give-up** (matching what the rig report assumed the design was) — rejected: an exited supervisor cannot be re-armed by SIGUSR1 and leaves the port unsupervised; the crash page's whole point is keeping a live, retryable presence.
- **Backoff-cap the boot loop after page death** — unnecessary once the page stops dying; adding a second safeguard for a path that no longer occurs would be dead code.

## Consequences

- Give-up under an occupied port is now observably parked: the log carries one "cannot bind" line instead of an unhandled-exception stack per cycle, and the occupant is left alone. The regression test (`give-up parks when the crash page cannot bind`) runs a real watchdog through four counted failures with a bare TCP holder on the port, and asserts: attempt count freezes, no unhandled-error line, the holder survives, and SIGUSR1 resumes boot attempts. It fails against the pre-fix script.
- The rig's companion observations were also verified against the log: own-port EADDRINUSE classification was correct all along (attempts 1–4/5 freed the port without counting), and the watchdog process did NOT die when the page crashed (it kept boot-attempting — the disappearance the rig observed was its own teardown).
- Residual gap, deliberately accepted: a give-up whose counted failures came from attempt logs with no EADDRINUSE line (instance killed before it could log) still counts toward give-up — that classification gap is inherent to reading logs, and the composition/composition-rollback layers own that failure class.
