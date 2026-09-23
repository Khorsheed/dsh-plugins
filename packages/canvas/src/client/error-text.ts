/**
 * The one place a shared error code becomes a sentence the operator reads
 * (stage ⑧: the board tab, the detail tab and the reader all report the same
 * six codes, and a fourth seat was not going to get a fourth `switch`).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CanvasError } from '../types.ts'

/**
 * Localized copy for one shared error code.
 * @param t - the canvas namespace's translate.
 * @param error - the code the store answered with.
 * @returns the line to show.
 */
export function canvasErrorText(t: TranslateNS<'canvas'>, error: CanvasError): string {
  switch (error) {
    case 'exists': return t('error.exists')
    case 'stale': return t('error.stale')
    case 'missing': return t('error.missing')
    case 'invalid-name': return t('error.invalidName')
    case 'denied': return t('error.denied')
    default: return t('error.io')
  }
}
