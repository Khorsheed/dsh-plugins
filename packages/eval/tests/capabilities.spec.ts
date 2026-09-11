/**
 * T32 — the capability face as a checkable fact.
 *
 * Three seams meet here: the contract (a `preset` only a composable harness
 * may declare), the lock (`provisioned.capabilities`, what provision
 * measured), and the readiness gate (the claim must have a measurement
 * behind it, checked before any delegation is spent).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conditionLockOf, writeConditionLock } from '../src/provision.ts'
import { conditionDiagnostics, resolveConditionReadiness } from '../src/validate.ts'
import { capabilityRefusal, checkReadiness, type ReadinessSubject } from '../src/readiness.ts'
import { hashConditionDocument } from '../src/hash.ts'
import { LOCK_SCHEMA, PRESET_CAPABLE_HARNESSES, validateJson } from '../src/schema.ts'

const CAPS_SHA = 'a'.repeat(64)
const HOME_SHA = 'b'.repeat(64)

function conditionDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'dataseek.condition/1',
    harness: { name: 'dsh', version: '0.1.5-rc.1', drive: 'exec' },
    model: { declared: 'deepseek-official/deepseek-v4-pro', endpoint: 'https://api.example/v1' },
    reasoning: { effort: 'high' },
    permissions: 'unrestricted',
    instructions: 'none',
    preset: null,
    skills: { pack: null },
    home: { sha: HOME_SHA },
    env: { keys: ['DSH_HOME'] },
    ...over,
  }
}

describe('the preset field is only for a harness this family composes', () => {
  it('accepts a preset on dsh — its sub-profile is what the instance writes', () => {
    const { errors } = conditionDiagnostics(conditionDoc({ preset: 'eval-lean' }))
    expect(errors).toEqual([])
    expect(PRESET_CAPABLE_HARNESSES).toEqual(['dsh'])
  })

  for (const harness of ['codex', 'claude-code', 'kimi'] as const) {
    it(`refuses a preset on ${harness} — an external CLI brings its own composition`, () => {
      const permissions = { codex: 'read-only', 'claude-code': 'normal', kimi: 'auto-approve' }[harness]
      const { errors } = conditionDiagnostics(conditionDoc({
        harness: { name: harness, version: '1.0.0', drive: 'exec' },
        permissions,
        preset: 'eval-lean',
      }))
      expect(errors.map(error => error.code)).toContain('PRESET_NOT_FOR_HARNESS')
      // The message has to name the alternative, or the author's next move is a guess.
      expect(errors.find(error => error.code === 'PRESET_NOT_FOR_HARNESS')?.message).toMatch(/skills\.pack/)
    })

    it(`accepts null on ${harness} — the only legal value there`, () => {
      const permissions = { codex: 'read-only', 'claude-code': 'normal', kimi: 'auto-approve' }[harness]
      const { errors } = conditionDiagnostics(conditionDoc({
        harness: { name: harness, version: '1.0.0', drive: 'exec' },
        permissions,
        preset: null,
      }))
      expect(errors).toEqual([])
    })
  }

  it('leaves an unknown harness alone — degrade, do not explode', () => {
    const { errors } = conditionDiagnostics(conditionDoc({
      harness: { name: 'some-future-cli', version: '1.0.0', drive: 'exec' },
      preset: 'eval-lean',
    }))
    expect(errors.map(error => error.code)).not.toContain('PRESET_NOT_FOR_HARNESS')
  })
})

describe('conditionLockOf — provision writes what it built', () => {
  it('locks the hash alone when provision has built nothing', () => {
    const document = conditionDoc()
    const lock = conditionLockOf('dsh-exec', document)
    expect(lock).toEqual({
      schema: 'dataseek.condition-lock/1',
      condition: 'dsh-exec',
      sha: hashConditionDocument(document),
    })
    // "provision has not run" and "provision ran and built nothing" must not
    // read alike: an empty provisioned block is never written.
    expect('provisioned' in lock).toBe(false)
  })

  it('records the home hash, the preset read back, and the capability fingerprint', () => {
    const document = conditionDoc({ preset: 'eval-lean' })
    const lock = conditionLockOf('dsh-exec-lean', document, {
      homeSha: HOME_SHA,
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', skills: 3, tools: 11 },
    })
    expect(lock.home).toEqual({ sha: HOME_SHA })
    expect(lock.provisioned).toEqual({
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', skills: 3, tools: 11 },
    })
    expect(validateJson(LOCK_SCHEMA, lock)).toEqual([])
  })

  it('refuses a malformed digest — a lock carrying one reads as verified', () => {
    const document = conditionDoc()
    expect(() => conditionLockOf('c', document, { capabilities: { sha: 'not-a-sha' } })).toThrow(/64-hex/)
    expect(() => conditionLockOf('c', document, { homeSha: 'nope' })).toThrow(/64-hex/)
  })

  it('writes the file where validate reads it back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-lock-'))
    await mkdir(join(root, 'conditions'), { recursive: true })
    const document = conditionDoc({ preset: 'eval-lean' })
    await writeFile(join(root, 'conditions', 'dsh-lean.json'), JSON.stringify(document, null, 2), 'utf8')
    const { path } = await writeConditionLock(root, 'dsh-lean', document, {
      homeSha: HOME_SHA,
      preset: 'eval-lean',
      capabilities: { sha: CAPS_SHA, preset: 'eval-lean', skills: 3, tools: 11 },
    })
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)

    const readiness = await resolveConditionReadiness('dsh-lean', root)
    expect(readiness.entry.lock?.capabilities).toEqual({ sha: CAPS_SHA, preset: 'eval-lean' })
    expect(readiness.entry.status).toBe('ready')
    expect(readiness.warnings.map(warning => warning.code)).not.toContain('CAPABILITIES_NOT_PROVISIONED')
  })

  it('warns when a preset condition has a lock with no capability record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-lock-'))
    await mkdir(join(root, 'conditions'), { recursive: true })
    const document = conditionDoc({ preset: 'eval-lean' })
    await writeFile(join(root, 'conditions', 'dsh-lean.json'), JSON.stringify(document, null, 2), 'utf8')
    await writeConditionLock(root, 'dsh-lean', document, { homeSha: HOME_SHA })
    const readiness = await resolveConditionReadiness('dsh-lean', root)
    expect(readiness.warnings.map(warning => warning.code)).toContain('CAPABILITIES_NOT_PROVISIONED')
  })

  it('warns when the capability record was taken under another preset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-lock-'))
    await mkdir(join(root, 'conditions'), { recursive: true })
    const document = conditionDoc({ preset: 'eval-lean' })
    await writeFile(join(root, 'conditions', 'dsh-lean.json'), JSON.stringify(document, null, 2), 'utf8')
    await writeConditionLock(root, 'dsh-lean', document, {
      homeSha: HOME_SHA,
      capabilities: { sha: CAPS_SHA, preset: 'eval-full' },
    })
    const readiness = await resolveConditionReadiness('dsh-lean', root)
    expect(readiness.warnings.map(warning => warning.code)).toContain('CAPABILITIES_PRESET_MISMATCH')
  })
})

describe('capabilityRefusal — the readiness gate on the preset claim', () => {
  const base: ReadinessSubject = { id: 'dsh-lean', harnessName: 'dsh', declaredModel: null, provider: 'dsh-cli' }

  it('passes a condition that claims no preset', () => {
    expect(capabilityRefusal(base)).toBeUndefined()
    expect(capabilityRefusal({ ...base, preset: null })).toBeUndefined()
  })

  it('refuses a declared preset with no measured face', () => {
    expect(capabilityRefusal({ ...base, preset: 'eval-lean' })).toMatch(/never measured/)
  })

  it('refuses a face measured under another preset', () => {
    const reason = capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA, preset: 'eval-full' } })
    expect(reason).toMatch(/another subject/)
  })

  it('passes when the measurement agrees, and when it names no preset at all', () => {
    expect(capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA, preset: 'eval-lean' } })).toBeUndefined()
    expect(capabilityRefusal({ ...base, preset: 'eval-lean', capabilities: { sha: CAPS_SHA } })).toBeUndefined()
  })
})

describe('checkReadiness spends no delegation on an unmeasured preset', () => {
  const localAgent = {
    start: async (): Promise<never> => { throw new Error('the readiness probe must not delegate here') },
    cancel: (): void => {},
    get: (): undefined => undefined,
    delegationOf: (): undefined => undefined,
  }

  it('fails the condition before any start, and carries the reason', async () => {
    const records = await checkReadiness({
      localAgent: localAgent as never,
      conditions: [{ id: 'dsh-lean', harnessName: 'dsh', declaredModel: null, provider: 'dsh-cli', preset: 'eval-lean' }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.ok).toBe(false)
    expect(records[0]?.childSessionId).toBeNull()
    expect(records[0]?.reason).toMatch(/never measured/)
  })

  it('records the measured fingerprint on the verdict when it agrees', async () => {
    const started: string[] = []
    const facade = {
      ...localAgent,
      start: async (parent: string) => {
        started.push(parent)
        return { id: 'child-1', result: Promise.resolve({ stopReason: 'completed' as const, text: 'READY' }) }
      },
    }
    const records = await checkReadiness({
      localAgent: facade as never,
      conditions: [{
        id: 'dsh-lean',
        harnessName: 'dsh',
        declaredModel: null,
        provider: 'dsh-cli',
        preset: 'eval-lean',
        capabilities: { sha: CAPS_SHA, preset: 'eval-lean' },
      }],
      parentSessionId: 'session-1',
      probeDirBase: mkdtempSync(join(tmpdir(), 'eval-readiness-')),
      readbackWaitMs: 0,
    })
    expect(started).toEqual(['session-1'])
    expect(records[0]?.ok).toBe(true)
    expect(records[0]?.capabilities).toEqual({ sha: CAPS_SHA, preset: 'eval-lean' })
  })
})
