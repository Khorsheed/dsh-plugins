# Agent Note: Community-plugin acceptance for imported website Sessions

Status: implemented

English | [中文](2026-11-13-imported-session-plugin-acceptance.zh.md)

## Problem

The official experimental importer introduced in host 0.2.2-rc.3 creates ordinary stored Sessions from DeepSeek website exports. Community plugins should be able to consume those histories without another ZIP parser, but their behavior cannot be inferred from similar-looking panels. In particular, an imported tool result must not become a fabricated local file or job, and the importer does not remove the restrictions on restoring a custom assistant role.

## Decision

`packages/basic/tests/imported-sessions.host.spec.ts` imports one synthetic ZIP through the real official importer into a real Web composition with message tools, message timeline, Context Lens, file preview, TaskPilot, quote and inline HTML rendering. The fixture contains a question, a file name without file bytes, web search and fetch records, reasoning, an answer and a `dsh-card` fence.

The browser checks the completed search and fetch cards after expanding the official folded process, and the sandboxed HTML card. It selects the imported question, quotes it to the current composer, opens the community quote chip's own preview and checks the original text and source title. The message timeline is a floating navigation panel, not a toolbar button, so the test reads it directly.

The Host checks retain the synthetic file reference's name in the user event while requiring an empty file-preview list and an empty official job list in the isolated scaffold. No `request/header` event is invented. Context Lens reads the official measured total of one turn and three steps rather than manufacturing request metadata.

Withdrawing and restoring the imported assistant reply keeps the existing message-tools degradation: a new user-role event with source `{ kind: 'message-tools', op: 'restore-assistant' }`, without adding an assistant event. This is not an S12 unlock.

The importer-specific browser tests skip when the selected Host has no official importer, as on rc.2. The mobile Workspace-picker test uses the same condition. A skip identifies a version boundary; it is not evidence that an rc.3 capability works on rc.2.

## Alternatives considered

**Copy the importer into basic or make the imported Session a default bundle member.** Rejected: the official importer owns conversion and remains an optional experimental package. These tests verify composition rather than duplicating ownership.

**Assert only component-level cards or only successful ZIP conversion.** Rejected: neither proves that the real stored history works through the actual browser, plugin services and official statistics.

**Require a downloadable attachment or claim custom-role restoration.** Rejected: the export supplies only a synthetic file reference in this fixture, and the official append/projection restriction remains. The test deliberately preserves both limits.

## Consequences

The release candidate has real composition evidence for the existing basic-family consumers without changing their production behavior. Canvas and eval integration with the reusable Workspace picker, real-device coverage and an S12 role-restoration seam remain separate work.

## Testing

The focused basic test command runs the imported-Session cases and the account/notification browser case through the standard package test script. The full basic build/test passed 3 files / 9 tests. The full mobile build/test passed 32 files / 176 tests, including the official importer's real mobile directory flow.

## Related

- [Host 0.2.2-rc.3 adaptation](../process/2026-11-13-host-022-rc3-adaptation.md)
- [Complete client builds preserve version metadata](../bug-fix/2026-11-13-complete-client-build-metadata.md)
