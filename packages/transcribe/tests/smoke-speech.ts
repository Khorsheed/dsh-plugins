/**
 * Manual smoke: transcribe a media file through the service with the models in
 * $DSH_HOME/state/transcribe/models (default ~/.dsh). Not part of `test`: it
 * needs the downloaded models (or downloads them) and takes seconds to minutes.
 *   pnpm exec tsx packages/transcribe/tests/smoke-speech.ts <file> [zh|en|auto] [diarize]
 */
import { TranscribeService } from '../src/service.ts'

const [file, language = 'zh', diarize] = process.argv.slice(2)
if (!file) throw new Error('usage: smoke-speech.ts <file> [zh|en|auto] [diarize]')
const t0 = Date.now()
const service = new TranscribeService()
let streamed = 0
const res = await service.run(
  { input: { files: [file] }, language: language as 'zh' | 'en' | 'auto', diarize: diarize ? {} : false, owner: 'smoke' },
  {
    onProgress: (p) => process.stderr.write(`\r${p.stage} ${(p.progress * 100).toFixed(0)}%   `),
    onSegments: (segments) => { streamed += segments.length },
  },
)
process.stderr.write('\n')
for (const s of res.segments) console.log(`[${s.start.toFixed(2)}–${s.end.toFixed(2)}] S${s.cluster}: ${s.text}`)
console.log('first tokens:', JSON.stringify(res.segments[0]?.tokens.slice(0, 6)))
console.log(`streamed ${streamed} · language ${res.language ?? '-'} · speakers ${res.speakers.length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
