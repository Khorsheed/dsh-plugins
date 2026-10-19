/**
 * The reader's model-facing tools.
 *
 * `reader_read` lets the model read an article the reader is discussing — its
 * text, paragraph-numbered so the model can point back (¶3), and the reader's
 * notes on it. Without it the model sees only what the reader pasted.
 *
 * The text is the browser's snapshot (see `notes.ts`): the host never parses
 * an article, and a feed entry's text never reaches it otherwise. An article
 * the reader never opened has no snapshot, and the answer says so instead of
 * guessing.
 *
 * Origin-tagged the community way (the `Symbol.for('dsh.tool.origin')` key,
 * set directly — the capability catalog's documented no-import path).
 *
 * @module @khorsheed/dsh-reader/tools
 */
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ReaderDiscussionPoint, ReaderEntryNotes, ReaderEntrySnapshot, ReaderNotesStore } from './notes.ts'
import type { ReaderRecentEntry } from './types.ts'

/** The package name the tools are tagged with. */
export const READER_PACKAGE_NAME = '@khorsheed/dsh-reader'

/** The most article text one call returns; the rest is one `from` away. */
export const READ_PAGE_CHARS = 60_000

/** The slice of the reader service the tools read. */
export interface ReaderToolCore {
  listRecent(): Promise<{ entries: ReaderRecentEntry[] }>
}

/** The community tool-origin tag. */
function tagOrigin<T extends object>(definition: T): T {
  ;(definition as Record<PropertyKey, unknown>)[Symbol.for('dsh.tool.origin')] = {
    channel: 'plugin',
    owner: READER_PACKAGE_NAME,
  }
  return definition
}

/** The host converts thrown tool failures into durable isError results. */
export class ReaderToolError extends Error {}

/** One article the model could mean: what the reader opened, noted or discussed. */
interface Candidate {
  readonly entryId: string
  readonly title: string
  readonly url?: string
}

/** The comparable form of a URL: no scheme, no `www.`, no trailing slash or fragment. */
function urlKey(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/#.*$/, '').replace(/\/+$/, '')
}

/**
 * Every article the model may name, most recently opened first.
 *
 * @param recent - the reader's recently opened list.
 * @param entries - the articles carrying notes or discussions.
 * @param notes - the store (for snapshot titles).
 */
function candidatesOf(recent: readonly ReaderRecentEntry[], entries: readonly ReaderEntryNotes[], notes: ReaderNotesStore): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const item of recent) {
    seen.set(item.entryId, { entryId: item.entryId, title: item.title, ...(item.url === undefined ? {} : { url: item.url }) })
  }
  for (const entry of entries) {
    if (!seen.has(entry.entryId)) seen.set(entry.entryId, { entryId: entry.entryId, title: entry.title, ...(entry.url === undefined ? {} : { url: entry.url }) })
  }
  for (const entryId of notes.snapshotIds()) {
    if (seen.has(entryId)) continue
    const snapshot = notes.readSnapshot(entryId)
    if (snapshot !== undefined) seen.set(entryId, { entryId, title: snapshot.title, ...(snapshot.url === undefined ? {} : { url: snapshot.url }) })
  }
  return [...seen.values()]
}

/**
 * Resolve what the model asked for: an id, a link, or a piece of the title.
 *
 * @param wanted - the `entry` argument (trimmed, non-empty).
 * @param candidates - the articles it may mean.
 * @returns one article, several (ambiguous), or none.
 */
export function resolveEntry(wanted: string, candidates: readonly Candidate[]): Candidate[] {
  const byId = candidates.find(item => item.entryId === wanted)
  if (byId !== undefined) return [byId]
  if (/^https?:\/\//i.test(wanted) || /^[\w-]+(\.[\w-]+)+\//.test(wanted)) {
    const key = urlKey(wanted)
    const byUrl = candidates.filter(item => item.url !== undefined && urlKey(item.url) === key)
    if (byUrl.length > 0) return byUrl
  }
  const needle = wanted.toLowerCase().replace(/^《|》$/g, '')
  const exact = candidates.filter(item => item.title.toLowerCase() === needle)
  if (exact.length > 0) return exact
  return candidates.filter(item => item.title.toLowerCase().includes(needle))
}

/**
 * Render one article for the model: header, numbered text from `from`, notes.
 *
 * @param identity - the article as resolved.
 * @param snapshot - its text, when the browser handed one over.
 * @param entry - the reader's notes and discussions on it.
 * @param from - the first paragraph to show (1-based).
 */
export function renderArticle(
  identity: Candidate,
  snapshot: ReaderEntrySnapshot | undefined,
  entry: ReaderEntryNotes | undefined,
  from = 1,
): string {
  const title = snapshot?.title ?? entry?.title ?? identity.title
  const url = snapshot?.url ?? entry?.url ?? identity.url
  const source = snapshot?.source ?? entry?.source
  const lines: string[] = [`《${title}》（${identity.entryId}）`]
  const meta = [source, url].filter((part): part is string => part !== undefined && part !== '')
  if (meta.length > 0) lines.push(meta.join(' · '))
  const notes = entry?.notes ?? []
  const sessions = entry?.sessions ?? []
  lines.push(`读者笔记 ${String(notes.length)} 条 · 讨论过它的会话 ${String(sessions.length)} 个`)
  lines.push('---')
  if (snapshot === undefined) {
    lines.push('正文：宿主上还没有这篇的正文（读者在灵感空间里打开它一次就会有）。下面只有读者的笔记。')
  } else {
    const paragraphs = snapshot.paragraphs
    const start = Math.min(Math.max(1, Math.floor(from)), Math.max(1, paragraphs.length))
    const total = paragraphs.reduce((sum, item) => sum + item.length, 0)
    lines.push(`正文（共 ¶${String(paragraphs.length)}、${String(total)} 字${snapshot.truncated === true ? '，原文过长，后面的部分没有保存' : ''}）：`)
    let used = 0
    let shown = start - 1
    for (let index = start - 1; index < paragraphs.length; index++) {
      const paragraph = paragraphs[index] ?? ''
      if (paragraph === '') { shown = index + 1; continue }
      if (used > 0 && used + paragraph.length > READ_PAGE_CHARS) break
      lines.push(`¶${String(index + 1)} ${paragraph}`)
      used += paragraph.length
      shown = index + 1
    }
    if (shown < paragraphs.length) {
      lines.push(`……正文还有 ¶${String(shown + 1)}–¶${String(paragraphs.length)}，用 from=${String(shown + 1)} 接着读。`)
    }
  }
  if (notes.length > 0) {
    lines.push('---', '读者笔记（摘抄是原文；在译文里划的另附译文）：')
    for (const note of notes) {
      lines.push(`${note.id} ¶${String(note.anchor.block + 1)}「${note.anchor.quote}」`)
      if (note.anchor.translated !== undefined) lines.push(`    译文：${note.anchor.translated}`)
      if (note.comment !== undefined) lines.push(`    评论：${note.comment}`)
      for (const reply of note.replies ?? []) lines.push(`    ${reply.by === 'agent' ? '讨论结论' : '读者补充'}：${reply.text}`)
    }
  }
  const discussions = entry?.discussions ?? []
  if (discussions.length > 0) {
    lines.push('---', '讨论笔记（最近的在前）：')
    for (const item of discussions) {
      lines.push(`${item.id} ${item.kind === 'check' ? '考考我' : '讨论'} ${item.createdAt.slice(0, 10)}${item.title === '' ? '' : `《${item.title}》`}`)
      for (const point of item.points) lines.push(`    - ${point.text}${point.para === undefined ? '' : `（¶${String(point.para)}）`}`)
      if (item.aside !== undefined) lines.push(`    ${item.aside}`)
    }
  }
  return lines.join('\n')
}

/** A `key：value` line (full- or half-width colon), for the text-only form. */
function keyValue(line: string): { key: string; value: string } | undefined {
  const match = /^\s*([^:：]{1,8})[:：]\s*(.*)$/.exec(line)
  return match === null ? undefined : { key: match[1]!.trim().toLowerCase(), value: match[2]!.trim() }
}

/**
 * Parse the discussion points out of `text`: one point per line (a leading
 * list marker is dropped), a `¶3` anywhere in the line cites that paragraph,
 * and a line starting 「其余」 is the aside rather than a point.
 *
 * @param text - the lines.
 */
export function pointsOf(text: string): { points: ReaderDiscussionPoint[]; aside?: string } {
  const points: ReaderDiscussionPoint[] = []
  let aside: string | undefined
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').trim()
    if (line === '') continue
    if (/^其余/.test(line)) { aside = line; continue }
    const para = /¶\s*(\d+)/.exec(line)?.[1]
    const cleaned = line.replace(/[（(]\s*(?:原文\s*)?¶\s*\d+\s*[)）]/g, '').replace(/\s*原文\s*¶\s*\d+[。.]?/g, '').trim()
    points.push({ text: cleaned === '' ? line : cleaned, ...(para === undefined ? {} : { para: Number(para) }) })
  }
  return { points, ...(aside === undefined ? {} : { aside }) }
}

/**
 * Pull the text-only form's header lines (笔记：n2 / 类型：考考我 / 文章：…)
 * off the top of `text`; the rest is the body.
 */
export function headerOf(text: string): { note?: string; kind?: 'discussion' | 'check'; entry?: string; body: string } {
  const lines = text.split('\n')
  const out: { note?: string; kind?: 'discussion' | 'check'; entry?: string } = {}
  let index = 0
  for (; index < lines.length; index++) {
    const pair = keyValue(lines[index]!)
    if (pair === undefined) break
    if (pair.key === '笔记' || pair.key === 'note') out.note = pair.value
    else if (pair.key === '类型' || pair.key === 'kind') out.kind = /考|check/i.test(pair.value) ? 'check' : 'discussion'
    else if (pair.key === '文章' || pair.key === 'entry') out.entry = pair.value
    else break
  }
  return { ...out, body: lines.slice(index).join('\n').trim() }
}

/**
 * The reader's model-facing tool definitions.
 *
 * @param core - the reader service (its recently opened list).
 * @param notes - the notes store.
 */
export function readerToolDefinitions(core: ReaderToolCore, notes: ReaderNotesStore): ToolDefinition[] {
  const read = defineTool({
    name: 'reader_read',
    description:
      'Read an article from the user\'s reader (灵感空间): its text with ¶ paragraph numbers, and the user\'s notes on it (n1, n2…). '
      + 'No arguments: the article this conversation discussed, else the one the user opened last. entry: an id, a link, or part of the title. from: continue at that ¶.',
    parameters: {
      entry: { type: 'string', description: 'Entry id, article URL, or part of its title.' },
      from: { type: 'number', description: 'First ¶ to return (for long articles).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args: { entry?: string; from?: number }, exec: { agent?: Agent }): Promise<string> => {
      const { entries: recent } = await core.listRecent()
      const candidates = candidatesOf(recent, notes.entries(), notes)
      const wanted = (args.entry ?? '').trim()
      let target: Candidate | undefined
      if (wanted === '') {
        const discussed = exec.agent?.session?.id === undefined ? undefined : notes.sessionEntry(String(exec.agent.session.id))
        target = candidates.find(item => item.entryId === discussed) ?? candidates[0]
        if (target === undefined) return '读者还没有在灵感空间里打开过文章。'
      } else {
        const matches = resolveEntry(wanted, candidates)
        if (matches.length === 0) {
          const recentTitles = candidates.slice(0, 8).map(item => `- ${item.entryId}　《${item.title}》`)
          throw new ReaderToolError([`没有找到「${wanted}」。最近的文章：`, ...recentTitles].join('\n'))
        }
        if (matches.length > 1) {
          return [`「${wanted}」对应多篇，请用 id 指定：`, ...matches.slice(0, 8).map(item => `- ${item.entryId}　《${item.title}》`)].join('\n')
        }
        target = matches[0]
      }
      if (target === undefined) return '读者还没有在灵感空间里打开过文章。'
      // Reading an article in a conversation IS discussing it there: the
      // article remembers this conversation, so the reader can get back to it.
      const sessionId = exec.agent?.session?.id
      if (sessionId !== undefined) {
        void notes.recordSession({
          entryId: target.entryId,
          title: target.title,
          ...(target.url === undefined ? {} : { url: target.url }),
          sessionId: String(sessionId),
        }).catch(() => undefined)
      }
      return renderArticle(target, notes.readSnapshot(target.entryId), notes.entry(target.entryId), args.from ?? 1)
    },
  })
  const write = defineTool({
    name: 'reader_note',
    description:
      'Write into the user\'s reader notes — ONLY when the user asks (「记到笔记」) or a 考考我 round ends. '
      + 'op=conclusion: a conclusion under note n2 (note). op=discussion: a discussion note, one point per line in text, ¶3 cites a paragraph, '
      + 'kind=check for a 考考我 round. Never edits or deletes what the user wrote. Load the reader skill first.',
    parameters: {
      op: { type: 'string', enum: ['conclusion', 'discussion'], description: 'What to write.' },
      text: { type: 'string', required: true, description: 'The conclusion, or the points one per line. Header lines also work: 笔记：n2 / 类型：考考我.' },
      note: { type: 'string', description: 'conclusion: the note id (n2).' },
      kind: { type: 'string', enum: ['discussion', 'check'], description: 'discussion: check for a 考考我 round.' },
      title: { type: 'string', description: 'discussion: a short title.' },
      entry: { type: 'string', description: 'The article (id, link or title); default: the one this conversation discussed.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (
      args: { op?: string; text?: string; note?: string; kind?: string; title?: string; entry?: string },
      exec: { agent?: Agent },
    ): Promise<string> => {
      const header = headerOf(args.text ?? '')
      const noteId = (args.note ?? header.note)?.trim()
      const op = args.op === 'conclusion' || args.op === 'discussion' ? args.op : noteId !== undefined ? 'conclusion' : 'discussion'
      const sessionId = exec.agent?.session?.id === undefined ? undefined : String(exec.agent.session.id)
      const { entries: recent } = await core.listRecent()
      const candidates = candidatesOf(recent, notes.entries(), notes)
      const wanted = (args.entry ?? header.entry ?? '').trim()
      let target: Candidate | undefined
      if (wanted !== '') {
        const matches = resolveEntry(wanted, candidates)
        if (matches.length !== 1) throw new ReaderToolError(matches.length === 0 ? `失败：没有找到文章「${wanted}」。` : `失败：「${wanted}」对应多篇，请用 id。`)
        target = matches[0]
      } else {
        const discussed = sessionId === undefined ? undefined : notes.sessionEntry(sessionId)
        target = candidates.find(item => item.entryId === discussed)
        if (target === undefined) throw new ReaderToolError('失败：这个会话还没有讨论过哪篇文章——先用 reader_read 读它，或用 entry 指明。')
      }
      if (target === undefined) throw new ReaderToolError('失败：没有找到文章。')
      if (header.body === '') throw new ReaderToolError('失败：text 是空的。')
      if (op === 'conclusion') {
        if (noteId === undefined || noteId === '') {
          throw new ReaderToolError('失败：op=conclusion 要给 note（笔记编号，如 n2；参数到不了就在 text 第一行写「笔记：n2」）。跨多条笔记的结论用 op=discussion。')
        }
        const outcome = await notes.addReply({ entryId: target.entryId, noteId, text: header.body, by: 'agent', ...(sessionId === undefined ? {} : { sessionId }) })
        if (outcome === 'not-found') {
          const ids = (notes.entry(target.entryId)?.notes ?? []).map(item => item.id).join('、')
          throw new ReaderToolError(`失败：《${target.title}》没有笔记 ${noteId}。现有：${ids === '' ? '（无）' : ids}。`)
        }
        if (outcome !== 'ok') throw new ReaderToolError(`失败：${outcome}`)
        return `完成：结论已写在《${target.title}》的笔记 ${noteId} 下。`
      }
      const { points, aside } = pointsOf(header.body)
      const kind = args.kind === 'check' || args.kind === 'discussion' ? args.kind : header.kind ?? 'discussion'
      const created = await notes.addDiscussion({
        entryId: target.entryId,
        title: target.title,
        ...(target.url === undefined ? {} : { url: target.url }),
        kind,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(args.title === undefined ? {} : { heading: args.title }),
        points,
        ...(aside === undefined ? {} : { aside }),
      })
      if (created === 'empty') throw new ReaderToolError('失败：没有可记的要点（text 里每行一点）。')
      return `完成：《${target.title}》新增${kind === 'check' ? '考考我' : '讨论'}笔记 ${created.id}，${String(points.length)} 点。`
    },
  })
  return [tagOrigin(read), tagOrigin(write)]
}
