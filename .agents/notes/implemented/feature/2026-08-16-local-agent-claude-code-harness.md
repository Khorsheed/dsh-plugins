# Agent Note: Claude Code harness — one-shot `claude -p` delegation under a scoped config dir

Status: implemented

English | [中文](2026-08-16-local-agent-claude-code-harness.zh.md)

## Problem

The [local-agent family](2026-08-14-local-agent-family.md) had two harness samples (Kimi, Codex) whose shape — scoped home per harness, browser/device login, records adapter, one-shot CLI delegation — needed a third validation before freezing, and Claude Code was the named candidate. Claude differed from both in three concrete ways:

1. **Login is a browser OAuth flow, not a device-code URL** — `claude setup-token` reads a token from stdin (TUI/interactive, hangs under the framework's stdin-ignore spawn), while `claude auth login` prints the browser authorization URL to stdout — the same capture contract codex's device-code flow uses.
2. **Credential storage is platform-dependent** — macOS keeps the real credential in the OS keychain under a hashed entry keyed to the config-dir path; Linux has upstream bug #47661 where `CLAUDE_CONFIG_DIR` does NOT isolate the credentials file (writes scoped, reads the default home). Auth detection must be a light file check, never a CLI spawn.
3. **Records are project files with a lossy directory slug** — sessions live in `projects/<cwd-slug>/<uuid>.jsonl` where the slug encodes the workspace path lossily (separators → dashes, collisions possible), so the listed cwd must come from file CONTENT (the first `user` event's `cwd`), never the directory name.
4. **The child needs permission bypass** — `claude -p` without `--dangerously-skip-permissions` denies write actions in non-interactive mode (no approval surface), so a one-shot subagent cannot do real work.

## Decision

`@khorsheed/dsh-local-agent-claude-code` (`packages/local-agent-claude-code/`) is the third harness bundle, same seam shape as kimi/codex:

- **Harness** `claude-code`: `CLAUDE_CONFIG_DIR` scoped home, `login: { command: 'claude', args: ['auth', 'login'], capture: 'stdout' }` (the browser OAuth URL surfaces in the session, CLI polls in the background), records from project files, `isAuthenticated` = scoped `.claude.json` carries an `oauthAccount` (light file check, never a CLI spawn), `logout` removes the scoped config file (the keychain entry on macOS is left for `claude auth logout` and rewritten on next login).
- **Provider** `claude-local`: one-shot `claude -p [--dangerously-skip-permissions] --output-format json "<task>"` under the scoped home. The JSON result line carries `result` (final answer), `usage` (Anthropic counters: `input_tokens` uncached, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — each maps to its own bucket, no subtraction), and `session_id`. `--output-format json` is strictly better than parsing plain stdout: one deterministic line yields both the answer and the accounting.
- **Config**: `permissionMode` (`skip` default passes the permission bypass; `normal` omits it) and `baseUrl` (sets `ANTHROPIC_BASE_URL` for the child; absent inherits the host environment, e.g. a user proxy like `https://proxy.example.com/anthropic`).
- **Patch** `cordis.patch.yml` inserts only `local-agent-claude-code` + `tool-subagent-claude-code-local` (provider `claude-local`, toolName `subagent_claude_code_local`, `enableRunInBackground: false`, `maxDepth: provider-managed`) at the profile root — following the [profile-root delegation decision](2026-08-15-profile-root-delegation-tools.md). The family core row is deliberately **not** re-inserted: the framework bundle's own patch owns it (see [delegation-accounting](2026-08-16-delegation-accounting.md) for the shared timing/usage append discipline, replicated here: `turn/start` at spawn, `turn/end` at every terminal settle with `completed`/`error`/`aborted` reasons, and usage on the final `assistant/message`).
- **v1 output**: the JSON result's `result` field is appended as a single assistant message (user/message + assistant/message with usage + persistence), visible in the 子代理 surface; a full event-stream mirror is deferred to v2.

Provider and tool names (`claude-local` / `subagent_claude_code_local`) avoid the DUPLICATE_PROVIDER collision with the official `subagent-claude-code` provider (`claude-code`) and the disabled `subagent_claude_code` preset row.

## Alternatives considered

- **`claude setup-token` as the login command**. Rejected after testing: it reads the token from stdin (TUI), which hangs under the framework's stdin-ignore spawn; `claude auth login` prints the browser URL to stdout and matches the existing `login.capture: 'stdout'` contract.
- **Probe auth by spawning the CLI** (`claude auth status`). Rejected: slow and, on Linux with the credentials bug, would report the default home's state rather than the scoped home's; the scoped `.claude.json` `oauthAccount` check is a pure file read.
- **Plain `claude -p` stdout as the run output**. Rejected: plain stdout is the final answer but carries no accounting; `--output-format json` yields the answer and the usage in one parse, mirroring codex's `--json` decision.
- **Default `permissionMode: 'normal'`**. Rejected: a one-shot CLI subagent has no approval surface, so without the bypass it cannot do real work; `skip` is the working default with `normal` as the opt-in restricted mode.

## Consequences

- Claude Code delegations are now ambient across every agent preset (`subagent_claude_code_local` at the profile root), isolated under `$DSH_HOME/local-agent/claude-code`, and listed by `/claude-code sessions` and the family's settings section (narrowed per project by the content-sourced `workDir`).
- The harness shape gained its third sample: a browser-OAuth login (vs kimi/codex device-code), a JSON-single-line delegation output (vs codex's NDJSON stream), and a platform-dependent credential probe — all absorbed without framework changes.
- macOS keychain entries persist across `/claude-code logout` (documented); Linux credentials are not isolated from the default home (upstream bug, documented) — both are known limitations, not silent behaviors.
- Timing and token accounting ride the same projections as kimi/codex (turn boundaries + usage on the final message), verified with a real delegation: timing ratio 1.00 and non-zero four-bucket usage (including cache write, which claude reports and codex does not).

## Verification

- Unit tests: records parsing (content-sourced cwd across lossy slugs, malformed files skipped, `oauthAccount` auth probe), provider settlement (JSON result → output + usage buckets, failure closes the turn with an error reason), child-session record creation with the resolved descriptor, apply registration + provisioning, patch rows, invariant home-env check, and provision/logout file behavior.
- Real delegation: one `claude -p --output-format json` run through the provider, folded `subagentTiming` ≈ wall clock (ratio 1.00) and non-zero `tokenUsage` totals with all four buckets populated.
- oxlint, typecheck, translation pairing, doc budgets, and README limitations gates pass for this change's surface.
