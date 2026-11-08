export interface ReadingMemory {
  readonly n: number
  readonly editing?: boolean
}

export interface EditorPosition {
  readonly start: number
  readonly end: number
  readonly scrollTop: number
}

const VERSION = 1

function readingKey(canvasId: string): string {
  return `novel-reading:${canvasId}`
}

function positionKey(canvasId: string, n: number): string {
  return `novel-editor-position:${canvasId}:${n}`
}

function read(key: string): unknown {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage denial leaves the in-memory editor fully usable.
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['version'] === VERSION
    ? value as Record<string, unknown>
    : null
}

export function loadReadingMemory(canvasId: string): ReadingMemory | null {
  const value = record(read(readingKey(canvasId)))
  const n = value?.['n']
  const editing = value?.['editing']
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || typeof editing !== 'boolean') return null
  return { n, ...(editing ? { editing: true } : {}) }
}

export function saveReadingMemory(canvasId: string, value: ReadingMemory | null): void {
  write(readingKey(canvasId), value === null ? null : { version: VERSION, n: value.n, editing: value.editing === true })
}

export function loadEditorPosition(canvasId: string, n: number, textLength: number): EditorPosition | null {
  const value = record(read(positionKey(canvasId, n)))
  const start = value?.['start']
  const end = value?.['end']
  const scrollTop = value?.['scrollTop']
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0
    || typeof end !== 'number' || !Number.isInteger(end) || end < start
    || typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop < 0) return null
  return {
    start: Math.min(start, textLength),
    end: Math.min(end, textLength),
    scrollTop,
  }
}

export function saveEditorPosition(canvasId: string, n: number, position: EditorPosition): void {
  write(positionKey(canvasId, n), { version: VERSION, ...position })
}

export function clearEditorPosition(canvasId: string, n: number): void {
  write(positionKey(canvasId, n), null)
}

export function continuationTail(text: string, limit = 80): string {
  return text.trimEnd().slice(-limit)
}
