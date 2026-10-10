/**
 * Manual smoke: diarize + transcribe a 16 kHz mono WAV with the models in
 * $DSH_HOME/state/video-studio/models (default ~/.dsh). Not part of `test`:
 * it needs the downloaded models and takes seconds to minutes.
 *   pnpm exec tsx packages/video-studio/tests/smoke/smoke-speech.ts <wav> [paraformer|senseVoice]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runSpeech } from '../../src/media/speech.ts'

const [wav, kind = 'paraformer', n = '-1', th = '0.5'] = process.argv.slice(2)
if (!wav) throw new Error('usage: smoke-speech.ts <wav> [paraformer|senseVoice]')
const M = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'state', 'video-studio', 'models')
const asr = kind === 'senseVoice'
  ? { kind: 'senseVoice' as const, model: join(M, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/model.int8.onnx'), tokens: join(M, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/tokens.txt') }
  : { kind: 'paraformer' as const, model: join(M, 'sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx'), tokens: join(M, 'sherpa-onnx-paraformer-zh-2023-09-14/tokens.txt') }
const t0 = Date.now()
const res = await runSpeech({
  wavPath: wav,
  models: {
    asr,
    segmentation: join(M, 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'),
    embedding: join(M, '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx'),
    punctuation: kind === 'paraformer' ? join(M, 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx') : undefined,
  },
  voices: [],
  numSpeakers: Number(n),
  clusterThreshold: Number(th),
  matchThreshold: 0.6,
  numThreads: 4,
}, (stage, p) => process.stderr.write(`\r${stage} ${(p * 100).toFixed(0)}%   `))
process.stderr.write('\n')
for (const s of res.segments) {
  const text = s.tokens.map((t) => t.text).join('')
  console.log(`[${s.start.toFixed(2)}–${s.end.toFixed(2)}] S${s.cluster}: ${text}`)
}
console.log('first tokens:', JSON.stringify(res.segments[0]?.tokens.slice(0, 6)))
console.log('speakers:', res.speakers.map((s) => `S${s.cluster} ${s.speechSec.toFixed(1)}s`).join(', '), `· ${((Date.now() - t0) / 1000).toFixed(1)}s`)
