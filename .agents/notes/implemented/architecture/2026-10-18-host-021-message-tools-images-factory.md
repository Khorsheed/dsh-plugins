# Agent Note: host-021 message-tools images — in-place consumption of the conversation.images.content factory

Status: implemented

English | [中文](2026-10-18-host-021-message-tools-images-factory.zh.md)

## Problem

Host 0.2.1-alpha.3 removed `renderMessageImages` from `ChatNodeOwnerProps`: the single images slot split into `conversation.chat.user.images` / `conversation.chat.message.images` (declared as children of ui-chat's own registrations, so only the official `UserContent`/`AssistantNodeView` may render them), and the official gallery moved behind the root-scoped `conversation.images.content` factory provided by ui-attachment. message-tools shadows the official user/steering renderers (`conversation.chat.node`, priority -1) and owns the withdrawal divider, so it renders user-message images itself and lost that surface on 0.2.1. Wave batch 2 left a compile-level shim (an optional local prop, always undefined under 0.2.1) that kept both views rendering text-only.

## Decision

- **Consume the factory in place; never register an images slot entry.** Both views call `renderFactorySlot('conversation.images.content', { images, loadImage, align: 'end' })` from their own render, via the shared `src/client/message-images.ts` helper. `renderFactorySlot` is a framework seat granted to every renderer-created component (`PropsRenderFactories` in ui-slots' `ComposedProps`), and `loadImage` remains a required member of `ChatNodeOwnerProps`, so a custom node renderer needs no new seam. This is exactly what the official slot entries do — ui-attachment's `MessageImages` adapter forwards the slot owner props to the same factory — so our shadowed rows render pixel-identical galleries while the official slots and renderers stay untouched. Gallery copy defaults to the factory's own `conversation` locale (no `labels` passed), matching the official chat images.
- **Legacy-first dual path, not factory-first.** Hosts before 0.2.1-alpha.3 still pass the `renderMessageImages` owner prop (required in their `ChatNodeOwnerProps`), and on middle hosts (0.1.6-alpha.2 → 0.2.1-alpha.2) the factory seat exists but the factory is never registered — preferring the seat there would regress those hosts to no images. The helper therefore prefers the legacy prop when present and falls to the factory otherwise; on 0.1.5 (no factory seat at all) the legacy prop is always present, so the factory call never executes. The compat prop stays as a documented local optional (`LegacyMessageImagesProp` in `slots.ts`) because the 0.2.1 type surface no longer declares it.
- **Absence degrades to omission, by design.** The renderer's `FactoryOutlet` returns `fallback ?? null` while the factory is unregistered and subscribes for its arrival, so a composition without ui-attachment renders no images and self-heals if the plugin lands later — identical to the official behavior for unfilled images slots. No apply-time probe (`ctx.slots.snapshot('factory:…')`) is used: apply order is unconstrained and the live outlet makes it unnecessary.

## Alternatives considered

- **Register our own `conversation.chat.user.images` entry** (shadowing ui-attachment's gallery at that slot): rejected — the slot is ui-chat's child declaration shared with the official `UserContent`; a lower-priority entry there would also replace the gallery inside the *official* user renderer, which the wave brief explicitly forbids (「不干扰官方节点」), and it would couple us to a slot whose owner props we do not control.
- **Factory-first preference whenever the seat exists**: rejected — regresses hosts 0.1.6-alpha.2 → 0.2.1-alpha.2 (seat present, factory never registered, legacy prop working) from rendered galleries to none.
- **Keep the batch-2 text-only shim until minHost reaches 0.2.1**: rejected — the wave pins 0.2.1-rc.1 and the shim left the wave target itself degraded; the dual path is cheap and keeps minHost unmoved.

## Consequences

- Both views render the official gallery on host ≥0.2.1-alpha.3 and keep the legacy gallery on earlier in-range hosts; minHost (`0.1.5-rc.1`) and the engines range are unchanged.
- `RenderMessageImagesShim`/`RenderMessageImagesShimProp` and every `TODO(host-021 batch-3)` marker are gone; the two client specs now cover the factory call shape, legacy preference, and the absent-factory omission arm. `pnpm --filter ./packages/client-message-tools run build && pnpm --filter ./packages/client-message-tools test` is green (229 tests).
- No new upstream seam was needed: the existing factory seat plus the standing `loadImage` owner prop cover a custom node renderer's image needs.
- Both READMEs describe the formal consumption instead of the batch-2 degrade (pairing sidecar re-recorded).
