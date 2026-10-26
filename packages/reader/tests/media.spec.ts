/**
 * Video and audio entries, host and shared halves: caption parsing and
 * paragraph merging, link recognition, Xiaoyuzhou pages, the caption-track
 * choice, and the synthetic page a media link is stored as. The fixtures are
 * trimmed shapes of files measured on 2026-10-20 (YouTube json3 / rolling VTT,
 * Bilibili subtitle JSON, Xiaoyuzhou `__NEXT_DATA__`).
 */
import { describe, expect, it } from 'vitest'
import {
  MERGE, formatClock, mergeCues, parseBiliJson, parseCaptions, parseJson3, parseSrt, parseVtt, renderTranscript, type Cue,
} from '../src/captions.ts'
import { canonicalMediaUrl, embedUrl, enclosureKind, entryMedia, isShortMediaLink, linkAt, mediaLink, readMediaMeta } from '../src/media.ts'
import { channelRss, episodePage, syntheticLabel, videoPage } from '../src/media-host.ts'
import { podcastPageToRss, readEpisodePage } from '../src/xiaoyuzhou.ts'
import { chooseCaptionTrack, releaseAsset } from '../src/ytdlp.ts'

describe('caption formats', () => {
  it('reads YouTube json3, skipping newline-append events', () => {
    const raw = JSON.stringify({ events: [
      { tStartMs: 160, dDurationMs: 2110, segs: [{ utf8: 'hi' }, { utf8: ' everyone' }] },
      { tStartMs: 2270, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 2280, dDurationMs: 1950, segs: [{ utf8: '30-minute talk' }] },
    ] })
    expect(parseJson3(raw)).toEqual([
      { start: 0.16, end: 2.27, text: 'hi everyone' },
      { start: 2.28, end: 4.23, text: '30-minute talk' },
    ])
  })

  it('drops the repeated line of a rolling auto-caption VTT', () => {
    const raw = [
      'WEBVTT', '',
      '00:00:00.160 --> 00:00:02.270 align:start position:0%', ' ', 'hi<00:00:00.320><c> everyone</c>', '',
      '00:00:02.270 --> 00:00:02.280 align:start position:0%', 'hi everyone', ' ', '',
      '00:00:02.280 --> 00:00:04.230 align:start position:0%', 'hi everyone', '30-minute<00:00:02.800><c> talk</c>', '',
    ].join('\n')
    expect(parseVtt(raw).map(cue => cue.text)).toEqual(['hi everyone', '30-minute talk'])
  })

  it('reads SRT and Bilibili JSON, and dispatches by extension', () => {
    expect(parseSrt('1\n00:00:01,000 --> 00:00:02,500\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n世界')).toEqual([
      { start: 1, end: 2.5, text: '你好' }, { start: 3, end: 4, text: '世界' },
    ])
    expect(parseBiliJson(JSON.stringify({ body: [{ from: 1.5, to: 3, content: '大家好' }] }))).toEqual([{ start: 1.5, end: 3, text: '大家好' }])
    expect(parseCaptions('{"body":[]}', 'json')).toEqual([])
    expect(parseCaptions('x', 'ass')).toEqual([])
  })
})

describe('merging cues into paragraphs', () => {
  const at = (start: number, text: string, length = 2): Cue => ({ start, end: start + length, text })

  it('closes punctuated paragraphs at a sentence end once long enough', () => {
    // 'One.' and 'Two.' end sentences before 15s, so they do not close the paragraph; 'and four.' at 16s does.
    const cues = [at(0, 'One.', 4), at(4, 'Two.', 4), at(8, 'Three', 4), at(12, 'and four.', 4), at(16, 'Five.', 2), at(18, 'Six', 2)]
    const merged = mergeCues(cues)
    expect(merged.map(segment => segment.text)).toEqual(['One. Two. Three and four.', 'Five. Six'])
    expect(merged[0]!.lines).toHaveLength(4)
  })

  it('closes unpunctuated captions at a short pause, and always by the cap', () => {
    const bare = Array.from({ length: 30 }, (_, index) => at(index * 2, `word${String(index)}`, 2))
    // A clear pause after the 9th cue (ends at 18s): past the minimum, so the paragraph closes there.
    const withPause = bare.map(cue => cue.start >= 18 ? { ...cue, start: cue.start + 1, end: cue.end + 1 } : cue)
    expect(mergeCues(withPause)[0]!.lines).toHaveLength(9)
    expect(mergeCues(bare).every(segment => segment.end - segment.start <= MERGE.bareMaxSeconds + 2)).toBe(true)
  })

  it('joins CJK lines without spaces, and a long pause always splits', () => {
    expect(mergeCues([at(0, '大家好。'), at(2, '今天聊聊。')])[0]!.text).toBe('大家好。今天聊聊。')
    expect(mergeCues([at(0, 'a.'), at(10, 'b.')])).toHaveLength(2)
  })

  it('renders paragraphs with their start time, escaped', () => {
    expect(renderTranscript(mergeCues([at(65.25, 'a < b')]))).toBe('<p data-t="65.3">a &lt; b</p>')
    expect([formatClock(5), formatClock(65), formatClock(3725)]).toEqual(['0:05', '1:05', '1:02:05'])
  })
})

describe('media links', () => {
  it('recognizes videos, channels and Xiaoyuzhou pages, and nothing else', () => {
    expect(mediaLink('https://www.youtube.com/watch?v=zjkBMFhNj_g&t=10')).toEqual({ provider: 'youtube', kind: 'video', id: 'zjkBMFhNj_g' })
    expect(mediaLink('https://youtu.be/zjkBMFhNj_g')).toMatchObject({ kind: 'video', id: 'zjkBMFhNj_g' })
    expect(mediaLink('https://www.youtube.com/@AndrejKarpathy/videos')).toEqual({ provider: 'youtube', kind: 'channel', id: '@AndrejKarpathy' })
    expect(mediaLink('https://www.bilibili.com/video/BV1GJ411x7h7/?p=1')).toEqual({ provider: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' })
    expect(mediaLink('https://www.xiaoyuzhoufm.com/episode/61dc343d98304da3caa6c4ae')).toMatchObject({ provider: 'xiaoyuzhou', kind: 'audio' })
    expect(mediaLink('https://www.xiaoyuzhoufm.com/podcast/5e93287b418a84a04661a12e')).toMatchObject({ kind: 'podcast' })
    expect(mediaLink('https://example.com/watch?v=abcdefg')).toBeUndefined()
  })

  it('resolves share short links to a clean canonical page', () => {
    expect(isShortMediaLink('https://b23.tv/t414KUa')).toBe(true)
    expect(isShortMediaLink('https://www.bilibili.com/video/BV1omhd6iEQQ')).toBe(false)
    expect(canonicalMediaUrl('https://www.bilibili.com/video/BV1omhd6iEQQ/?buvid=YB43&share_from=ugc&p=1&unique_k=t414KUa')).toBe('https://www.bilibili.com/video/BV1omhd6iEQQ/')
    expect(canonicalMediaUrl('https://www.bilibili.com/video/BV1omhd6iEQQ/?p=3&x=1')).toBe('https://www.bilibili.com/video/BV1omhd6iEQQ/?p=3')
    expect(canonicalMediaUrl('https://youtu.be/zjkBMFhNj_g?si=abc')).toBe('https://www.youtube.com/watch?v=zjkBMFhNj_g')
    expect(canonicalMediaUrl('https://example.com/a')).toBeUndefined()
  })

  it('decides an entry\'s kind per item: the link first, then the enclosure', () => {
    expect(entryMedia({ link: 'https://www.youtube.com/watch?v=zjkBMFhNj_g' })).toMatchObject({ kind: 'video', provider: 'youtube' })
    expect(entryMedia({ link: 'https://pod.example/ep1', enclosure: { url: 'https://cdn/ep1.mp3', type: 'audio/mpeg', durationSec: 60 } }))
      .toEqual({ kind: 'audio', provider: 'enclosure', ref: 'https://cdn/ep1.mp3', durationSec: 60 })
    expect(entryMedia({ link: 'https://blog.example/post' })).toBeUndefined()
    expect([enclosureKind('https://x/a.m4a'), enclosureKind('https://x/v', 'video/mp4'), enclosureKind('https://x/doc.pdf')]).toEqual(['audio', 'video', undefined])
  })

  it('builds the embed and the at-a-moment links', () => {
    const yt = { kind: 'video' as const, provider: 'youtube' as const, ref: 'zjkBMFhNj_g' }
    expect(embedUrl(yt, 61.9, 'http://localhost:3080')).toContain('enablejsapi=1')
    expect(embedUrl(yt, 61.9, 'http://localhost:3080')).toContain('start=61')
    expect(embedUrl({ kind: 'video', provider: 'bilibili', ref: 'BV1GJ411x7h7' }, 60, '')).toContain('t=60')
    expect(linkAt('https://www.youtube.com/watch?v=zjkBMFhNj_g', 125)).toBe('https://www.youtube.com/watch?v=zjkBMFhNj_g&t=125s')
    expect(linkAt('https://pod.example/ep1', 125)).toBe('https://pod.example/ep1')
  })
})

describe('the synthetic page a media link is stored as', () => {
  it('round-trips the media description through the page', () => {
    const page = videoPage({ title: 'Intro <LLMs>', duration: 3588.4, thumbnail: 'https://i.ytimg.com/x.jpg', description: 'Line one\n\nLine two', uploader: 'AK', upload_date: '20231123' }, 'youtube', 'zjkBMFhNj_g')
    expect(page).toContain('<title>Intro &lt;LLMs&gt;</title>')
    expect(page).toContain('<p>Line two</p>')
    expect(readMediaMeta(page)).toEqual({ kind: 'video', provider: 'youtube', ref: 'zjkBMFhNj_g', durationSec: 3588, thumbnail: 'https://i.ytimg.com/x.jpg' })
    expect(readMediaMeta('<html><head></head></html>')).toBeUndefined()
  })

  it('names the source after the channel, and lists a channel as RSS of watch links', () => {
    expect(syntheticLabel(videoPage({ title: 'T', uploader: 'Andrej &amp; co' }, 'youtube', 'x'))).toBe('Andrej &amp; co')
    const rss = channelRss({ title: 'AK', entries: [{ id: 'EWvNQjAaOHw', title: 'How I use LLMs', timestamp: 1760918400, thumbnail: 'https://i.ytimg.com/a.jpg' }, { title: 'no id' }] }, 'https://www.youtube.com/@AK')
    expect(rss).toContain('<link>https://www.youtube.com/watch?v=EWvNQjAaOHw</link>')
    expect(rss).toContain('<media:thumbnail url="https://i.ytimg.com/a.jpg"/>')
    expect(rss).toContain('<pubDate>')
    expect(rss.match(/<item>/g)).toHaveLength(1)
  })
})

describe('Xiaoyuzhou pages', () => {
  const episode = { eid: '61dc343d98304da3caa6c4ae', title: '记录繁忙成长的一年', duration: '6579', pubDate: '2022-01-10T12:54:27.000Z', shownotes: '<p>聊了这一年</p>', enclosure: { url: 'https://cdn.example/a.mp3.m4a?x=1&y=2' }, image: { picUrl: 'https://img/e.jpg' }, podcast: { title: '听生' } }
  const page = (props: unknown) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script></html>`

  it('reads an episode page and stores it as an audio page', () => {
    const read = readEpisodePage(page({ episode }))
    expect(read).toMatchObject({ id: episode.eid, audio: 'https://cdn.example/a.mp3.m4a?x=1&y=2', durationSec: 6579, podcastTitle: '听生' })
    expect(readMediaMeta(episodePage(read!))).toMatchObject({ kind: 'audio', provider: 'xiaoyuzhou', durationSec: 6579 })
    expect(readEpisodePage('<html></html>')).toBeUndefined()
  })

  it('turns a podcast page into RSS with enclosures', () => {
    const rss = podcastPageToRss(page({ podcast: { title: '听生', description: '一档节目', episodes: [episode] } }), 'https://www.xiaoyuzhoufm.com/podcast/x')!
    expect(rss).toContain('<title>听生</title>')
    expect(rss).toContain('<link>https://www.xiaoyuzhoufm.com/episode/61dc343d98304da3caa6c4ae</link>')
    expect(rss).toContain('<enclosure url="https://cdn.example/a.mp3.m4a?x=1&amp;y=2" type="audio/mp4" length="0"/>')
    expect(rss).toContain('<itunes:duration>6579</itunes:duration>')
    expect(podcastPageToRss('<html></html>', 'u')).toBeUndefined()
  })
})

describe('yt-dlp', () => {
  it('prefers uploaded captions, then the ORIGINAL auto track — never a machine translation', () => {
    expect(chooseCaptionTrack({ language: 'en', subtitles: { en: [{ ext: 'vtt' }, { ext: 'json3' }] } })).toEqual({ lang: 'en', auto: false, ext: 'json3' })
    expect(chooseCaptionTrack({ language: 'en', automatic_captions: { 'zh-Hans': [{ ext: 'json3' }], 'en-orig': [{ ext: 'json3' }] } }))
      .toEqual({ lang: 'en-orig', auto: true, ext: 'json3' })
    expect(chooseCaptionTrack({ subtitles: { danmaku: [{ ext: 'xml' }] } })).toBeUndefined()
    expect(chooseCaptionTrack({ subtitles: { 'ai-zh': [{ ext: 'srt' }] } })).toEqual({ lang: 'ai-zh', auto: false, ext: 'srt' })
  })

  it('names the standalone release per platform', () => {
    expect([releaseAsset('darwin', 'arm64'), releaseAsset('linux', 'x64'), releaseAsset('linux', 'arm64'), releaseAsset('aix', 'x64')])
      .toEqual(['yt-dlp_macos', 'yt-dlp_linux', 'yt-dlp_linux_aarch64', undefined])
  })
})
