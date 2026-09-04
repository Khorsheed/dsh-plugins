import { execFileSync } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyTransition, createPreflightSnapshot, createTransitionPreflightSnapshot, prepareTransition,
  readTransitionRecord, rollbackTransition, validateTransitionPlan,
  type TransitionPlan,
} from '../src/transition.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(directory, { recursive: true, force: true }) })
  return directory
}

function fixture(): { home: string; stateDir: string; plan: TransitionPlan } {
  const root = temporaryDirectory('ankh-transition-')
  const home = join(root, 'home')
  const stateDir = join(home, 'guard-state')
  mkdirSync(join(home, 'storages'), { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  return {
    home,
    stateDir,
    plan: {
      schemaVersion: 1,
      home,
      operations: [{ kind: 'quarantine', path: 'storages/session_projcache.json', expect: 'absent' }],
    },
  }
}

describe('filesystem transition', () => {
  it('rejects ambiguous, escaping, linked, and guard-owned paths', () => {
    const { home, stateDir, plan } = fixture()
    expect(() => validateTransitionPlan({ ...plan, operations: [{ kind: 'quarantine', path: '../outside', expect: 'absent' }] }, home, stateDir)).toThrow(/traversal/)
    expect(() => validateTransitionPlan({
      ...plan,
      operations: [
        { kind: 'quarantine', path: 'storages', expect: 'present' },
        { kind: 'quarantine', path: 'storages/session_projcache.json', expect: 'absent' },
      ],
    }, home, stateDir)).toThrow(/overlap/)
    expect(() => validateTransitionPlan({
      ...plan,
      operations: [{ kind: 'quarantine', path: 'guard-state/launch.json', expect: 'absent' }],
    }, home, stateDir)).toThrow(/guard state directory/)

    mkdirSync(join(home, 'outside'))
    symlinkSync(join(home, 'outside'), join(home, 'linked'))
    expect(() => validateTransitionPlan({
      ...plan,
      operations: [{ kind: 'quarantine', path: 'linked/state.json', expect: 'absent' }],
    }, home, stateDir)).toThrow(/symbolic link/)
    symlinkSync(join(home, 'missing'), join(home, 'dangling'))
    expect(() => validateTransitionPlan({
      ...plan,
      operations: [{ kind: 'quarantine', path: 'dangling', expect: 'present' }],
    }, home, stateDir)).toThrow(/symbolic link/)
  })

  it('retains rejected target output before restoring the exact previous bytes', () => {
    const { home, stateDir, plan } = fixture()
    const source = join(home, 'storages/session_projcache.json')
    writeFileSync(source, 'previous-version-3')
    const reference = prepareTransition({
      ...plan, operations: [{ ...plan.operations[0]!, expect: 'present' }],
    }, home, stateDir, 'cutover-restore')

    expect(applyTransition(reference, home, stateDir, 'cutover-restore')).toEqual({
      phase: 'applied', changed: ['storages/session_projcache.json'], unchanged: [],
    })
    expect(existsSync(source)).toBe(false)
    writeFileSync(source, 'rejected-target-version-5')

    expect(rollbackTransition(reference, home, stateDir, 'cutover-restore').phase).toBe('rolled-back')
    expect(readFileSync(source, 'utf8')).toBe('previous-version-3')
    expect(readFileSync(
      join(stateDir, 'launch-transitions/cutover-restore/rejected-target/storages/session_projcache.json'),
      'utf8',
    )).toBe('rejected-target-version-5')
    expect(rollbackTransition(reference, home, stateDir, 'cutover-restore')).toEqual({
      phase: 'rolled-back', changed: [], unchanged: ['storages/session_projcache.json'],
    })
  })

  it('restores absence while retaining a target-created path', () => {
    const { home, stateDir, plan } = fixture()
    const source = join(home, 'storages/session_projcache.json')
    const reference = prepareTransition(plan, home, stateDir, 'cutover-absent')

    expect(applyTransition(reference, home, stateDir, 'cutover-absent')).toEqual({
      phase: 'applied', changed: [], unchanged: ['storages/session_projcache.json'],
    })
    writeFileSync(source, 'target-only')
    rollbackTransition(reference, home, stateDir, 'cutover-absent')

    expect(existsSync(source)).toBe(false)
    expect(readFileSync(
      join(stateDir, 'launch-transitions/cutover-absent/rejected-target/storages/session_projcache.json'),
      'utf8',
    )).toBe('target-only')
  })

  it('refuses a prepared plan whose durable bytes were changed', () => {
    const { home, stateDir, plan } = fixture()
    const reference = prepareTransition(plan, home, stateDir, 'cutover-tamper')
    writeFileSync(reference.planPath, `${JSON.stringify({
      ...plan, operations: [{ kind: 'quarantine', path: 'other', expect: 'absent' }],
    })}\n`)
    expect(() => applyTransition(reference, home, stateDir, 'cutover-tamper')).toThrow(/changed after preparation/)
  })

  it('binds source presence for both preflight and live apply', () => {
    const { home, stateDir, plan } = fixture()
    expect(() => prepareTransition({
      ...plan, operations: [{ ...plan.operations[0]!, expect: 'present' }],
    }, home, stateDir, 'cutover-wrong-expectation')).toThrow(/absent, expected present/)

    const reference = prepareTransition(plan, home, stateDir, 'cutover-source-changed')
    writeFileSync(join(home, 'storages/session_projcache.json'), 'appeared-after-preparation')
    expect(() => applyTransition(reference, home, stateDir, 'cutover-source-changed')).toThrow(/source changed after preparation/)
    expect(readFileSync(join(home, 'storages/session_projcache.json'), 'utf8')).toBe('appeared-after-preparation')
  })

  it('reconciles a crash after the source move but before its journal commit', () => {
    const { home, stateDir, plan } = fixture()
    const source = join(home, 'storages/session_projcache.json')
    writeFileSync(source, 'previous')
    const presentPlan: TransitionPlan = {
      ...plan, operations: [{ ...plan.operations[0]!, expect: 'present' }],
    }
    const reference = prepareTransition(presentPlan, home, stateDir, 'cutover-interrupted')
    const root = join(stateDir, 'launch-transitions/cutover-interrupted')
    const stateFile = join(root, 'state.json')
    const record = JSON.parse(readFileSync(stateFile, 'utf8'))
    record.phase = 'applying'
    record.entries[0].apply = 'moving'
    writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`)
    const retained = join(root, 'previous/storages/session_projcache.json')
    mkdirSync(join(root, 'previous/storages'), { recursive: true })
    renameSync(source, retained)

    expect(applyTransition(reference, home, stateDir, 'cutover-interrupted').phase).toBe('applied')
    expect(readTransitionRecord(reference, home, stateDir, 'cutover-interrupted')).toMatchObject({
      phase: 'applied', entries: [{ apply: 'quarantined', original: 'present' }],
    })
  })

  it('preflights on a transitioned copy without mutating the live home', () => {
    const { home, plan } = fixture()
    const source = join(home, 'storages/session_projcache.json')
    writeFileSync(source, 'previous')
    const presentPlan: TransitionPlan = {
      ...plan, operations: [{ ...plan.operations[0]!, expect: 'present' }],
    }

    const snapshot = createTransitionPreflightSnapshot(validateTransitionPlan(presentPlan, home))
    try {
      expect(readFileSync(source, 'utf8')).toBe('previous')
      expect(existsSync(join(snapshot.home, 'storages/session_projcache.json'))).toBe(false)
    } finally {
      snapshot.cleanup()
    }
    expect(existsSync(snapshot.home)).toBe(false)
  })

  it('rebuilds relative links inside the snapshot so linked writes cannot reach live bytes', () => {
    const root = temporaryDirectory('ankh-snapshot-links-')
    const home = join(root, 'home')
    const external = join(root, 'external.txt')
    mkdirSync(home)
    writeFileSync(join(home, 'internal.txt'), 'live-internal')
    writeFileSync(external, 'live-external')
    symlinkSync('internal.txt', join(home, 'internal-link'))
    symlinkSync('../external.txt', join(home, 'external-link'))
    symlinkSync('../external.txt', join(home, 'external-link-again'))

    const snapshot = createPreflightSnapshot(home)
    try {
      expect(lstatSync(join(snapshot.home, 'internal-link')).isSymbolicLink()).toBe(true)
      expect(lstatSync(join(snapshot.home, 'external-link')).isSymbolicLink()).toBe(true)
      expect(realpathSync(join(snapshot.home, 'internal-link'))).toBe(realpathSync(join(snapshot.home, 'internal.txt')))
      expect(realpathSync(join(snapshot.home, 'external-link')).startsWith(realpathSync(snapshot.root))).toBe(true)
      expect(realpathSync(join(snapshot.home, 'external-link-again'))).toBe(realpathSync(join(snapshot.home, 'external-link')))
      writeFileSync(join(snapshot.home, 'internal-link'), 'candidate-internal')
      writeFileSync(join(snapshot.home, 'external-link'), 'candidate-external')
      expect(readFileSync(join(snapshot.home, 'external-link-again'), 'utf8')).toBe('candidate-external')
      expect(readFileSync(join(home, 'internal.txt'), 'utf8')).toBe('live-internal')
      expect(readFileSync(external, 'utf8')).toBe('live-external')
    } finally {
      snapshot.cleanup()
    }
  })

  it('allows contained directory cycles but fails closed on dangling links', () => {
    const root = temporaryDirectory('ankh-snapshot-cycle-')
    const home = join(root, 'home')
    mkdirSync(home)
    symlinkSync('.', join(home, 'loop'))

    const snapshot = createPreflightSnapshot(home)
    try {
      expect(lstatSync(join(snapshot.home, 'loop')).isSymbolicLink()).toBe(true)
      expect(realpathSync(join(snapshot.home, 'loop'))).toBe(realpathSync(snapshot.home))
    } finally {
      snapshot.cleanup()
    }

    const danglingHome = join(root, 'dangling-home')
    mkdirSync(danglingHome)
    symlinkSync('missing', join(danglingHome, 'dangling'))
    expect(() => createPreflightSnapshot(danglingHome)).toThrow(/could not safely copy/)
  })

  it('fails closed on special filesystem entries', () => {
    const mkfifo = ['/usr/bin/mkfifo', '/bin/mkfifo'].find(existsSync)
    if (mkfifo === undefined) return
    const root = temporaryDirectory('ankh-snapshot-special-')
    const home = join(root, 'home')
    mkdirSync(home)
    execFileSync(mkfifo, [join(home, 'pipe')])

    expect(() => createPreflightSnapshot(home)).toThrow(/special filesystem entry/)
  })
})
