// @vitest-environment jsdom
// The inline-html-card skill registration: pull-based generation-side contract.
// Mirrors the file-preview 3d-artifact and ankh-guard restart-skill pattern —
// the skill ships under `skills/inline-html-card/SKILL.md` (globbed into
// `files`) and `apply` registers it through the optional `skills` service.
//
// The description is the model's ONLY trigger signal (the catalog lists the
// name + description; the body loads on demand), so it is asserted to carry
// plain user-facing intent words ("show me", "see", "preview") that a normal
// request would match, rather than internal jargon.

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

interface Registered {
  name: string
  description: string
  content: string
  source?: string
}

describe('inline-html-card skill registration', () => {
  it('registers the skill when the skills service is present', () => {
    const ctx = new Context()
    const registrations: Registered[] = []
    ctx.provide('skills', {
      register: (skill: Registered) => {
        registrations.push(skill)
        return () => {}
      },
    } as never)
    apply(ctx)
    expect(registrations.map(skill => skill.name)).toEqual(['inline-html-card'])
    const reg = registrations[0]
    // The description is the pull-based trigger: the agent decides to load this
    // skill from the catalog text alone. It should read like user intent, not
    // implementation jargon.
    expect(reg?.description).toMatch(/show me|see|preview/i)
    expect(reg?.description).toContain('inline')
    expect(reg?.description).toContain('interactive')
    // The body carries the hard rules a generating model must obey.
    expect(reg?.content).toContain('dsh-card')
    expect(reg?.content).toContain('connect-src')
    expect(reg?.content).toContain('dshBridge')
    expect(reg?.content).toContain('self-contained')
    // Positive guidance for interactivity: an inline <script> + addEventListener
    // is the supported way to make a card respond — not CSS alone.
    expect(reg?.content).toContain('addEventListener')
    // The content should be the card itself: no fixed narrow width centered in
    // a big panel, no extra solid-background "window" wrapper, no large empty
    // min-height. The user sees the content, not a container around it.
    expect(reg?.content).toContain('The content IS the card')
    expect(reg?.content).toContain("don't fix a narrow width")
    // Default to an inline preview to confirm details; only write an HTML file
    // when the user asks for one or the details are settled.
    expect(reg?.content).toContain('Show it inline first')
    expect(reg?.content).toContain('Only write a file when asked')
    // No machine-specific path from the dev environment it was written on.
    expect(reg?.content).not.toContain('code/dsh-plugins')
    expect(reg?.content).not.toContain('/Users/')
    // The registry validates `source` at LOAD time — a registration without it
    // lists fine but explodes on invocation. Pin it (the ankh-guard 8.9 bug).
    expect(reg?.source).toBe('runtime')
  })

  it('skips registration when the skills service is absent — with a boot-log warning', () => {
    const ctx = new Context()
    const warn = vi.fn()
    Object.assign(ctx, { logger: { warn } })
    expect(() => apply(ctx)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skills capability absent'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('inline-html-card skill is not registered'))
  })
})
