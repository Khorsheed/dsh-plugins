import { describe, expect, it } from 'vitest'
import { AGENT_NOTE_CLASSES, walkAgentNoteTree } from './agent-note-tree.ts'

// The Agent Note gates (verify-agent-note-classification / -format) are
// whole-tree CLI gates wired into the pre-commit hook; this spec guards the
// shared structural walker they both run on, asserting against the repo's own
// tree, which the hook also keeps green on every commit.

describe('agent-note tree walker', () => {
  it('walks the real tree with a consistent structure', () => {
    const { notes, errors } = walkAgentNoteTree()
    expect(errors).toEqual([])
    expect(notes.length).toBeGreaterThan(0)
  })

  it('indexes every note under a known class with a dated filename', () => {
    const { notes } = walkAgentNoteTree()
    expect(notes.length).toBeGreaterThan(0)
    for (const note of notes) {
      expect(AGENT_NOTE_CLASSES).toContain(note.rel.split('/')[1])
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
