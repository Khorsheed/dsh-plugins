// @vitest-environment jsdom
/**
 * Mention-intercept unit coverage: the three hit gates (structure,
 * absolute-path title, matching label), the plugin-surface exclusion, and the
 * capture-phase listener's fail-open semantics — a confirmed mention is
 * rerouted and stopped, everything else passes through untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { interceptMentionClicks, mentionPathFrom } from '../src/client/mention-intercept.ts'

/** Build an official-mention-shaped `code > button[title]` in the body. */
function mention(title: string, label: string, wrap?: (code: HTMLElement) => void): HTMLButtonElement {
  const code = document.createElement('code')
  const button = document.createElement('button')
  button.title = title
  button.textContent = label
  code.appendChild(button)
  wrap?.(code)
  if (code.parentNode === null) document.body.appendChild(code)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mentionPathFrom', () => {
  it('ignores non-Element targets', () => {
    expect(mentionPathFrom(document)).toBeUndefined()
    expect(mentionPathFrom(null)).toBeUndefined()
  })

  it('ignores clicks outside any mention structure', () => {
    const plain = document.createElement('button')
    plain.title = '/work/a.md'
    plain.textContent = 'a.md'
    document.body.appendChild(plain)
    expect(mentionPathFrom(plain)).toBeUndefined()
  })

  it('ignores mentions inside the plugin-owned drawer dialog', () => {
    const button = mention('/work/a.md', 'a.md', (code) => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      dialog.appendChild(code)
      document.body.appendChild(dialog)
    })
    expect(mentionPathFrom(button)).toBeUndefined()
  })

  it('ignores relative-path titles', () => {
    expect(mentionPathFrom(mention('src/a.md', 'a.md'))).toBeUndefined()
  })

  it('ignores labels that match neither the path nor its basename', () => {
    expect(mentionPathFrom(mention('/work/a.md', 'other.md'))).toBeUndefined()
  })

  it('extracts the absolute path from a basename-labeled mention', () => {
    expect(mentionPathFrom(mention('/work/src/a.md', 'a.md'))).toBe('/work/src/a.md')
  })

  it('extracts the path from a full-path-labeled mention', () => {
    expect(mentionPathFrom(mention('/work/src/a.md', '/work/src/a.md'))).toBe('/work/src/a.md')
  })

  it('accepts Windows drive paths', () => {
    expect(mentionPathFrom(mention('C:\\work\\a.md', 'a.md'))).toBe('C:\\work\\a.md')
  })
})

describe('interceptMentionClicks', () => {
  it('reroutes a mention click and stops it before the bubble phase', () => {
    const open = vi.fn()
    const dispose = interceptMentionClicks(open)
    const bubbleSpy = vi.fn()
    document.body.addEventListener('click', bubbleSpy)
    const button = mention('/work/a.md', 'a.md')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.dispatchEvent(event)
    expect(open).toHaveBeenCalledWith('/work/a.md')
    expect(event.defaultPrevented).toBe(true)
    expect(bubbleSpy).not.toHaveBeenCalled()
    dispose()
  })

  it('ignores non-primary and already-prevented clicks', () => {
    const open = vi.fn()
    const dispose = interceptMentionClicks(open)
    const button = mention('/work/a.md', 'a.md')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }))
    const prevented = new MouseEvent('click', { bubbles: true, cancelable: true })
    prevented.preventDefault()
    button.dispatchEvent(prevented)
    expect(open).not.toHaveBeenCalled()
    dispose()
  })

  it('lets unrecognized clicks propagate untouched', () => {
    const open = vi.fn()
    const dispose = interceptMentionClicks(open)
    const bubbleSpy = vi.fn()
    document.body.addEventListener('click', bubbleSpy)
    const plain = document.createElement('button')
    document.body.appendChild(plain)
    plain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(open).not.toHaveBeenCalled()
    expect(bubbleSpy).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('stops intercepting once disposed', () => {
    const open = vi.fn()
    const dispose = interceptMentionClicks(open)
    dispose()
    mention('/work/a.md', 'a.md').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(open).not.toHaveBeenCalled()
  })
})
