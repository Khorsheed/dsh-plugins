// @vitest-environment jsdom
// The inline-html-card skill registration: pull-based generation-side contract.
// `apply(ctx)` registers it once the `skills` service is ready via
// `ctx.inject(['skills'], …)` — it waits for the registry rather than probing it
// synchronously at apply time (the fix for inline-html-card not appearing in the
// catalog while 3d-artifact did). The description is the model's ONLY trigger
// signal, so it is asserted to carry plain user-facing intent words.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

interface Registered {
  name: string
  description: string
  content: string
  source?: string
}

describe('inline-html-card skill registration', () => {
  it('registers the skill into a real SkillRegistry catalog once the service is ready', async () => {
    const ctx = new Context()
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    // Build the registry on the ctx so ctx.skills / ctx.get('skills') resolves,
    // then apply — ctx.inject(['skills'], …) waits for it and registers.
    const registry = new SkillRegistry(ctx as never)
    apply(ctx)
    // The inject callback runs after the registry is present; await a tick.
    await new Promise(r => setTimeout(r, 0))
    const names = (await registry.list({ cwd: '/' })).map(s => s.name)
    expect(names).toContain('inline-html-card')
  })

  it('the registered skill body carries the hard rules + user-intent description', async () => {
    const ctx = new Context()
    const registrations: Registered[] = []
    // Provide a register stub; apply waits for 'skills' via inject.
    ctx.provide('skills', {
      register: (skill: Registered) => { registrations.push(skill); return () => {} },
    } as never)
    apply(ctx)
    await new Promise(r => setTimeout(r, 0))
    expect(registrations.map(skill => skill.name)).toEqual(['inline-html-card'])
    const reg = registrations[0]
    // The description is the pull-based trigger: user intent, not jargon.
    expect(reg?.description).toMatch(/show me|see|preview/i)
    expect(reg?.description).toContain('inline')
    expect(reg?.description).toContain('interactive')
    // The body carries the hard rules.
    expect(reg?.content).toContain('dsh-card')
    expect(reg?.content).toContain('connect-src')
    expect(reg?.content).toContain('dshBridge')
    expect(reg?.content).toContain('self-contained')
    expect(reg?.content).toContain('addEventListener')
    expect(reg?.content).toContain('The content IS the card')
    expect(reg?.content).toContain('no fixed narrow width')
    expect(reg?.content).toContain('Show it inline first')
    expect(reg?.content).toContain('Only write a file when asked')
    // No machine-specific path from the dev environment it was written on.
    expect(reg?.content).not.toContain('code/dsh-plugins')
    expect(reg?.content).not.toContain('/Users/')
    // The skill must not impose the model's design choices: no assumption that
    // the page is dark, no prescribed aesthetic/font stack. Colors/theme/fonts
    // are the model's to choose for the content.
    expect(reg?.content).not.toMatch(/dark[- ]theme|developer-tool aesthetic|compact font/i)
    expect(reg?.content).toContain('Colors, theme, and fonts are yours to choose')
    // The registry validates `source` at LOAD time — pin it (the ankh-guard 8.9 bug).
    expect(reg?.source).toBe('runtime')
  })

  it('does not crash when the skills service is absent — it stays pending, no warning', () => {
    const ctx = new Context()
    expect(() => apply(ctx)).not.toThrow()
    // No skill is registered (the inject fiber just waits); apply returns cleanly.
  })
})
