# Agent Note: historical v0 sessions refused by the 0.1.5 migrator — message-tools' `source.op` was out of spec

Status: implemented

English | [中文](2026-09-11-session-source-op-repair.zh.md)

## Problem

After the 3080 host moved to 0.1.5-rc.1, many historical sessions failed to load: `session-format-v0-to-v1 refuses this format … source has unexpected member "op"`. Root cause: message-tools' edit/withdraw feature stamps a plugin source with an extra discriminator (`{kind: 'plugin', plugin: 'message-tools', op: 'edit' | 'edit-trigger' | 'restore-assistant'}`). The 0.1.2-era write path accepted unknown members; the 0.1.5 v0→v1 migrator validates released v0 keys fail-closed (`payload-validation.ts`: a plugin source may carry only `kind`/`plugin`, plus compact extras) and refuses the entire log. 49 of 375 v0 logs under the prod HOME were affected — every session that ever used message edit.

The current (v3-era) write and read paths tolerate the member — verified live on 0.1.5-rc.1: edit a message, reload, the session reopens and the 已编辑 badge renders. Only the historical-file migration gate is strict. So the incident is data-shaped, not code-shaped: no message-tools change is required for correctness today, but any future format bump with the same released-keys rule will reject sessions written now. An upstream proposal for a sanctioned plugin-source extension member (or lenient unknown-member migration) belongs in docs/upstream-proposals.

## Decision

Repair the data, keep the code. `scripts/repair-session-source-op.ts` deletes `source.op` from message-tools rows in the affected v0 logs (dry-run by default; `--apply` writes), preserving originals under `sessions-backup-source-op/`. Two layout rules made the repair non-obvious:

- The log is a concatenated-Zstandard container whose FIRST frame must be exactly the header line (session-persistence-jsonl/src/zstd.ts). A whole-file single-frame rewrite is structurally corrupt to the reader — the first draft of the script did exactly that and was caught by a dev-instance boot scan; all 49 files were restored from backup before the corrected script ran. The final script copies the header frame byte-for-byte and emits one body frame with the host writer's exact recipe (`zstdCompress` with `ZSTD_c_checksumFlag=1`).
- Acceptance runs on the rewritten bytes: frame structure, plaintext equality except the stripped member, and the host's own `assertReleasedEventPayload` on every message-tools row — the same rule that refused the sessions.

Verified end to end on the 0.1.5-rc.1 dev instance: a repaired historical session (21 days old, edits and withdrawals inside) migrates on open and renders fully, withdrawal expanders included.

## Alternatives considered

**Re-encode the discriminator out of `source` (e.g. a dedicated plugin name per op).** Rejected for now: the current format reads it fine, the narrowing predicates already treat absent-`op` as the legacy withdrawal case, and a re-encode buys nothing until a future migrator repeats the strictness — the upstream proposal is the durable fix.

**Ask the host to skip the offending rows.** Rejected: the migrator is deliberately fail-closed ("source v0 artifact remains unchanged"), and unknown-member tolerance is exactly the kind of decision the host should make, not a plugin-side fork.

## Consequences

All 375 v0 logs under the prod HOME scan clean; the 49 previously refused sessions load again. Repaired edit replacements project as plain message-tools replacements (the withdrawal bucket) in those historical sessions — a cosmetic mislabel in history, accepted. The user's takeaway for plugin authors: session records are a released format — writing extension members into them is forward-hostile, and the next strict migration is when the bill comes due.
