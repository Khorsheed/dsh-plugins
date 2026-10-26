/**
 * Manual smoke: local transcription of one video / audio URL end to end —
 * the reader's own yt-dlp (downloaded on first use), the transcription engine
 * from the sibling package's SOURCE, the reader's job runner. Not part of
 * `test`: it downloads audio and runs the models.
 *   pnpm exec tsx packages/reader/tests/smoke-local-transcribe.ts <state-root> <url> [video|audio] [out.html]
 * With `resume` as the URL it only waits for a job a killed run left behind.
 */
import { writeFileSync } from 'node:fs'
import { TranscribeService } from '../../transcribe/src/service.ts'
import { LocalTranscriber, type TranscribeEngine } from '../src/local-transcribe.ts'
import { mediaLink } from '../src/media.ts'
import { YtDlp } from '../src/ytdlp.ts'

const [stateRoot, url, kind = 'video', out] = process.argv.slice(2)
if (!stateRoot || !url) throw new Error('usage: smoke-local-transcribe.ts <state-root> <url> [video|audio]')
const resuming = url === 'resume'
const media = resuming ? { kind: 'video' as const, provider: 'bilibili' as const, ref: '' } : kind === 'audio' ? { kind: 'audio' as const, provider: 'enclosure' as const, ref: url } : mediaLink(url)
if (media === undefined) throw new Error(`not a media link: ${url}`)
const engine = new TranscribeService()
const ytdlp = new YtDlp(stateRoot)
const t0 = Date.now()
const local = new LocalTranscriber({
  engine: () => engine as unknown as TranscribeEngine,
  tmpRoot: `${stateRoot}/tmp`,
  videoAudio: (u, dir, options) => ytdlp.audio(u, dir, options),
  store: async (_id, _url, html, language) => {
    console.log(`stored ${html.length} chars · ${language ?? '-'}`)
    if (out !== undefined) writeFileSync(out, html)
  },
})
if (!resuming) console.log(await local.start({ entryId: 'smoke', url, media: { ...media, kind: media.kind } as never, confirmModels: true }))
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const status = local.status('smoke')
  process.stderr.write(`\r${status.state} ${Math.round((status.progress ?? 0) * 100)}% ${((Date.now() - t0) / 1000).toFixed(0)}s   `)
  if (status.state === 'done' || status.state === 'failed') {
    process.stderr.write('\n')
    console.log(status.error ?? status.html?.split('\n').slice(0, 6).join('\n'))
    break
  }
}
