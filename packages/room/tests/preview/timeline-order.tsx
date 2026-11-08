/**
 * Manual UI fixture for room-timeline-interaction-order's B line (compare
 * with proposals/prototypes/room-timeline-order.html, 「改后」 frames ①–⑤ and
 * ⑪): the real receipt line, reply line, queue capsules, queue strip and the
 * members page queue over a scripted room state. The human bubble and the
 * composer card are stand-ins (the host draws those). Fictional text only.
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /timeline-order.html?state=<queued|waited|multi|paused|native|member>[&lang=en][&dark=1]
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RoomReceiptView } from '../../src/client/RoomReceiptView.tsx'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { RoomRunView } from '../../src/client/RoomRunView.tsx'
import { RoomQueueStrip } from '../../src/client/RoomQueueStrip.tsx'
import { RoomQueueCapsules } from '../../src/client/RoomQueueCapsules.tsx'
import { queueCapsules } from '../../src/client/queue-capsules.ts'
import { MemberInboxView } from '../../../local-agent/src/client/MemberInboxView.tsx'
import { zh as laZh, en as laEn } from '../../../local-agent/src/client/locales.ts'
import { WITHDRAWN_TEXT } from '../../src/delivery-notes.ts'
import { en, zh } from '../../src/client/locales.ts'
import capsuleCss from '../../src/client/RoomTaskCapsule.module.css'
import type { RoomDelivery, RoomMember, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'queued'
const english = params.get('lang') === 'en'
const translate = (dictionary: Record<string, string>) => ((key: string, vars?: Record<string, unknown>) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
const t = translate(english ? en : zh)
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const T = new Date(2026, 10, 8, 21, 56).getTime()
const M1 = '第三章的冲突太平了，帮我把主角和师父的分歧往前提，给个新大纲。'
const M2 = '另外：师父这条线最后不要死，改成离开。'
const M3 = '@故事顾问 @画布维护 第三章新大纲出来后同步更新画布的章节卡。'
const gu: RoomMember = { id: 'm-gu', name: '故事顾问', kind: 'cli', provider: 'kimi-cli', role: '协调者', invitedBy: 'human', childSessionId: 'child-gu' as never }
const hb: RoomMember = { id: 'm-hb', name: '画布维护', kind: 'cli', provider: 'codex', role: '画布', invitedBy: 'human', childSessionId: 'child-hb' as never }
const dsh: RoomMember = { id: 'legacy:1', name: 'dsh', kind: 'main-agent', invitedBy: 'human' }
const d = (seq: number, memberId: string, over: Partial<RoomDelivery>): RoomDelivery =>
  ({ id: `${seq}:${memberId}`, dispatchSeq: seq, memberId, origin: 'human', status: 'done', text: '…', queuedAt: T, messageId: `msg-${seq}`, bubble: 'before', ...over })

const deliveries: Record<string, RoomDelivery[]> = {
  queued: [d(2, 'm-gu', { status: 'running', startedAt: T + 200 }), d(5, 'm-gu', { status: 'queued', queuedAt: T + 9 * 60_000 })],
  waited: [d(2, 'm-gu', { startedAt: T + 200, endedAt: T + 648_000 }), d(5, 'm-gu', { status: 'running', queuedAt: T + 569_000, startedAt: T + 648_000 })],
  multi: [d(5, 'm-gu', { status: 'cancelled', note: WITHDRAWN_TEXT, queuedAt: T + 9 * 60_000 }), d(6, 'm-hb', { status: 'running', queuedAt: T + 10 * 60_000, startedAt: T + 10 * 60_000 + 300 }), d(6, 'm-gu', { status: 'queued', queuedAt: T + 10 * 60_000 })],
  paused: [d(5, 'm-gu', { status: 'queued', queuedAt: T + 9 * 60_000 }), d(3, 'm-gu', { status: 'uncertain', queuedAt: T })],
  native: [d(2, 'legacy:1', { status: 'running', startedAt: T + 100 }), d(5, 'legacy:1', { status: 'queued', queuedAt: T + 9 * 60_000, bubble: undefined, text: M2 })],
}
const room: RoomState = {
  members: state === 'native' ? [dsh, hb] : [gu, hb], relays: [], tasks: [],
  runs: [],
  deliveries: deliveries[state] ?? [],
  ...state === 'paused' ? { restartFacts: { queuePaused: ['m-gu'] } } : {},
  latestSpeechSeq: 8, latestReplySeq: 8,
}
const roomStore = { subscribe: () => () => {}, getCached: () => room, refresh: async () => {}, isRoomCached: () => true }
const node = (kind: string, seq: number, data: Record<string, unknown>) => ({ key: `${kind}-${seq}`, kind, id: String(seq), target: 'chat', anchorSeq: seq, location: { kind: 'unresolved' }, visibility: 'visible', data: { seq, time: T, ...data } })
const LIVE = '我先通读了第二、三章。现在的问题是分歧到第三章末尾才出现，前面没有铺垫，读者会觉得突然。我打算把分歧拆成三步……'
const SPEECH = '新大纲（第三章）：\n\n1. 开场：师父拒绝带主角下山，两人第一次顶嘴。\n2. 中段：主角私下接了委托，师父知道后没有拦。\n3. 结尾：委托出事，师父出手，两人的分歧摆到台面上。'
const common = {
  sessionId: 'room-1', roomStore, openSession: () => {}, cancelMember: async () => {}, renderSlot: () => null, t,
  renderMemberOutput: () => <div style={{ fontSize: 14, lineHeight: 1.75 }}>{LIVE}</div>,
  withdraw: async () => undefined, resumeQueue: async () => undefined,
}

function Human({ text, time }: { readonly text: string; readonly time: number }) {
  const clock = new Date(time)
  return <div style={{ alignSelf: 'flex-end', maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
    <div style={{ background: 'light-dark(#e3e6ea, rgb(53,54,56))', borderRadius: 14, padding: '8px 12px', fontSize: 14 }}>{text}</div>
    <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{`${clock.getHours()}:${String(clock.getMinutes()).padStart(2, '0')}`}</span>
  </div>
}
const Receipt = ({ seq }: { readonly seq: number }) => <RoomReceiptView {...{ ...common, node: node('room-receipt', seq, { messageId: `msg-${seq}` }) } as never} />
const Run = ({ member, seq }: { readonly member: string; readonly seq: number }) =>
  <RoomRunView {...{ ...common, node: node('room-run', seq, { member, startedAt: T + 200, runId: `2:${member === '故事顾问' ? 'm-gu' : 'm-hb'}`, state: 'running' }) } as never} />

function Feed() {
  const at = (minutes: number) => T + minutes * 60_000
  switch (state) {
    case 'queued': return <>
      <Human text={M1} time={T} />
      <Human text={M2} time={at(9)} /><Receipt seq={5} />
      <Run member="故事顾问" seq={7} />
    </>
    case 'waited': return <>
      <Human text={M1} time={T} />
      <Human text={M2} time={T + 569_000} /><Receipt seq={5} />
      <RoomSpeechView {...{ ...common, node: node('room-speech', 8, { member: '故事顾问', runId: '2:m-gu', time: T + 648_000, durationMs: 648_000, text: SPEECH }) } as never} />
      <Run member="故事顾问" seq={9} />
    </>
    case 'multi': return <>
      <Human text={M2} time={at(9)} /><Receipt seq={5} />
      <Human text={M3} time={at(10)} /><Receipt seq={6} />
      <Run member="画布维护" seq={8} />
      <Run member="故事顾问" seq={9} />
    </>
    case 'paused': return <>
      <Human text={M2} time={at(9)} /><Receipt seq={5} />
    </>
    case 'native': return <>
      <Human text={M1} time={T} />
      <div style={{ fontSize: 14, color: 'var(--dsw-alias-label-primary)' }}>{english ? '(the native dsh turn draws here)' : '（原生 dsh 那一轮在这里由宿主画）'}</div>
    </>
    default: return null
  }
}

function Dock() {
  const capsules = queueCapsules(room, state === 'native' ? 'legacy:1' : 'm-gu')
  const pending = (room.deliveries ?? []).filter(row => row.bubble === undefined && row.status === 'queued')
    .map(row => ({ id: row.id, preview: row.text, pending: true, withdraw: () => {} }))
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div className={capsuleCss.capsules}>
      <button type="button" className={capsuleCss.capsule} data-running="">{t('job.capsule.running', { count: 1 })}</button>
      <RoomQueueCapsules capsules={capsules} resume={async () => undefined} openSession={() => {}} t={t} />
    </div>
    <RoomQueueStrip items={pending} t={t} />
    <div style={{ border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 14, padding: '10px 12px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 14 }}>
      {english ? 'Message, @ a member…' : '发消息，@ 指定成员…'}
    </div>
  </div>
}

function MemberPage() {
  const laT = translate(english ? laEn : laZh)
  const inbox = { memberId: 'child-gu', paused: false, messages: [{ id: 'r-1', caller: 'room' as const, preview: M2, status: 'queued' as const, createdAt: T, updatedAt: T }] }
  return <main style={{ maxWidth: 720, margin: '8px auto 24px', padding: '0 16px' }}>
    <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', margin: '12px 0' }}>{english ? 'Room › Story adviser (members page)' : '房间 › 故事顾问（成员页）'}</div>
    <MemberInboxView face={{ read: async () => inbox, control: async () => ({ ok: true }) }} t={laT} />
  </main>
}

function Page() {
  if (state === 'member') return <MemberPage />
  return <main style={{ maxWidth: 720, margin: '8px auto 24px', padding: '0 16px', containerType: 'inline-size' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}><Feed /></div>
    <Dock />
  </main>
}

createRoot(document.getElementById('root')!).render(<Page />)
