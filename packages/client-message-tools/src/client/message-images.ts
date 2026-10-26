/**
 * Cross-host message-image gallery dispatch shared by the two chat-node views.
 * Hosts before 0.2.1-alpha.3 pass a `renderMessageImages` owner prop with the
 * session-authorized loader bound inside; 0.2.1-alpha.3 removed that prop when
 * the images slot split into `conversation.chat.user.images` /
 * `conversation.chat.message.images`, with the official gallery now behind the
 * root-scoped `conversation.images.content` factory (ui-attachment) reached
 * through the framework `renderFactorySlot` seat. The factory outlet renders
 * nothing while the factory is unregistered, which matches the official
 * omit-on-absence behavior of the unfilled images slots.
 */
import type { ReactNode } from 'react'
import type { MessageImageLoader, MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'

/** The gallery input one view owns: the owner props minus the loader. */
export type MessageImagesInput = Omit<MessageImagesOwnerProps, 'loadImage'>

/**
 * Render one image group through the host's gallery surface. The legacy owner
 * prop wins when present: on hosts that still pass it (before 0.2.1-alpha.3)
 * the factory either has no seat (0.1.5) or is never registered, while the
 * prop always carries a working gallery. On 0.2.1-alpha.3+ the prop is absent
 * and the factory renders the official gallery.
 * @param legacy - the pre-0.2.1 owner-prop closure, when the host passes it.
 * @param renderFactorySlot - the framework factory seat.
 * @param loadImage - the session-authorized loader from `ChatNodeOwnerProps`.
 * @param input - image sources and layout hints.
 * @returns the gallery occurrence, or null when the composition has none.
 */
export function renderImageGallery(
  legacy: ((owner: MessageImagesInput) => ReactNode) | undefined,
  renderFactorySlot: RenderFactorySlot,
  loadImage: MessageImageLoader,
  input: MessageImagesInput,
): ReactNode {
  if (legacy !== undefined) return legacy(input)
  return renderFactorySlot('conversation.images.content', { ...input, loadImage })
}
