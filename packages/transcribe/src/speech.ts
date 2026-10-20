import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SpeechJob, WorkerMessage, WorkerSegment, WorkerSpeaker } from './speech-protocol.ts'

/**
 * Locate the worker script next to whichever module is running: the bundled
 * `lib/media/speech-worker.js` in a built package, or the TS source under
 * vitest / tsx (forked with the tsx loader).
 */
function workerEntry(): { path: string; execArgv: string[] } {
  const here = import.meta.url
  const candidates = [
    new URL('./media/speech-worker.js', here),
    new URL('./speech-worker.js', here),
    new URL('../media/speech-worker.js', here),
  ]
  for (const url of candidates) {
    const path = fileURLToPath(url)
    if (existsSync(path)) return { path, execArgv: [] }
  }
  const ts = fileURLToPath(new URL('./speech-worker.ts', here))
  if (existsSync(ts)) return { path: ts, execArgv: ['--import', 'tsx'] }
  throw new Error('transcribe: speech worker script not found')
}

export interface SpeechResult {
  segments: WorkerSegment[]
  speakers: WorkerSpeaker[]
  /** SenseVoice's dominant detected language. */
  language?: string | undefined
}

export type SpeechProgress = (stage: 'load' | 'diarize' | 'transcribe' | 'embed', progress: number) => void

/** Run one (diarize+)transcribe job in a child process; `onSegments` hears each finished stretch. */
export function runSpeech(job: SpeechJob, onProgress?: SpeechProgress, signal?: AbortSignal, onSegments?: (segments: WorkerSegment[]) => void): Promise<SpeechResult> {
  const entry = workerEntry()
  return new Promise((resolve, reject) => {
    const child = fork(entry.path, [], { execArgv: entry.execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], signal })
    let stderr = ''
    let settled = false
    child.stderr?.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString('utf8')).slice(-4000)
    })
    child.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'progress') onProgress?.(msg.stage, msg.progress)
      else if (msg.type === 'segments') onSegments?.(msg.segments)
      else if (msg.type === 'done') {
        settled = true
        resolve({ segments: msg.segments, speakers: msg.speakers, language: msg.language })
      } else if (msg.type === 'error') {
        settled = true
        reject(new Error(msg.message))
      }
    })
    child.on('error', (e) => {
      if (!settled) reject(e)
      settled = true
    })
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`speech worker exited with code ${code}${stderr ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`))
      settled = true
    })
    child.send(job)
  })
}
