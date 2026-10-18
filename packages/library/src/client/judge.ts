/**
 * Judging the answers the sidebar can judge itself: a choice against its key
 * (a letter, the option text, or a lettered option) and a fill-in against its
 * key (alternatives split on / or |). Width, case, whitespace and trailing
 * punctuation never decide. Open answers are the coach's.
 *
 * @module @khorsheed/dsh-library/client/judge
 */

/** The common LaTeX commands as their unicode glyphs — a fill answer's spelling, never its notation, should decide. */
const MATH_COMMANDS: Readonly<Record<string, string>> = {
  infty: '∞', pm: '±', times: '×', div: '÷', cdot: '·', sqrt: '√',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  cup: '∪', cap: '∩', in: '∈', subset: '⊂', supset: '⊃', emptyset: '∅',
  to: '→', rightarrow: '→', leftarrow: '←', degree: '°',
  pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', phi: 'φ', omega: 'ω',
}

/** Fold LaTeX notation onto its plain reading: $…$ delimiters, known commands, braces, \!/\, spacing. */
function mathFold(text: string): string {
  return text
    .replace(/\$+/g, '')
    .replace(/\\([a-zA-Z]+)/g, (_raw, cmd: string) => MATH_COMMANDS[cmd] ?? cmd)
    .replace(/\\[^a-zA-Z]/g, '')
    .replace(/[{}]/g, '')
}

/** Compare answers loosely. */
function norm(text: string): string {
  return mathFold(text.normalize('NFKC')).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[。.!！?？]+$/, '')
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

/* ---------------------------------------------------------------- review */

/** How a due card is asked. */
export type ReviewMode = 'cloze' | 'choice' | 'spell' | 'explain'

/** The slice of a card the review needs. */
export interface ReviewCardLike {
  readonly id: string
  readonly kind: 'word' | 'concept'
  readonly term: string
  readonly aliases: readonly string[]
  readonly gloss: string
  readonly contexts: readonly { readonly sentence: string }[]
  readonly mastery: { readonly box: number; readonly streak: number }
}

/** The sentence with the term blanked, or undefined when the sentence does not hold it. */
export function clozeOf(sentence: string, term: string, aliases: readonly string[] = []): { before: string; after: string; answer: string } | undefined {
  const lower = sentence.toLowerCase()
  for (const candidate of [term, ...aliases].filter(word => word.trim() !== '').sort((a, b) => b.length - a.length)) {
    const at = lower.indexOf(candidate.toLowerCase())
    if (at < 0) continue
    // Take the whole word the match sits in (instalment → instalments).
    let end = at + candidate.length
    while (end < sentence.length && /[A-Za-z'-]/.test(sentence[end]!)) end += 1
    return { before: sentence.slice(0, at), after: sentence.slice(end), answer: sentence.slice(at, end) }
  }
  return undefined
}

/**
 * Pick how to ask a card: a concept is explained; a word the learner already
 * knows well (box 3+) is spelled; otherwise a word met in a sentence is a
 * cloze or a meaning choice, alternating by its streak (the choice needs three
 * other glosses for distractors).
 */
export function pickMode(card: ReviewCardLike, otherGlosses: number): ReviewMode {
  if (card.kind === 'concept') return 'explain'
  if (card.mastery.box >= 3) return 'spell'
  const hasCloze = card.contexts.some(context => clozeOf(context.sentence, card.term, card.aliases) !== undefined)
  const canChoose = otherGlosses >= 3
  if (hasCloze && (!canChoose || card.mastery.streak % 2 === 0)) return 'cloze'
  if (canChoose) return 'choice'
  return hasCloze ? 'cloze' : 'spell'
}

/** Fold the British / American spellings that should never decide an answer. */
function foldSpelling(word: string): string {
  return word.normalize('NFKC').toLowerCase().trim()
    .replace(/[^a-z]/g, '')
    .replace(/our\b/g, 'or')
    .replace(/(?<=[a-z]{3})is(e|ed|es|ing|ation)$/g, 'iz$1')
    .replace(/(?<=[a-z]{2})re$/g, 'er')
    .replace(/ll(?=[a-z])/g, 'l')
    .replace(/(?<=[aeiou])ll(ed|ing)$/g, 'l$1')
}

/** Whether a typed word is the term (case, width, a UK/US spelling and a plural apart). */
export function spellMatches(input: string, answers: readonly string[]): boolean {
  const given = foldSpelling(input)
  if (given === '') return false
  return answers.some(answer => {
    const want = foldSpelling(answer)
    return want === given || want === given.replace(/e?s$/, '') || want.replace(/e?s$/, '') === given
  })
}

/** Per-letter marks for a spelling attempt: true where the letter matches the target at that position. */
export function letterMarks(input: string, target: string): boolean[] {
  return [...input].map((char, index) => target[index]?.toLowerCase() === char.toLowerCase())
}

/** Three distractors from other cards' glosses, shuffled with the answer; `random` is injectable for tests. */
export function choiceOptions(answer: string, others: readonly string[], random: () => number = Math.random): { options: string[]; correct: number } {
  const pool = [...new Set(others.filter(other => other !== answer))]
  const picked: string[] = []
  while (picked.length < 3 && pool.length > 0) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!)
  const options = [...picked]
  const correct = Math.floor(random() * (options.length + 1))
  options.splice(correct, 0, answer)
  return { options, correct }
}
