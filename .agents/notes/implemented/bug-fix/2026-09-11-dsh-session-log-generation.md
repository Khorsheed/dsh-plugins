# Agent Note: the sub-dsh session log is addressed by generation, not by name

Status: implemented

English | [中文](2026-09-11-dsh-session-log-generation.zh.md)

## Problem

Every read-back the `dsh` harness performs comes out of one file: the sub-dsh's
own session log, in the scoped home. Two readers open it — the session mirror
(which derives the round's observed model, token usage and tool-call count) and
the `/dsh sessions` records adapter (which reads each session's header). Both
hardcoded the basename `session.jsonl.zstd`.

The host addresses that log by SESSION FORMAT GENERATION. Version zero keeps
the original `session.jsonl`; every later generation carries a lowercase `vN`
component. Host 0.1.5 writes `session.v3.jsonl.zstd` — and a reader looking for
`session.jsonl.zstd` finds nothing at all.

Measured on a throwaway home, one real delegation round per toolchain:

| toolchain | file the store wrote | `settled` observation before this fix |
|---|---|---|
| `rc-0.1.2-rc.1` | `session.jsonl.zstd` | model, usage, toolCalls, cliVersion |
| `rc-0.1.5-rc.1` | `session.v3.jsonl.zstd` | `cliVersion` ONLY |

The round still settles `completed`. The failure is silent and total: three
observations vanish together, and `/dsh sessions` lists nothing. Downstream,
"the log could not be read" is indistinguishable from "this round produced
nothing" — the evaluation's third invariant falls back to the declared side for
every dsh cell, the efficiency table's dsh token columns go blank, and pilot B
(dsh × two models) cannot pair its two cells at all.

## Decision

### One resolver, the host's own rule

`src/session-log.ts` parses each entry of a session directory with the host's
canonical pattern, copied character for character from
`@deepseek-ai/dsh-session-format`:

```
/^session(?:\.v([1-9][0-9]*))?\.jsonl$/u      # matched AFTER stripping any .zstd
```

So `.v0`, leading zeros (`v01`), uppercase (`V3`), `session.lock` and temporary
names are not generations — the host does not publish them, and a reader that
accepted them would read a file the writer never committed. Version zero is the
unversioned original.

`resolveDshSessionLog(dir)` returns the numerically HIGHEST canonical
generation present, which is the backend's own selection rule, with the
compressed artifact winning a same-generation tie (compression is the backend's
default; the pair only appears in a store whose setting changed). Absent means
absent: a directory with no canonical log — a lock file alone, say — yields
undefined rather than an empty history.

**Highest, not latest-by-mtime and not lexicographic.** A migrated store keeps
its older generations beside the new one, so "the newest file on disk" is not
the rule; and `v10` must beat `v2`, which a string sort gets backwards.

### Both readers go through it

The session mirror and the records adapter resolve through the same function,
so the two can never disagree about where a session's history lives — the
disagreement being precisely what a second hardcoded constant would create the
next time the host advances a generation.

`readSubDshEvents` now returns `{events, log}`, and `DshMirrorDelta` carries
`sessionLogFile`. The read-back says WHICH generation it read, so the next
filename change shows up as a changed field rather than as an empty session.
`readDshSessionHeaderLine` takes the encoding as a parameter, because a raw
(`compression: 'none'`) log is real and was previously unreadable too.

## Verification

One real delegation round per toolchain, into a throwaway `DSH_HOME`, after the
fix:

| toolchain | file resolved | observedModel | usage | toolCalls | `/dsh sessions` |
|---|---|---|---|---|---|
| `rc-0.1.5-rc.1` | `session.v3.jsonl.zstd` | `deepseek-official/deepseek-flash` | 479 in / 133 out / 13952 cacheRead | `{count: 1, byName: {bash: 1}}` | 1 session |
| `rc-0.1.2-rc.1` | `session.jsonl.zstd` | `deepseek-official/deepseek-v4-flash` | 8387 in / 224 out / 16000 cacheRead | `{count: 2, byName: {bash: 2}}` | 1 session |

Both paths are pinned in tests against both lines: the v3 fixture carries the
`session.lock` the real 0.1.5 directory keeps beside its log, and a multi-
generation fixture proves `v10` beats `v2`. Recomputing the pilot-a-round1
bundle leaves `results.jsonl` byte-identical — this package does not touch the
report.

## Alternatives considered

**Bump the constant to `session.v3.jsonl.zstd`.** Rejected: it fixes exactly
one host version and re-arms the same silent failure for v4. The cost of the
bug was never the wrong name, it was that a name can go stale without anything
saying so.

**Try a list of known names in order (`v3`, then `v2`, then unversioned).**
Rejected for the same reason one level up — the list still has to be edited per
host release — and it gets a migrated store wrong, where several generations
coexist and only the highest is the history.

**Pick the most recently modified file.** Rejected: a migration rewrites older
generations' neighbours and a lock file is touched constantly, so mtime answers
a different question than "which generation is current".

**Import the host's `parseSessionFormatLogFilename` instead of restating the
rule.** Tempting, and rejected for this package's compatibility bar: the symbol
lives in `@deepseek-ai/dsh-session-format`, which this plugin does not depend
on, and taking a new host dependency to read a filename would make the package
refuse to load on hosts that predate that module. The regex is four lines and
its provenance is named right above it.

**Let the mirror keep its own copy of the resolver.** Rejected: two copies is
how the two readers drifted apart in the first place — `/dsh sessions` broke on
0.1.5 for exactly the same reason the mirror did, in a file nobody thought to
check when the mirror was last touched.

## Consequences

`readSubDshEvents` changed shape (`SessionEvent[]` → `{events, log}`). It is
exported, so an out-of-tree caller would have to follow; in tree there is one
caller and one test.

`DshMirrorDelta` gained `sessionLogFile`. It is optional and absent when no log
was found, so a delta a reader compares by equality gains one field on the
success path — the package's own tests are the only such readers.

A host that advances to a generation this package has never seen still works:
the rule is the host's, not a list, so `session.v4.jsonl.zstd` resolves the day
it appears. What would break it is the host changing the naming SCHEME rather
than the number — and then the resolver reports absence, which is the honest
answer and the one `sessionLogFile` now makes diagnosable.
