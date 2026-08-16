# Agent Note: New-session shortcut (Ctrl/Cmd+O) via the public workspaces service

Status: implemented

English | [中文](2026-08-16-ui-shortcuts-new-session.zh.md)

## Problem

The shortcuts plugin shipped with two fixed actions (pause, steer-send); starting a new session had no keyboard entry even though it is one of the most frequent chat-app gestures. The chord choice is constrained by the browser: Ctrl/Cmd+N (new window), Ctrl/Cmd+Shift+N (incognito), and the tab-management chords are browser-reserved and can never be intercepted by a page.

## Decision

A third fixed action `newSession`, default `Ctrl/Cmd+O`, calls the public `workspaces.startSession()` — the same entry the sidebar New-session button calls (`WorkspaceRuntime.startSession` resolves target workspace → reuse-blank-or-create → open; no workspace → New Session view). The keydown rides the steer-send capture-phase global listener (not the composer-gated Escape path — session creation is a global gesture) and `preventDefault`s the browser open-file dialog. `workspaces` joins the plugin's `inject` list. Ctrl/Cmd+Shift+O stays reserved for a future new-session-and-split action (ChatGPT's new-chat chord family).

## Alternatives considered

**Ctrl/Cmd+N.** Rejected: browser-reserved (new window), not interceptable — the page never sees the keydown.

**Ctrl/Cmd+Shift+O as the default.** Rejected by the product owner: the plain chord is the everyday action; the Shift variant is reserved for the heavier new-session-and-split operation once split view exists.

**Composer-scoped handling like Escape-pause.** Rejected: there is no text-input conflict for a `primary` chord, and the action must work from the sidebar and session list too.

## Consequences

The durable `ui-shortcuts` settings section gains a `newSession` field with the schema-filled default; stored sections without it adopt the default on read. The settings row renders a third field; `ShortcutBindingsPolicy` carries the third store. The bench in `apply.client.spec.tsx` shadows the root-provided real `workspaces` service's `startSession` with a spy (providing a second one fails loud). This note also covers the completion of the in-flight partial wiring another agent left uncommitted (settings/policy/locales/row-interface without the `index.ts` wiring), and the package's previously missing self-mounting `cordis.patch.yml` (`name` quoted — `@` is YAML-reserved).
