/**
 * File paths a member writes in inline code (`game-2/design/art.png`) become
 * openers, the way the main conversation links the files a turn produced.
 * The host's own mention vocabulary (ui-deliverables) only knows files a
 * host turn touched; a CLI member's writes happen in its own process, so the
 * room recognizes the path's shape instead: no whitespace, no URL, a common
 * file extension. A token that names no real file opens the viewer's
 * "missing" state — never a broken link.
 * @module @khorsheed/dsh-room/client/path-mentions
 */
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'

/** Extensions a member's inline code most often names as a deliverable or source file. */
const FILE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|md|txt|json|ya?ml|toml|csv|html?|css|[cm]?[jt]sx?|py|sh|glb|gltf|blend|fbx|obj|mp3|wav|ogg|mp4|webm|pdf)$/i

/**
 * Whether an inline-code token reads as a file path.
 * @param value - the token as authored.
 * @returns true for a path-shaped token with a known file extension.
 */
export function looksLikeFilePath(value: string): boolean {
  return value.length <= 300 && !/\s/.test(value) && !value.includes('://') && !value.startsWith('-') && FILE_EXTENSION.test(value)
}

/**
 * The absolute path a member's token names: as written when absolute, under
 * the member's working directory when it has its own, else left relative (the
 * file address then resolves it against the room session's workspace).
 * @param value - the token.
 * @param cwd - the member's own working directory, when it has one.
 * @returns the path to open.
 */
export function memberPath(value: string, cwd: string | undefined): string {
  if (value.startsWith('/') || value.startsWith('~') || cwd === undefined) return value
  return `${cwd.replace(/\/+$/, '')}/${value.replace(/^\.\//, '')}`
}

/**
 * The file-mention vocabulary for one member's text.
 * @param open - opens one resolved path in the sidebar.
 * @param cwd - the member's own working directory, when it has one.
 * @returns the MarkdownText fileMentions value.
 */
export function pathMentions(open: (path: string) => void, cwd: string | undefined): MarkdownFileMentions {
  return {
    resolve: (value) => {
      if (!looksLikeFilePath(value)) return undefined
      const path = memberPath(value, cwd)
      return { open: () => { open(path) }, label: value, title: path }
    },
  }
}
