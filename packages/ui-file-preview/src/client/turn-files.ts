/**
 * Turn-tail chain claim for the file-preview turn card. The card is an async
 * thin shell: the host `filePreview.turnFiles` RPC is the SINGLE source of
 * truth for every turn's mutations — write/edit calls, Code Mode dispatches,
 * render-intent paths from result diff meta, and bash captures — so the old
 * client-side write/edit-only fold and the official deliverables union retired
 * with it (the "two pipelines, one divergence" fix: the card and the products
 * tab now read the same host data). The claim is unconditional so the card
 * mounts for every turn and renders nothing until its fetch settles or the
 * turn has no files — a no-file turn shows nothing, and the official
 * produced-files entry never mounts (priority -1 preemption unchanged).
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Claim every turn of the chain (the row decides visibility from its fetch).
 * @param _owner - chain owner currency; unused — the claim never declines.
 * @returns a non-null marker so this entry always wins the first-match election.
 */
export function selectTurnFiles(_owner: TurnTailOwnerProps): readonly [] {
  return []
}

/** Re-export for the row component's basename display. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
