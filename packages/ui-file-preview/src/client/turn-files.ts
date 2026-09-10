/**
 * Turn-tail chain claim for the file-preview turn card. The card is an async
 * thin shell: the host `filePreview.turnFiles` RPC is the SINGLE source of
 * truth for every turn's mutations — write/edit calls, Code Mode dispatches,
 * render-intent paths from result diff meta, and bash captures — so the card
 * and the file-preview tab read the same host data. The claim is
 * unconditional so the card mounts for every turn the election reaches it for
 * and renders nothing until its fetch settles or the turn has no files. Since
 * the 0.1.5-rc.1 move the entry carries no priority: the official
 * deliverables row (same default band, registered earlier) elects first and
 * claims the turns its own data covers — this card renders exactly the turns
 * official data misses (bash captures, S2).
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * Claim every turn of the chain (the row decides visibility from its fetch).
 * @param _owner - chain owner currency; unused — the claim never declines.
 * @returns a non-null marker so this entry wins the election whenever the
 *   earlier official entries declined the turn.
 */
export function selectTurnFiles(_owner: TurnTailOwnerProps): readonly [] {
  return []
}

/** Re-export for the row component's basename display. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
