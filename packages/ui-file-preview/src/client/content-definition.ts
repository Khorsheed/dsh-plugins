/**
 * The content renderer's static identity: the implementation id (registry +
 * keyed seat share it) and the file suffixes it answers to.
 *
 * This is the 0.1.7-rc.1 content face: the shared content pane registered as
 * one implementation of the OFFICIAL document tab, replacing the self-drawn
 * tab type's address claim (the 0.1.5 line keeps that tab; see index.ts). At
 * the default `extension` band it outranks every official renderer, so a file
 * click lands in the official document tab with OUR body as the default view —
 * the official renderers stay one dropdown away. Suffixes are the
 * change-history text set plus avif (the one image format the official image
 * renderer does not claim): every other image goes to the official zoom
 * viewer, which is strictly better than the pane's plain `<img>` arm.
 */

import { HISTORY_EXTENSIONS } from './history-definition.ts'

/** The content renderer's implementation id (registry + seat key). */
export const FILE_CONTENT_ID = '@khorsheed/dsh-client-ui-file-preview/content'

/** Bitmap suffixes the pane serves that the official image renderer does not claim. */
export const CONTENT_BINARY_EXTENSIONS: readonly string[] = ['avif']

/** The file suffixes the content renderer answers to. */
export const CONTENT_EXTENSIONS: readonly string[] = [
  ...HISTORY_EXTENSIONS,
  ...CONTENT_BINARY_EXTENSIONS,
]
