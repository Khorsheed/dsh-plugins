# Agent Note: The keychain stamp parser never matched what security prints

Status: implemented

English | [中文](2026-09-17-keychain-stamp-ordering.zh.md)

## Problem

macOS allows several items under one keychain service, and claude's scoped credential service accumulates them: one per login into that config directory, plus historical debris. `readKeychainCredential` is supposed to enumerate the service, order the items newest-write-first, and return the first USABLE blob — the rule a previous fix (the pilot log's G10) established after an empty-token shell was mirrored into the credentials file and made every delegation report an expiry that had not happened.

The enumeration ordered nothing. `keychainTimestamp` accepted only a spaced stamp, `2026-09-01 02:03:04 +0000`. What `security dump-keychain` actually prints is the compact Zulu form with the attribute's trailing NUL rendered after the closing digit:

```
    "mdat"<timedate>=0x32303236303931363034303835355A00  "20260916040855Z\000"
```

No observed build emits the spaced form. So every item's stamp failed to parse, fell to the `?? 0` default, and `items.sort((a, b) => b.mdat - a.mdat)` over all-equal keys became a no-op — `Array#sort` is stable, so the dump's own order survived. `readKeychainCredential` then returned whichever usable item the dump happened to list first. **Newest-write-first has never worked in production**; G10's other guarantee, skipping empty shells, was unaffected and kept working, which is why nothing looked wrong.

It surfaced on a scoped home that had been logged in twice. Its service held two usable items, and the dump listed them worst-first:

| acct | mdat | listed |
|---|---|---|
| `unknown` | `20260916040855Z` | first — superseded generation |
| the account owner | `20260917053120Z` | second — that day's fresh login |

Every reconcile mirrored the 9/16 generation into `.credentials.json`; the fresh login sat unread in the keychain. The instance reported `authenticated: yes` throughout, because the stale blob's refresh expiry was still weeks out, and ran on a generation whose refresh token was in all likelihood already spent. A second login could not have helped — it rewrites the owner's item, which still loses to `unknown` in dump order.

**Why no test caught it:** the suite's `dumpKeychainOutput` fixture synthesized the spaced form — a shape `security` never emits — so the case named "prefers the newest write among several usable entries" had been asserting against an input that cannot occur. Converting the fixture to the real shape turned that existing test red on the spot, before a line of source changed.

## Decision

`keychainTimestamp` parses the compact Zulu form first and keeps the spaced form as a fallback.

```
/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z/
```

No end anchor: the rendered NUL follows the `Z`, and anchoring would reject every real line for the sake of strictness that buys nothing. The compact form carries no offset — the `Z` is the offset — so it maps straight through `Date.UTC`. The spaced branch is retained in case some build does emit it, and is exercised by its own test rather than left as unproven dead code.

The fixture now renders what the tool renders, trailing `\000` and all, and a test transcribes a real dump block verbatim instead of synthesizing one. That is the actual repair: a fixture in a shape the tool never emits is a fixture that proves nothing, and this parser had two of them.

## Consequences

- A scoped home logged in more than once now serves its newest credential. Combined with the newer-wins reconcile in [the credential sync note](2026-09-17-claude-credential-sync-newer-wins.md), the keychain and the credentials file converge on the live generation from either direction: the file is not overwritten by an older keychain item, and the keychain item chosen is now actually the newest one.
- An item whose stamp cannot be parsed still sorts as oldest, and a test pins that, so an unparseable stamp can never again win by being printed first.
- A scope stranded on a superseded generation heals on its next reconcile without a fresh login.

## Alternatives considered

**Sort on `cdat` instead.** The creation stamp is stable across refreshes, which is exactly wrong: the question is which item was WRITTEN most recently, and a slot rewritten by a fresh login keeps its original `cdat`.

**Hand the stamp to `Date.parse`.** The compact form is not ISO 8601 (no separators), and `Date.parse` on a non-ISO string is implementation-defined. An explicit regex that states the two accepted shapes is both correct and readable as a specification of what the tool emits.

**Drop the ordering and pick by credential content** — say, the blob with the latest `expiresAt`. It would work, but it reads every item's SECRET to decide, where the metadata dump answers the same question without touching one. Ordering on metadata and reading only the winner is the smaller exposure.

**Leave it and always re-login.** Measured not to work: a second login rewrites the owner's item, which still loses to the historical `unknown` item in dump order. The ordering is the only lever.

## Testing

Three cases in `records.spec.ts`, all three red against the pre-fix source and green after:

- a dump block transcribed from a real `security dump-keychain`, two usable items with the superseded one listed first, asserting the fresh one is mirrored;
- the spaced form listed as the newer item, asserting the legacy branch still parses and that both forms compare on one scale;
- an unparseable stamp listed first, asserting it sorts as oldest rather than winning by position.

The existing "prefers the newest write among several usable entries" case also goes red once the fixture emits the real shape, which is how the defect was found; it is left in place as the fourth guard.
