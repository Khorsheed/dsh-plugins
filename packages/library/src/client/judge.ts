/**
 * Judging the answers the sidebar can judge itself: a choice against its key
 * (a letter, the option text, or a lettered option) and a fill-in against its
 * key (alternatives split on / or |). Width, case, whitespace and trailing
 * punctuation never decide. Open answers are the coach's.
 *
 * @module @khorsheed/dsh-library/client/judge
 */

/** Compare answers loosely. */
function norm(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[。.!！?？]+$/, '')
}

/** The option index an answer key names, or -1. */
export function choiceIndex(options: readonly string[], answer: string): number {
  const key = norm(answer)
  if (/^[a-z]$/.test(key)) return key.charCodeAt(0) - 97
  const lettered = /^([a-z])[.、)）:：]\s*/.exec(key)
  if (lettered !== null) return lettered[1]!.charCodeAt(0) - 97
  const exact = options.findIndex(option => norm(option) === key)
  if (exact >= 0) return exact
  return options.findIndex(option => norm(option).includes(key) || key.includes(norm(option)))
}

/** Whether a fill-in answer matches the key. */
export function fillMatches(input: string, answer: string): boolean {
  const given = norm(input)
  return given !== '' && answer.split(/[/|]/).some(alternative => norm(alternative) === given)
}
