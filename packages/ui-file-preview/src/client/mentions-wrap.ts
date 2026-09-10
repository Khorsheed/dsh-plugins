/**
 * Mention open-route unification (S1 tail): the official ui-deliverables
 * `chatFileMentions` routes clicks on files delivered through the `present`
 * tool to the native default application (`opener.open`), while undelivered
 * files open in the right sidebar (`owner.openFile`). This plugin wants every
 * prose mention to open in this package's detail view, so the provided
 * service's `forClosing` is WRAPPED IN PLACE: the original implementation
 * keeps its claim logic (which paths link), while every resolved mention gets
 * a new `open` (the detail view through the injected reroute, falling back to
 * `owner.openFile` — the official openResource route, which the file-preview
 * tab type claims for known products — when the reroute throws) and a new
 * label (the official text for present-delivered files says "open in the
 * default app", which is no longer true).
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

/** The open behavior and label the wrap substitutes for every resolved mention. */
export interface MentionReroute {
  /**
   * Open one resolved path in this package's own surface (the detail view).
   * Takes the viewed session so the open can name the canonical
   * `dsh-resource://file/session/<id>/<path>` address — the same tab the
   * deliverables card's open reveals (one file, one tab). May throw (no
   * mounted sidebar surface); the wrap then falls back to the owner's
   * official `openFile`.
   */
  open(sessionId: string, path: string): void
  /**
   * The mention's action label.
   * @param path - the resolved path (the hit's title).
   * @returns the visible label.
   */
  label(path: string): string
}

/**
 * Wrap the provided chatFileMentions service so every resolved mention opens
 * in this package's detail view instead of the native default application.
 * Idempotent: a second wrap of the same object is a no-op.
 * @param mentions - the live service object ui-deliverables provided.
 * @param reroute - the substituted open behavior and label.
 */
export function wrapChatFileMentions(mentions: ChatFileMentions, reroute: MentionReroute): void {
  if (WRAP_MARK in mentions) return
  const original = mentions.forClosing.bind(mentions)
  mentions.forClosing = (owner, sessionId) => {
    const resolved = original(owner, sessionId)
    if (resolved === undefined) return undefined
    return {
      resolve(value: string) {
        const hit = resolved.resolve(value)
        if (hit === undefined) return undefined
        // hit.title is the resolved path (official builder contract).
        return {
          ...hit,
          label: reroute.label(hit.title),
          open: () => {
            try {
              reroute.open(sessionId, hit.title)
            } catch {
              // No mounted sidebar surface (or a lost race): the official
              // openFile still lands the file in the right sidebar.
              owner.openFile(hit.title)
            }
          },
        }
      },
    }
  }
  Object.defineProperty(mentions, WRAP_MARK, { value: true })
}

/** Non-enumerable marker making the in-place wrap idempotent. */
const WRAP_MARK = Symbol.for('dsh.client-ui-file-preview.mentionsWrapped')
