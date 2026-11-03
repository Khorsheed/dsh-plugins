export interface ChapterSelection {
  readonly quote: string
  readonly start: number
  readonly end: number
  readonly before: string
  readonly after: string
  readonly rect: DOMRect
}

function owner(node: Node): HTMLElement | null {
  return (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('[data-feedback-start]') ?? null
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

export function chapterSelectionFromRange(body: string, root: HTMLElement, range: Range): ChapterSelection | undefined {
  const first = owner(range.startContainer)
  const last = owner(range.endContainer)
  if (first === null || last === null || !root.contains(first) || !root.contains(last)) return undefined
  const firstStart = Number(first.dataset.feedbackStart)
  const lastStart = Number(last.dataset.feedbackStart)
  if (!Number.isInteger(firstStart) || !Number.isInteger(lastStart)) return undefined
  let start = firstStart + textOffset(first, range.startContainer, range.startOffset)
  let end = lastStart + textOffset(last, range.endContainer, range.endOffset)
  while (start < end && /\s/.test(body[start] ?? '')) start += 1
  while (end > start && /\s/.test(body[end - 1] ?? '')) end -= 1
  if (end <= start) return undefined
  const quote = body.slice(start, end)
  if (quote.trim() === '') return undefined
  return {
    quote,
    start,
    end,
    before: body.slice(Math.max(0, start - 120), start),
    after: body.slice(end, end + 120),
    rect: range.getBoundingClientRect(),
  }
}
