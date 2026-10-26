/**
 * The model-tool face of the library: one small tool per noun, each with a
 * schema sized to its own job (schema-level required fields per operation —
 * the mega-tool's per-`what` missing-field teaching class moved to the schema
 * line). `library_read` answers everything read-only; the `library_<noun>`
 * writes validate and persist what the coach authored (the card dedupe and
 * the two-axis quiz checks live behind them); `library_assess` is the one
 * cascading write. Content is always generated on the model side; the tools
 * are mechanical. There is no skill to load: each tool's parameter
 * descriptions carry its payload shape, and every refusal teaches the correct
 * call back.
 *
 * A path belongs to one TEXTBOOK (a resource with a contents; proposal
 * 2026-10-19-library-book-paths): `library_roadmap` takes the textbook as a
 * required `resource`, and a station names that textbook's rows as
 * `chapters: "3-4"` plus side references in `also` — both expand to the
 * stored covers (`{ ref, locator? }`). The older spellings still parse
 * (`covers`, `chapterRanges`, `book`, node `kind`), they are just no longer
 * advertised. A node's `gate` says how it completes (quiz | acceptance |
 * read).
 *
 * `project` / `resource` default to the session's binding (the header chip),
 * so a bound session rarely names them; a resource id alone resolves its
 * owner project.
 *
 * Every tool is a thin adapter over {@link LibraryService}, one per file in
 * `tools/` (shared transport helpers, schemas and the per-call kit in
 * `tools/kit.ts`). This module ASSEMBLES the definitions in workflow order
 * and registers nothing; the package's `./tool` row (`src/tool.ts`) tags
 * and registers them.
 *
 * @module @khorsheed/dsh-library/tool-definition
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LibraryService } from './service.ts'
import { ImageRefCache } from './image-refs.ts'
import { createToolKit } from './tools/kit.ts'
import { libraryReadTool } from './tools/read.ts'
import { libraryProjectTool } from './tools/project.ts'
import { libraryResourceTool } from './tools/resource.ts'
import { libraryRoadmapTool } from './tools/roadmap.ts'
import { libraryNotesTool } from './tools/notes.ts'
import { libraryPageTool } from './tools/page.ts'
import { libraryCardsTool } from './tools/cards.ts'
import { libraryQuizTool } from './tools/quiz.ts'
import { libraryBindingTool } from './tools/binding.ts'
import { libraryAssessTool } from './tools/assess.ts'

export { chaptersLocator, splitTocText } from './tools/kit.ts'

/** The names this module registers, in registration (workflow) order. */
export const LIBRARY_TOOL_NAMES: readonly string[] = [
  'library_read',
  'library_project',
  'library_textbook',
  'library_roadmap',
  'library_notes',
  'library_page',
  'library_cards',
  'library_quiz',
  'library_binding',
  'library_assess',
]


/**
 * Build the tools. Creating them is the package's `./tool` row, which applies
 * the origin tag; this module never registers.
 * @param service - the library service the adapters translate to.
 * @param images - the session image references the tool row remembers (a
 *   page's photo is resolved from them, never trusted to the model's copy).
 * @returns the definitions, untagged and unregistered, in workflow order.
 */
export function libraryToolDefinitions(service: LibraryService, images: ImageRefCache = new ImageRefCache()): ToolDefinition[] {
  const kit = createToolKit(service, images)
  return [
    libraryReadTool(kit),
    libraryProjectTool(kit),
    libraryResourceTool(kit),
    libraryRoadmapTool(kit),
    libraryNotesTool(kit),
    libraryPageTool(kit),
    libraryCardsTool(kit),
    libraryQuizTool(kit),
    libraryBindingTool(kit),
    libraryAssessTool(kit),
  ]
}
