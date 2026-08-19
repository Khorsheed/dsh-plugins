# Agent Note: Bash-write capture for the products list

Status: implemented

English | [中文](2026-08-18-file-preview-bash-write-capture.zh.md)

## Problem

The products list (`filePreview.list`) folds the session log for `read`/`write`/`edit` tool calls keyed on `file_path` — files an agent writes through `bash` (heredocs, `>` redirects, `tee`, `sed -i`) are invisible to it. Measured in a real session (whalesong game design): a dozen HTML artifacts, nearly all written via `bash` `cat > … <<'EOF'` heredocs, none appear in 产物. The fold is deliberately a pure log fold with no filesystem access and no environment context, so it cannot resolve `$DSH_HOME/…`-style paths itself.

## Decision

Ship the upstream-seam-registry **S2** workaround in the file-preview host half: a host-side collector that turns the log's `tool/call` (bash) → `tool/result` pairs into verified write records, kept in a per-session in-memory registry that `list` merges into its fold entries.

- **Capture** (`src/bash-writes.ts`): on `tool/call` with `name === 'bash'`, extract write targets from the command with a high-precision scanner — single `>` redirects (covers `cat > path <<'EOF'` heredocs), `tee` (append forms skipped), `sed -i … path` (first non-option token after the inline script). `>>`, `2>`, `>&`, `<>`, `&>`, everything inside a heredoc body (HTML `>` content must never read as a redirect), and the deferred forms (`cp`/`mv`/`python open`) are ignored. Targets expand through the collector's own environment (`$VAR`/`${VAR}` — unset variables are rejected, not guessed), `~`, and the session cwd for relative paths; globs and command substitution are rejected.
- **Verification** (prefer a miss over a false positive): the matching `tool/result` (correlated by callId) triggers `fs.resolve` + `fs.stat`, and only paths that exist as files are recorded.
- **Registry** (per session, bounded by `maxFiles`): rebuilt by replaying the session's own history on `session/created`, so a restarted host regains captures with no durable state of its own; live events flow through the `session/event` firehose subscribed via `ctx.effect` (fiber disposal cleans up).
- **Merge** in `list(agent)`: captured paths the fold already knows keep their log-derived entry; only genuinely new paths are appended (op `write`, the issuing call's seq/turn/step).
- **Config**: `captureBashWrites` (schemastery, default `true`) — the deployment's off switch.

**Why NOT the registry doc's original "append a log-only session event"**: the official `Session.append(type, data)` cannot set the envelope's `ignorable: true` marker, and the persistence read path **throws** on any event type outside `KNOWN_SESSION_EVENT_TYPES` that lacks the marker ("refusing to interpret the log"). A plugin-appended event would therefore poison the session's durable log on the next reload. This is itself a new upstream gap (the known-event-types comment defers a plugin registration surface "until such a consumer exists" — we would be the first), recorded as S2's third retirement condition. The side registry achieves the same user-visible outcome without touching the log.

## Alternatives considered

- **Append the derived event via `Session.append`** (the registry doc's original mechanism). Rejected after verification: `append` cannot write `ignorable: true`, and the persistence read path refuses unknown non-ignorable types — the event would break session reload, not just fail to fold.
- **Filesystem scan in `list`.** Rejected: a scan answers "what exists now", not "what this session touched", and moves the pure-log fold into fs territory; the collector keeps the fold log-only and adds the fs check only where the log points.
- **Parsing bash writes inside the fold itself.** Rejected: the fold has no environment (`$DSH_HOME`), no cwd resolution for relative targets, and no way to correlate call → settled result; the collector owns all three.

## Consequences

Bash-written files (heredocs, redirects, `tee`, `sed -i`) now appear in the products list with current-content preview via `read` — no diff history (same limitation as Code Mode dispatches, registry S3). False positives are bounded by the pattern set + `fs.stat` (a transient file deleted before verification is dropped). Captures are in-memory per host process; a restart rebuilds them by replaying the session log, but paths that no longer exist at replay time are dropped (宁缺毋滥). The session log is never mutated, so persistence, replay, and the model-visible ⟺ logged invariant are untouched. The client half needed no changes — it just sees more entries. Tests: parser/expansion unit coverage plus collector behavior (capture, missing-file drop, non-bash ignore, replay, disposal) and the `list` merge, 86 host tests green.
