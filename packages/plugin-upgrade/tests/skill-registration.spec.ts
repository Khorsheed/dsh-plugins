// The plugin-upgrade skill registration: pull-based upgrade runbook.
// `apply(ctx)` registers it once the `skills` service is ready via
// `ctx.inject(['skills'], …)` — it waits for the registry rather than probing
// it synchronously at apply time. The bundle carries reference docs and the
// restart supervisor template beside SKILL.md, so the registration must point
// `resourceBase` at the bundle directory (the capability-catalog source
// browser lists it from there).

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

interface Registered {
  name: string
  description: string
  content: string
  source?: string
  provider?: string
  resourceBase?: { kind: 'directory'; path: string }
}

async function registerInto(): Promise<Registered[]> {
  const ctx = new Context()
  const registrations: Registered[] = []
  ctx.provide('skills', {
    register: (skill: Registered) => { registrations.push(skill); return () => {} },
  } as never)
  apply(ctx)
  await new Promise(r => setTimeout(r, 0))
  return registrations
}

describe('plugin-upgrade skill registration', () => {
  it('registers the skill into a real SkillRegistry catalog once the service is ready', async () => {
    const ctx = new Context()
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    const registry = new SkillRegistry(ctx as never)
    apply(ctx)
    // The inject callback runs after the registry is present; await a tick.
    await new Promise(r => setTimeout(r, 0))
    const names = (await registry.list({ cwd: '/' })).map(s => s.name)
    expect(names).toContain('plugin-upgrade')
  })

  it('the registered skill carries the runbook body + bundle resourceBase', async () => {
    const registrations = await registerInto()
    expect(registrations.map(skill => skill.name)).toEqual(['plugin-upgrade'])
    const reg = registrations[0]
    // The description is the pull-based trigger: user intent, not jargon.
    expect(reg?.description).toMatch(/upgrade/i)
    expect(reg?.description).toContain('instance')
    // The body carries the runbook's spine.
    expect(reg?.content).toContain('Never modify the running host')
    expect(reg?.content).toContain('Probe features, never version numbers')
    expect(reg?.content).toContain('reference/breakage-checklist.md')
    expect(reg?.content).toContain('reference/dual-host-fix-patterns.md')
    expect(reg?.content).toContain('assets/restart-resume.sh')
    expect(reg?.content).toMatch(/zero plugin\s+errors in the browser console/)
    expect(reg?.content).toContain('handoff note')
    // No machine-specific path from the dev environment it was written on.
    expect(reg?.content).not.toContain('code/dsh-plugins')
    expect(reg?.content).not.toContain('/Users/')
    // The registry validates `source` at LOAD time — pin it (the ankh-guard 8.9 bug).
    expect(reg?.source).toBe('runtime')
    expect(reg?.provider).toBe('plugin-upgrade')
    // The bundle carries reference/ + assets/ beside SKILL.md, so the
    // registration MUST point resourceBase at the bundle directory (a
    // content-only skill would omit it).
    expect(reg?.resourceBase?.kind).toBe('directory')
    expect(reg?.resourceBase?.path.endsWith('skills/plugin-upgrade')).toBe(true)
    expect(existsSync(reg!.resourceBase!.path)).toBe(true)
  })

  it('does not crash when the skills service is absent — it stays pending, no warning', () => {
    const ctx = new Context()
    expect(() => apply(ctx)).not.toThrow()
    // No skill is registered (the inject fiber just waits); apply returns cleanly.
  })
})
