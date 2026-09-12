// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installForegroundRecovery } from '../src/client/foreground.ts'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('coalesces native and visibility resumes, does not reconnect on initial visibility, and cancels disposal', () => {
  vi.useFakeTimers();let visible='visible'
  vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visible as DocumentVisibilityState)
  const reconnect=vi.fn(),dispose=installForegroundRecovery(window,reconnect)
  document.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(200);expect(reconnect).not.toHaveBeenCalled()
  visible='hidden';document.dispatchEvent(new Event('visibilitychange'))
  visible='visible';document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('dsh-mobile-foreground'))
  vi.advanceTimersByTime(200);expect(reconnect).toHaveBeenCalledOnce()
  window.dispatchEvent(new Event('dsh-mobile-foreground'));dispose();vi.advanceTimersByTime(200);expect(reconnect).toHaveBeenCalledOnce()
})
