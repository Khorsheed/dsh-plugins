import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EvalService } from '../src/service.ts'
import { ARTIFACT_MAX_BYTES, extensionOf, isInside, readCellArtifact } from '../src/cell-artifact.ts'
import { judgeSessionsOf } from '../src/cell-detail.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

/**
 * I5·T69 — the record detail answers 「跑了什么、交了什么」.
 *
 * Two halves. The ARTIFACT read is a new door onto bytes the judge bench
 * could already reach, so the tests that matter are the ones about the door
 * being narrow: a path that climbs out, a symlink that points out, a binary
 * name, and the byte cap. The JUDGE ROUNDS half is a projection of records
 * that already existed — the interesting case is the one that made the old
 * fallback wrong, where a judged cell with no refs named the judge's session
 * as the player's.
 */

/** A run-data tree with one attempt directory, populated by the caller. */
function attemptTree(files: Record<string, string>): { dataDir: string; attemptDir: string } {
  const dataDir = tmpTree()
  const attemptDir = join(dataDir, 'runs', 'run-1', 'data', 'p0-codex-a-rep1', 'attempt-2')
  mkdirSync(attemptDir, { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const path = join(attemptDir, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  return { dataDir, attemptDir }
}

/** The smallest mission read face `readCellArtifact` uses: its data root. */
function missionFace(dataDir: string | undefined) {
  return {
    ...(dataDir === undefined ? {} : { dataDir }),
    runList: () => [{ id: 'run-1' }],
    runStatus: () => ({ run: { id: 'run-1', state: 'active', createdAt: 1, meta: {} }, rows: [], buckets: {}, unreleased: [] }),
    get: () => ({ mission: { currentAttempt: 1, attempts: [], annotations: [] } }),
  }
}

function read(dataDir: string | undefined, path: string, attempt = 2) {
  return readCellArtifact({
    mission: missionFace(dataDir) as never,
    runId: 'run-1',
    missionId: 'p0-codex-a-rep1',
    attempt,
    path,
  })
}

describe('isInside', () => {
  it('keeps the directory itself and everything under it, and nothing else', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c/d.md')).toBe(true)
    expect(isInside('/a/b', '/a/c')).toBe(false)
    expect(isInside('/a/b', '/a')).toBe(false)
    // The prefix trap: a sibling whose name starts with the root's.
    expect(isInside('/a/b', '/a/bb/c.md')).toBe(false)
  })
})

describe('extensionOf', () => {
  it('lower-cases, and a dotfile has no extension', () => {
    expect(extensionOf('stage1.MD')).toBe('.md')
    expect(extensionOf('a/b/notes.json')).toBe('.json')
    expect(extensionOf('archive/workspace')).toBe('')
    // A leading dot is a NAME, not an extension — `.gitignore` is not a
    // `.gitignore`-typed file.
    expect(extensionOf('.gitignore')).toBe('')
  })
})

describe('readCellArtifact', () => {
  it('reads a text artifact whole, with its size and no note', async () => {
    const { dataDir } = attemptTree({ 'stage1.md': '# 阶段一\n\n交了这些。\n' })
    const view = await read(dataDir, 'stage1.md')
    expect(view).toMatchObject({
      runId: 'run-1',
      missionId: 'p0-codex-a-rep1',
      attempt: 2,
      path: 'stage1.md',
      kind: 'text',
      truncated: false,
      note: null,
    })
    expect(view.text).toBe('# 阶段一\n\n交了这些。\n')
    expect(view.bytes).toBe(Buffer.byteLength('# 阶段一\n\n交了这些。\n'))
  })

  it('cuts an over-long artifact at the byte cap and SAYS it cut it', async () => {
    const big = 'x'.repeat(ARTIFACT_MAX_BYTES + 1_000)
    const { dataDir } = attemptTree({ 'run.log': big })
    const view = await read(dataDir, 'run.log')
    expect(view.kind).toBe('text')
    expect(view.truncated).toBe(true)
    expect(view.text).toHaveLength(ARTIFACT_MAX_BYTES)
    expect(view.bytes).toBe(big.length)
    // A truncation nobody is told about is a file a reader would quote wrongly.
    expect(view.note).toContain(String(ARTIFACT_MAX_BYTES))
  })

  it('lists a directory artifact — `archive` and `probe-verdicts` are recorded as artifacts and ARE directories', async () => {
    const { dataDir } = attemptTree({
      'archive/workspace/stage1.md': 'a',
      'archive/workspace/stage2.md': 'b',
      'archive/manifest.json': '{}',
    })
    const view = await read(dataDir, 'archive')
    expect(view.kind).toBe('directory')
    expect(view.entries).toEqual(['manifest.json', 'workspace'])
    expect(view.text).toBeNull()
    expect(view.bytes).toBeNull()
  })

  it('refuses a binary BY NAME, and says which extension it refused', async () => {
    const { dataDir } = attemptTree({ 'shot.png': '\u0089PNG\r\n' })
    const view = await read(dataDir, 'shot.png')
    expect(view.kind).toBe('binary')
    expect(view.text).toBeNull()
    expect(view.bytes).toBeGreaterThan(0)
    expect(view.note).toContain('.png')
  })

  it('refuses a path that climbs out of the attempt directory — whether or not the target exists', async () => {
    const { dataDir } = attemptTree({ 'stage1.md': 'mine' })
    // A real neighbour: the sibling attempt of the SAME run, which exists and
    // is still not this cell's to read.
    const sibling = join(dataDir, 'runs', 'run-1', 'data', 'p0-codex-a-rep2', 'attempt-1')
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'stage1.md'), 'another cell\'s')
    await expect(read(dataDir, '../../p0-codex-a-rep2/attempt-1/stage1.md')).rejects.toThrow(/越出/)
    // …and one that does not exist refuses the SAME way: a caller must not be
    // able to read «does this file exist» off the difference between the two.
    await expect(read(dataDir, '../../../../nothing-here.md')).rejects.toThrow(/越出/)
  })

  it('refuses a path that climbs out THROUGH A SYMLINK — the case a string check would pass', async () => {
    const { dataDir, attemptDir } = attemptTree({ 'archive/keep.md': 'mine' })
    const outside = tmpTree()
    writeFileSync(join(outside, 'elsewhere.md'), 'another run\'s')
    // Exactly the shape an export could lay down without anyone intending it:
    // a link INSIDE the attempt directory whose target is not.
    symlinkSync(outside, join(attemptDir, 'archive', 'out'))
    await expect(read(dataDir, 'archive/out/elsewhere.md')).rejects.toThrow(/越出/)
    // …and the real file beside it still reads, so the guard is about the
    // target and not about the directory.
    expect((await read(dataDir, 'archive/keep.md')).text).toBe('mine')
  })

  it('refuses an absolute path by SHAPE, before the containment check is the only guard', async () => {
    const { dataDir } = attemptTree({ 'stage1.md': 'mine' })
    await expect(read(dataDir, '/etc/hosts')).rejects.toThrow(/相对路径/)
  })

  it('reports a missing file and a missing attempt directory as absences, not as crashes', async () => {
    const { dataDir } = attemptTree({ 'stage1.md': 'mine' })
    await expect(read(dataDir, 'stage9.md')).rejects.toThrow(/产物不在磁盘上/)
    await expect(read(dataDir, 'stage1.md', 7)).rejects.toThrow(/运行数据目录不在磁盘上/)
  })

  it('refuses when the composition reports no data root at all', async () => {
    await expect(read(undefined, 'stage1.md')).rejects.toThrow(/数据根目录/)
  })
})

describe('EvalService.cellArtifact', () => {
  it('forwards the read, and refuses a cell whose bytes would leave the attempt', async () => {
    const { dataDir } = attemptTree({ 'stage1.md': 'the submission' })
    const service = new EvalService({
      get: (name) => (name === 'mission' ? missionFace(dataDir) : undefined),
    } as never)
    const view = await service.cellArtifact({
      runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'stage1.md',
    })
    expect(view.text).toBe('the submission')
    await expect(service.cellArtifact({
      runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: '../../../..',
    })).rejects.toThrow(/越出/)
  })
})

describe('judgeSessionsOf', () => {
  const annotations = [
    { ns: 'orchestrator', attempt: 1, createdAt: 5, payload: { kind: 'readiness', childSessionId: 'readiness-1' } },
    { ns: 'orchestrator', attempt: 1, createdAt: 10, payload: { kind: 'delegation', stage: 'stage1', childSessionId: 'player-1' } },
    {
      ns: 'orchestrator',
      attempt: 1,
      createdAt: 20,
      payload: {
        kind: 'judge', judgeCondition: 't31-judge-other', judgeModel: 'other/m1',
        sample: 1, attempt: 1, childSessionId: 'judge-1', selfJudged: false,
      },
    },
    {
      ns: 'orchestrator',
      attempt: 1,
      createdAt: 30,
      payload: {
        kind: 'judge', judgeCondition: 't31-judge-twin', judgeModel: null,
        sample: 2, attempt: 1, selfJudged: true, error: 'judge delegation failed to start',
      },
    },
  ]

  it('reports one row per judge round, oldest first, and keeps the round that never started', () => {
    expect(judgeSessionsOf(annotations)).toEqual([
      {
        judgeCondition: 't31-judge-other', judgeModel: 'other/m1', sample: 1, attempt: 1,
        childSessionId: 'judge-1', at: 20, selfJudged: false, error: null,
      },
      {
        judgeCondition: 't31-judge-twin', judgeModel: null, sample: 2, attempt: 1,
        childSessionId: null, at: 30, selfJudged: true, error: 'judge delegation failed to start',
      },
    ])
  })

  it('does not mistake the readiness or delegation rounds for judge rounds', () => {
    const ids = judgeSessionsOf(annotations).map(round => round.childSessionId)
    expect(ids).not.toContain('readiness-1')
    expect(ids).not.toContain('player-1')
  })
})

/**
 * The fallback that used to answer a different question. A cell whose
 * `refs.sessions` is empty falls back to the annotations, and three kinds
 * carry a `childSessionId` — so «the last one» was the JUDGE's session on
 * every judged cell that got there, and the readiness probe's on a refused
 * one. Both are real sessions, so nothing ever failed; 打开子会话 simply
 * opened someone else's transcript.
 */
describe('the player session a cell falls back to', () => {
  const annotations = [
    { ns: 'orchestrator', attempt: 1, createdAt: 5, payload: { kind: 'readiness', childSessionId: 'readiness-1' } },
    { ns: 'orchestrator', attempt: 1, createdAt: 10, payload: { kind: 'delegation', stage: 'stage1', childSessionId: 'player-1' } },
    { ns: 'orchestrator', attempt: 1, createdAt: 12, payload: { kind: 'delegation', stage: 'stage2', childSessionId: 'player-1' } },
    { ns: 'orchestrator', attempt: 1, createdAt: 20, payload: { kind: 'judge', judgeCondition: 'j1', childSessionId: 'judge-1' } },
  ]

  /** A mission face whose one cell records no refs at all. */
  function faceWithoutRefs() {
    return {
      runList: () => [{ id: 'run-1' }],
      runStatus: () => ({
        run: { id: 'run-1', state: 'active', createdAt: 1, meta: {} },
        rows: [{ id: 'c1', labels: { task: 'P0', condition: 'codex-a', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1, enteredCurrentAt: 2 }],
        buckets: { ready: [], scheduled: [], blocked: [], active: [], done: ['c1'] },
        unreleased: [],
      }),
      get: () => ({
        mission: {
          currentAttempt: 1,
          attempts: [{ attempt: 1, state: 'archived', refs: {}, enteredAt: { archived: 2 }, checkpoints: [], artifacts: [], history: [] }],
          annotations,
        },
      }),
      isReleasable: () => false,
    }
  }

  it('names the PLAYER\'s last round, not the judge round that ran after it', async () => {
    const service = new EvalService({ get: (name) => (name === 'mission' ? faceWithoutRefs() : undefined) } as never)
    const detail = await service.cell('run-1', 'c1')
    expect(detail.childSessionId).toBe('player-1')
    // …and the judge's own round is reported under its own name, so nothing
    // was hidden by narrowing the fallback.
    expect(detail.judgeSessions.map(round => round.childSessionId)).toEqual(['judge-1'])
  })
})
