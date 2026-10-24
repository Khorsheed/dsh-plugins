# Agent Note: Install collections — basic plus one mode suite, as data

Status: implemented

## Problem

The mode suites are capability bundles: each installs one mode and the family its preset grants, and none of them includes the basic suite. An ordinary user therefore needs two installs (basic plus a mode) and has to know that. The family-bundles proposal ([2026-09-24-family-bundles-and-collections](../../../../proposals/active/2026-09-24-family-bundles-and-collections.md)) already separated the two axes — bundles are capability units, collections are scenes — and left the collection layer as wave 3. Folding basic's members into every mode suite would have made each suite a single install, at the price of copying twelve rows into six patches and blurring the capability axis.

## Decision

A collection is data, not a package. `collections.json` at the repo root lists each collection's id, zh/en title and bundle names: one per mode (`@khorsheed/dsh-basic` plus that mode's suite), `basic` alone, and `full` (basic plus all six suites, the 3080 shape).

One command installs a collection: `dsh plugin add` forwards its arguments to pnpm, so `dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite` works today with no host change and no meta package.

`scripts/check-collections.ts` owns the collection layer:

- `pnpm check:collections` (also a `gate` step) checks shape (unique ids, both titles, no repeated bundle), membership (every name is a repo `family`/`mode` bundle; every mode suite is in some collection), host range (the bundles' `engines.dsh` ranges intersect, so no collection installs a set no host boots), and that the generated README text is current;
- `pnpm map:collections` writes the install commands between markers: a table in README.md / README.en.md (`collections:`), and a "recommended: install with basic" block in each mode suite's README pair (`collection:`) — which is also what each suite's mirror repo shows.

Overlap between a collection and a hand-picked install is harmless: shared rows collapse to one (the Loader keys entries by id), and check:plugins' cross-bundle row parity keeps shared rows byte-identical.

## Alternatives considered

**Each mode suite also lists basic's members.** One install per mode, but twelve rows copied into six patches, and every basic change touches six packages. Rejected: it merges the capability and scene axes the bundle layer was built to keep apart.

**A collection meta package per scene** (patch generated from the member bundles at build time — the proposal's wave-3 candidate). Rejected for now: a package of packages adds a publish line per scene and a second place rows live, and buys nothing over a one-line command.

**Wait for a host "install set" in the plugin market.** The market index supports categories and labels for discovery, but installs one card at a time. A one-click collection in the UI would need an upstream change; this note does not block it — the market can label scenes later, and `collections.json` is the list it would read.

## Consequences

- An ordinary user's path is one command from the README or a suite's mirror repo; an advanced user still installs any package or suite alone.
- Adding a mode suite requires adding its collection (check:collections fails otherwise), and the README blocks regenerate from the list.

## Testing

`scripts/check-collections.spec.ts`: version ordering and range intersection units, the generated text shape, and the real tree (every scene collection is basic plus exactly one suite; zero findings). `pnpm check:collections` clean; `pnpm test:scripts` green apart from the pre-existing `sync-icon-artwork` failure on main.
