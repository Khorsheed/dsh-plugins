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
 * - `canvas.card.section`: on a foreshadow's page the user's ★, on a
 *   character's page 此刻 (editable).
 *
 * Outside the canvas, the conversation cards of `novel_write` /
 * `novel_extract`: the shared fixed shell (`@khorsheed/dsh-client-ui-agent-nav`).
 * The novel draws nothing there: its tools hand the label, status and door's
 * words with the write, and the panel's confirm / adopt hand what came of it
 * (`updateCards`). The door opens the answer's destination through the
 * canvas's `canvasNav.go`, read lazily — without it the card has no door.
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
import { NOVEL_CODEX_FACE, NOVEL_GENRE_ID, NOVEL_IDEAS_FACE, NOVEL_PLAN_FACE, NOVEL_STORY_FACE } from '../types.ts'
import { IdeasView } from './IdeasView.tsx'
import { CodexView } from './CodexView.tsx'
import { TimelineView } from './TimelineView.tsx'
import { CardSection } from './CardSection.tsx'
import { ChapterBook } from './ChapterBook.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { STORY_LOG_PAGE, type NovelFace, type NovelRemote } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { ChaptersBadge, CardScopes, DeleteNote, FaceLabel } from './NovelFaces.tsx'
import { PlanView } from './PlanView.tsx'
import { StoryLogPage } from './StoryLogPage.tsx'
import {
  notifyWritten, registerDestinationCards, updateCards, type Destination,
} from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

export { CardSection } from './CardSection.tsx'
export { ChapterBook } from './ChapterBook.tsx'
export { ChapterReader } from './ChapterReader.tsx'
export { ChaptersBadge, CardScopes, DeleteNote, FaceLabel, storyUsage } from './NovelFaces.tsx'
export { PendingList } from './PendingList.tsx'
export { PlanView } from './PlanView.tsx'
export { StoryLogPage, StoryView } from './StoryLogPage.tsx'
export { STORY_LOG_PAGE } from './contract.ts'
export type { NovelCardOwnerProps, NovelFace, NovelNavigate, NovelOwnerProps, NovelPageOwnerProps, NovelRemote } from './contract.ts'

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

  /**
   * The session's conversation input, reached structurally the way the
   * canvas's quote gestures reach it (ui-conversation's per-session facade,
   * never imported: a composition may omit it, and `sessions` is read
   * lazily for the same reason).
   */
  type InputFacade = {
    state?: { getSnapshot(): { draft: string } }
    setDraft?: (value: string) => void
    focus?: () => void
    submit?: (mode?: unknown, source?: 'click' | 'enter') => void
  }
  const inputOf = (sessionId: SessionId): InputFacade | undefined => {
    const scope = (ctx.get.bind(ctx) as (name: string) => unknown)('sessions') as { scope(id: SessionId): { get(name: string): unknown } } | undefined
    const session = scope?.scope(sessionId)
    return (session?.get('conversation') as { input?: { for(actx: unknown): unknown } } | undefined)?.input?.for(session) as InputFacade | undefined
  }
  /**
   * Send a line as the person's message. Only into an empty input: a draft
   * the person is still typing is never sent along — the line is appended to
   * it instead and nothing goes out ('drafted'). False when the composition
   * has no conversation input.
   */
  const sendToConversation = (sessionId: SessionId, text: string): 'sent' | 'drafted' | false => {
    try {
      const input = inputOf(sessionId)
      if (typeof input?.setDraft !== 'function' || typeof input.state?.getSnapshot !== 'function') return false
      const draft = input.state.getSnapshot().draft.trimEnd()
      if (draft !== '' || typeof input.submit !== 'function') {
        input.setDraft(draft === '' ? text : `${draft}\n\n${text}`)
        if (typeof input.focus === 'function') input.focus()
        return 'drafted'
      }
      input.setDraft(text)
      input.submit(undefined, 'click')
      return 'sent'
    } catch {
      return false
    }
  }
  const draftToConversation = (sessionId: SessionId, text: string): boolean => {
    try {
      const scope = (ctx.get.bind(ctx) as (name: string) => unknown)('sessions') as { scope(id: SessionId): { get(name: string): unknown } } | undefined
      const session = scope?.scope(sessionId)
      const input = (session?.get('conversation') as { input?: { for(actx: unknown): unknown } } | undefined)?.input?.for(session) as {
        state?: { getSnapshot(): { draft: string } }
        setDraft?: (value: string) => void
        focus?: () => void
      } | undefined
      if (typeof input?.setDraft !== 'function' || typeof input.state?.getSnapshot !== 'function') return false
      const draft = input.state.getSnapshot().draft.trimEnd()
      input.setDraft(draft === '' ? text : `${draft}\n\n${text}`)
      if (typeof input.focus === 'function') input.focus()
      return true
    } catch {
      return false
    }
  }
  const t = ctx.locale.bind(NS)
  /**
   * The Remote, with the gestures that change what a conversation card says
   * (a plan confirmed, an outline adopted) handing the card its news
   * (`updateCards`), and every such gesture announcing its write so the
   * panels re-read.
   */
  const announced = new WeakMap<object, NovelRemote>()
  const remoteOf = (): NovelRemote | undefined => {
    const api = ctx.get('remote.novel') as NovelRemote | undefined
    if (api === undefined) return undefined
    let wrapped = announced.get(api)
    if (wrapped === undefined) {
      const written = (canvasId: string): void => { notifyWritten({ kind: 'canvas', params: { canvasId } }) }
      const ok = (result: unknown): boolean => {
        const outer = result as { ok?: boolean; value?: { ok?: boolean } } | undefined
        return outer?.ok === true && outer.value?.ok !== false
      }
      wrapped = {
        ...api,
        confirmPlan: async (sessionId, request) => {
          const result = await api.confirmPlan(sessionId, request)
          if (ok(result)) {
            updateCards('canvas', { canvasId: request.canvasId, face: 'manuscripts', item: String(request.n), focus: 'plan' },
              { status: t('card.confirmed'), awaiting: false, door: `${t('card.view')} →` })
          }
          written(request.canvasId)
          return result
        },
        editPlan: async (sessionId, request) => { const result = await api.editPlan(sessionId, request); written(request.canvasId); return result },
        decideOutline: async (sessionId, request) => {
          const result = await api.decideOutline(sessionId, request)
          if (ok(result)) {
            updateCards('canvas', { canvasId: request.canvasId, face: 'lead' },
              { status: t('card.outlineSettled'), awaiting: false, door: `${t('card.outlineView')} →` })
          }
          written(request.canvasId)
          return result
        },
      }
      announced.set(api, wrapped)
    }
    return wrapped
  }
  const face: NovelFace = { remote: remoteOf, draftToConversation, sendToConversation }
  // The seats are declared by @khorsheed/dsh-canvas, outside this type graph.
  const seats = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  const genreKey = (name: string): string => `${NOVEL_GENRE_ID}:${name}`
  for (const name of [NOVEL_PLAN_FACE, 'manuscripts', 'board', NOVEL_STORY_FACE, NOVEL_IDEAS_FACE]) {
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
  }, TimelineView)), 'canvas-novel: timeline face')
  ctx.effect(() => seats.inject('canvas.board.view', () => seats.register({
    name: 'canvas.board.view',
    key: genreKey(NOVEL_IDEAS_FACE),
    locale: NS,
    inject: () => face,
  }, IdeasView)), 'canvas-novel: ideas face')
  ctx.effect(() => seats.inject('canvas.board.view', () => seats.register({
    name: 'canvas.board.view',
    key: genreKey(NOVEL_CODEX_FACE),
    locale: NS,
    inject: () => face,
  }, CodexView)), 'canvas-novel: settings face')
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
  for (const [key, page] of [[STORY_LOG_PAGE, StoryLogPage]] as const) {
    ctx.effect(() => seats.inject('canvas.page', () => seats.register({
      name: 'canvas.page',
      key,
      locale: NS,
      inject: () => face,
    }, page)), `canvas-novel: page ${key}`)
  }

  // The conversation cards (proposal 2026-10-30-agent-sidebar-navigation):
  // the one fixed shell under novel_write / novel_extract and in the Turn tail
  // (the Turn folds its tool rows, card and all, exactly when the reply says
  // 「点一下确认计划」). The novel only hands data; the door is the shell's.
  const go = (): ((destination: Destination) => void) | undefined => {
    const nav = ctx.get('canvasNav') as { go?: (params: Record<string, unknown>) => void } | undefined
    return nav?.go === undefined ? undefined : destination => { nav.go!(destination.params) }
  }
  registerDestinationCards(
    (body, label) => { ctx.effect(body, label) },
    seats,
    () => (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as { events?: { register?: (definition: unknown) => () => void } } | undefined,
    {
      owner: '@khorsheed/dsh-canvas-novel',
      tools: ['novel_write', 'novel_extract'],
      locale: NS,
      face: () => ({ copy: () => ({ kind: t('card.label'), running: t('card.running'), failed: t('card.failed'), open: t('card.open'), turnTitle: t('card.turnTitle') }), go }),
    },
  )

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
