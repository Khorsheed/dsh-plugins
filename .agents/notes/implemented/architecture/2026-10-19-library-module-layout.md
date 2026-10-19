# Agent Note: Library — module layout by domain (service layers, one file per tool, station views)

Status: implemented

## Problem

Three files had grown past the point where a change in one domain meant reading the others: `src/service.ts` (~2200 lines: projects, resources, roadmaps, pages, cards, assessments, attempts, bindings, events and the pure rules in one class), `src/tool-definition.ts` (~1100 lines: ten tools inside one closure) and `src/client/views/book.tsx` (~1100 lines: the textbook page, the station page and the whole 章节考 tab). The next step — knowledge-point mastery and a per-subject profile seam — touches all three, and the user expects more subjects later.

## Decision

A mechanical split, no behavior change, one commit before any feature work:

- **Service as layers.** `LibraryService` stays one public class (`src/service.ts` re-exports it, so every import path holds), built as a chain of layers in `src/service/`, each extending the one below: `core` (store, listeners, disposal, `mutate`, events, refusals) → `shelf` (projects, resources, seq) → `cards` → `roadmap` (drafts, adoption, notes, 读完) → `pages` → `assess` (quizzes, attempts) → `bindings` (bindings, summary, events, stats) = `LibraryService`. A layer may call anything below it; members that crossed layers went from `private` to `protected`. Pure rules (shape validation, unlock, the evidence gate) moved to `service/rules.ts`.
- **One file per tool.** `src/tools/<noun>.ts` exports a factory taking the shared kit; `src/tools/kit.ts` holds the transport helpers, the parameter schemas and `createToolKit` (binding defaults, project / resource resolution, auto-binding). `src/tool-definition.ts` only assembles the ten tools in workflow order and keeps `LIBRARY_TOOL_NAMES`.
- **Station views apart.** `views/book.tsx` keeps the textbook page (draft card, path, skipped chapters, quiz rows); `views/station.tsx` holds the station page and its 导读 / 我的记录 / 讲义 tabs; `views/station-quiz.tsx` the 章节考 and acceptance tabs.

## Alternatives considered

- **Separate npm packages per subject or per domain**: rejected — what varies by subject is small (judging, mark kind, review modes, coach prompt fragments, math rendering) and belongs behind a profile seam inside the package; more packages would add dependency, packing and deploy rules for no gain. A future subject that needs its own UI can ship a companion package providing a profile to the core (the sanctioned companion → core edge).
- **Composition (domain objects the service delegates to) instead of a class chain**: rejected for this step — it rewrites every method body; the layer chain moves bodies verbatim, which is what a no-behavior-change split needs. Composition stays open if a layer later needs independent testing.

## Consequences

- Import paths are unchanged for callers (`./service.ts`, `./tool-definition.ts` with `splitTocText` / `chaptersLocator` re-exported, `views/book.tsx` for `QuizRows`); `LibraryPane` imports `NodeView` from `views/station.tsx`.
- `tsconfig.host.json` / `tsconfig.client.json` list the new files (their `files` arrays are explicit).

## Testing

163/163 unchanged and green; host and client typecheck clean; `check:panels` clean. The sidebar fixture's 今日 and 章节考 screens are pixel-identical before and after the split.
