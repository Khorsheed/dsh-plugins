# Agent Note: claude manual-handoff login — the CLI's auth is TTY-only now

Status: implemented

English | [中文](2026-08-22-claude-manual-login.zh.md)

## Problem

The family's claude login broke against claude CLI 2.1.235: the harness declared a device-code-style login (`claude auth login`, prompt captured from stdout), but current claude prints NO OAuth URL on a non-TTY stdout — it answers `Invalid API key · Please run /login` and exits, even with a fresh empty `CLAUDE_CONFIG_DIR`; the `setup-token` alternative needs Ink raw mode and dies without a TTY. The core's prompt-capture flow (`LocalAgentRegistry.runLogin`) therefore cannot re-authenticate claude at all. This is the second time scraping a CLI's output format broke (the kimi prompt-shape capture is the other), so the fix stops scraping for claude instead of re-scraping a new format.

## Decision

A second `login` variant on the harness contract (`LocalAgentLogin` union in `packages/local-agent/src/index.ts`): beside the unchanged device-code member sits the **manual handoff** — `{ manual: { commandDisplay }, watch? }`. When declared, `/<harness> login` spawns NOTHING: it replies with instructions naming the exact command for the user's own terminal, and the registry polls the credential probe (`watch ?? harness.isAuthenticated`) every `MANUAL_LOGIN_POLL_MS` (2s), bounded by `MANUAL_LOGIN_LIMIT_MS` (5 min). The reply cannot carry the outcome (the command channel has already returned), so success and the timeout are logged, and the surfaces' own status polling (the settings section re-probes every few seconds and shows the login toast) picks the landed credential up. A second `/login` replaces the in-flight watch — the existing pending-login replace semantics, generalized: the controller now carries an optional `stop` (cancels a watch) alongside the device variant's child kill.

The claude harness declares it with the relay env scrubbed and the scoped home pinned, exactly:

```
env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR=<homeDir> claude auth login
```

The device-code member is byte-unchanged: kimi and codex declarations compile and behave as before.

## Alternatives considered

- **Allocating a PTY for the CLI** — rejected: a pseudo-terminal dependency (node-pty or script(1) wrapping) is heavy, platform-fragile, and still leaves us parsing a TUI frame buffer — strictly worse than the scraping it replaces.
- **`claude setup-token`** — rejected: it drives an Ink raw-mode TUI (verified: dies without a TTY), the same PTY problem with a worse UX (manual token paste).
- **Blocking the `/login` reply until the credential lands** — rejected: a reply held open for minutes freezes the command node and the settings UI's runCommand await; the immediate-reply + status-polling pattern is how the device flow already surfaces completion.
- **Scraping the new TTY output format** — rejected on the incident's own evidence: two scrapes broke in a row; a TTY-only flow is not ours to stabilize.

## Consequences

- `/claude-code login` works again, through the user's own terminal; the settings panel's status poll and login toast are untouched and complete the UX.
- The pending-slot replace semantics now cover both variants (watch stop or child kill), so a retry mid-handoff is clean.
- A manual watch expiring with no credential only logs — the user-visible signal is the settings row staying unauthenticated; the reply text states the 5-minute window.
- Any future TTY-only CLI gets the variant for free (declare `manual`, no core change).

## Testing

`packages/local-agent/tests/local-agent.spec.ts` gains a manual-variant suite (4 tests, fake timers): the instructions reply carries the display command and the success reply proves nothing spawned (the manual declaration holds no spawnable command); the watch polls and stops when the probe flips; the watch stops at the window expiry; a second login replaces the first (single-watch poll rate). The device-code suite is untouched and green. `packages/local-agent-claude-code/tests/apply.spec.ts` pins the declaration: manual variant present, display command verbatim including the scoped-home path. Suites: local-agent 150/150, local-agent-claude-code 38/38, family regression green.

## Cross-references

- The harness contract and settings surfaces live with the [local-agent family note](../feature/2026-08-14-local-agent-family.md).
