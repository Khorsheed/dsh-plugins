# Agent Note: downstream session events are unresumable — the datasets binding leaves the session log

Status: implemented

English | [中文](2026-08-20-downstream-session-events-unresumable.zh.md)

## Problem

Live smoke on the rc.8 web profile: any session that had ever been dataset-bound refused to resume after a restart — `SessionFormatUnsupportedError: session contains event type "datasets/binding" unknown to this harness and not marked ignorable`. [M1](2026-08-19-datasets-store-m1.md) stored the per-session binding as a log-only `datasets/binding` session event, following the in-harness `goal/change` precedent. The refusal is by design: the persistence read path rejects any log holding an event type outside the build's known vocabulary, because silently skipping a required event could reconstruct a wrong session.

## Decision

The binding moves out of the session log into a plugin-owned durable store: one versioned JSON record per session at `<stateRoot>/bindings/<encoded-session-id>.json` (`$DSH_HOME/state/datasets`, else `<cwd>/.dsh-datasets`), written atomically (tmp + rename), deleted on unbind, read per call (`src/binding.ts`; `BindingSession` narrows to `{ id }`). The CLI's `bind`/`unbind`/`binding` verbs write the same store via `--state-root`, and `src/session-log.ts` (the offline JSONL/zstd append machinery and its live-session race) is deleted outright. No datasets code path calls `Session.append` anymore; a regression test drives the binding verbs against a fake session whose `append` throws.

Why the marker fix the bug suggests is impossible downstream, verified against the rc.8 checkout: `KNOWN_SESSION_EVENT_TYPES` (`packages/core/session/src/known-event-types.ts`) is generated from in-repo declarations only — a downstream plugin's declaration merge can never enter it, and the file's own header defers a registration surface "until such a consumer exists". And `Session.append(type, data)` builds the envelope `{type, seq, time, data}` with no ignorable option for non-surface events; no live writer anywhere in the harness produces `ignorable: true` (only the persistence packers round-trip the field and the seed validator tolerates it). So a community plugin's custom session event is unresumable **by construction**, however it is written. The `goal/change` precedent never transferred: goal is in-harness, its type sits in the generated set.

The lesson, generalized: **a downstream plugin must not append custom-typed session events at all** until upstream ships the registration surface; per-session durable state belongs in the plugin's own `$DSH_HOME/state/<plugin>/` store. If a plugin's semantics genuinely require the session log (audit, fork inheritance), that is an upstream-change request, not a local workaround.

## Alternatives considered

- **Add `ignorable: true` on both write paths** (the obvious fix) — rejected as impossible downstream: the CLI's offline append owned its envelope bytes, but the live path goes through `Session.append()`, which exposes no marker channel. Half a fix still poisons every tab-/slash-bound session on restart.
- **Runtime `KNOWN_SESSION_EVENT_TYPES.add('datasets/binding')` at apply time** — rejected: mutating a generated host structure from a plugin, and silently a no-op whenever the app bundles its own copy of dsh-session (the plugin's mutation then lands on a different module instance and the poison remains).
- **In-memory-only bindings (lost on restart)** — rejected: the proposal's acceptance criteria require the binding to survive a restart; the store keeps that, the map would not.
- **Keep the session event as audit and add the store as the durable copy** — rejected: the event is the poison; writing it for audit still breaks resume. Audit of binding changes moves to the store file itself.

## Consequences

- Bound sessions resume. CLI `bind` becomes safe against live sessions (per-call reads — the M1 sequence-counter race and its safety note are gone), and ~200 lines of zstd frame surgery leave the package.
- Given up: the binding's seat in the session log — it no longer travels with session export/fork (a forked session starts unbound) and is no longer auditable in the log; deleting a session leaves an orphan record. All three are recorded in the README's Known Limitations.
- CLI surface change: `--sessions-root` becomes `--state-root`; pre-release line, no alias kept.
- Upstream follow-up (not ours to patch): a downstream event-type registration surface, or an `ignorable` channel on `Session.append`, would make the session-event design legal again; the store design stays valid regardless.
- The M1 note's session-binding bullets are superseded by this note; the M2 note's "bind/unbind write the same session event" fact is corrected by it.

## Testing

`packages/datasets/tests/` — 54 tests over 9 files green. The binding suites now cover: store write/read/overwrite/unbind round-trips, persistence across a service re-create (restart simulation), loud failure on corrupt or unknown-version records, path-safe id encoding, the CLI verbs against `--state-root`, and the no-session-events regression guard (a fake session whose `append` throws).

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md) — where the session-event design shipped (superseded bullets point here).
- [datasets M2](2026-08-19-datasets-m2-remote-tab.md) — the Remote/tab face whose bind verbs moved to the store with everything else.
- [datasets proposal](../../../proposals/active/2026-08-19-datasets-store.md) — the binding semantics (whitelist governance) are unchanged; only the storage home moved.
