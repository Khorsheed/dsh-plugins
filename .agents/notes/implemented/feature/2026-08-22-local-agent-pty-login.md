# Agent Note: pty login variant — the CLI opens the browser, we just give it a terminal

Status: implemented

English | [中文](2026-08-22-local-agent-pty-login.zh.md)

## Problem

The [manual-handoff login](../bug-fix/2026-08-22-claude-manual-login.md) made claude re-auth a terminal errand: copy a command, run it, come back. The first-generation flow was better — click login, the browser opens. It broke when claude ≥2.1.235 made auth TTY-only, and the manual note rejected a PTY on the grounds that "we would still be parsing a TUI frame buffer."

## Decision

That rejection was wrong about one fact: under a PTY the CLI **opens the browser itself** and prints the OAuth URL as plain fallback text (verified against claude 2.1.236) — nothing needs TUI parsing. The remaining gap is the OAuth code the page hands back, which the CLI reads from stdin.

The third `LocalAgentLogin` variant, `{ pty: { command, args }, watch? }`:

- Spawn rides the **official subprocess seam's `spawnTerminal`** (node-pty backend, cross-platform incl. Windows conpty) — no new native dependency, no `script(1)` wrapper (BSD script rejects a socket stdin, which is what `child_process` pipes are; that path was tried and abandoned).
- The OAuth URL is captured from the terminal output into the reply as a fallback link; the reply also names the paste command.
- `/<name> code <value>` (a registry-level subcommand) writes the pasted code to the terminal (`\r`-terminated). `statusOf` exposes `loginAwaitingCode` so the settings section renders a paste box exactly while a pty login waits.
- Completion is the shared `watchCredential` (presence + fresh `credentialStamp`), the same watch the manual variant uses; replacement kills the old terminal (`terminate()`) alongside the existing device-child ladder.
- When the composition lacks the subprocess seam, the variant degrades to the manual-handoff reply.

claude declares `pty` with the relay env scrubbed and the scoped home pinned, replacing the `manual` declaration as the primary path; the manual flow remains the documented fallback (and the win32/seam-missing degradation).

## Alternatives considered

- **`script(1)` as the PTY wrapper** — rejected empirically: BSD script dies with `tcgetattr/ioctl: Operation not supported on socket` because libuv pipes are socketpairs, and its flags differ across macOS/Linux.
- **Keep manual handoff as the only path** — rejected by the product owner: the click-to-browser flow is the family's first-run experience and worth restoring.
- **Parsing the OAuth code page / polling Anthropic ourselves** — rejected: the CLI owns the flow; we only provide its terminal.

## Consequences

- Clicking 登录/重新授权 on claude opens the browser again (one paste step when the page shows a code — new since claude 2.1.235, upstream-imposed).
- Any future TTY-only CLI gets the variant by declaration; Windows works through conpty.

## Testing

Framework: pty login surfaces the captured URL, `statusOf().loginAwaitingCode` flips while waiting, `/<name> code` delivers the paste to the terminal (fake `spawnTerminal`), and a paste with no pending login errors. The manual and device suites are untouched and green.

## Cross-references

- [claude manual-handoff login](../bug-fix/2026-08-22-claude-manual-login.md) — the interim path this supersedes.
- [Auth-failure truthfulness](../bug-fix/2026-08-22-local-agent-auth-failure-truthfulness.md) — the watch both variants share.
