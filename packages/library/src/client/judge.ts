/**
 * Judging the answers the sidebar can judge itself: a choice against its key
 * (a letter, the option text, or a lettered option) and a fill-in against its
 * key — the same text loosely (width, case, spaces, LaTeX vs unicode, the
 * comma's width), or the same NUMBER (1/2 = 0.5 = \frac{1}{2}), part by part
 * for a multi-blank answer; alternatives are written " / ", "|" or "或". What
 * still disagrees, the learner may overrule (「我答对了」). Open answers are
 * the coach's.
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

/** Fold LaTeX notation onto its plain reading: $…$ delimiters, \sqrt / \frac, known commands, braces, \!/\, spacing. */
function mathFold(text: string): string {
  let folded = text.replace(/\$+/g, '').replace(/\\left|\\right/g, '')
  // Innermost first, so \frac{\sqrt{3}}{2} reads as √3/2.
  for (let pass = 0; pass < 4; pass += 1) {
    folded = folded
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_raw, body: string) => /^[\w.π]+$/.test(body) ? `√${body}` : `√(${body})`)
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_raw, top: string, bottom: string) =>
        `${/^[\w.π√]+$/.test(top) ? top : `(${top})`}/${/^[\w.π√]+$/.test(bottom) ? bottom : `(${bottom})`}`)
  }
  return folded
    .replace(/\\([a-zA-Z]+)/g, (_raw, cmd: string) => MATH_COMMANDS[cmd] ?? cmd)
    .replace(/\\[^a-zA-Z]/g, '')
    .replace(/[{}]/g, '')
}

/** Superscript / subscript digits as their ^ / _ spelling — NFKC alone would flatten (x-2)² into (x-2)2. */
const SCRIPTS: Readonly<Record<string, string>> = Object.fromEntries([
  ...[...'⁰¹²³⁴⁵⁶⁷⁸⁹'].map((char, digit) => [char, `^${digit}`]),
  ...[...'₀₁₂₃₄₅₆₇₈₉'].map((char, digit) => [char, `_${digit}`]),
  ['⁻', '^-'], ['ⁿ', '^n'],
])

/** Compare answers loosely. */
function norm(text: string): string {
  return mathFold(text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉⁻ⁿ]/g, char => SCRIPTS[char] ?? char).normalize('NFKC').replace(/\u2044/g, '/')).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[。.!！?？]+$/, '')
}

/** Looser still: no spaces, one minus sign, no wrapping quotes or trailing clause punctuation. */
function loose(text: string): string {
  return norm(text)
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[×*·]/g, '×')
    // Wrapping quotes go; brackets stay (an interval's brackets are the answer).
    .replace(/^[「『“"'‘《]+|[」』”"'’》]+$/g, '')
    .replace(/[,;:、]+$/, '')
}

/**
 * The value of a plain numeric expression — digits, + - × / ^, parentheses,
 * √, π, a trailing % — or undefined. A tiny recursive-descent parser, never
 * eval: 1/2, 0.5, √3/2, 2π/3 and 50% all read as numbers.
 */
export function numericValue(text: string): number | undefined {
  const source = loose(text).replace(/^[a-zα-ω]\w*=/, '').replace(/,/g, '')
  if (source === '' || !/^[\d.+\-×/^()√π%]+$/.test(source) || !/\d|π/.test(source)) return undefined
  let at = 0
  const peek = (): string => source[at] ?? ''
  const expr = (): number => {
    let value = term()
    while (peek() === '+' || peek() === '-') value = source[at++] === '+' ? value + term() : value - term()
    return value
  }
  const term = (): number => {
    let value = power()
    for (;;) {
      if (peek() === '×') { at += 1; value *= power() }
      else if (peek() === '/') { at += 1; value /= power() }
      else if (/[\d.(√π]/.test(peek())) value *= power() // implicit: 2π, 2√3
      else return value
    }
  }
  const power = (): number => {
    const base = unary()
    if (peek() !== '^') return base
    at += 1
    return base ** unary()
  }
  const unary = (): number => {
    if (peek() === '-') { at += 1; return -unary() }
    if (peek() === '+') { at += 1; return unary() }
    if (peek() === '√') { at += 1; return Math.sqrt(atom()) }
    return atom()
  }
  const atom = (): number => {
    if (peek() === '(') {
      at += 1
      const value = expr()
      if (peek() !== ')') throw new Error('unbalanced')
      at += 1
      return value
    }
    if (peek() === 'π') { at += 1; return Math.PI }
    const match = /^\d*\.?\d+/.exec(source.slice(at))
    if (match === null) throw new Error('not a number')
    at += match[0].length
    let value = Number(match[0])
    if (peek() === '%') { at += 1; value /= 100 }
    return value
  }
  try {
    const value = expr()
    return at === source.length && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** One answer against one key: same text (loosely), or the same number. */
function sameAtom(given: string, want: string): boolean {
  if (norm(given) === norm(want) || loose(given) === loose(want)) return true
  const a = numericValue(given)
  const b = numericValue(want)
  return a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
}

/** A multi-blank answer ("1/2, √3/2") matches part by part, in order. */
function sameAnswer(given: string, want: string): boolean {
  if (sameAtom(given, want)) return true
  const split = (text: string): string[] => norm(text).split(/\s*[,;、]\s*/).filter(part => part !== '')
  const parts = split(given)
  const keys = split(want)
  return keys.length > 1 && parts.length === keys.length && keys.every((key, index) => sameAtom(parts[index]!, key))
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

/**
 * Whether a fill-in answer matches the key. The whole key is tried first —
 * "1/2" is a fraction, never two alternatives — then alternatives written
 * " / " (spaced), "|" or "或".
 */
export function fillMatches(input: string, answer: string): boolean {
  if (norm(input) === '') return false
  const alternatives = [answer, ...answer.split(/\s+\/\s+|\s*[|｜]\s*|\s*或\s*/)].filter(alternative => alternative.trim() !== '')
  return alternatives.some(alternative => sameAnswer(input, alternative))
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
