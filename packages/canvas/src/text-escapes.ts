/**
 * Line breaks that arrived as escape text. Some CLI members (the K3 / Kimi
 * route) hand a tool's string arguments over with their newlines still
 * escaped — 「状态：暂定。\n场景可以恢复」 with a literal backslash-n — and the
 * card then shows the two characters. A string with NO real line break but a
 * literal `\n` is taken to be one of those and unescaped (`\n`, `\r\n`, `\t`);
 * a string that already holds a real line break is left alone, since its
 * backslashes are then meant (a path, a regex, code).
 * @module @khorsheed/dsh-canvas/text-escapes
 */

/**
 * Unescape one string when it carries escaped line breaks only.
 * @param text - the argument as it arrived.
 * @returns the text with its line breaks restored, or the text untouched.
 */
export function unescapeLineBreaks(text: string): string {
  if (text.includes('\n') || !text.includes('\\n')) return text
  return text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * The same through a value of any JSON shape (a card's field values).
 * @param value - the value as it arrived.
 * @returns the value with every string unescaped as above.
 */
export function unescapeDeep<T>(value: T): T {
  if (typeof value === 'string') return unescapeLineBreaks(value) as T
  if (Array.isArray(value)) return value.map(entry => unescapeDeep(entry)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unescapeDeep(entry)])) as T
  }
  return value
}
