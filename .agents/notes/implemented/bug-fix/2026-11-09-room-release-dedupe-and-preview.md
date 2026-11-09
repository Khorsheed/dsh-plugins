# Agent Note: Room held-report releases are deduplicated and preview what they carry

Status: implemented

## Problem

The report gate holds a report for a busy recipient and wakes the recipient later with a release round. That round is a `room/dispatch` with `releases` (the held dispatch seqs). `releaseHeld` appended a new release every time it ran. `recover()` calls it on every room entry for each member that has holds this process holds no wake timer for. A hold only closes when the recipient actually starts a round. While the recipient was busy or blocked, every room entry (a human message, a stop, a plan command) queued another identical release. In one real room the same held report was released six times, and each copy cost the coordinator a model round.

The release's journaled `text` is only the trailer the model needs (「以上 N 条回报一直等着交给你：#m…」). The held reports' bodies are prepended only when the prompt is built. So the members-page queue row (the core ledger's `preview`, 「来自协作间：…」), the reply's cause line and the team view showed only the trailer. They did not show what was being handed over.

## Decision

**Releases are idempotent, read from the journal.** Before `releaseHeld` appends anything, it reads `pendingReleaseSeqs`: the `releases` of the recipient's release deliveries that are still `queued` or `running`. It hands over only the open holds that those releases do not already cover. If no such holds remain, it appends nothing and returns `false`. A timeout, a restart or a manual 现在交给 therefore adds a release that carries only the newly held seqs. The rule needs no new fields or process state, so it holds across restarts and for old journals.

**Older journals' duplicates close on entry.** At the start of `recoverOnce`, before anything is resubmitted, `redundantReleases` finds the recipient's queued releases that would hand over nothing. A queued release is redundant when every seq it names is either already closed (some round carried it) or covered by a running release or by an earlier queued release that was kept. Each redundant release gets a `cancelled` edge with the text `重复的提醒` (`DUPLICATE_RELEASE_TEXT` in `delivery-notes.ts`). If this process had already submitted it, it is also withdrawn from the core queue. The team view leaves these rows out. The room timeline never rendered release dispatches, so nothing else needs hiding.

**Every preview of a release reads what it carries.** `src/release-preview.ts` is a pure module that the client bundle also imports. It resolves a release's `releases` seqs to the held report deliveries in the room state, then gives the reporter (`reportSource`, moved there from `client/speech-cause.ts`) and each report's opening (80 characters, on one line). The following surfaces use it:

- `previewOf` → the core row's `preview` → the members page's 「来自协作间：补交回报：招摇构筑师 · 四地区交付…」. When a release carries several reports, it reads 「补交 2 条回报：A、B」.
- The reply's cause line → 「回应 招摇构筑师 的汇报：四地区交付…」. With several reports, their openings are joined with ` / `.
- The team view's delivery list and the 「current」 line → 「招摇构筑师 · 四地区交付…」.

No event types, no new fields, and no hint labels were added.

## Alternatives considered

**Keep the restart path but skip it when a release exists at all.** This was rejected. A release that has already settled may have closed nothing: it may have been cancelled or failed before its round started. Only a pending release (queued or running) is a promise that the holds will be handed over.

**Keep only identical duplicates (the proposal's literal rule).** This was widened to cover any queued release whose holds are all closed or covered. The real incident's copies sat behind a release that later ran and carried the hold. Under the literal rule the earliest queued copy would still have run and cost a model round for nothing.

**Journal the preview on the release dispatch.** This was rejected because the journal already holds the release seqs and the held reports. A copied preview field would duplicate data, and older journals would not have it.

**Show queued releases in the room composer's queue strip.** This was not done. Under the room-timeline D decision, the strip shows only member-level capsules and human messages that have no bubble yet. The room's copy of the member inbox also leaves room rows out by design. A release is visible on the members page queue and, once it runs, on its reply's cause line.

## Consequences

Repeated room entries queue at most one release per set of open holds, and older journals stop running their stacked copies. A second release that carries a hold which arrived later still runs after the first one has carried everything. In that case it brings only its trailer. Dropping such a release at admission time would require a check when the core admits it, which is left for later. The previews are Chinese on the host side (the core `preview`), like the rest of the room's prompt text. The client-side lines use names and openings, and no new strings were added.

## Testing

- `packages/room/tests/release-dedupe.host.spec.ts`: the incident shape (one release that ran plus five queued copies, all redundant); keeping the earliest copy; a release whose hold a later round carried; settled releases cover nothing; preview text for one and for several reports, plus the 80-character cut.
- `packages/room/tests/dispatch.host.spec.ts` (「held-report releases on room entry」): with a busy CLI recipient, five `recover()` calls queue one release, and its core `preview` reads the carried report; a new hold then gets a release that carries only that hold. An older journal's five queued copies close on entry, and only the earliest is submitted to the core.
- `nodes.client.spec.tsx` and `team.client.spec.tsx` cover the cause-line text and the team view rows.
