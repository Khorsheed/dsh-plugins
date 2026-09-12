# Agent Note: official-style model selection across the member UX

Status: implemented

English | [中文](2026-09-13-composer-model-polish.zh.md)

## Problem

Follow-up gaps after the member-model surface landed: the settings card's model field looked like a plain text box (no affordance, and the placeholder never said WHAT the CLI default is); the codex and claude dropdowns were empty on prod (scoped configs name no models — codex had no discovery source at all); the member composer's chip sat bottom-left as a bordered pill that didn't read as a picker; the room composer had no model selection for the room's MAIN agent (its takeover hides the official composer bar, whose `conversation.input.model` seat is single-host and cannot be re-hosted — verified against the slots runtime: declarations are exclusive, renderSlot is authorized per entry); and room member cards/edit dialogs showed no model at all, so a user couldn't tell what a dispatched member runs.

## Decision

**Settings card (all four providers).** The field is now a select-like control: an always-visible chevron opens a measured-flip menu of the broker choices (picking fills the draft; 保存 still persists; free text and datalist stay); no choices → no affordance, plain input (the claude fresh-install case). The placeholder names the effective default (`留空 = 跟随 CLI 配置：<model>` / dsh 宿主默认) so blank is self-explanatory.

**Codex catalog discovery.** A lazy one-shot probe spawns `codex app-server --stdio` against the scoped home (deliberately WITHOUT the live driver's per-member `-c` overrides — the bridge token is meaningless and a model binding could scope the answer), `initialize` → `model/list`, hidden entries filtered, 5s bound, any failure degrades to `[]`. Per-home 5-minute TTL on completed probes (failures cached too), concurrent reads share one in-flight promise, `modelInfo` serves the cache synchronously and re-probes in the background — a cold CLI boot never blocks a settings read; the card re-fetches on open. Claude has NO honest local enumeration (CLI has no models surface; its picker is network-dynamic) — it keeps free-text + recent-model memory rather than a disguised hardcoded catalog.

**Composers.** The member chip moves beside the send circle and matches the official ModelSelect trigger (borderless 28px, 13/20 w500, rotating chevron). The room composer gains a main-agent picker beside ITS send circle, built on the public `ctx.modelDirectories` service — the same per-session directory the official seat uses, so its `select()` writes the exact durable session selection the official composer writes; the official two-level model/effort menu ported directly (the directory surface exposes efforts); absent service renders nothing. @-member messages bypass it by design (members have their own per-member channel).

**Room members.** Cards append the member's effective model (`memberModel(childSessionId)`; `RoomMember.childSessionId` is journaled at first dispatch — never-dispatched members show nothing), the main-agent card shows the directory selection, and the edit dialog's model field prefills from the broker surface and saves broker-first (`setMemberModel` refusal keeps the dialog open with the error) then journals the value onto the member record (null clears) so a never-started member's first dispatch binds it.

## Alternatives considered

**Re-host the official `conversation.input.model` seat in RoomComposer.** Impossible by architecture: slot declarations are single-owner and `renderSlot` is authorized per entry (ui-slots registry throws on a second declarer). The upstream-change path (hand the bar's renderSlot to chain takeovers, or export ModelSelect) remains available if the duplication ever hurts.

**Pre-fill the settings field with the CLI default as a real value.** Rejected: blank is a deliberate semantic (follow the CLI's own default); writing a value would pin it and hide upstream default changes. The placeholder naming the default answers the confusion without changing behavior.

**Scrape claude's binary-embedded model constants.** Rejected: an internal identity-validation table inside the bundled JS is not a supported surface — it would be a hardcoded catalog in disguise.

## Consequences

Every model-bearing surface in the family now shows and switches models with one visual language. Costs: RoomModelPicker duplicates the official ModelSelect UI (bounded — both sit on the same directory service, so behavior can't drift semantically); the codex probe costs one short-lived app-server spawn per 5-minute window at most; an RPC-failed `setMemberModel` in the room edit dialog degrades to journal-only persistence (documented). Tests: settings cards +24 across four packages, codex +9 (catalog 8, broker 1), member composer +1, room +14 (composer picker 6, member cards/edit 8, service 1).
