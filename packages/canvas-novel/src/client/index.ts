/**
 * The 长篇小说 genre's browser half: the surfaces that live inside the
 * canvas, on the seats it declares for genres. The genre names its own top
 * face (`faces.view: 'story'`), so the canvas reads 章节 · 设定 · 故事:
 *
 * - `canvas.board.tab` (`novel:manuscripts` / `novel:board` / `novel:story`):
 *   the three labels; `canvas.board.tab.badge` `novel:manuscripts`: 章节's
 *   badge, what waits on the person;
 * - `canvas.board.manuscripts`: 章节 — the book: 继续写, the pending queue,
 *   the contents, then a chapter-by-chapter reader;
 * - `canvas.board.view` `novel:plan`: 规划 — the one-page outline, the volume
 *   roadmap and the core suspenses (the genre's lead face);
 * - `canvas.board.view` `novel:story`: 故事 — the story log;
 * - `canvas.board.scopes`: 设定's 已进入故事 / 灵感 chips. Its 连线
 *   layout is the canvas's own (free lanes and links; the genre's relation
 *   ring was retired 2026-10-08 — it listed only characters a chapter had
 *   reached, so a work in planning showed none);
 * - `canvas.card.deleteNote`: the chapters a card is in, on its delete question;
 * - `canvas.page` `novel:story-log`: the story log — foreshadows, relations,
 *   characters and world settings as rows over the chapter columns;
 * - `canvas.page` `novel:chapter`: the same reader, opened at one chapter
 *   (from a chat card, or the story log's columns);
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
import { NOVEL_GENRE_ID, NOVEL_PLAN_FACE, NOVEL_STORY_FACE } from '../types.ts'
import { CardSection } from './CardSection.tsx'
import { ChapterBook } from './ChapterBook.tsx'
import { ChapterPage } from './ChapterReader.tsx'
import { CHAPTER_PAGE, PLAN_PAGE, STORY_LOG_PAGE, type NovelFace, type NovelRemote } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { ChaptersBadge, CardScopes, DeleteNote, FaceLabel } from './NovelFaces.tsx'
import { PlanView } from './PlanView.tsx'
import { StoryLogPage, StoryView } from './StoryLogPage.tsx'
import { novelTurnDefinition } from './novel-turn.ts'
import { NovelTurnTail, WriteToolRow, type WriteToolFace } from './WriteToolRow.tsx'

export { CardSection } from './CardSection.tsx'
export { ChapterBook } from './ChapterBook.tsx'
export { ChapterPage, ChapterReader } from './ChapterReader.tsx'
export { ChaptersBadge, CardScopes, DeleteNote, FaceLabel, storyUsage } from './NovelFaces.tsx'
export { PendingList } from './PendingList.tsx'
export { PlanView } from './PlanView.tsx'
export { StoryLogPage, StoryView } from './StoryLogPage.tsx'
export { WriteToolRow } from './WriteToolRow.tsx'
export { CHAPTER_PAGE, PLAN_PAGE, STORY_LOG_PAGE } from './contract.ts'
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
 * faces, the book, the two pages and the tool row.
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
  const genreKey = (name: string): string => `${NOVEL_GENRE_ID}:${name}`
  for (const name of [NOVEL_PLAN_FACE, 'manuscripts', 'board', NOVEL_STORY_FACE]) {
    ctx.effect(() => seats.inject('canvas.board.tab', () => seats.register({
      name: 'canvas.board.tab',
      key: genreKey(name),
      locale: NS,
      inject: () => face,
    }, FaceLabel)), `canvas-novel: face label ${name}`)
  }
  ctx.effect(() => seats.inject('canvas.board.tab.badge', () => seats.register({
    name: 'canvas.board.tab.badge',
    key: genreKey('manuscripts'),
    locale: NS,
    inject: () => face,
  }, ChaptersBadge)), 'canvas-novel: chapters badge')
  ctx.effect(() => seats.inject('canvas.board.view', () => seats.register({
    name: 'canvas.board.view',
    key: genreKey(NOVEL_STORY_FACE),
    locale: NS,
    inject: () => face,
  }, StoryView)), 'canvas-novel: story face')
  ctx.effect(() => seats.inject('canvas.board.view', () => seats.register({
    name: 'canvas.board.view',
    key: genreKey(NOVEL_PLAN_FACE),
    locale: NS,
    inject: () => face,
  }, PlanView)), 'canvas-novel: plan face')
  for (const [slot, component] of [
    ['canvas.board.scopes', CardScopes],
    ['canvas.card.deleteNote', DeleteNote],
  ] as const) {
    ctx.effect(() => seats.inject(slot, () => seats.register({
      name: slot,
      key: NOVEL_GENRE_ID,
      locale: NS,
      inject: () => face,
    }, component)), `canvas-novel: ${slot}`)
  }
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
  for (const [key, page] of [[STORY_LOG_PAGE, StoryLogPage], [CHAPTER_PAGE, ChapterPage], [PLAN_PAGE, PlanView]] as const) {
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
    planPage: PLAN_PAGE,
  }
  ctx.effect(() => seats.inject('tool.call.toolview', () => seats.register({
    name: 'tool.call.toolview',
    key: 'novel_write',
    locale: NS,
    inject: () => writeFace,
  }, WriteToolRow)), 'canvas-novel: novel_write tool row')

  // The same cards in the Turn tail, beneath the closing prose: a finished
  // Turn folds its tool rows, card and all, exactly when the reply says
  // 「点一下确认计划」 (the datasets T96 route). ui-chat declares the slot and
  // composes ui-conversation, so `uiConversation` is read only once it can
  // exist; without either nothing registers and the tool row stays the door.
  ctx.effect(() => seats.inject('conversation.chat.turnTail', () => {
    const conversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as {
      events?: { register?: (definition: unknown) => () => void }
    } | undefined
    const register = conversation?.events?.register
    if (register === undefined) return () => undefined
    const disposeDefinition = register.call(conversation?.events, novelTurnDefinition)
    const disposeEntry = seats.register({
      name: 'conversation.chat.turnTail',
      id: '@khorsheed/dsh-canvas-novel/asks',
      order: 40,
      locale: NS,
      inject: () => writeFace,
    }, NovelTurnTail)
    return () => {
      disposeEntry()
      disposeDefinition()
    }
  }), 'canvas-novel: turn-tail cards')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
