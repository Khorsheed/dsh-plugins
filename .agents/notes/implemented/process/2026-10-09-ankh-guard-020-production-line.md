# Agent Note: ankh-guard compat labels move to the 0.2.0-rc.2 production line; the 0.2.0 runtime-acceptance checklist is deferred to the next host window

Status: implemented

## Problem

The 3080 production instance moved to host 0.2.0-rc.2 (release head `639ed01539`), but ankh-guard's compatibility labels still named 0.1.7-rc.2: `dsh.compat.verifiedHost` and the "0.1.7-rc.2 is the 3080 production-verified line" claim in `dsh.compat.notes`, plus the matching `Compatibility` bullets in both READMEs. The compatibility-labeling convention requires the labels to track reality on every host-API audit.

Separately, the [0.2.0-rc.2 adaptation note](2026-09-29-host-020-rc2-adaptation.md) left a runtime-acceptance follow-up open — ToolCallRecovery tolerance, probe re-verify, detailed-transcript click-through — with minHost floors frozen "pending runtime acceptance". No record of that acceptance exists.

## Decision

The user decided on 2026-10-09:

1. **Update ankh-guard's labels now** — it is the one package whose "production-verified line" claim was factually stale, and the evidence chain is live: the watchdog log (`$DSH_HOME/state/watchdog.log`) shows gated restarts passing readiness + ownership window + canary with deployment proofs recorded on `639ed01539` four times on 2026-10-09 alone.
2. **Defer the 0.2.0 runtime-acceptance checklist to the next host-version window.** When the next host update lands, the keeper-plugin list gets confirmed first, then the acceptance runs once for exactly those plugins, and their compat labels (verifiedHost / minHost moves) update in the same wave. Until then every other package's labels stay as they are — the frozen minHost floors from the 09-29 adaptation remain intentional, not stale.

## What shipped

- `packages/ankh-guard/package.json`: `dsh.compat.verifiedHost` → `0.2.0-rc.2`; notes' production-line clause now reads "0.2.0-rc.2 is the 3080 production-verified line (watchdog-supervised gated restarts PASS … since 2026-10-09)".
- `packages/ankh-guard/README.md` / `README.en.md`: the source-line `Compatibility` bullet carries `verifiedHost: 0.2.0-rc.2` and the 3080 cutover evidence. The npm-line bullet (0.1.5-rc.1 full-line boot verification) is unchanged — that verification is historical fact.
- `minHost` stays `0.1.5-rc.1`; the version-line mapping (older hosts stay on older ankh-guard release lines) is untouched.

## Alternatives considered

- **Sweep every package's verifiedHost to 0.2.0-rc.2 now.** Rejected: verifiedHost means *runtime*-verified, and the acceptance checklist has not run. Moving labels without the runtime evidence would devalue the field; the deferred wave does both together.
- **Run the acceptance checklist now.** Rejected by the user: several plugins may not survive the next keeper-list cut, so acceptance effort spent today could be wasted; one wave at the next host window covers exactly the survivors.

## Consequences

ankh-guard's labels are honest again and the 3080 evidence chain (watchdog canary + deployment proofs on `639ed01539`) is on the record. Every other package keeps its pre-0.2.0 verifiedHost by design, which reads stale until the wave lands — that is the cost of deferring. What the deferral buys: one acceptance run against exactly the keeper list, with labels and runtime evidence arriving together instead of twice. The open obligation — run the 09-29 checklist (ToolCallRecovery tolerance, probe re-verify, detailed-transcript click-through) at the next host window and update the survivors' labels in the same wave — is now recorded here so the wave cannot be forgotten.
