/**
 * The reader Remote: the browser-facing wire face, and nothing else.
 *
 * Every method is a one-line delegation to {@link ReaderService}; the value it
 * returns is the BARE domain value. The wire layer wraps that in the protocol's
 * own result envelope, so a domain refusal is a value inside that envelope —
 * never a second `{ ok }` object nested inside the first (which is how the
 * discarded scaffold managed to answer `{ ok: true }` twice and throw it away).
 *
 * @module @khorsheed/dsh-reader/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ReaderService } from './service.ts'
import type { ReaderNotesStore } from './notes.ts'
import type { ReaderEntryIdentity, ReaderEntryNotes, ReaderNote, ReaderNoteInput, ReaderNoteOutcome } from './types.ts'
import type {
  ReaderAddFailure,
  ReaderAddOutcome,
  ReaderAddRefusal,
  ReaderAnnotationOutcome,
  ReaderBackfillCandidate,
  ReaderEntryBodyView,
  ReaderImageResult,
  ReaderEntryFetchState,
  ReaderBody,
  ReaderCapabilities,
  ReaderEntryTranslationView,
  ReaderMutationOutcome,
  ReaderRecentEntry,
  ReaderRefreshResult,
  ReaderSentenceLearn,
  ReaderSourceSummary,
  ReaderStorageStats,
  ReaderTag,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    readerRemote: ReaderRemoteService
  }
}

/** Reserved for future config-driven knobs; the service owns today's config. */
export interface ReaderRemoteConfig {}

/** The wire namespace is `reader`: the browser calls `remote.reader.*`. */
export class ReaderRemoteService extends TypertRemoteService<ReaderRemoteConfig> {
  static inject = ['reader', 'readerNotes']

  constructor(ctx: Context, _config: ReaderRemoteConfig = {}) {
    super(ctx, 'readerRemote', { namespace: 'reader' })
  }

  /** The service core this face delegates to. */
  private get core(): ReaderService {
    return this.ctx.reader
  }

  /** The notes store this face delegates to. */
  private get notes(): ReaderNotesStore {
    return this.ctx.readerNotes
  }

  /** Capability handshake: what the browser may rely on in this composition. */
  @Remote('capabilities')
  capabilities(): Promise<ReaderCapabilities> {
    return this.core.capabilities()
  }

  /** The configured sources, without payloads. */
  @Remote('listSources')
  async listSources(): Promise<{ sources: ReaderSourceSummary[] }> {
    return this.core.listSources()
  }

  /** Add a source; the host decides whether the URL is a feed or an article. */
  @Remote('addSource')
  addSource(request: { url: string; label?: string }): Promise<ReaderAddOutcome | ReaderAddRefusal | ReaderAddFailure> {
    return this.core.addSource(request)
  }

  /** Change a source's label/enabled flag, or the global refresh time. */
  @Remote('updateSource')
  updateSource(request: {
    id: string
    enabled?: boolean
    label?: string
    url?: string
    timeOfDay?: string
  }): Promise<ReaderMutationOutcome> {
    return this.core.updateSource(request)
  }

  /** Drop a source; its entries' translations go with it (their bodies stay for the budget). */
  @Remote('removeSource')
  removeSource(request: { id: string; entryIds?: readonly string[] }): Promise<ReaderMutationOutcome> {
    return this.core.removeSource(request)
  }

  /** Fetch the named sources (or every enabled one) now. */
  @Remote('refresh')
  async refresh(request: { ids?: string[] }): Promise<{ results: ReaderRefreshResult[] }> {
    return this.core.refresh(request)
  }

  /** Hand back raw payloads for the browser to parse. */
  @Remote('getBodies')
  async getBodies(request: { ids: string[] }): Promise<{ bodies: ReaderBody[] }> {
    return this.core.getBodies(request)
  }

  /* ------------------------------------------- entry bodies and reader tags */

  /** What the detail view should render for one entry, and whether a fetch is worth offering. */
  @Remote('getEntryBody')
  getEntryBody(request: { entryId: string; url: string; feedHtml?: string }): Promise<ReaderEntryBodyView> {
    return this.core.getEntryBody(request)
  }

  /** Fetch one entry's article (the network half; the browser extracts). */
  @Remote('fetchEntryBody')
  fetchEntryBody(request: { entryId: string; url: string }): Promise<{
    entryId: string
    url?: string
    raw?: string
    rawFile?: string
    truncated?: boolean
    error?: string
  }> {
    return this.core.fetchEntryBody(request)
  }

  /**
   * Fetch one image the browser could not load cross-origin (CORP /
   * hotlink-protected), so the pane can re-point the failed `<img>` at the
   * bytes. Called per failed image, never for a healthy one.
   */
  @Remote('fetchImage')
  fetchImage(request: { url: string }): Promise<ReaderImageResult> {
    return this.core.fetchImage(request)
  }

  /** Cache the markup the browser extracted for one entry. */
  @Remote('storeEntryBody')
  storeEntryBody(request: {
    entryId: string
    url: string
    html: string
    truncated?: boolean
    scriptFigures?: number
    bodyHash?: string
    /** The article's own title, as extracted — the saved link's card upgrade. */
    title?: string
    /** A short excerpt (abstract / first paragraph), with the title. */
    excerpt?: string
  }): Promise<ReaderEntryBodyView> {
    return this.core.storeEntryBody(request)
  }

  /** What the plugin holds per entry: a body, a stored raw payload, or a failure. */
  @Remote('entryFetchStates')
  entryFetchStates(request: { entryIds: readonly string[] }): Promise<{ states: Record<string, ReaderEntryFetchState> }> {
    return this.core.entryFetchStates(request)
  }

  /** A stored raw payload, so the browser can extract it later. */
  @Remote('getRawBody')
  getRawBody(request: { entryId: string }): Promise<{ entryId: string; raw?: string; url?: string; truncated?: boolean; error?: string }> {
    return this.core.getRawBody(request)
  }

  /** Which entries still need their full text (the automatic backfill's work list). */
  @Remote('listBackfillCandidates')
  listBackfillCandidates(request: {
    entries: readonly { entryId: string; url: string; label: string; hasBody: boolean }[]
    limit?: number
  }): Promise<{ candidates: ReaderBackfillCandidate[] }> {
    return this.core.listBackfillCandidates(request)
  }

  /* -------------------------------------------------- translation memory */

  /** One entry's exact-fit translation record (segment map resolved), when usable. */
  @Remote('getEntryTranslation')
  getEntryTranslation(request: { entryId: string }): Promise<{ translation?: ReaderEntryTranslationView }> {
    return this.core.getEntryTranslation(request)
  }

  /** Translations for exactly the asked sentence hashes of one pair — never the whole table. */
  @Remote('getSentenceTranslations')
  getSentenceTranslations(request: { pair: string; hashes: readonly string[] }): Promise<{ translations: Record<string, string> }> {
    return this.core.getSentenceTranslations(request)
  }

  /** Persist what one translation run learned (and refresh what it reused), in one batch. */
  @Remote('rememberSentences')
  rememberSentences(request: {
    pair: string
    entries: readonly ReaderSentenceLearn[]
    recalled?: readonly ReaderSentenceLearn[]
    entryId?: string
    bodyHash?: string
  }): Promise<{ stored: number }> {
    return this.core.rememberSentences(request)
  }

  /** Per-tier cache usage, aggregated on the host (the tables never cross). */
  @Remote('getStorageStats')
  getStorageStats(): Promise<ReaderStorageStats> {
    return this.core.getStorageStats()
  }

  /** Forget every translation: the global memory and every entry map. */
  @Remote('clearTranslations')
  clearTranslations(): Promise<{ clearedEntries: number; clearedMemory: boolean }> {
    return this.core.clearTranslations()
  }

  /** The tag vocabulary, with how many entries carry each tag. */
  @Remote('listTags')
  listTags(): Promise<{ tags: ReaderTag[]; counts: Record<string, number> }> {
    return this.core.listTags()
  }

  /** Create a tag, or return the existing one with the same name. */
  @Remote('createTag')
  createTag(request: { name: string }): Promise<ReaderTag | ReaderAnnotationOutcome> {
    return this.core.createTag(request)
  }

  /** Rename a tag without touching the entries that carry it. */
  @Remote('renameTag')
  renameTag(request: { id: string; name: string }): Promise<ReaderAnnotationOutcome> {
    return this.core.renameTag(request)
  }

  /** Delete a tag and remove it from every entry. */
  @Remote('deleteTag')
  deleteTag(request: { id: string }): Promise<ReaderAnnotationOutcome> {
    return this.core.deleteTag(request)
  }

  /** Add or remove one tag on one entry. */
  @Remote('tagEntry')
  tagEntry(request: { entryId: string; tagId: string; on: boolean }): Promise<ReaderAnnotationOutcome> {
    return this.core.tagEntry(request)
  }

  /** The tags on one entry. */
  @Remote('entryTags')
  entryTags(request: { entryId: string }): Promise<{ tags: ReaderTag[] }> {
    return this.core.entryTags(request)
  }

  /** Read or set how long a fetched body is served (and the translation budget). */
  @Remote('getCachePolicy')
  getCachePolicy(): Promise<{ ttlHours: number; maxEntries: number; translationBudgetChars: number }> {
    return this.core.getCachePolicy()
  }

  @Remote('setCachePolicy')
  setCachePolicy(request: { ttlHours: number; maxEntries?: number; translationBudgetChars?: number }): Promise<ReaderAnnotationOutcome> {
    return this.core.setCachePolicy(request)
  }

  /** Drop tags nothing references any more. */
  @Remote('pruneTags')
  pruneTags(): Promise<{ removed: number }> {
    return this.core.pruneTags()
  }

  /** Record that the reader opened one entry (the recent page's write half). */
  @Remote('recordRead')
  recordRead(request: {
    entryId: string
    sourceId: string
    title: string
    url?: string
  }): Promise<{ entries: number }> {
    return this.core.recordRead(request)
  }

  /** The entries the reader opened, newest first. */
  @Remote('listRecent')
  listRecent(): Promise<{ entries: ReaderRecentEntry[] }> {
    return this.core.listRecent()
  }

  /** Forget every recent entry. */
  @Remote('clearRecent')
  clearRecent(): Promise<{ removed: number }> {
    return this.core.clearRecent()
  }

  /** Forward a ref block to the side-chat service when one is composed. */
  @Remote('quoteToSideChat')
  quoteToSideChat(request: {
    contextKey: string
    label: string
    text: string
  }): Promise<'ok' | 'unavailable'> {
    return this.core.quoteToSideChat(request)
  }
  /* ------------------------------------------------------------------ notes */

  /** One article's notes and the conversations that discussed it. */
  @Remote('entryNotes')
  async entryNotes(request: { entryId: string }): Promise<{ entry?: ReaderEntryNotes }> {
    const entry = this.notes.entry(request.entryId)
    return entry === undefined ? {} : { entry }
  }

  /** How many notes each article carries. */
  @Remote('noteCounts')
  async noteCounts(): Promise<{ counts: Record<string, number> }> {
    return { counts: this.notes.counts() }
  }

  /** Keep one excerpt (and its comment). */
  @Remote('addNote')
  addNote(request: ReaderNoteInput): Promise<ReaderNote | 'empty' | 'full'> {
    return this.notes.addNote(request)
  }

  /** Change or clear one note's comment. */
  @Remote('updateNote')
  updateNote(request: { entryId: string; noteId: string; comment: string }): Promise<ReaderNoteOutcome> {
    return this.notes.updateNote(request)
  }

  /** Delete one note. */
  @Remote('deleteNote')
  deleteNote(request: { entryId: string; noteId: string }): Promise<ReaderNoteOutcome> {
    return this.notes.deleteNote(request)
  }

  /** Remember that a conversation discussed this article. */
  @Remote('recordDiscussion')
  recordDiscussion(request: ReaderEntryIdentity & { sessionId: string; sessionTitle?: string }): Promise<'ok' | 'empty'> {
    return this.notes.recordSession(request)
  }

  /** Add the reader's own line under a note. */
  @Remote('addReply')
  addReply(request: { entryId: string; noteId: string; text: string }): Promise<ReaderNoteOutcome> {
    return this.notes.addReply({ ...request, by: 'user' })
  }

  /** Rewrite (or, with empty text, remove) one line under a note. */
  @Remote('editReply')
  editReply(request: { entryId: string; noteId: string; index: number; text: string }): Promise<ReaderNoteOutcome> {
    return this.notes.editReply(request)
  }

  /** Remember that a note or a discussion note became a canvas card. */
  @Remote('markSynced')
  markSynced(request: { entryId: string; noteId?: string; discussionId?: string; canvasId: string; cardId: string; canvasTitle: string }): Promise<ReaderNoteOutcome> {
    return this.notes.markSynced(request)
  }

  /** Delete one discussion note. */
  @Remote('deleteDiscussion')
  deleteDiscussion(request: { entryId: string; discussionId: string }): Promise<ReaderNoteOutcome> {
    return this.notes.deleteDiscussion(request)
  }

  /** A video entry's transcript from its platform captions (stored; `none` when it has none). */
  @Remote('mediaTranscript')
  mediaTranscript(request: { entryId: string; url: string }): Promise<{ entryId: string; html?: string; captions: 'platform' | 'none' | 'failed'; language?: string; error?: string }> {
    return this.core.mediaTranscript(request)
  }

  /** Hand the host the article's original text, block by block, for the model to read. */
  @Remote('snapshotEntry')
  snapshotEntry(request: ReaderEntryIdentity & { paragraphs: string[] }): Promise<'ok' | 'empty'> {
    return this.notes.snapshot(request)
  }
}

export default ReaderRemoteService
