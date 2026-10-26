/**
 * Xiaoyuzhou (小宇宙): episode and podcast pages → what the reader stores.
 *
 * Xiaoyuzhou publishes no RSS. Its pages do carry their data as Next.js
 * `__NEXT_DATA__` JSON (measured 2026-10-20): an episode page has
 * `props.pageProps.episode` with the audio enclosure, duration, shownotes and
 * podcast; a podcast page has `props.pageProps.podcast.episodes[]`. A podcast
 * page is turned into an RSS document on the host, so subscribing to it is an
 * ordinary feed subscription for every other part of the reader.
 *
 * Pure: the host fetches the page and hands over its text.
 *
 * @module @khorsheed/dsh-reader/xiaoyuzhou
 */

/** One episode, as the reader needs it. */
export interface XiaoyuzhouEpisode {
  readonly id: string
  readonly title: string
  readonly audio: string
  readonly durationSec?: number
  readonly publishedAt?: string
  /** The shownotes (Xiaoyuzhou's own HTML), else the plain description. */
  readonly notesHtml?: string
  readonly image?: string
  readonly podcastTitle?: string
}

/** The page's Next.js data, or `undefined` when the page has none. */
function nextData(html: string): Record<string, unknown> | undefined {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (match === null) return undefined
  try {
    return JSON.parse(match[1]!) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** A nested record field, tolerantly. */
function field(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** A string field, or `undefined`. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** One episode record → the reader's shape. */
function readEpisode(record: unknown, podcastTitle?: string): XiaoyuzhouEpisode | undefined {
  const id = str(field(record, 'eid'))
  const title = str(field(record, 'title'))
  const audio = str(field(record, 'enclosure', 'url')) ?? str(field(record, 'media', 'source', 'url'))
  if (id === undefined || title === undefined || audio === undefined) return undefined
  const duration = Number(field(record, 'duration'))
  const notes = str(field(record, 'shownotes')) ?? str(field(record, 'description'))
  const image = str(field(record, 'image', 'picUrl')) ?? str(field(record, 'podcast', 'image', 'picUrl'))
  const podcast = podcastTitle ?? str(field(record, 'podcast', 'title'))
  const publishedAt = str(field(record, 'pubDate'))
  return {
    id,
    title,
    audio,
    ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(notes === undefined ? {} : { notesHtml: notes }),
    ...(image === undefined ? {} : { image }),
    ...(podcast === undefined ? {} : { podcastTitle: podcast }),
  }
}

/**
 * Read an episode page.
 *
 * @param html - the page's HTML.
 * @returns the episode, or `undefined` when the page carries none.
 */
export function readEpisodePage(html: string): XiaoyuzhouEpisode | undefined {
  return readEpisode(field(nextData(html), 'props', 'pageProps', 'episode'))
}

/** Escape text for XML content and attributes. */
function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** CDATA, safe against a literal `]]>` in the content. */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

/** The MIME type an audio URL most likely has. */
function audioType(url: string): string {
  const path = url.toLowerCase().split('?')[0] ?? ''
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4'
  return 'audio/mpeg'
}

/**
 * Turn a podcast page into an RSS document the reader subscribes to like any
 * other feed.
 *
 * @param html - the podcast page's HTML.
 * @param pageUrl - the page's URL (the channel link).
 * @returns the RSS text, or `undefined` when the page carries no podcast.
 */
export function podcastPageToRss(html: string, pageUrl: string): string | undefined {
  const podcast = field(nextData(html), 'props', 'pageProps', 'podcast')
  const title = str(field(podcast, 'title'))
  if (title === undefined) return undefined
  const episodes = Array.isArray(field(podcast, 'episodes')) ? field(podcast, 'episodes') as unknown[] : []
  const items = episodes.flatMap(record => {
    const episode = readEpisode(record, title)
    if (episode === undefined) return []
    const date = episode.publishedAt === undefined ? undefined : new Date(episode.publishedAt)
    return [[
      '<item>',
      `<title>${xml(episode.title)}</title>`,
      `<link>https://www.xiaoyuzhoufm.com/episode/${episode.id}</link>`,
      `<guid isPermaLink="false">xiaoyuzhou:${episode.id}</guid>`,
      date === undefined || Number.isNaN(date.getTime()) ? '' : `<pubDate>${date.toUTCString()}</pubDate>`,
      episode.notesHtml === undefined ? '' : `<description>${cdata(episode.notesHtml)}</description>`,
      `<enclosure url="${xml(episode.audio)}" type="${audioType(episode.audio)}" length="0"/>`,
      episode.durationSec === undefined ? '' : `<itunes:duration>${String(episode.durationSec)}</itunes:duration>`,
      episode.image === undefined ? '' : `<itunes:image href="${xml(episode.image)}"/>`,
      '</item>',
    ].filter(line => line !== '').join('')]
  })
  const description = str(field(podcast, 'description'))
  const image = str(field(podcast, 'image', 'picUrl'))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    '<channel>',
    `<title>${xml(title)}</title>`,
    `<link>${xml(pageUrl)}</link>`,
    description === undefined ? '' : `<description>${xml(description)}</description>`,
    image === undefined ? '' : `<image><url>${xml(image)}</url><title>${xml(title)}</title><link>${xml(pageUrl)}</link></image>`,
    ...items,
    '</channel>',
    '</rss>',
  ].filter(line => line !== '').join('\n')
}
