/**
 * Manual UI fixture for a member CLI's own subagents (member-cli-subagents
 * M5/M8; compare with proposals/prototypes/member-activity.html, the
 * 「成员会话」 group and 「运行卡片 · 正在等子智能体」) — the real toolview and
 * run row over scripted local-agent reads:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /subagents.html?state=<subrun|substeps|subdone|subbg|swarm|resume|claude|ended|codex|waitcard>[&lang=en][&dark=1]
 * (subrun/substeps/subdone/subbg = one Kimi `Agent` subagent running,
 * expanded, done, in the background; swarm = an `AgentSwarm` group; resume =
 * a reused subagent; claude = a Claude Code `Task` in the M4 mirror's shape;
 * ended = cancelled and lost; codex = a Codex member's spawn (「暂不支持查看过程」, M8);
 * waitcard = the room run row while the member waits for its subagent.)
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LocalAgentSubagentCall, LocalAgentSubagentCalls } from '@khorsheed/dsh-local-agent/types'
import { ActivityReveals } from '../../src/client/MemberActivity.tsx'
import { SubagentCallsStore, SubagentToolView, type SubagentCardsFace } from '../../src/client/SubagentCards.tsx'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'subrun'
const english = params.get('lang') === 'en'
const dictionary: Record<string, string> = english ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const now = Date.now()
const MEMBER = 'child-edit'
const L = (zhText: string, enText: string): string => english ? enText : zhText

const steps = (done: boolean): LocalAgentSubagentCall['steps'] => [
  { kind: 'request', index: 1, text: L('决定先列出这一期的素材文件', 'Decide to list this episode\'s files first'), durationMs: 12_000 },
  { kind: 'tool', name: 'Glob', summary: 'projects/podcast-0412/**/*.json', durationMs: 200 },
  { kind: 'request', index: 2, text: L('先读转写稿和已有剪辑点', 'Read the transcript and the existing cuts first'), durationMs: 8_400 },
  { kind: 'tool', name: 'Read', summary: 'transcript.json · cuts.json · notes.md', durationMs: 400 },
  ...done ? [
    { kind: 'request', index: 3, text: L('按时间戳找停顿', 'Find the pauses by timestamp'), durationMs: 21_700 },
    { kind: 'tool', name: 'Grep', summary: '"pause" transcript.json', durationMs: 100 },
    { kind: 'request', index: 4, text: L('筛出超过 1.2 秒的 14 处并整理', 'Keep the 14 over 1.2 s and sort them'), durationMs: 62_900 },
    { kind: 'reply', text: L('共找到 14 处超过 1.2 秒的停顿，最长一处在 18:42（3.4 秒）……', 'Found 14 pauses over 1.2 s; the longest is at 18:42 (3.4 s)…') },
  ] as LocalAgentSubagentCall['steps'] : [],
]

const call = (callId: string, patch: Partial<LocalAgentSubagentCall>): LocalAgentSubagentCall => ({
  callId, sessionId: `${MEMBER}.sub.${callId}`, executionId: `exec-${callId}`, name: 'explore',
  description: L('查找可剪的停顿', 'Find the pauses to cut'), ordinal: 1, turn: 1, state: 'running', startedAt: now - 72_000,
  usage: { inputTokens: 3_200, outputTokens: 1_100, cacheReadTokens: 27_900 }, steps: steps(false), ...patch,
})

interface Scene {
  readonly who: string
  readonly provider: string
  readonly ask: string
  readonly lead: string
  readonly tool: string
  readonly args: string
  readonly phase: 'start' | 'result'
  readonly calls: LocalAgentSubagentCall[]
  readonly after?: string
  readonly extra?: Array<{ readonly tool: string; readonly args: string; readonly callId: string }>
}

const pausesAsk = L('把 4 月 12 日那期的长停顿都缩短到 0.6 秒，先给我看清单。', 'Shorten every long pause in the April 12 episode to 0.6 s; show me the list first.')
const pausesLead = L('我先派一个子智能体把停顿都找出来，等它的结果再统一处理。', 'I will send a subagent to find the pauses first, then handle them together.')
const exploreArgs = JSON.stringify({ description: L('查找可剪的停顿', 'Find the pauses to cut'), prompt: '…', subagent_type: 'explore' })

const SCENES: Record<string, Scene> = {
  subrun: { who: '剪辑师', provider: 'kimi-cli', ask: pausesAsk, lead: pausesLead, tool: 'Agent', args: exploreArgs, phase: 'start', calls: [call('call-1', {})] },
  substeps: { who: '剪辑师', provider: 'kimi-cli', ask: pausesAsk, lead: pausesLead, tool: 'Agent', args: exploreArgs, phase: 'start', calls: [call('call-1', {})] },
  subdone: { who: '剪辑师', provider: 'kimi-cli', ask: pausesAsk, lead: pausesLead, tool: 'Agent', args: exploreArgs, phase: 'result',
    calls: [call('call-1', { state: 'done', startedAt: now - 300_000, endedAt: now - 137_000, usage: { inputTokens: 9_000, outputTokens: 4_600, cacheReadTokens: 62_000 }, steps: steps(true) })],
    after: L('找到 14 处，清单已放进剪辑面板「待确认」……', 'Found 14; the list is in the editing panel under "To confirm"…') },
  subbg: { who: '剪辑师', provider: 'kimi-cli', ask: L('把全片字幕补齐，弄好告诉我。', 'Fill in the subtitles for the whole cut and tell me when done.'),
    lead: L('字幕补齐要一段时间，我放到后台做，你可以先忙别的。', 'Subtitles take a while; I put it in the background, go ahead with other things.'),
    tool: 'Agent', args: JSON.stringify({ description: L('补全全片字幕', 'Finish the subtitles'), subagent_type: 'coder', run_in_background: true }), phase: 'result',
    calls: [call('call-1', { name: 'coder', description: L('补全全片字幕', 'Finish the subtitles'), background: true, startedAt: now - 372_000, usage: { inputTokens: 4_000, outputTokens: 1_400, cacheReadTokens: 38_600 },
      steps: [{ kind: 'request', index: 1, text: L('按段落补齐', 'Fill in by section'), durationMs: 9_000 }, { kind: 'tool', name: 'Edit', summary: 'subtitles/part-3.srt', durationMs: 300 }] })],
    after: L('已在后台开始，完成后我会接着检查并告诉你。', 'Started in the background; I will check it and tell you when it is done.') },
  swarm: { who: '剪辑师', provider: 'kimi-cli', ask: L('三段素材分别配字幕，风格统一。', 'Subtitle the three clips separately, in one style.'),
    lead: L('三段互不依赖，我让三个子智能体并行处理。', 'The three are independent; three subagents will work in parallel.'),
    tool: 'AgentSwarm', args: JSON.stringify({ description: L('为三段素材生成字幕', 'Subtitles for the three clips'), tasks: [{}, {}, {}] }), phase: 'start',
    calls: [
      call('call-swarm', { sessionId: `${MEMBER}.sub.a0`, executionId: 'e0', name: 'coder', description: L('片头 00:00–04:10', 'Opening 00:00–04:10'), group: { index: 0, size: 3 }, state: 'done', startedAt: now - 400_000, endedAt: now - 215_000, usage: { inputTokens: 3_000, outputTokens: 900, cacheReadTokens: 30_000 } }),
      call('call-swarm', { sessionId: `${MEMBER}.sub.a1`, executionId: 'e1', name: 'coder', description: L('访谈 04:10–31:55', 'Interview 04:10–31:55'), group: { index: 1, size: 3 }, startedAt: now - 400_000, usage: { inputTokens: 5_000, outputTokens: 1_500, cacheReadTokens: 40_000 } }),
      call('call-swarm', { sessionId: `${MEMBER}.sub.a2`, executionId: 'e2', name: 'coder', description: L('片尾 31:55–35:20', 'Closing 31:55–35:20'), group: { index: 2, size: 3 }, state: 'done', startedAt: now - 400_000, endedAt: now - 282_000, usage: { inputTokens: 2_000, outputTokens: 600, cacheReadTokens: 31_000 } }),
    ] },
  resume: { who: '剪辑师', provider: 'kimi-cli', ask: L('再找一下 30 分钟之后有没有口头禅。', 'Look for filler words after the 30-minute mark too.'),
    lead: L('让刚才那个探索子智能体接着找，它已经读过转写稿了。', 'The explore subagent from before continues; it already read the transcript.'),
    tool: 'Agent', args: JSON.stringify({ description: L('查找 30 分钟后的口头禅', 'Find filler words after 30:00'), resume: 'agent-0' }), phase: 'result',
    calls: [call('call-2', { description: L('查找 30 分钟后的口头禅', 'Find filler words after 30:00'), ordinal: 2, turn: 2, state: 'done', startedAt: now - 100_000, endedAt: now - 52_000, usage: { inputTokens: 12_000, outputTokens: 900 } })] },
  claude: { who: '审片员', provider: 'claude-code', ask: L('检查成片里有没有穿帮镜头。', 'Check the final cut for continuity errors.'),
    lead: L('我派一个子智能体逐段对照分镜表。', 'I will send a subagent to compare it against the storyboard.'),
    tool: 'Task', args: JSON.stringify({ description: L('对照分镜表检查穿帮', 'Check against the storyboard'), prompt: '…', subagent_type: 'general-purpose' }), phase: 'result',
    calls: [call('toolu_01', { name: 'general-purpose', description: L('对照分镜表检查穿帮', 'Check against the storyboard'), state: 'done', startedAt: now - 300_000, endedAt: now - 58_000, usage: { inputTokens: 23_000, outputTokens: 3_100 },
      steps: [{ kind: 'request', index: 1, text: L('先读分镜表', 'Read the storyboard first'), durationMs: 4_000 }, { kind: 'tool', name: 'Read', summary: 'storyboard.md', durationMs: 120 }, { kind: 'reply', text: L('发现 2 处……', 'Found 2…') }] })],
    after: L('发现 2 处：12:04 背景里有工作人员，27:31 话筒入画……', 'Found 2: a crew member in the background at 12:04, the mic in frame at 27:31…') },
  ended: { who: '剪辑师', provider: 'kimi-cli', ask: L('测量两个机位的音量。', 'Measure the levels of both camera angles.'),
    lead: L('两个机位各派一个子智能体。', 'One subagent per camera angle.'),
    tool: 'Agent', args: JSON.stringify({ description: L('测量 A 机位音量', 'Measure camera A levels'), subagent_type: 'coder' }), phase: 'result',
    calls: [
      call('call-1', { name: 'coder', description: L('测量 A 机位音量', 'Measure camera A levels'), state: 'cancelled', startedAt: now - 200_000, endedAt: now - 49_000, usage: { inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 16_500 } }),
      call('call-2', { name: 'coder', description: L('测量 B 机位音量', 'Measure camera B levels'), state: 'lost', background: true, startedAt: now - 900_000, usage: { inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 10_000 } }),
    ],
    extra: [{ tool: 'Agent', args: JSON.stringify({ description: L('测量 B 机位音量', 'Measure camera B levels'), subagent_type: 'coder', run_in_background: true }), callId: 'call-2' }] },
  codex: { who: '配音员', provider: 'codex', ask: L('分别试三种配音语速。', 'Try three voice-over speeds.'),
    lead: L('我开几个子智能体分别试。', 'I will spawn a few subagents to try them.'),
    tool: 'collab/spawnAgent', args: JSON.stringify({ prompt: L('试 0.9 倍语速', 'Try 0.9× speed'), model: 'gpt-5.5' }), phase: 'result', calls: [],
    after: L('三种都试过了，0.9 倍听起来最自然……', 'Tried all three; 0.9× sounds the most natural…') },
}

const scene = SCENES[state] ?? SCENES['subrun']!
const read: LocalAgentSubagentCalls = { calls: scene.calls }
const face: SubagentCardsFace = { store: new SubagentCallsStore(async () => read), reveals: new ActivityReveals(), open: () => {} }

function ToolRow({ tool, args, callId, phase }: { readonly tool: string; readonly args: string; readonly callId: string; readonly phase: 'start' | 'result' }) {
  const block = phase === 'start' ? { time: now - 72_000, argsRaw: args } : { callTime: now - 300_000, call: { argsRaw: args } }
  return <SubagentToolView callId={callId} toolName={tool} phase={phase} block={block} sessionId={MEMBER} subagents={face} t={t} />
}

function Session() {
  useEffect(() => {
    if (state !== 'substeps') return
    const timer = setInterval(() => {
      const button = [...document.querySelectorAll('button')].find(entry => entry.textContent === t('sub.action.expand'))
      if (button !== undefined) { button.click(); clearInterval(timer) }
    }, 50)
    return () => { clearInterval(timer) }
  }, [])
  return (
    <main style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: 8 }}>
        {L('房间', 'Room')} › <b style={{ color: 'var(--dsw-alias-label-primary)' }}>{scene.who}</b> · {scene.provider}
      </div>
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '7px 11px', borderRadius: '12px 12px 4px 12px', background: 'var(--dsw-alias-bg-layer-2)' }}>{scene.ask}</div>
      <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)' }}>{scene.lead}</p>
      <ToolRow tool={scene.tool} args={scene.args} callId={scene.calls[0]?.callId ?? 'call-codex'} phase={scene.phase} />
      {scene.extra?.map(row => <ToolRow key={row.callId} tool={row.tool} args={row.args} callId={row.callId} phase="result" />)}
      {scene.after !== undefined && <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)' }}>{scene.after}</p>}
    </main>
  )
}

const editor: RoomMember = { id: 'm-edit', name: '剪辑师', kind: 'cli', provider: 'kimi-cli', role: '剪辑', invitedBy: 'human', childSessionId: MEMBER as never }
const runRoom: RoomState = { members: [editor], relays: [], tasks: [], runs: [], deliveries: [], executions: [] } as never
const waitRead: LocalAgentSubagentCalls = { calls: [call('call-1', { startedAt: now - 6 * 60_000 - 20_000 })] }
const waitFace: SubagentCardsFace = { store: new SubagentCallsStore(async () => waitRead), reveals: new ActivityReveals(), open: () => {} }

function WaitCard() {
  const roomStore = { subscribe: () => () => {}, getCached: () => runRoom, refresh: async () => {}, isRoomCached: () => true }
  const node = { key: 'room-run-1', kind: 'room-run', id: '1', target: 'chat', anchorSeq: 1, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq: 1, time: now, member: '剪辑师', state: 'running', startedAt: now - 490_000 } }
  return (
    <main style={{ maxWidth: 780, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{L('房间时间线', 'Room timeline')}</div>
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '7px 11px', borderRadius: '12px 12px 4px 12px', background: 'var(--dsw-alias-bg-layer-2)' }}>@剪辑师 {pausesAsk}</div>
      <RoomRunView {...{ sessionId: 'room-1', node, roomStore, openSession: () => {}, cancelMember: async () => {}, renderMemberOutput: () => null, renderSlot: () => null, memberSubagents: waitFace, t } as never} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(state === 'waitcard' ? <WaitCard /> : <Session />)
