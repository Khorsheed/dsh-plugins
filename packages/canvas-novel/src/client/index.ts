/**
 * The 长篇小说 genre's browser half: three surfaces that live inside the
 * canvas, on the seats it declares for genres —
 *
 * - `canvas.board.strip`: the work's chapters, the ledger link and the
 *   pending queue (medium/low-confidence findings, missed plans);
 * - `canvas.page` `novel:ledger`: the foreshadow ledger with each
 *   foreshadow's chapter track;
 * - `canvas.page` `novel:chapter`: one chapter — phase lamp, plan, its own
 *   pending items, the text, and the person's 「✓ 审过」.
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
import { ChapterPage } from './ChapterPage.tsx'
import { CHAPTER_PAGE, LEDGER_PAGE, type NovelFace, type NovelRemote } from './contract.ts'
import { LedgerPage } from './LedgerPage.tsx'
import { en, NS, zh } from './locales.ts'
import { PendingStrip } from './PendingStrip.tsx'

export { ChapterPage } from './ChapterPage.tsx'
export { LedgerPage } from './LedgerPage.tsx'
export { PendingList, PendingStrip } from './PendingStrip.tsx'
export { CHAPTER_PAGE, LEDGER_PAGE } from './contract.ts'
export type { NovelFace, NovelNavigate, NovelOwnerProps, NovelPageOwnerProps, NovelRemote } from './contract.ts'

/**
 * Required services: slots, the remote channel, the locale. `remote.novel` is
 * read lazily through `ctx.get` (this plugin mounts it), so a composition
 * without the host half renders each surface's missing state instead of
 * pending forever.
 */
export const inject = ['slots', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * strip and the two pages.
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
  for (const [key, page] of [[LEDGER_PAGE, LedgerPage], [CHAPTER_PAGE, ChapterPage]] as const) {
    ctx.effect(() => seats.inject('canvas.page', () => seats.register({
      name: 'canvas.page',
      key,
      locale: NS,
      inject: () => face,
    }, page)), `canvas-novel: page ${key}`)
  }

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
