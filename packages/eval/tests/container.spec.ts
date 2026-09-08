/**
 * The container path's parts, each against a fake of exactly one seam.
 *
 * The whole-loop test (a plan with a unit segment driven end to end against a
 * fake lab) lives in run.spec.ts, beside the host-path loop it must not
 * disturb. What is here is the machinery that loop is built from: the data
 * layer that turns a plan and a condition into ONE acquire spec, the credential
 * directory check, the probe executor that runs §6.7 inside a unit, and the
 * readiness probe's throwaway unit.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LabAcquireSpec, LabFace, LabUnitInfo, LabVerifyResult, LocalAgentFace } from '../src/faces.ts'
import {
  acquireSpecFor, checkCredentialsDir, conditionOwnedComponents, conditionUnitDiagnostics,
  describeAcquireSpec, environmentClassComponents, planUnitOf, resolveCellUnit, unitUid,
  UNIT_VERDICTS_DIR, UNIT_WORKSPACE,
} from '../src/unit.ts'
import { unitProbeExecutor } from '../src/probe-exec.ts'
import { checkReadiness, READINESS_PROMPT, type ReadinessUnit } from '../src/readiness.ts'

const tmpDirs: string[] = []
function tmpTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-unit-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const CODEX_CONDITION = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.9.1', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: null },
  reasoning: { effort: 'high' },
  permissions: 'danger-full-access',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: null },
  env: { keys: ['CODEX_HOME'] },
  unit: { scopedHome: { container: '/creds/codex', var: 'CODEX_HOME' } },
}

const PLAN_UNIT = { image: 'eval-env:pinned', network: 'eval-net', user: '1000', resources: { cpus: '2', memory: '4g' } }

describe('the plan/condition split that produces one acquire spec', () => {
  it('reads the plan segment only when it names an image', () => {
    expect(planUnitOf({ unit: PLAN_UNIT })?.image).toBe('eval-env:pinned')
    expect(planUnitOf({ unit: { network: 'eval-net' } })).toBeNull()
    expect(planUnitOf({})).toBeNull()
  })

  it('declares exactly one mount and exactly the environment the unit needs', () => {
    const resolved = resolveCellUnit(PLAN_UNIT, 'codex-exec', CODEX_CONDITION, '/host/homes/codex')
    expect(resolved.ok).toBe(true)
    const spec = acquireSpecFor((resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan, { missionId: 'm-1', runId: 'r-1' })
    // One mount: four credential directories in one container would show every
    // player the other three's credentials — a leak AND an asymmetry. The
    // source is the harness's own scoped home, verbatim: mounting a COPY is
    // what broke the read-back, because the CLI then writes its rollout where
    // nothing looks for it.
    expect(spec.mounts).toEqual([{ source: '/host/homes/codex', target: '/creds/codex', type: 'bind' }])
    expect(spec.env).toEqual({ CODEX_HOME: '/creds/codex' })
    expect(spec).toMatchObject({
      image: 'eval-env:pinned',
      network: 'eval-net',
      user: '1000',
      resources: { cpus: '2', memory: '4g' },
      workdir: UNIT_WORKSPACE,
      ownWorkdir: true,
      missionId: 'm-1',
      runId: 'r-1',
    })
  })

  it('gives dsh — and only dsh — the node flag its HTTP client needs behind a proxy', () => {
    const dsh = { ...CODEX_CONDITION, harness: { name: 'dsh', version: null, drive: 'exec' }, permissions: 'unrestricted', env: { keys: ['DSH_HOME'] }, unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } } }
    const resolved = resolveCellUnit(PLAN_UNIT, 'dsh-exec', dsh, '/host/homes/dsh')
    const spec = acquireSpecFor((resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan)
    expect(spec.env).toEqual({ DSH_HOME: '/creds/dsh', NODE_OPTIONS: '--use-env-proxy' })
    const codex = resolveCellUnit(PLAN_UNIT, 'codex-exec', CODEX_CONDITION, '/host/homes/codex')
    expect(acquireSpecFor((codex as { plan: Parameters<typeof acquireSpecFor>[0] }).plan).env).not.toHaveProperty('NODE_OPTIONS')
  })

  it('refuses a condition with no scoped home, and one whose variable it never declared', () => {
    const { unit: _dropped, ...noUnit } = CODEX_CONDITION
    expect(conditionUnitDiagnostics('codex-exec', noUnit).map(d => d.code)).toEqual(['UNIT_SCOPED_HOME_MISSING'])
    const undeclared = { ...CODEX_CONDITION, env: { keys: ['OPENAI_API_KEY'] } }
    expect(conditionUnitDiagnostics('codex-exec', undeclared).map(d => d.code)).toEqual(['UNIT_SCOPED_HOME_VAR_UNDECLARED'])
    const relative = { ...CODEX_CONDITION, unit: { scopedHome: { container: 'creds/codex', var: 'CODEX_HOME' } } }
    expect(conditionUnitDiagnostics('codex-exec', relative).map(d => d.code)).toEqual(['UNIT_SCOPED_HOME_RELATIVE'])
  })

  it('prints a spec with env NAMES and no values', () => {
    const resolved = resolveCellUnit(PLAN_UNIT, 'codex-exec', CODEX_CONDITION, '/host/homes/codex')
    const described = describeAcquireSpec(acquireSpecFor((resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan))
    expect(described['envKeys']).toEqual(['CODEX_HOME'])
    // Names, never the map: the mount TARGET is reviewable (it is what the
    // condition declared), an env VALUE is not printed even when it happens
    // to be the same path.
    expect(described).not.toHaveProperty('env')
    expect(described).toMatchObject({ image: 'eval-env:pinned', network: 'eval-net', user: '1000' })
  })

  it('reads a numeric uid out of a lab user string and nothing out of a name', () => {
    expect(unitUid('1000')).toBe(1000)
    expect(unitUid('1000:1000')).toBe(1000)
    expect(unitUid('node')).toBeNull()
    expect(unitUid(undefined)).toBeNull()
  })
})

describe('the credential directory check (existence, emptiness, owner — never contents)', () => {
  it('accepts a staged directory owned by this process, and says why that is allowed', () => {
    const root = tmpTree()
    const dir = join(root, 'codex-exec')
    mkdirSync(dir)
    writeFileSync(join(dir, 'auth.json'), '{}\n')
    const self = process.getuid?.() ?? 0
    const check = checkCredentialsDir(dir, 'codex-exec', 1000, self)
    expect(check.ok).toBe(true)
    expect(check.entries).toBe(1)
    expect(check.ownerNote).toContain('remap')
  })

  it('refuses a directory that does not exist, and one that is empty', () => {
    const root = tmpTree()
    expect(checkCredentialsDir(join(root, 'nope'), 'codex-exec', 1000, 0).reason).toContain('does not exist')
    const empty = join(root, 'codex-exec')
    mkdirSync(empty)
    const check = checkCredentialsDir(empty, 'codex-exec', 1000, process.getuid?.() ?? 0)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('empty')
  })

  it('refuses a third-party owner — the case where the unit cannot write its refreshed token back', () => {
    const root = tmpTree()
    const dir = join(root, 'codex-exec')
    mkdirSync(dir)
    writeFileSync(join(dir, 'auth.json'), '{}\n')
    chmodSync(dir, 0o700)
    // Neither the unit's uid nor this process's: on a host that passes uids
    // through, that directory is unreadable from inside the unit.
    const check = checkCredentialsDir(dir, 'codex-exec', 1000, (process.getuid?.() ?? 0) + 7)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('neither the unit')
  })
})

/** A lab face that records every call and answers from a script. */
function fakeLab(script: {
  verify?: (unitId: string, options: { command: string[]; source?: string; timeoutMs?: number }) => LabVerifyResult
  collect?: () => void
} = {}): { lab: LabFace; calls: Array<{ verb: string; args: unknown[] }> } {
  const calls: Array<{ verb: string; args: unknown[] }> = []
  const record = (verb: string, ...args: unknown[]): void => { calls.push({ verb, args }) }
  const lab: LabFace = {
    async acquire(spec: LabAcquireSpec): Promise<LabUnitInfo> {
      record('acquire', spec)
      return { id: 'u1', provider: 'docker', resource: 'dsh-lab-u1', fingerprint: 'lab-env:deadbeef', workspace: UNIT_WORKSPACE, createdAt: 0 }
    },
    async populate(unitId, options) { record('populate', unitId, options); return { sha: 'x', count: 0, files: [] } },
    async collect(unitId, options) { record('collect', unitId, options); script.collect?.() },
    async checkpoint(unitId, options) { record('checkpoint', unitId, options); return { ref: 'c'.repeat(40) } },
    async verify(unitId, options) {
      record('verify', unitId, options)
      return script.verify?.(unitId, options) ?? { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false }
    },
    async archive(unitId, options) { record('archive', unitId, options) },
    fingerprintOf(components) { record('fingerprintOf', components); return `lab-env:${JSON.stringify(components).length}` },
    async release(unitId, options) { record('release', unitId, options) },
    async status() { record('status'); return [] },
  }
  return { lab, calls }
}

const EXECUTION = { file: 'items/P0/verify/probes/one.mjs', shell: false, cwd: 'items/P0/verify', slug: 'probes-one.mjs', rubric: '.rubric.yml', timeoutMs: 5000 }

describe('the probe executor that runs §6.7 inside the unit', () => {
  it('hands the judging directory to verify as material and points the probe at the workspace', async () => {
    const { lab, calls } = fakeLab()
    const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/host/judging', collectDir: '/host/out', artifactPath: 'probe-verdicts' })
    await executor.run(EXECUTION)
    const verify = calls.find(call => call.verb === 'verify')?.args[1] as { command: string[]; source?: string }
    expect(verify.source).toBe('/host/judging')
    const script = verify.command[2] as string
    expect(verify.command.slice(0, 2)).toEqual(['sh', '-c'])
    expect(script).toContain("--cell '/workspace'")
    expect(script).toContain("cd '/run/dsh-lab/verify/items/P0/verify'")
    expect(script).toContain("exec node '/run/dsh-lab/verify/items/P0/verify/probes/one.mjs'")
    expect(script).toContain("--rubric '/run/dsh-lab/verify/.rubric.yml'")
    // The verdicts land OUTSIDE the workspace: the archive is the player's
    // work, and judging output in it would be in every bundle forever.
    expect(script).toContain(`--out '${UNIT_VERDICTS_DIR}/probes-one.mjs/verdicts.json'`)
    expect(script).not.toContain(`--out '${UNIT_WORKSPACE}`)
  })

  it('runs a .sh probe with sh and a .mjs probe with node', async () => {
    const { lab, calls } = fakeLab()
    const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/host/judging', collectDir: '/host/out', artifactPath: 'probe-verdicts' })
    await executor.run({ ...EXECUTION, file: 'verify/probes/no-patch.sh', shell: true, slug: 'shared-probes-no-patch.sh' })
    expect(calls[0]?.args[1]).toMatchObject({ command: ['sh', '-c', expect.stringContaining('exec sh ') as unknown as string] })
  })

  it('carries the three exit states through verbatim, and reports a timeout as no exit code at all', async () => {
    for (const [exitCode, expected] of [[0, 0], [3, 3], [1, 1]] as const) {
      const { lab } = fakeLab({ verify: () => ({ exitCode, stdout: '', stderr: 'said something', durationMs: 2, timedOut: false }) })
      const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/j', collectDir: '/o', artifactPath: 'p' })
      const result = await executor.run(EXECUTION)
      expect(result.code).toBe(expected)
      expect(result.stderr).toBe('said something')
      expect(result.spawnError).toBeUndefined()
    }
    const { lab } = fakeLab({ verify: () => ({ exitCode: -1, stdout: '', stderr: '', durationMs: 5000, timedOut: true }) })
    const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/j', collectDir: '/o', artifactPath: 'p' })
    const timedOut = await executor.run(EXECUTION)
    expect(timedOut.code).toBeNull()
    expect(timedOut.spawnError).toContain('exceeded')
  })

  it('collects the whole verdict tree ONCE, as one registered artifact', async () => {
    const { lab, calls } = fakeLab()
    const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/j', collectDir: '/o', artifactPath: 'probe-verdicts' })
    await executor.run(EXECUTION)
    await executor.run({ ...EXECUTION, slug: 'probes-two.mjs' })
    expect(await executor.collect()).toEqual({ ok: true })
    const collects = calls.filter(call => call.verb === 'collect')
    expect(collects).toHaveLength(1)
    expect(collects[0]?.args[1]).toEqual({ source: UNIT_VERDICTS_DIR, target: '/o', kind: 'probe-verdicts', artifactPath: 'probe-verdicts' })
    expect(executor.outFile(EXECUTION)).toBe(join('/o', 'probes-one.mjs', 'verdicts.json'))
  })

  it('does not ask for a directory it never created, and reports a failed collect instead of throwing', async () => {
    const { lab, calls } = fakeLab({ collect: () => { throw new Error('no such directory') } })
    const idle = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/j', collectDir: '/o', artifactPath: 'p' })
    expect(await idle.collect()).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
    const ran = unitProbeExecutor({ lab, unitId: 'u1', probeDir: '/j', collectDir: '/o', artifactPath: 'p' })
    await ran.run(EXECUTION)
    expect(await ran.collect()).toEqual({ ok: false, error: 'no such directory' })
  })

  it('removes the in-unit verdict directory when it is done with it', async () => {
    const { lab, calls } = fakeLab()
    const executor = unitProbeExecutor({ lab, unitId: 'u1', probeDir: tmpTree(), collectDir: '/o', artifactPath: 'p' })
    await executor.run(EXECUTION)
    await executor.discard()
    const last = calls[calls.length - 1]
    expect(last?.verb).toBe('verify')
    expect((last?.args[1] as { command: string[] }).command[2]).toBe(`rm -rf '${UNIT_VERDICTS_DIR}'`)
  })
})

/** A localAgent face that records how each delegation was addressed. */
function fakeAgent(): { agent: LocalAgentFace; starts: Array<Record<string, unknown>> } {
  const starts: Array<Record<string, unknown>> = []
  return {
    starts,
    agent: {
      async start(_parent, provider, prompt, options) {
        starts.push({ provider, text: prompt[0]?.text, ...options })
        return { id: `child-${starts.length}`, result: Promise.resolve({ stopReason: 'completed' }) }
      },
      async resume() { throw new Error('the readiness probe never resumes') },
      cancel: () => true,
      get: () => ({ delegationProvider: 'subagent_codex' }),
    },
  }
}

describe('the readiness probe inside a throwaway unit', () => {
  const subject = { id: 'codex-exec', harnessName: 'codex', declaredModel: null, provider: 'subagent_codex' }

  it('runs the probe in the unit, never passes a host cwd, and releases whatever happened', async () => {
    const { agent, starts } = fakeAgent()
    let released = 0
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subject],
      parentSessionId: 'sess',
      probeDirBase: join(tmpTree(), 'readiness'),
      unitFor: async (): Promise<ReadinessUnit> => ({
        exec: { container: 'dsh-lab-probe', workdir: UNIT_WORKSPACE, env: { CODEX_HOME: '/creds/codex' } },
        fingerprint: 'lab-env:deadbeef',
        release: async () => { released += 1 },
      }),
    })
    expect(starts[0]).toMatchObject({ exec: { container: 'dsh-lab-probe', workdir: UNIT_WORKSPACE } })
    expect(starts[0]?.['text']).toBe(READINESS_PROMPT)
    // Inside a unit the host cwd means nothing, so it is not sent at all.
    expect(starts[0]).not.toHaveProperty('cwd')
    expect(records[0]?.ok).toBe(true)
    expect(records[0]?.unit).toEqual({ resource: 'dsh-lab-probe', fingerprint: 'lab-env:deadbeef' })
    expect(released).toBe(1)
  })

  it('releases the unit even when the delegation faults', async () => {
    let released = 0
    const agent: LocalAgentFace = {
      async start() { throw new Error('spawn refused') },
      async resume() { throw new Error('never') },
      cancel: () => true,
      get: () => ({ delegationProvider: 'subagent_codex' }),
    }
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subject],
      parentSessionId: 'sess',
      probeDirBase: join(tmpTree(), 'readiness'),
      unitFor: async (): Promise<ReadinessUnit> => ({
        exec: { container: 'dsh-lab-probe', workdir: UNIT_WORKSPACE },
        fingerprint: 'lab-env:deadbeef',
        release: async () => { released += 1 },
      }),
    })
    expect(records[0]?.ok).toBe(false)
    expect(released).toBe(1)
  })

  it('reports a unit it could not acquire as an unready condition, not as a crash', async () => {
    const { agent, starts } = fakeAgent()
    const records = await checkReadiness({
      localAgent: agent,
      conditions: [subject],
      parentSessionId: 'sess',
      probeDirBase: join(tmpTree(), 'readiness'),
      unitFor: async () => { throw new Error('maxConcurrentUnits reached') },
    })
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.reason).toContain('maxConcurrentUnits reached')
    expect(starts).toHaveLength(0)
  })
})

describe('the environment CLASS: the plan\'s environment, without each condition\'s own', () => {
  const COMPONENTS = {
    version: 1,
    image: 'registry/eval-env@sha256:abc',
    resources: { cpus: '2', memory: '4294967296' },
    mounts: [
      { target: '/creds/codex', type: 'bind', readonly: false },
      { target: '/input', type: 'bind', readonly: true },
    ],
    envKeys: ['CODEX_HOME', 'EVAL_SEED', 'OPENAI_BASE_URL'],
    network: 'eval-net',
    user: '1000',
  }

  it('drops the condition\'s scoped-home mount, its variable, its harness extras and its declared keys', () => {
    const resolved = resolveCellUnit(PLAN_UNIT, 'codex-exec', { ...CODEX_CONDITION, env: { keys: ['CODEX_HOME', 'OPENAI_BASE_URL'] } }, '/host/homes/codex')
    const owned = conditionOwnedComponents((resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan, { ...CODEX_CONDITION, env: { keys: ['CODEX_HOME', 'OPENAI_BASE_URL'] } })
    expect(owned).toEqual({ mountTargets: ['/creds/codex'], envKeys: ['CODEX_HOME', 'OPENAI_BASE_URL'] })
    const { components, excluded } = environmentClassComponents(COMPONENTS, owned)
    // What the PLAN declared survives; what the condition brought does not.
    expect(components.mounts).toEqual([{ target: '/input', type: 'bind', readonly: true }])
    expect(components.envKeys).toEqual(['EVAL_SEED'])
    expect(components).toMatchObject({ version: 1, image: COMPONENTS.image, network: 'eval-net', user: '1000', resources: COMPONENTS.resources })
    expect(excluded).toEqual({ mounts: ['/creds/codex'], envKeys: ['CODEX_HOME', 'OPENAI_BASE_URL'] })
  })

  it('drops dsh\'s node flag too — a harness extra is the condition\'s, not the plan\'s', () => {
    const dsh = { ...CODEX_CONDITION, harness: { name: 'dsh', version: null, drive: 'exec' }, permissions: 'unrestricted', env: { keys: ['DSH_HOME'] }, unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } } }
    const resolved = resolveCellUnit(PLAN_UNIT, 'dsh-exec', dsh, '/host/homes/codex')
    const owned = conditionOwnedComponents((resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan, dsh)
    expect(owned.envKeys).toEqual(['DSH_HOME', 'NODE_OPTIONS'])
  })

  it('leaves version alone: the class is the same hashing rule over fewer components', () => {
    const { components } = environmentClassComponents(COMPONENTS, { mountTargets: [], envKeys: [] })
    expect(components).toEqual(COMPONENTS)
  })

  it('four conditions that differ only in their scoped home share one class and no unit fingerprint', () => {
    const harnesses = [
      { id: 'codex-exec', name: 'codex', permissions: 'danger-full-access', container: '/creds/codex', var: 'CODEX_HOME' },
      { id: 'claude-exec', name: 'claude-code', permissions: 'skip', container: '/creds/claude', var: 'CLAUDE_CONFIG_DIR' },
      { id: 'kimi-exec', name: 'kimi', permissions: 'auto-approve', container: '/creds/kimi', var: 'KIMI_CODE_HOME' },
      { id: 'dsh-exec', name: 'dsh', permissions: 'unrestricted', container: '/creds/dsh', var: 'DSH_HOME' },
    ]
    // Stand-in for lab's hashing rule; what matters here is only that it is a
    // function of the components, which is what the real one is.
    const hash = (components: unknown): string => `lab-env:${JSON.stringify(components).length}:${JSON.stringify(components)}`
    const classes = new Set<string>()
    const units = new Set<string>()
    for (const harness of harnesses) {
      const condition = {
        ...CODEX_CONDITION,
        harness: { name: harness.name, version: null, drive: 'exec' },
        permissions: harness.permissions,
        env: { keys: [harness.var] },
        unit: { scopedHome: { container: harness.container, var: harness.var } },
      }
      const resolved = resolveCellUnit(PLAN_UNIT, harness.id, condition, '/host/homes/codex')
      const plan = (resolved as { plan: Parameters<typeof acquireSpecFor>[0] }).plan
      const spec = acquireSpecFor(plan)
      // The unit's own components, as lab would compute them from that spec.
      const components = {
        version: 1,
        image: 'registry/eval-env@sha256:abc',
        resources: { cpus: '2', memory: '4294967296' },
        mounts: (spec.mounts ?? []).map(mount => ({ target: mount.target, type: mount.type ?? 'bind', readonly: mount.readonly === true })),
        envKeys: Object.keys(spec.env ?? {}).sort(),
        network: 'eval-net',
        user: '1000',
      }
      units.add(hash(components))
      classes.add(hash(environmentClassComponents(components, conditionOwnedComponents(plan, condition)).components))
    }
    // The whole point: four units, one environment. Before the class, this run
    // read `violated` and the report refused to compare anything.
    expect(units.size).toBe(4)
    expect(classes.size).toBe(1)
  })
})
