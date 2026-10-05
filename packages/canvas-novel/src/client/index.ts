/**
 * The 长篇小说 genre's browser half: four surfaces that live inside the
 * canvas, on the seats it declares for genres —
 *
 * - `canvas.board.strip`: the chapter to pick up at, the pending queue
 *   (medium/low-confidence findings, missed plans), the story-log link and the
 *   way into the book;
 * - `canvas.board.manuscripts`: the 成稿 face as the book — contents, then a
 *   chapter-by-chapter reader;
 * - `canvas.page` `novel:story-log`: the story log — foreshadows, relations,
 *   characters and world settings as rows over the chapter columns;
 * - `canvas.page` `novel:chapter`: the same reader, opened at one chapter
 *   (from the strip, or a chat card);
 * - `canvas.card.section`: on a foreshadow's page the user's ★, on a
 *   character's page 此刻 (editable).
 *
 * Outside the canvas, the `novel_write` tool row in the conversation: a
 * planned chapter shows as a card whose door opens that chapter page (through
 * the canvas's `canvasNav` service, read lazily; without it the card has no
 * door).
 *
 * It mounts the `novel` Remote through the official `ctx.remote.$mount`. The
 * seats are declared by the canvas tab's registration (its children table),
 * which this package does not depend on: every registration rides
 * `ctx.slots.inject` through a structural view of the registry, so without the
 * canvas the injects never fire and nothing renders.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-canvas-novel/remote'
import novelRemote from '@khorsheed/dsh-canvas-novel/remote'
import { NOVEL_GENRE_ID } from '../types.ts'
import { CardSection } from './CardSection.tsx'
import { ChapterBook } from './ChapterBook.tsx'
import { ChapterPage } from './ChapterReader.tsx'
import { CHAPTER_PAGE, STORY_LOG_PAGE, type NovelFace, type NovelRemote } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { PendingStrip } from './PendingStrip.tsx'
import { StoryLogPage } from './StoryLogPage.tsx'
import { WriteToolRow, type WriteToolFace } from './WriteToolRow.tsx'

export { CardSection } from './CardSection.tsx'
export { ChapterBook } from './ChapterBook.tsx'
export { ChapterPage, ChapterReader } from './ChapterReader.tsx'
export { PendingList, PendingStrip } from './PendingStrip.tsx'
export { StoryLogPage } from './StoryLogPage.tsx'
export { WriteToolRow } from './WriteToolRow.tsx'
export { CHAPTER_PAGE, STORY_LOG_PAGE } from './contract.ts'
export type { NovelCardOwnerProps, NovelFace, NovelNavigate, NovelOwnerProps, NovelPageOwnerProps, NovelRemote } from './contract.ts'
export type { WriteToolFace } from './WriteToolRow.tsx'

/**
 * Required services: slots, the remote channel, the locale. `remote.novel` is
 * read lazily through `ctx.get` (this plugin mounts it), so a composition
 * without the host half renders each surface's missing state instead of
 * pending forever.
 */
export const inject = ['slots', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * strip, the book, the two pages and the tool row.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(novelRemote))
  } catch (error) {
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'canvas-novel: dictionaries')

  const face: NovelFace = { remote: () => ctx.get('remote.novel') as NovelRemote | undefined }
  // The seats are declared by @khorsheed/dsh-canvas, outside this type graph.
  const seats = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  ctx.effect(() => seats.inject('canvas.board.strip', () => seats.register({
    name: 'canvas.board.strip',
    id: NOVEL_GENRE_ID,
    locale: NS,
    inject: () => face,
  }, PendingStrip)), 'canvas-novel: board strip')
  ctx.effect(() => seats.inject('canvas.board.manuscripts', () => seats.register({
    name: 'canvas.board.manuscripts',
    key: NOVEL_GENRE_ID,
    locale: NS,
    inject: () => face,
  }, ChapterBook)), 'canvas-novel: book')
  ctx.effect(() => seats.inject('canvas.card.section', () => seats.register({
    name: 'canvas.card.section',
    id: NOVEL_GENRE_ID,
    locale: NS,
    inject: () => face,
  }, CardSection)), 'canvas-novel: card section')
  for (const [key, page] of [[STORY_LOG_PAGE, StoryLogPage], [CHAPTER_PAGE, ChapterPage]] as const) {
    ctx.effect(() => seats.inject('canvas.page', () => seats.register({
      name: 'canvas.page',
      key,
      locale: NS,
      inject: () => face,
    }, page)), `canvas-novel: page ${key}`)
  }

  // The tool slot is declared by @deepseek-ai/dsh-client-ui-tool, outside this
  // type graph too; without it the inject never fires and the call keeps the
  // host's generic row.
  const writeFace: WriteToolFace = {
    ...face,
    openPage: () => (ctx.get('canvasNav') as { openPage: ReturnType<WriteToolFace['openPage']> } | undefined)?.openPage,
    chapterPage: CHAPTER_PAGE,
  }
  ctx.effect(() => seats.inject('tool.call.toolview', () => seats.register({
    name: 'tool.call.toolview',
    key: 'novel_write',
    locale: NS,
    inject: () => writeFace,
  }, WriteToolRow)), 'canvas-novel: novel_write tool row')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
