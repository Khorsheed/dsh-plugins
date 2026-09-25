/**
 * Stage one of this package's right-Sidebar registration: what the
 * `file-preview` tab type IS — on both host lines (the plan-B embedding into
 * the official document tab landed and was vetoed the same day, 2026-09-24;
 * this self-drawn page is the content face again).
 *
 * Both a page and a claimant: the guide page offers it as an entry box, and
 * it claims `dsh-resource://file/**` addresses whose suffix the detail view's
 * preview stack renders (text/code/markup/data/images — pdf, archives, and
 * binaries stay with the official document tab). At the default `extension`
 * band it outranks the official `text` type (fallback band) — the rc.1 tab
 * registry kept the band mechanism — so every openResource route (the
 * deliverables card, the file tree, wrapped mentions' fallback, the turn
 * card) lands files in our detail view. The claim is deterministic by
 * construction: an earlier cut also required fold membership, but the cache
 * warms only after our surfaces fetch, and turns the official card claims
 * never mount our card (its loader) — exactly those files kept falling back
 * to the official tab (the "sometimes ours, sometimes official" race). The
 * turn card opens the page by kind with `params: { path }` for
 * outside-workspace paths (no addressable resource).
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const FILE_PREVIEW_KIND = 'file-preview'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const FILE_PREVIEW_ID = '@khorsheed/dsh-client-ui-file-preview'

/**
 * Suffixes the detail view's preview stack renders: the change-history text
 * set plus the image formats the pane's image arm serves. Everything else
 * (pdf, archives, binaries) stays with the official document tab — the type's
 * `canOpen` filters on this set before claiming an address.
 */
export const RENDERABLE_EXTENSIONS: readonly string[] = [
  'md', 'mdx', 'txt', 'log',
  'json', 'jsonc', 'jsonl', 'csv', 'tsv', 'xml', 'svg',
  'yaml', 'yml', 'toml', 'ini',
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'sh', 'bash', 'sql',
  'html', 'htm', 'css', 'scss', 'less',
  'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'swift', 'kt',
  'vue', 'svelte', 'diff', 'patch',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
]

const RENDERABLE = new Set(RENDERABLE_EXTENSIONS)

/**
 * Whether the detail view can render this path's content (suffix match,
 * case-insensitive, compound suffixes intentionally not special-cased).
 * @param path - any file path spelling.
 */
export function renderablePath(path: string): boolean {
  const base = path.replaceAll('\\', '/').toLowerCase()
  const name = base.slice(base.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && RENDERABLE.has(name.slice(dot + 1))
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The file-preview page takes the path to select (the turn card's outside-workspace gesture). */
    'file-preview': { readonly path?: string }
  }
}

/**
 * The type's glyph at the guide capsule's size: a document sheet with the
 * change-history accent (the official files capsule's two-tone flat style,
 * re-cut for "products with history").
 */
function ProductsGlyph({ size, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" className={className} aria-hidden="true">
      {/* Sheet: folder-blue family, matching the official files capsule's palette. */}
      <path
        d="M7 3.5h7.2c.5 0 .9.2 1.2.5l4.4 4.4c.3.3.5.7.5 1.2v12.1c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V5.3c0-1 .8-1.8 1.8-1.8Z"
        fill="#4f8ff7"
        opacity="0.28"
      />
      <path
        d="M7 3.5h7.2c.5 0 .9.2 1.2.5l4.4 4.4c.3.3.5.7.5 1.2v12.1c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V5.3c0-1 .8-1.8 1.8-1.8Z"
        fill="none"
        stroke="#4f8ff7"
        strokeWidth="1.6"
      />
      <path d="M14.6 3.8v4.4c0 .6.5 1.1 1.1 1.1h4.4" fill="none" stroke="#4f8ff7" strokeWidth="1.6" />
      {/* The diff accent: one removal line, one addition line. */}
      <line x1="8.6" y1="13.6" x2="13.4" y2="13.6" stroke="#e5645f" strokeWidth="1.7" strokeLinecap="round" />
      <line x1="8.6" y1="17.4" x2="15.6" y2="17.4" stroke="#3fb27f" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
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

/**
 * The file-preview type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function filePreviewDefinition(t: TranslateNS<'filePreview'>): SidebarRightTabDefinition {
  return {
    id: FILE_PREVIEW_ID,
    kind: FILE_PREVIEW_KIND,
    patterns: ['dsh-resource://file/**'],
    // Claim every session-scoped file address the preview stack renders.
    // Synchronous and deterministic by construction (no data dependency);
    // unrenderable suffixes and session-less addresses decline, falling
    // through to the official document tab (fallback band).
    canOpen: (address) => {
      const parsed = parseFileAddress(address)
      return parsed?.scope === 'session' && renderablePath(parsed.path)
    },
    title: (address) => chipTitle(address, () => t('open')),
    guide: [{
      id: FILE_PREVIEW_KIND,
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: ProductsGlyph,
    }],
  }
}
