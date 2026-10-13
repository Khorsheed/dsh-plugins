# Agent Note: Avoid mobile refreshes for unchanged presentation

Status: implemented

## Problem

Streaming conversation history triggered whole-document mobile surface and panel scans. Repeated Room reads published unchanged rosters and bumped the compatibility composer election even when no room was newly discovered.

## Decision

Presentation and panel observers ignore mutations within the checked conversation history slot. Frame, header, composer and popup mutations remain observed. Panel titles come from the owner service, so the panel observer does not watch character data. Composer height continues to use its existing ResizeObserver.

Room reads compare the fields consumed by the mobile roster and preserve the previous snapshot when unchanged, while renewing cache freshness. The older-Room composer compatibility refresh only runs when the current room is newly discovered, not on every roster or run update. The compatibility path remains available to supported older installations. Remote refresh frequency and owner mutation actions are unchanged.

## Alternatives considered

**Remove all DOM observation.** Current supported hosts still require checked presentation anchors and late-mount recovery. Public presentation events would be a better future seam.

**Remove the old Room compatibility path unconditionally.** The latest Room handles promotion itself, but independently installed older Room versions still need the fallback.

## Consequences

Message tokens no longer trigger the expensive surface scan, while title and structural changes still update mobile presentation. Unchanged Room reads do not notify subscribers. Tests exercise text and element streaming, retained header/panel updates, stable roster snapshots and changed membership. This does not unify the two Room stores or change shared-host startup loading.
