/**
 * Synthetic member ledger files shaped like the 2026-11-09 restart incident
 * (design proposals/active/2026-11-09-restart-recovery-consolidation.md):
 * the two CLI members' ledgers as an OLD core left them right after the
 * restart (rows `uncertain`, the boot pause `pausedBy: 'restart'`), and a
 * ledger a host died on mid-round (rows still `running`). Row shapes only —
 * ids and texts are invented.
 * @module
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalAgentMemberInbox } from '../../src/types.ts'

/** The error an old core wrote on a row it turned `uncertain` at load. */
export const OLD_UNCERTAIN_ERROR = 'Host restarted before durable settlement; reconcile this input before continuing'

const T = 1_762_686_000_000

/** The coordinator (总编排) after the old restart: its goal attempt uncertain, the ledger boot-paused. */
export const coordinatorAfterOldRestart: LocalAgentMemberInbox = {
  memberId: 'child-coord', paused: true, pausedBy: 'restart',
  messages: [
    { id: 'exec-1541', key: '1541:coord', caller: 'room', status: 'uncertain', createdAt: T, updatedAt: T + 1, admittedAt: T, error: OLD_UNCERTAIN_ERROR },
  ],
}

/** 地图匠 after the old restart: its coordinator round uncertain, a page input waiting, the ledger boot-paused. */
export const mapperAfterOldRestart: LocalAgentMemberInbox = {
  memberId: 'child-map', paused: true, pausedBy: 'restart',
  messages: [
    { id: 'exec-1530', key: '1530:map', caller: 'room', status: 'uncertain', createdAt: T, updatedAt: T + 1, admittedAt: T, error: OLD_UNCERTAIN_ERROR },
    { id: 'exec-page', key: 'page-1', caller: 'composer', status: 'queued', text: '顺便把出生点挪到桥头。', createdAt: T + 2, updatedAt: T + 2 },
  ],
}

/** A ledger the host died on mid-round: a room round and a page round still `running`, rows queued behind. */
export function runningAtCrash(memberId: string, admittedAt: number): LocalAgentMemberInbox {
  return {
    memberId, paused: false,
    messages: [
      { id: 'exec-room', key: '7:map', caller: 'room', status: 'running', createdAt: admittedAt, updatedAt: admittedAt, admittedAt },
      { id: 'exec-later', key: '8:map', caller: 'room', status: 'queued', createdAt: admittedAt, updatedAt: admittedAt },
      { id: 'exec-typed', key: 'typed-1', caller: 'composer', status: 'queued', text: '顺便把出生点挪到桥头。', createdAt: admittedAt, updatedAt: admittedAt },
    ],
  }
}

/** Write a ledger file where the core reads it (`<sha256(memberId)>.json`, version 2). */
export function writeLedger(directory: string, state: LocalAgentMemberInbox): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, createHash('sha256').update(state.memberId).digest('hex') + '.json')
  writeFileSync(path, JSON.stringify({ version: 2, state }))
  return path
}
