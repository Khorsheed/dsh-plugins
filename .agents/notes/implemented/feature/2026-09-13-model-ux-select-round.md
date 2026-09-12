# Agent Note: select-style model fields with an auto-displayed default

Status: implemented

English | [中文](2026-09-13-model-ux-select-round.zh.md)

## Problem

Third round of model-UX feedback on prod: after picking a value the settings dropdown shrank and changed style (the native `<datalist>` filtering by input text — two list mechanisms fighting); an unset field forced the user to pick once to "see" the default (the ask: auto-display the default, all four providers, and drop the separate 跟随 line); the (i) tooltip copy (「本插件一个模型参数都不传」) read as if choosing another model would not work; the member composer's picker popup looked homemade and opened an empty box when no choices existed; and the invite dialog's model field sat buried in the advanced drawer under a different name.

## Decision

**Settings cards (all four, uniform).** The datalist is gone — the chevron menu is the single, unfiltered list. An unset field DISPLAYS the inherited default (same source chain as before: scoped config → catalog-named → last-observed → generic) in caption styling — display only, never pinned; blank-save still unsets. The menu's leading item `默认（跟随 …）` is checked while unset and clears the draft; the separate 跟随 line under the input is removed (its information lives in the control now); the tooltip copy is rewritten (blank = follow the shown default; pick or type + save pins for later delegations; per-session switching lives in the member composer; manual entry stays).

**Member composer — the picker popup ONLY** (user-scoped: nothing else in the composer touched). The popup now mirrors the official ModelSelect menu (r20, `--dsw-specific-menu`, prominent shadow, 38px rows, trailing check, separated reset row), and an empty-choices state renders one disabled 暂无候选模型 hint row instead of an empty box.

**Room invite dialog.** The model field moved out of the advanced drawer to right under Provider, renamed 默认模型, same select control as the settings cards (dimmed default display, leading 默认 item, no datalist); invite/edit semantics unchanged. The client wiring now passes the full broker surface (`modelSurface`) instead of bare choices.

## Alternatives considered

**Keep the datalist alongside the menu.** Rejected: it is exactly the "dropdown shrank and restyled" confusion — one list mechanism, always complete.

**Auto-PIN the default as a real saved value.** Rejected (as before): blank-is-follow is deliberate; auto-pinning would freeze today's default and hide upstream changes.

## Consequences

Every model field in the family is now the same select control with the same semantics; "默认" is visible everywhere without a click. Tests: settings cards rewritten ×4, member composer +2, room members +~6; suites green (kimi 228, codex 216, claude-code 204, dsh 180, local-agent 267, room 217).
