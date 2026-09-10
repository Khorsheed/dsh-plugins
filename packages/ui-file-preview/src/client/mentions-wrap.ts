/**
 * Mention open-route unification (S1 tail): the official ui-deliverables
 * `chatFileMentions` routes clicks on files delivered through the `present`
 * tool to the native default application (`opener.open`), while undelivered
 * files open in the right sidebar (`owner.openFile`). This plugin wants every
 * prose mention to open in the sidebar, so the provided service's
 * `forClosing` is WRAPPED IN PLACE: the original implementation keeps its
 * claim and copy logic (which paths link, which labels they carry), and only
 * the resolved `open` behavior is replaced with `owner.openFile` — the
 * official route into the right-sidebar document tab.
 *
 * Why in-place mutation: `ctx.provide` rejects a second provider and
 * `ctx.set` rejects any fiber but the provider's own ("cannot set property in
 * multiple fibers", vendor/cordis reflect.ts) — no official cross-plugin
 * replacement seam exists (the open-direction override is the S1 tail
 * registered in docs/upstream-seam-registry.md). The mutated object is the
 * exact reference the chat view reads per call
 * (`ctx.get('chatFileMentions')?.forClosing(...)`), so the wrap takes effect
 * without a remount. Ordering rides the dsh.client.inject package edge on
 * ui-deliverables (compose order = apply order). If the deliverables fiber
 * ever reloads (HMR), its fresh provide discards this wrap — accepted; the
 * original behavior (native open for presented files) simply returns.
 *
 * The resolved path is recovered from the mention's `title`, which the
 * official builder sets to the path (producedFileMentions, 0.1.5-rc.1) — a
 * structural assumption re-checked on every host upgrade.
 *
 * @module @khorsheed/dsh-client-ui-file-preview
 */
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * Wrap the provided chatFileMentions service so every resolved mention opens
 * through `owner.openFile` (the sidebar document tab) instead of the native
 * default application. Idempotent: a second wrap of the same object is a no-op.
 * @param mentions - the live service object ui-deliverables provided.
 */
export function wrapChatFileMentions(mentions: ChatFileMentions): void {
  if (WRAP_MARK in mentions) return
  const original = mentions.forClosing.bind(mentions)
  mentions.forClosing = (owner, sessionId) => {
    const resolved = original(owner, sessionId)
    if (resolved === undefined) return undefined
    return {
      resolve(value: string) {
        const hit = resolved.resolve(value)
        if (hit === undefined) return undefined
        // hit.title is the resolved path (official builder contract); the
        // owner opens it in the right sidebar.
        return { ...hit, open: () => owner.openFile(hit.title) }
      },
    }
  }
  Object.defineProperty(mentions, WRAP_MARK, { value: true })
}

/** Non-enumerable marker making the in-place wrap idempotent. */
const WRAP_MARK = Symbol.for('dsh.client-ui-file-preview.mentionsWrapped')
