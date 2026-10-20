/**
 * The host half of video and audio entries: the pages a media link becomes,
 * the feeds a channel or podcast becomes, and the transcript a video reads as.
 *
 * - A single video (YouTube, Bilibili) or Xiaoyuzhou episode is stored as a
 *   `link` source whose payload is a SYNTHETIC page: title, description,
 *   thumbnail, and a `<meta name="dsh-reader:media">` carrying the media
 *   description the browser half reads (`readMediaMeta`). Every other part of
 *   the reader then treats it as a saved link.
 * - A YouTube channel resolves to YouTube's own channel feed; a Xiaoyuzhou
 *   podcast page becomes an RSS document (`xiaoyuzhou.ts`).
 * - A video's transcript comes from the platform's captions via yt-dlp,
 *   merged into timed paragraphs (`captions.ts`). Whether a video has
 *   captions is remembered in `media.json`, so a caption-less video does not
 *   cost a yt-dlp run on every open.
 *
 * @module @khorsheed/dsh-reader/media-host
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeCues, renderTranscript } from './captions.ts'
import { MEDIA_META_NAME, type ReaderMedia } from './media.ts'
import type { XiaoyuzhouEpisode } from './xiaoyuzhou.ts'
import { chooseCaptionTrack, YtDlp, type YtDlpInfo } from './ytdlp.ts'

/** What a video's captions came to, remembered per entry. */
export interface CaptionRecord {
  readonly state: 'platform' | 'none'
  readonly language?: string
  readonly checkedAt: string
}

/** Escape text for HTML content and attributes. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A plain-text description as paragraphs. */
function paragraphs(text: string): string {
  return text.split(/\n{2,}/).map(block => block.trim()).filter(block => block !== '')
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('\n')
}

/**
 * The synthetic page a media link is stored as.
 *
 * @param page - what the page says.
 */
export function syntheticPage(page: {
  title: string
  media: ReaderMedia
  descriptionText?: string
  descriptionHtml?: string
  author?: string
  publishedAt?: string
}): string {
  const body = page.descriptionHtml ?? (page.descriptionText === undefined ? '' : paragraphs(page.descriptionText))
  const plain = (page.descriptionText ?? page.descriptionHtml?.replace(/<[^>]+>/g, ' ') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    plain === '' ? '' : `<meta name="description" content="${escapeHtml(plain)}">`,
    page.media.thumbnail === undefined ? '' : `<meta property="og:image" content="${escapeHtml(page.media.thumbnail)}">`,
    page.author === undefined ? '' : `<meta name="author" content="${escapeHtml(page.author)}">`,
    page.publishedAt === undefined ? '' : `<meta property="article:published_time" content="${escapeHtml(page.publishedAt)}">`,
    `<meta name="${MEDIA_META_NAME}" content="${escapeHtml(JSON.stringify(page.media))}">`,
    '</head><body><article>',
    `<h1>${escapeHtml(page.title)}</h1>`,
    body,
    '</article></body></html>',
  ].filter(line => line !== '').join('\n')
}

/** A yt-dlp `upload_date` (`YYYYMMDD`) or timestamp as ISO-8601. */
function publishedOf(info: YtDlpInfo): string | undefined {
  if (typeof info.timestamp === 'number') return new Date(info.timestamp * 1000).toISOString()
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(info.upload_date ?? '')
  return day === null ? undefined : `${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z`
}

/**
 * A video's synthetic page from its yt-dlp metadata.
 *
 * @param info - the metadata.
 * @param provider - which platform.
 * @param id - the platform's video id.
 */
export function videoPage(info: YtDlpInfo, provider: 'youtube' | 'bilibili', id: string): string {
  const published = publishedOf(info)
  const author = info.uploader ?? info.channel
  return syntheticPage({
    title: info.title ?? id,
    media: {
      kind: 'video',
      provider,
      ref: id,
      ...(typeof info.duration === 'number' ? { durationSec: Math.round(info.duration) } : {}),
      ...(info.thumbnail === undefined ? {} : { thumbnail: info.thumbnail }),
    },
    ...(info.description === undefined ? {} : { descriptionText: info.description }),
    ...(author === undefined ? {} : { author }),
    ...(published === undefined ? {} : { publishedAt: published }),
  })
}

/**
 * A Xiaoyuzhou episode's synthetic page.
 *
 * @param episode - the parsed episode.
 */
export function episodePage(episode: XiaoyuzhouEpisode): string {
  return syntheticPage({
    title: episode.title,
    media: {
      kind: 'audio',
      provider: 'xiaoyuzhou',
      ref: episode.audio,
      ...(episode.durationSec === undefined ? {} : { durationSec: episode.durationSec }),
      ...(episode.image === undefined ? {} : { thumbnail: episode.image }),
    },
    ...(episode.notesHtml === undefined ? {} : { descriptionHtml: episode.notesHtml }),
    ...(episode.podcastTitle === undefined ? {} : { author: episode.podcastTitle }),
    ...(episode.publishedAt === undefined ? {} : { publishedAt: episode.publishedAt }),
  })
}

/**
 * The channel feed a YouTube channel page links to.
 *
 * Channel pages carry `<link rel="alternate" type="application/rss+xml">` to
 * `feeds/videos.xml?channel_id=…`; the page's own `channelId` is the fallback.
 *
 * @param html - the channel page.
 */
export function youtubeChannelFeed(html: string): string | undefined {
  const alternate = /<link[^>]+type="application\/rss\+xml"[^>]+href="([^"]+)"/.exec(html)
    ?? /<link[^>]+href="([^"]+)"[^>]+type="application\/rss\+xml"/.exec(html)
  if (alternate !== null) return alternate[1]!.replace(/&amp;/g, '&')
  const id = /"(?:channelId|externalId)":"(UC[\w-]{20,})"/.exec(html)
  return id === null ? undefined : `https://www.youtube.com/feeds/videos.xml?channel_id=${id[1]!}`
}

/** The host's media helper: yt-dlp plus the caption record. */
export class ReaderMediaHost {
  readonly ytdlp: YtDlp
  private readonly file: string
  private records: Record<string, CaptionRecord> | undefined

  /**
   * @param stateRoot - the reader's state root.
   * @param ytdlpPath - a deployment-configured yt-dlp, which wins over the managed one.
   */
  constructor(private readonly stateRoot: string, ytdlpPath?: string) {
    this.ytdlp = new YtDlp(stateRoot, ytdlpPath)
    this.file = join(stateRoot, 'media.json')
  }

  /** The caption records, read once. */
  private load(): Record<string, CaptionRecord> {
    if (this.records !== undefined) return this.records
    try {
      this.records = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, CaptionRecord>
    } catch {
      this.records = {}
    }
    return this.records
  }

  /** What is known about an entry's captions. */
  captions(entryId: string): CaptionRecord | undefined {
    return this.load()[entryId]
  }

  /** Remember what an entry's captions came to. */
  remember(entryId: string, record: CaptionRecord): void {
    const records = { ...this.load(), [entryId]: record }
    this.records = records
    try {
      mkdirSync(this.stateRoot, { recursive: true })
      const temporary = `${this.file}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`)
      renameSync(temporary, this.file)
    } catch {
      // Memory-only: the record still saves this process the repeat run.
      rmSync(`${this.file}.${process.pid}.tmp`, { force: true })
    }
  }

  /**
   * A video's transcript from its platform captions.
   *
   * @param url - the video page.
   * @returns the transcript markup and its language, or `none` when the video has no captions.
   */
  async transcript(url: string): Promise<{ html: string; language: string } | 'none'> {
    const info = await this.ytdlp.info(url)
    const track = chooseCaptionTrack(info)
    if (track === undefined) return 'none'
    const segments = mergeCues(await this.ytdlp.captions(url, track))
    if (segments.length === 0) return 'none'
    return { html: renderTranscript(segments), language: track.lang.replace(/-orig$/, '') }
  }
}
