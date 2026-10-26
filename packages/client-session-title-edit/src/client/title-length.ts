/**
 * Client-side mirror of the host session-title byte budget and the
 * normalization the host applies before capping, so the editor can gate
 * against the exact title the host would accept instead of discovering a
 * silent truncation after commit.
 *
 * The host contract: `@deepseek-ai/dsh-session-title`'s
 * `normalizeSessionTitle(input, maxTitleBytes)` cleans the text (ESC/CSI/
 * control/directional sequences stripped, whitespace collapsed to one space,
 * trimmed) and truncates to a UTF-8 byte budget. The production default is
 * `maxTitleBytes: 80` (deepseek-harness `packages/bundle/base/cordis.patch.yml`).
 * The clean step and the constant below mirror that behavior; update them
 * together if the host changes either.
 */

/** Strip operating-system-command escape sequences, including unterminated tails. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
/** Strip control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
/** Strip remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu
/** Strip non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
/** Strip directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/**
 * Host cap on any accepted session title, in UTF-8 bytes. Mirrors the
 * production default `maxTitleBytes: 80`; keep in sync with the host config.
 * 80 bytes ≈ 80 ASCII characters or ≈ 26 CJK characters (3 bytes each).
 */
export const MAX_TITLE_BYTES = 80

/**
 * UTF-8 byte length of a string (the host caps titles by encoded size, not
 * character count).
 * @param input - arbitrary text.
 * @returns the number of UTF-8 bytes `input` encodes to.
 */
export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length
}

/**
 * Byte length of a draft after the same cleaning the host applies before
 * capping: escape/control/directional sequences stripped, whitespace
 * collapsed to single spaces, trimmed. Gating on this value means the editor
 * fires exactly when the host would truncate — whitespace-heavy or control-
 * laced drafts are not falsely flagged, and drafts at the boundary pass
 * through unchanged.
 * @param input - raw editor draft.
 * @returns UTF-8 bytes of the cleaned text (0 when nothing visible remains).
 */
export function normalizedTitleByteLength(input: string): number {
  const cleaned = input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return utf8ByteLength(cleaned)
}
