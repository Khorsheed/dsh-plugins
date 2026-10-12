/**
 * The model-facing video_* tools. Every tool resolves the project from an
 * explicit `projectId` or from the calling session's binding, so the model
 * can say "the project" once and keep working. Mutations from here are
 * origin 'agent': proposals land as dashed ✓/✗ groups in the panel, never as
 * silent edits to the cut.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { basename } from 'node:path'
import { formatClock } from './core/timeline.ts'
import type { EditKind } from './core/types.ts'
import type { ExportKind, VideoStudioService } from './service.ts'

interface ExecLike {
  agent?: { id: string }
}

const text = {
  schema: { type: 'string' as const },
  render: (_a: unknown, v: unknown) => [{ type: 'text' as const, text: String(v) }],
}

function fail(tool: string, error: unknown): string {
  return `${tool} 失败：${error instanceof Error ? error.message : String(error)}`
}

async function resolveProject(svc: VideoStudioService, exec: ExecLike, projectId?: string): Promise<string> {
  if (projectId) return projectId
  const sid = exec.agent?.id
  const bound = sid ? await svc.bound(sid) : null
  if (!bound) throw new Error('这个会话还没有打开工程：先用 video_project 的 list / create / open')
  return bound
}

export function defineVideoTools(svc: VideoStudioService) {
  const project = defineTool({
    name: 'video_project',
    description:
      'Podcast/video editing projects (剪辑工程). `list` shows shows (节目) and projects. `create` makes a project '
      + '(optionally under a show, copying its settings: intro/outro music, loudness, subtitle style, voiceprints) and opens it for this session. '
      + '`open` binds an existing project to this session. `create_show` makes a new show. '
      + 'ALWAYS confirm with the user before `create` / `create_show` (propose the name and show in conversation first).',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'create', 'open', 'create_show'], description: 'What to do.' },
      name: { type: 'string', description: 'create / create_show: the name (e.g. 「#23 · 老周搬去杭州」).' },
      showId: { type: 'string', description: 'create: the show to copy settings from (omit for none).' },
      projectId: { type: 'string', description: 'open: the project to bind to this session.' },
    },
    output: text,
    async execute(args: { action: string; name?: string; showId?: string; projectId?: string }, exec: ExecLike): Promise<string> {
      try {
        const sid = exec.agent?.id
        if (args.action === 'list') {
          const o = await svc.overview()
          const bound = sid ? await svc.bound(sid) : null
          const lines = ['节目：']
          for (const s of o.shows) lines.push(`- ${s.id}「${s.name}」声纹：${s.voiceprints.map((v) => v.name).join('、') || '无'}`)
          if (!o.shows.length) lines.push('- （还没有节目）')
          lines.push('工程：')
          for (const p of o.projects.slice(0, 30)) {
            const show = o.shows.find((s) => s.id === p.showId)?.name ?? '无节目'
            lines.push(`- ${p.id}「${p.name}」${show} · ${p.status} · ${formatClock(p.durationSec)}→${formatClock(p.outputSec)}${p.id === bound ? ' ← 当前会话' : ''}`)
          }
          if (!o.toolchain.ffmpeg) lines.push('注意：本机没有找到 ffmpeg，导入和导出不可用。')
          return lines.join('\n')
        }
        if (args.action === 'create_show') {
          const s = await svc.createShow(args.name ?? '')
          return `已建节目 ${s.id}「${s.name}」`
        }
        if (args.action === 'create') {
          const p = await svc.createProject({ name: args.name ?? '', showId: args.showId ?? null })
          if (sid) await svc.bind(sid, p.id)
          return `已建工程 ${p.id}「${p.name}」并绑定到当前会话。下一步用 video_import 导入素材。`
        }
        if (args.action === 'open') {
          if (!args.projectId) return 'open 需要 projectId'
          if (!sid) return '没有会话可以绑定'
          await svc.bind(sid, args.projectId)
          return await svc.readForModel(args.projectId, { from: 0, to: 120 })
        }
        return `未知 action：${args.action}`
      } catch (e) {
        return fail('video_project', e)
      }
    },
  })

  const importTool = defineTool({
    name: 'video_import',
    description:
      'Add media files to the project by absolute host path (files stay where they are). The first audio file becomes the reference recording; '
      + 'video files are aligned to it by their sound. `continuous`: the recordings in this batch are legs of ONE session (the recorder was paused '
      + 'and resumed) — they are butt-joined in path order into one reference, and each leg is aligned to the video separately. '
      + 'Starts speaker separation + transcription in the background (minutes for an hour of audio; speech models download on first use). '
      + 'Check progress with video_read.',
    parameters: {
      paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Absolute paths (~ allowed). With continuous: legs in recording order.' },
      continuous: { type: 'boolean', description: 'The recordings are legs of one continuous session, joined in path order. Only before transcription.' },
      projectId: { type: 'string', description: 'Defaults to the project bound to this session.' },
    },
    output: text,
    async execute(args: { paths: string[]; projectId?: string; continuous?: boolean }, exec: ExecLike): Promise<string> {
      try {
        const id = await resolveProject(svc, exec, args.projectId)
        const p = await svc.importSources(id, args.paths ?? [], 'agent', args.continuous ?? false)
        return `已导入：${p.sources.map((s) => `${basename(s.path)}（${s.role}，${formatClock(s.durationSec)}）`).join('；')}。分人与转写已排队。`
      } catch (e) {
        return fail('video_import', e)
      }
    },
  })

  const read = defineTool({
    name: 'video_read',
    description:
      'Read the project: sources, speakers, job progress, pending proposals, the user\'s panel edits since your last read, and a transcript window '
      + '(reference time; [..] = already cut, {..} = pending proposal). Read before proposing, and re-read after the user changes things in the panel.',
    parameters: {
      projectId: { type: 'string', description: 'Defaults to the project bound to this session.' },
      from: { type: 'number', description: 'Transcript window start, seconds of the original recording (default 0).' },
      to: { type: 'number', description: 'Transcript window end (default from + 600).' },
    },
    output: text,
    isConcurrencySafe: () => true,
    async execute(args: { projectId?: string; from?: number; to?: number }, exec: ExecLike): Promise<string> {
      try {
        const id = await resolveProject(svc, exec, args.projectId)
        return await svc.readForModel(id, { ...(args.from !== undefined ? { from: args.from } : {}), ...(args.to !== undefined ? { to: args.to } : {}) })
      } catch (e) {
        return fail('video_read', e)
      }
    },
  })

  const propose = defineTool({
    name: 'video_propose_edit',
    description:
      'Propose edits as ONE group the user accepts or rejects (✓/✗ in the panel or in conversation), or decide a group on the user\'s word. '
      + '`scan`: the rule-based rough cut — fillers, long pauses (SHORTENED to pauseKeep, not cut), repeated phrases — as one proposal group. '
      + '`fix_text`: transcription corrections the user can confirm (wrong word → right word, text only). `cut_keyword`: cut every occurrence of a word. '
      + '`propose`: edits over the ORIGINAL recording\'s time — cut (remove a range from everyone: in a mixed recording you cannot remove one voice) '
      + 'or shorten (keep `value` seconds of a pause). `apply` / `reject`: only when the user explicitly said so in conversation. '
      + '`rename_speaker` / `merge_speakers` / `reassign`: speaker fixes the user asked for.',
    parameters: {
      action: { type: 'string', required: true, enum: ['scan', 'propose', 'fix_text', 'cut_keyword', 'apply', 'reject', 'rename_speaker', 'merge_speakers', 'reassign'], description: 'What to do.' },
      projectId: { type: 'string', description: 'Defaults to the project bound to this session.' },
      title: { type: 'string', description: 'propose: one line naming the group (e.g. 「删掉外卖吐槽 21:40–27:55」).' },
      edits: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: 'propose: [{kind: "cut"|"shorten", start, end (seconds, original recording), value? (shorten: seconds kept), reason?}].',
      },
      fixes: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: 'fix_text: transcription corrections [{from, to}] (e.g. {from: "门法", to: "门阀"}); each becomes one proposal group over every occurrence. Text only — subtitles and transcript, never the audio.',
      },
      keyword: { type: 'string', description: 'cut_keyword: propose cutting every occurrence of this word or phrase.' },
      groupId: { type: 'string', description: 'apply / reject: the proposal group.' },
      speakerId: { type: 'string', description: 'rename_speaker / reassign: the speaker; merge_speakers: the one merged AWAY.' },
      intoId: { type: 'string', description: 'merge_speakers: the speaker that remains.' },
      segmentId: { type: 'string', description: 'reassign: the transcript segment.' },
      name: { type: 'string', description: 'rename_speaker: the person\'s name (saved as a voiceprint in the show).' },
    },
    output: text,
    async execute(args: { action: string; projectId?: string; title?: string; edits?: Array<{ kind?: string; start?: number; end?: number; value?: number; reason?: string }>; fixes?: Array<{ from?: string; to?: string }>; keyword?: string; groupId?: string; speakerId?: string; intoId?: string; segmentId?: string; name?: string }, exec: ExecLike): Promise<string> {
      try {
        const id = await resolveProject(svc, exec, args.projectId)
        switch (args.action) {
          case 'scan': {
            const r = await svc.scan(id, 'agent')
            if (!r.groupId) return '没有新的可清理项。'
            return `已提议 ${r.groupId}：语气词 ${r.counts.fillers}、长停顿 ${r.counts.pauses}、重复 ${r.counts.repeats}，全部采纳约缩短 ${formatClock(r.savedSec)}。请让用户在面板或会话里确认。`
          }
          case 'propose': {
            const edits = (args.edits ?? [])
              .filter((e) => (e.kind === 'cut' || e.kind === 'shorten') && typeof e.start === 'number' && typeof e.end === 'number')
              .map((e) => ({ kind: e.kind as EditKind, start: e.start!, end: e.end!, ...(e.value !== undefined ? { value: e.value } : {}), ...(e.reason ? { reason: e.reason } : {}) }))
            if (!edits.length) return 'propose 需要至少一条 {kind: cut|shorten, start, end}'
            const r = await svc.propose(id, args.title ?? '', edits)
            return `已提议 ${r.groupId}「${args.title ?? '剪辑提议'}」（${edits.length} 处），等用户确认。`
          }
          case 'fix_text': {
            const lines: string[] = []
            for (const f of args.fixes ?? []) {
              if (!f.from || f.to === undefined) continue
              const r = await svc.replaceAll(id, f.from, f.to, 'agent', false)
              lines.push(r.groupId ? `${r.groupId}「${f.from}」→「${f.to}」${r.count} 处` : `「${f.from}」没有出现`)
            }
            return lines.length ? `已提议改字（等用户确认）：${lines.join('；')}` : 'fix_text 需要 fixes: [{from, to}]'
          }
          case 'cut_keyword': {
            if (!args.keyword) return 'cut_keyword 需要 keyword'
            const r = await svc.cutMatches(id, args.keyword, 'agent')
            return r.groupId ? `已提议 ${r.groupId}：剪掉所有「${args.keyword}」${r.count} 处，等用户确认。` : `「${args.keyword}」没有出现。`
          }
          case 'apply':
          case 'reject': {
            if (!args.groupId) return `${args.action} 需要 groupId`
            await svc.decide(id, { groupId: args.groupId }, args.action === 'apply' ? 'applied' : 'rejected', 'agent')
            const v = await svc.view(id)
            return `${args.action === 'apply' ? '已采纳' : '已拒绝'} ${args.groupId}。成片现在 ${formatClock(v.outputSec)}。`
          }
          case 'rename_speaker':
            if (!args.speakerId || !args.name) return 'rename_speaker 需要 speakerId 和 name'
            await svc.renameSpeaker(id, args.speakerId, args.name, 'agent')
            return `已改名为「${args.name}」。`
          case 'merge_speakers':
            if (!args.speakerId || !args.intoId) return 'merge_speakers 需要 speakerId 和 intoId'
            await svc.mergeSpeakers(id, args.speakerId, args.intoId, 'agent')
            return '已合并。'
          case 'reassign':
            if (!args.segmentId || !args.speakerId) return 'reassign 需要 segmentId 和 speakerId'
            await svc.reassignSegment(id, args.segmentId, args.speakerId, 'agent')
            return '已改说话人。'
          default:
            return `未知 action：${args.action}`
        }
      } catch (e) {
        return fail('video_propose_edit', e)
      }
    },
  })

  const render = defineTool({
    name: 'video_render',
    description:
      'Export the edited episode in the background: audio (podcast MP3, loudness-normalised), video (MP4 with subtitles), subtitles (SRT), text (transcript). '
      + 'Timestamps are computed from the edit, never estimate them yourself. Progress shows in the panel and in video_read.',
    parameters: {
      kinds: { type: 'array', required: true, items: { type: 'string', enum: ['audio', 'video', 'subtitles', 'text'] }, description: 'What to export.' },
      projectId: { type: 'string', description: 'Defaults to the project bound to this session.' },
    },
    output: text,
    async execute(args: { kinds: string[]; projectId?: string }, exec: ExecLike): Promise<string> {
      try {
        const id = await resolveProject(svc, exec, args.projectId)
        const kinds = (args.kinds ?? []).filter((k): k is ExportKind => ['audio', 'video', 'subtitles', 'text'].includes(k))
        if (!kinds.length) return 'kinds 至少要一项：audio / video / subtitles / text'
        const job = await svc.startExport(id, kinds)
        const p = await svc.mustProject(id)
        return `已排队「${job.label}」，输出到 ${await svc.exportDirFor(p)}`
      } catch (e) {
        return fail('video_render', e)
      }
    },
  })

  return [project, importTool, read, propose, render]
}
