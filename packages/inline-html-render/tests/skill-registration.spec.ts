// @vitest-environment jsdom
// The inline-html-card skill registration: pull-based generation-side contract.
// `apply(ctx)` registers it once the `skills` service is ready via
// `ctx.inject(['skills'], …)` — it waits for the registry rather than probing it
// synchronously at apply time (the fix for inline-html-card not appearing in the
// catalog while 3d-artifact did). The description is the model's ONLY trigger
// signal, so it is asserted to carry plain user-facing intent words.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('inline HTML authoring skill registration', () => {
  it('registers both owned skills into a real SkillRegistry catalog once the service is ready', async () => {
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
    expect(names).toContain('3d-artifact')
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
    expect(registrations.map(skill => skill.name)).toEqual(['inline-html-card', '3d-artifact'])
    const reg = registrations.find(skill => skill.name === 'inline-html-card')
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
    // Push the three-backtick / no-nested-fence rule so the model cannot
    // write a four-backtick nested block (which renders as an outer code
    // block and never becomes a card).
    expect(reg?.content).toMatch(/use exactly three backticks|three backticks/i)
    expect(reg?.content).toContain('never four')
    // Distinguish "no fake window" from "no content padding": a panel's own
    // inset is part of the content and must be kept, not stripped.
    expect(reg?.content).toContain("Keep the content's own breathing room")
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
    // This skill is content-only (a single self-contained SKILL.md, no sibling
    // scripts/assets). Per the catalog registration protocol it OMITS
    // resourceBase so the catalog renders a virtual single-SKILL.md node — it
    // does NOT point at a directory holding only SKILL.md. Provider is still
    // reported so the catalog labels the card.
    expect(reg?.provider).toBe('inline-html-render')
    expect(reg?.resourceBase).toBeUndefined()
    const artifact = registrations.find(skill => skill.name === '3d-artifact')
    expect(artifact?.description).toContain('3D')
    expect(artifact?.content).toContain('GLB')
    expect(artifact?.content).toContain('connect-src')
    expect(artifact?.content).not.toContain('/Users/')
    expect(artifact?.source).toBe('runtime')
    expect(artifact?.provider).toBe('inline-html-render')
    expect(artifact?.resourceBase).toBeUndefined()
  })

  it('does not crash when the skills service is absent — it stays pending, no warning', () => {
    const ctx = new Context()
    expect(() => apply(ctx)).not.toThrow()
    // No skill is registered (the inject fiber just waits); apply returns cleanly.
  })
})

describe('inline HTML authoring skill pack smoke', () => {
  it('ships both owned SKILL.md payloads', () => {
    const pkgDir = process.cwd()
    const packed = mkdtempSync(join(tmpdir(), 'inline-html-render-pack-'))
    execFileSync('pnpm', ['pack', '--pack-destination', packed], { cwd: pkgDir, stdio: 'pipe' })
    const tgz = readdirSync(packed).find(name => name.endsWith('.tgz'))
    expect(tgz, 'pnpm pack produced a tarball').toBeDefined()
    const unpack = join(packed, 'unpack')
    mkdirSync(unpack)
    execFileSync('tar', ['-xzf', join(packed, tgz!), '-C', unpack], { stdio: 'pipe' })
    expect(existsSync(join(unpack, 'package', 'skills', 'inline-html-card', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(unpack, 'package', 'skills', '3d-artifact', 'SKILL.md'))).toBe(true)
  }, 30_000)
})
