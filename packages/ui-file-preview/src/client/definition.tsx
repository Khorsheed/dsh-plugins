/**
 * Stage one of this package's right-Sidebar registration: what the
 * `file-preview` tab type IS.
 *
 * Both a page and a claimant: the guide page offers it as an entry box, and
 * it claims `dsh-resource://file/**` addresses for files it can render AND
 * recognizes as session products (the fold cache `claimsFile` is fed by the
 * list fetch and the turn-card loader — cold cache declines, falling back to
 * the official document tab; acceptable best-effort, noted in the claim
 * contract). At the default `extension` band it outranks the official `text`
 * type (fallback band), so every openResource route — the official
 * deliverables card, the file tree, wrapped mentions — lands produced files
 * in our detail view. The turn card opens the page by kind with
 * `params: { path }` for outside-workspace paths (no addressable resource).
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { FileTypeIcon, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from './locales.ts'
import { renderablePath } from './history-definition.ts'

/** The tab kind this package owns. */
export const FILE_PREVIEW_KIND = 'file-preview'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const FILE_PREVIEW_ID = '@khorsheed/dsh-client-ui-file-preview'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The file-preview page takes the path to select (the turn card's outside-workspace gesture). */
    'file-preview': { readonly path?: string }
  }
}

/** The type's glyph at the guide capsule's size: a plain file sheet. */
function FileSheetGlyph({ size, className }: IconProps) {
  return <FileTypeIcon kind="other" size={size} className={className} />
}

/**
 * The tab chip text: the decoded basename for a claimed file address (the
 * document tab's convention), the type label for a page open. Decoding is per
 * segment, matching how the address was built, so a name carrying `#`, `?`,
 * or a space reads as itself.
 * @param address - the address being opened.
 * @param fallback - the type label for non-file addresses.
 */
function chipTitle(address: string, fallback: () => string): string {
  if (!address.startsWith('dsh-resource://')) return fallback()
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return fallback()
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}

/** The fold-membership probe backing `canOpen` (sync; fed by the list fetch). */
export interface FileClaimSource {
  /**
   * Whether the fold recorded this path for this session.
   * @param sessionId - the session the address names.
   * @param path - the address's decoded path (workspace-relative or absolute).
   */
  claimsFile(sessionId: string, path: string): boolean
}

/**
 * The file-preview type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @param claims - fold-membership probe for the address claim.
 * @returns the definition to register.
 */
export function filePreviewDefinition(
  t: TranslateNS<'filePreview'>,
  claims: FileClaimSource,
): SidebarRightTabDefinition {
  return {
    id: FILE_PREVIEW_ID,
    kind: FILE_PREVIEW_KIND,
    patterns: ['dsh-resource://file/**'],
    // Claim only what the detail view renders AND what the session's fold
    // recorded as a product; everything else falls through to the official
    // document tab (fallback band). canOpen is synchronous and the fold cache
    // may be cold (the tab never opened) — declining then is the intended
    // degrade, not a miss to retry.
    canOpen: (address) => {
      const parsed = parseFileAddress(address)
      if (parsed?.scope !== 'session') return false
      if (!renderablePath(parsed.path)) return false
      return claims.claimsFile(parsed.sessionId, parsed.path)
    },
    title: (address) => chipTitle(address, () => t('open')),
    guide: [{
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: FileSheetGlyph,
    }],
  }
}
