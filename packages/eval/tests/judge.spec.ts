/**
 * The judging kernel in isolation: de-fingerprinting, rubric reading, probe
 * and rubric discovery, and prompt assembly. The wired-up behaviour (double
 * sampling, probe exit codes, the retry, the archive gate) lives in
 * run.spec.ts against the fakes; here only the pure functions are pinned.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildDeidentifyRules,
  buildJudgePrompt,
  fencedMaterial,
  judgePromptSegments,
  materialFence,
  deidentify,
  llmDraftCriteria,
  mergeReplacements,
  pickRubricPath,
  probePaths,
  HARNESS_ALIASES,
} from '../src/judge.ts'

describe('de-fingerprinting (frozen decision 9)', () => {
  it('replaces harness, CLI and self-reported names with <harness>', () => {
    const rules = buildDeidentifyRules()
    const { text, replacements } = deidentify(
      'I am Codex. Claude Code and kimi disagree; dsh (the DeepSeek Harness) is a fourth.',
      rules,
    )
    expect(text).toBe('I am <harness>. <harness> and <harness> disagree; <harness> (the <harness>) is a fourth.')
    // "I am Codex" needs no sentence pattern: the self-reported name IS an alias.
    expect(replacements.find(row => row.pattern === 'codex')).toEqual({ pattern: 'codex', replacement: '<harness>', count: 1 })
  })

  it('replaces the run’s model identifiers with <model>, longest literal first', () => {
    const rules = buildDeidentifyRules({ models: ['deepseek-chat', 'deepseek-reasoner', null, undefined, ''] })
    const { text, replacements } = deidentify('deepseek-reasoner beat deepseek-chat, and plain deepseek is the vendor.', rules)
    expect(text).toBe('<model> beat <model>, and plain <harness> is the vendor.')
    const patterns = replacements.map(row => row.pattern)
    // The specific model is consumed before the family name it contains.
    expect(patterns.indexOf('deepseek-reasoner')).toBeLessThan(patterns.indexOf('deepseek'))
  })

  it('is boundary-guarded: identifier-adjacent hits count, word-internal ones do not', () => {
    const rules = buildDeidentifyRules()
    const { text } = deidentify('dsh-eval and (dsh) and /dsh/ are fingerprints; wordsh and dshx are not.', rules)
    expect(text).toBe('<harness>-eval and (<harness>) and /<harness>/ are fingerprints; wordsh and dshx are not.')
  })

  it('is case-insensitive and counts every hit', () => {
    const rules = buildDeidentifyRules()
    const { text, total } = deidentify('CODEX, Codex, codex', rules)
    expect(text).toBe('<harness>, <harness>, <harness>')
    expect(total).toBe(3)
  })

  it('accepts a harness the module has never heard of, via the plan’s conditions', () => {
    expect(deidentify('acme-cli shipped it', buildDeidentifyRules()).text).toBe('acme-cli shipped it')
    expect(deidentify('acme-cli shipped it', buildDeidentifyRules({ harnesses: ['acme-cli'] })).text).toBe('<harness> shipped it')
  })

  it('leaves material with no fingerprints completely alone', () => {
    const clean = 'The room keeps one shared transcript; members join and leave explicitly.\n'
    const { text, replacements, total } = deidentify(clean, buildDeidentifyRules({ models: ['gpt-x'] }))
    expect(text).toBe(clean)
    expect(replacements).toEqual([])
    expect(total).toBe(0)
  })

  it('merges the per-file tables into one, ordered by count', () => {
    const rules = buildDeidentifyRules({ models: ['gpt-x'] })
    const merged = mergeReplacements([
      deidentify('codex codex gpt-x', rules).replacements,
      deidentify('codex kimi', rules).replacements,
    ])
    expect(merged).toEqual([
      { pattern: 'codex', replacement: '<harness>', count: 3 },
      { pattern: 'gpt-x', replacement: '<model>', count: 1 },
      { pattern: 'kimi', replacement: '<harness>', count: 1 },
    ])
  })

  it('covers all four harnesses of the pilot', () => {
    for (const name of ['dsh', 'claude-code', 'codex', 'kimi']) {
      expect(HARNESS_ALIASES).toContain(name)
    }
  })
})

describe('rubric reading — only kind: llm-draft reaches the judge', () => {
  const RUBRIC = `schema_version: dataseek.rubric/2
rubric_id: F2-default
items:
  - {id: A1-1, axis: A1, weight: 3, kind: llm-draft,
     criterion: 设计中存在一份共享上下文, evidence: "stage1.md"}
  - {id: A2-1, axis: A3, weight: 3, kind: objective,
     criterion: "out_of_scope 非空", evidence: "stage1.json:out_of_scope"}
  - {id: A3-2, axis: D1, weight: 4, kind: human,
     criterion: 标出的风险点确属真实风险, evidence: "stage1.json"}
  - {id: A-N1, axis: D1, weight: -3, kind: llm-draft, negative: true,
     criterion: 存在需改宿主的交互却未列入风险, evidence: "stage1.md", note: 对照 host_change_risks}
  - {id: X-veto, axis: D1, weight: 0, kind: llm-draft, veto: true,
     criterion: 改动了 harness 源码, evidence: "git status"}
`

  it('keeps the llm-draft rows in document order, with their marks', () => {
    const criteria = llmDraftCriteria(RUBRIC)
    expect(criteria.map(c => c.id)).toEqual(['A1-1', 'A-N1', 'X-veto'])
    expect(criteria[0]).toEqual({ id: 'A1-1', criterion: '设计中存在一份共享上下文', kind: 'llm-draft', evidence: 'stage1.md', weight: 3 })
    expect(criteria[1]?.negative).toBe(true)
    expect(criteria[1]?.note).toBe('对照 host_change_risks')
    expect(criteria[2]?.veto).toBe(true)
  })

  it('returns nothing for a rubric with no llm-draft rows, or no items at all', () => {
    expect(llmDraftCriteria('items:\n  - {id: A, kind: objective, criterion: x}\n')).toEqual([])
    expect(llmDraftCriteria('rubric_id: empty\n')).toEqual([])
  })

  it('skips malformed rows instead of failing the whole rubric', () => {
    expect(llmDraftCriteria('items:\n  - {kind: llm-draft, criterion: no id}\n  - {id: ok, kind: llm-draft, criterion: fine}\n')
      .map(c => c.id)).toEqual(['ok'])
  })
})

describe('discovery in the grading and verify layers', () => {
  it('finds the rubric in both item layouts, shortest path winning', () => {
    expect(pickRubricPath(['rubric.md', 'rubric.yml', 'oracle/notes.md'])).toBe('rubric.yml')
    expect(pickRubricPath(['answers/oracle/notes.md', 'answers/rubric.yml'])).toBe('answers/rubric.yml')
    expect(pickRubricPath(['deep/nested/rubric.yaml', 'rubric.yaml'])).toBe('rubric.yaml')
    expect(pickRubricPath(['standards-notes.yml', 'oracle/notes.md'])).toBeNull()
  })

  it('finds probes under any probes/ segment, and only executables', () => {
    expect(probePaths([
      'probes/room-identity.mjs',
      'checks/probes/no-patch.sh',
      'probes/README.md',
      'probes/manual-observation.md',
      'checklist.yml',
      'shared/helper.mjs',
    ])).toEqual(['checks/probes/no-patch.sh', 'probes/room-identity.mjs'])
    expect(probePaths(['checklist.yml', 'no-break/README.md'])).toEqual([])
  })
})

describe('the judge prompt', () => {
  const prompt = buildJudgePrompt({
    taskId: 'F2-multi-agent-room',
    judgeConditionId: 'judge-r1',
    criteria: [
      { id: 'A1-1', criterion: '存在共享上下文', kind: 'llm-draft', evidence: 'stage1.md' },
      { id: 'A-N1', criterion: '未列入风险', kind: 'llm-draft', negative: true },
    ],
    materials: [
      { path: 'stage1.json', text: '{ "design_decisions": [] }' },
      { path: 'stage1.md', text: '# design\n' },
    ],
  })

  it('carries the criteria, the material, and the output contract', () => {
    expect(prompt).toContain('### A1-1')
    expect(prompt).toContain('判据：存在共享上下文')
    expect(prompt).toContain('证据位置：stage1.md')
    expect(prompt).toContain('### A-N1（负分项）')
    expect(prompt).toContain('### stage1.json')
    expect(prompt).toContain('"schema": "dataseek.verdict/1"')
    expect(prompt).toContain('"task": "F2-multi-agent-room"')
    expect(prompt).toContain('"by": "judge-r1"')
    expect(prompt).toContain('verdicts.json')
  })

  it('tells the judge the material is de-identified and not to guess', () => {
    expect(prompt).toContain('<harness>')
    expect(prompt).toContain('不要推测材料出自哪一家')
  })

  it('is deterministic — the same inputs hash to the same prompt', () => {
    const again = buildJudgePrompt({
      taskId: 'F2-multi-agent-room',
      judgeConditionId: 'judge-r1',
      criteria: [
        { id: 'A1-1', criterion: '存在共享上下文', kind: 'llm-draft', evidence: 'stage1.md' },
        { id: 'A-N1', criterion: '未列入风险', kind: 'llm-draft', negative: true },
      ],
      materials: [
        { path: 'stage1.json', text: '{ "design_decisions": [] }' },
        { path: 'stage1.md', text: '# design\n' },
      ],
    })
    expect(again).toBe(prompt)
  })
})

describe('the judge prompt fence (T85)', () => {
  const criteria = [{ id: 'A1-1', criterion: '存在共享上下文', kind: 'llm-draft' as const, evidence: 'stage1.md' }]
  const build = (text: string): string => buildJudgePrompt({
    taskId: 'F2', judgeConditionId: 'judge-r1', criteria, materials: [{ path: 'stage1.md', text }],
  })

  it('plain material keeps the ``` fence, byte for byte as before (promptSha unchanged)', () => {
    const prompt = buildJudgePrompt({
      taskId: 'F2-multi-agent-room',
      judgeConditionId: 'judge-r1',
      criteria: [
        { id: 'A1-1', criterion: '存在共享上下文', kind: 'llm-draft', evidence: 'stage1.md' },
        { id: 'A-N1', criterion: '未列入风险', kind: 'llm-draft', negative: true },
      ],
      materials: [
        { path: 'stage1.json', text: '{ "design_decisions": [] }' },
        { path: 'stage1.md', text: '# design\n\nuse `x` and ``y``\n' },
      ],
    })
    // Recorded from the builder before T85 changed it.
    expect(createHash('sha256').update(prompt, 'utf8').digest('hex')).toBe('2adb71d8cf18109f5ddaf81a1ac78f714b1635337e3458772a7b0104e22b307d')
    expect(prompt).toContain('```markdown\n# design\n\nuse `x` and ``y``\n```\n')
  })

  it('material holding ``` gets a four-backtick fence that the inner fence cannot close', () => {
    const text = '# design\n\n```ts\nconst a = 1\n```\n\nafter the block'
    expect(materialFence(text)).toBe('````')
    expect(build(text)).toContain(`\`\`\`\`markdown\n${text}\n\`\`\`\`\n`)
  })

  it('material holding ```` gets a five-backtick fence', () => {
    const text = 'quoting a fence:\n````md\n```\n````'
    expect(materialFence(text)).toBe('`````')
    expect(fencedMaterial('stage1.json', text)).toBe(`\`\`\`\`\`json\n${text}\n\`\`\`\`\``)
  })

  it('the segments are the same template: filling the slots gives the prompt', () => {
    const materials = [{ path: 'stage1.json', text: '{}' }, { path: 'stage1.md', text: '```x```' }]
    const segments = judgePromptSegments({ taskId: 'F2', judgeConditionId: 'j', criteria, materialPaths: materials.map(m => m.path) })
    expect(segments.filter(segment => segment.kind === 'material')).toEqual([{ kind: 'material', path: 'stage1.json' }, { kind: 'material', path: 'stage1.md' }])
    let next = 0
    const filled = segments.map(segment => (segment.kind === 'text' ? segment.text : fencedMaterial(materials[next]!.path, materials[next++]!.text))).join('\n')
    expect(filled).toBe(buildJudgePrompt({ taskId: 'F2', judgeConditionId: 'j', criteria, materials }))
  })
})
