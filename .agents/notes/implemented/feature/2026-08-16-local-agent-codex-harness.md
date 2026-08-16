# Agent Note: Codex harness — one-shot `codex exec` delegation under a scoped home

Status: implemented

English | [中文](2026-08-16-local-agent-codex-harness.zh.md)

## Problem

The [local-agent family](2026-08-14-local-agent-family.md) had one harness sample (Kimi Code). The family contract induced from that sample — scoped home per harness, device-code login, records adapter, one-shot CLI delegation — needed a second sample before freezing, and Codex was the named candidate. The official `subagent-codex` bundle already delegates over `codex app-server --stdio` (an ephemeral thread: no session files on disk), so it cannot satisfy the family's file-based records surface; a file-based mirror was impossible without self-writing the provider.

Codex also differs from Kimi in three concrete ways that the harness shape had to absorb or pin:

1. **Login prompt on stdout** — `codex login --device-auth` prints the device-code URL to stdout, not stderr; the framework login flow captured stderr only.
2. **Default credential store is the OS keychain** — `cli_auth_credentials_store` defaults to `auto`, which resolves to the keychain on macOS. Without pinning `file`, credentials would leak outside the scoped home and the `auth.json` presence check would never see them.
3. **Session files are rollout JSONL** — one `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` per session with a `session_meta` head line; unlike Kimi's `session_index.jsonl`, the listing must walk dated directories and read only each file's head.

## Decision

`@deepseek-ai/dsh-local-agent-codex` (`packages/bundle/local-agent-codex/`) is the second harness bundle, same seam shape as kimi:

- **Harness** `codex`: `CODEX_HOME` scoped home, `login: { command: 'codex', args: ['login', '--device-auth'], capture: 'stdout' }` (the framework's new `capture` field), records from rollout files, `isAuthenticated` = `auth.json` present, `logout` removes the scoped `auth.json` (the CLI's own `codex logout` is not invoked; file removal is the harness contract's function form).
- **Provisioning** writes a minimal scoped `config.toml` pinning `cli_auth_credentials_store = "file"` on first start (an existing config is respected untouched), so device-code credentials land in the scoped home's `auth.json`.
- **Provider** `codex-local`: one-shot `codex exec --sandbox <mode> --json "<task>"` under the scoped home; the NDJSON event stream on stdout yields both the final answer and the turn usage (stderr piped for diagnostics only). `--sandbox` policy selectable via the bundle's `sandbox` plugin config (default `workspace-write`).
- **Patch** `cordis.patch.yml` inserts only `local-agent-codex` + `tool-subagent-codex-local` (provider `codex-local`, toolName `subagent_codex_local`, `enableRunInBackground: false`, `maxDepth: provider-managed`) at the profile root — following the [profile-root delegation decision](2026-08-15-profile-root-delegation-tools.md). The family core row (`local-agent`, shared homes root) is deliberately **not** re-inserted: the kimi bundle's patch owns it, and a duplicate id would mount the core twice. A codex-only composition without the family core fails loud at boot.
- **v1 output**: the delegation's printed response is appended to the dsh subagent session as a single assistant message (user/message + assistant/message + persistence), so the run is visible in the 子代理 surface with its final text; a full event-stream mirror (reasoning, tool calls, diffs) is deferred to v2. The mirror also carries real timing and token usage — see [2026-08-16-delegation-accounting.md](./2026-08-16-delegation-accounting.md).

Provider and tool names (`codex-local` / `subagent_codex_local`) avoid the DUPLICATE_PROVIDER collision with the official `subagent-codex` provider (`codex`) and the disabled `subagent_codex` preset row.

## Alternatives considered

- **Reuse the official `subagent-codex` provider** (`codex app-server --stdio`, ephemeral thread). Rejected: it writes no session files, so the family's file-based records surface (session listing, per-project narrowing) cannot work; the consultant feedback for the kimi family called the official providers' ephemeral threads precisely why a self-written provider + stream append is required.
- **Leave the credential store at `auto`** and check the keychain. Rejected: the family's isolation contract is directory-based — every credential must live in the scoped home; keychain storage breaks isolation and the auth check, and is invisible to `/codex logout`'s file removal.
- **Add the `local-agent` family-core row to the codex patch** so the bundle installs standalone. Rejected: both bundles mount in the same profile, and two top-level `insert` rows with the same id would mount the core twice. The prerequisite (install alongside the kimi bundle) is documented in the README instead.

## Consequences

- Codex delegations are now ambient across every agent preset (`subagent_codex_local` at the profile root), isolated under `$DSH_HOME/local-agent/codex`, and listed by `/codex sessions` and the family's settings section (narrowed per project by `workDir`).
- The harness shape gained the `login.capture` field (stdout vs stderr prompt capture) — a real second-sample delta absorbed into the framework contract.
- The family's file-based records surface now has a second adapter (rollout files), validating the directory-walk + head-read pattern against a different on-disk format.
- v1 delegates run one-shot and mirror only the final answer; the model-visible text is the codex response parsed from the `--json` stream, and child context never enters the parent. Sandbox policy defaults to `workspace-write`; actions needing approval are denied (non-interactive) rather than prompted.
- macOS keychain is avoided only for the scoped home's own login; the user's native `~/.codex` is untouched.

## Verification

- Unit tests: rollout head parsing and listing (malformed/torn files skipped, `auth.json` presence), run settlement (completed appends the response to the child session; non-zero exit settles error), child-session record creation with the resolved descriptor, apply registration + provisioning, patch rows, invariant home-env check, and provision/logout file behavior.
- The `sandbox` config is exercised through the provider spec; `cli_auth_credentials_store = "file"` provisioning is asserted in the apply spec.
- oxlint, typecheck, translation pairing (963 pairs), doc budgets, and README limitations gates pass for this change's surface.
