/**
 * Manual end-to-end smoke of the host service (not part of `test`): show →
 * project → import → transcribe → scan → accept → export, in a scratch state
 * dir that borrows the downloaded models.
 *   pnpm exec tsx packages/video-studio/tests/smoke/smoke-service.ts <recording> [video]
 */
import { mkdir, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VideoStudioService } from '../../src/service.ts'

const [recording, video] = process.argv.slice(2)
if (!recording) throw new Error('usage: smoke-service.ts <recording> [video]')
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const state = join(home, 'scratch', 'video-studio-smoke')
await rm(state, { recursive: true, force: true })
await mkdir(state, { recursive: true })
await symlink(join(home, 'state', 'video-studio', 'models'), join(state, 'models'))
const svc = new VideoStudioService(state)
await svc.setGlobal({ exportDir: join(state, 'out', '{show}', '{episode}') })

const show = await svc.createShow('周五夜聊')
const p = await svc.createProject({ name: '#1 冒烟', showId: show.id })
await svc.bind('session-smoke', p.id)
await svc.importSources(p.id, video ? [recording, video] : [recording], 'agent')

async function settle(): Promise<void> {
  for (;;) {
    const jobs = await svc.listJobs(p.id)
    const live = jobs.filter((j) => j.state === 'queued' || j.state === 'running')
    process.stderr.write(`\r${jobs.map((j) => `${j.label}:${j.state}${j.state === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}`).join('  ')}        `)
    if (!live.length) {
      process.stderr.write('\n')
      for (const j of jobs.filter((x) => x.state === 'failed')) console.log('FAILED', j.label, j.error)
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
const t0 = Date.now()
await settle()
console.log(`processing ${((Date.now() - t0) / 1000).toFixed(1)}s`)
let v = await svc.view(p.id)
console.log('sources:', v.project.sources.map((s) => `${s.role} offset=${s.offsetSec}`).join(', '))
console.log('speakers:', v.project.speakers.map((s) => `${s.id}(${s.speechSec.toFixed(1)}s)`).join(', '))
const first = v.project.speakers[0]
if (first) await svc.renameSpeaker(p.id, first.id, '阿遥', 'user')
const scan = await svc.scan(p.id, 'agent')
console.log('scan:', scan.counts, 'saves', scan.savedSec.toFixed(2), 's')
if (scan.groupId) await svc.decide(p.id, { groupId: scan.groupId }, 'applied', 'user')
v = await svc.view(p.id)
console.log(`duration ${v.durationSec.toFixed(2)} → output ${v.outputSec.toFixed(2)}`)
console.log((await svc.readForModel(p.id)).split('\n').slice(0, 12).join('\n'))
const showAfter = await svc.store.getShow(show.id)
console.log('voiceprints:', showAfter?.voiceprints.map((x) => x.name))
await svc.startExport(p.id, video ? ['subtitles', 'text', 'audio', 'video'] : ['subtitles', 'text', 'audio'])
await settle()
const jobs = await svc.listJobs(p.id)
console.log('outputs:', jobs.flatMap((j) => j.outputs ?? []))
svc.dispose()
