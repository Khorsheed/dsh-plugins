/**
 * Video and audio entries: what kind of media a link or a feed item is, and
 * how the browser plays it.
 *
 * The kind is decided per ITEM, never per source (the 2026-10-20 decision): a
 * feed may carry articles, audio and video side by side. The signals, best
 * first, are a feed enclosure's MIME type, a link the resolvers recognize
 * (YouTube, Bilibili, Xiaoyuzhou), and — on the host, where pages are fetched
 * — a page whose main content is a player. A page with real prose stays an
 * article even when it embeds a video.
 *
 * Pure and shared by both halves.
 *
 * @module @khorsheed/dsh-reader/media
 */

/** Where a media entry plays from. */
export type ReaderMediaProvider = 'youtube' | 'bilibili' | 'xiaoyuzhou' | 'enclosure'

/** A media entry's description, carried on the entry. */
export interface ReaderMedia {
  readonly kind: 'video' | 'audio'
  readonly provider: ReaderMediaProvider
  /** The platform's id (YouTube video id, Bilibili BV id) or the audio URL. */
  readonly ref: string
  readonly durationSec?: number
  readonly thumbnail?: string
}

/** A recognized media link. */
export interface MediaLink {
  readonly provider: 'youtube' | 'bilibili' | 'xiaoyuzhou'
  readonly kind: 'video' | 'audio' | 'channel' | 'podcast'
  /** Video id / BV id / episode id / channel handle-or-id / podcast id. */
  readonly id: string
}

/**
 * Recognize a media link from its URL alone.
 *
 * @param input - any URL.
 * @returns the link, or `undefined` for anything else.
 */
export function mediaLink(input: string): MediaLink | undefined {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }
  const host = url.hostname.replace(/^(www|m)\./, '')
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v')
    if (url.pathname === '/watch' && v !== null && /^[\w-]{6,}$/.test(v)) return { provider: 'youtube', kind: 'video', id: v }
    const short = /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(url.pathname)
    if (short !== null) return { provider: 'youtube', kind: 'video', id: short[1]! }
    const channel = /^\/(@[\w.-]+|channel\/UC[\w-]{10,}|c\/[\w.-]+|user\/[\w.-]+)\/?$/.exec(url.pathname.replace(/\/(videos|featured|streams)\/?$/, '/'))
    if (channel !== null) return { provider: 'youtube', kind: 'channel', id: channel[1]! }
    return undefined
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1)
    return /^[\w-]{6,}$/.test(id) ? { provider: 'youtube', kind: 'video', id } : undefined
  }
  if (host === 'bilibili.com' || host === 'b23.tv') {
    const bv = /\/video\/(BV[0-9A-Za-z]{10})/.exec(url.pathname)
    if (bv !== null) return { provider: 'bilibili', kind: 'video', id: bv[1]! }
    return undefined
  }
  if (host === 'xiaoyuzhoufm.com') {
    const episode = /^\/episode\/([0-9a-f]{24})/.exec(url.pathname)
    if (episode !== null) return { provider: 'xiaoyuzhou', kind: 'audio', id: episode[1]! }
    const podcast = /^\/podcast\/([0-9a-f]{24})/.exec(url.pathname)
    if (podcast !== null) return { provider: 'xiaoyuzhou', kind: 'podcast', id: podcast[1]! }
  }
  return undefined
}

/** Hosts whose links are only redirects to a media page (Bilibili's share links). */
const SHORT_LINK_HOSTS = new Set(['b23.tv', 'bili2233.cn'])

/** True for a share short link that must be resolved before it can be recognized. */
export function isShortMediaLink(input: string): boolean {
  try {
    return SHORT_LINK_HOSTS.has(new URL(input).hostname.replace(/^www\./, ''))
  } catch {
    return false
  }
}

/**
 * The clean address of a recognized video link: the platform's canonical page,
 * without the share-tracking parameters a resolved short link drags along.
 *
 * @param input - a video URL.
 */
export function canonicalMediaUrl(input: string): string | undefined {
  const link = mediaLink(input)
  if (link?.provider === 'bilibili' && link.kind === 'video') {
    const page = new URL(input).searchParams.get('p')
    return `https://www.bilibili.com/video/${link.id}/${page !== null && page !== '1' ? `?p=${encodeURIComponent(page)}` : ''}`
  }
  if (link?.provider === 'youtube' && link.kind === 'video') return `https://www.youtube.com/watch?v=${link.id}`
  return undefined
}

/**
 * The media kind of a feed enclosure, from its MIME type (or, when a feed
 * omits it, from the file extension).
 *
 * @param url - the enclosure URL.
 * @param type - the declared MIME type, when present.
 */
export function enclosureKind(url: string, type?: string): 'video' | 'audio' | undefined {
  const mime = (type ?? '').toLowerCase()
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  const path = url.toLowerCase().split('?')[0] ?? ''
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(path)) return 'audio'
  if (/\.(mp4|m4v|mov|webm)$/.test(path)) return 'video'
  return undefined
}

/**
 * The media an entry plays, from what the feed said and where it links.
 *
 * @param entry - the entry's link and its enclosure, when the feed had one.
 */
export function entryMedia(entry: { link?: string; enclosure?: { url: string; type?: string; durationSec?: number; image?: string } }): ReaderMedia | undefined {
  const linked = entry.link === undefined ? undefined : mediaLink(entry.link)
  if (linked !== undefined && linked.kind === 'video') {
    return { kind: 'video', provider: linked.provider, ref: linked.id, ...(entry.enclosure?.image === undefined ? {} : { thumbnail: entry.enclosure.image }) }
  }
  if (entry.enclosure !== undefined) {
    const kind = enclosureKind(entry.enclosure.url, entry.enclosure.type)
    if (kind !== undefined) {
      return {
        kind,
        provider: 'enclosure',
        ref: entry.enclosure.url,
        ...(entry.enclosure.durationSec === undefined ? {} : { durationSec: entry.enclosure.durationSec }),
        ...(entry.enclosure.image === undefined ? {} : { thumbnail: entry.enclosure.image }),
      }
    }
  }
  return undefined
}

/**
 * The embed URL a video plays in, starting at `start` seconds.
 *
 * YouTube's embed takes postMessage commands (`enablejsapi=1`, with the
 * embedding origin); Bilibili's has no control channel, so a seek reloads it
 * with `t` (measured 2026-10-20).
 *
 * @param media - the entry's media.
 * @param start - where to start (seconds).
 * @param origin - the embedding page's origin (YouTube checks it).
 */
export function embedUrl(media: ReaderMedia, start: number, origin: string): string | undefined {
  const t = Math.max(0, Math.floor(start))
  if (media.provider === 'youtube') {
    return `https://www.youtube.com/embed/${encodeURIComponent(media.ref)}?enablejsapi=1&playsinline=1&rel=0&start=${String(t)}&origin=${encodeURIComponent(origin)}`
  }
  if (media.provider === 'bilibili') {
    return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(media.ref)}&t=${String(t)}&danmaku=0&high_quality=1&autoplay=${t > 0 ? '1' : '0'}`
  }
  return undefined
}

/**
 * A link to the original at a moment (what notes and canvas cards carry).
 *
 * @param link - the entry's link.
 * @param seconds - the moment.
 */
export function linkAt(link: string, seconds: number): string {
  const media = mediaLink(link)
  const t = Math.max(0, Math.floor(seconds))
  if (media?.provider === 'youtube' || media?.provider === 'bilibili') {
    try {
      const url = new URL(link)
      url.searchParams.set('t', media.provider === 'youtube' ? `${String(t)}s` : String(t))
      return url.toString()
    } catch {
      return link
    }
  }
  return link
}

/** The `<meta name>` a media link's synthetic page carries its description in. */
export const MEDIA_META_NAME = 'dsh-reader:media'

/** Decode the few entities an attribute value carries. */
function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/**
 * The media description a synthetic page carries (see `media-host.ts`).
 *
 * @param raw - a stored link payload.
 * @returns the media, or `undefined` for an ordinary page.
 */
export function readMediaMeta(raw: string): ReaderMedia | undefined {
  const match = new RegExp(`<meta name="${MEDIA_META_NAME}" content="([^"]*)"`).exec(raw)
  if (match === null) return undefined
  try {
    const value = JSON.parse(unescapeAttribute(match[1]!)) as Partial<ReaderMedia>
    if ((value.kind !== 'video' && value.kind !== 'audio') || typeof value.ref !== 'string' || typeof value.provider !== 'string') return undefined
    return {
      kind: value.kind,
      provider: value.provider,
      ref: value.ref,
      ...(typeof value.durationSec === 'number' ? { durationSec: value.durationSec } : {}),
      ...(typeof value.thumbnail === 'string' ? { thumbnail: value.thumbnail } : {}),
    }
  } catch {
    return undefined
  }
}
