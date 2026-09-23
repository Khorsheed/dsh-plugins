// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectPhone } from '../src/client/ConnectPhone.tsx'
import { en } from '../src/client/locales.ts'
const t = (key: keyof typeof en) => en[key]
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
function fixture() {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'ready', origin: 'https://phone.example.test' }) })
    .mockResolvedValue({ ok: true, json: async () => ({ loginUrl: 'https://phone.example.test/?token=private', origin: 'https://phone.example.test' }) })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<ConnectPhone t={t}/>); return { fetcher, view }
}
it('waits for a user action, renders locally, and clears the QR on hide and page background', async () => {
  const f = fixture()
  await screen.findByRole('button', { name: en.connectGenerate })
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.connectGenerate }))
  await screen.findByRole('img', { name: en.connectQR })
  expect(f.fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
  expect(document.body.textContent).not.toContain('token=private')
  expect(localStorage.length).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: en.connectHide }))
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.connectGenerate })); await screen.findByRole('img')
  act(() => { window.dispatchEvent(new Event('pagehide')) })
  expect(screen.queryByRole('img')).toBeNull()
})
it('hides after two minutes without claiming the bearer credential has expired', async () => {
  fixture(); await screen.findByRole('button', { name: en.connectGenerate })
  vi.useFakeTimers()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.connectGenerate })) })
  expect(screen.getByRole('img')).toBeTruthy()
  act(() => { vi.advanceTimersByTime(120_000) })
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText(en.connectPrivacy)).toBeTruthy()
})
it('aborts pending generation when leaving, so a late response cannot redisplay a secret', async () => {
  const f = fixture(); await screen.findByRole('button', { name: en.connectGenerate })
  let resolve!: (value: unknown) => void
  f.fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: en.connectGenerate }))
  act(() => { window.dispatchEvent(new Event('pagehide')) })
  await act(async () => { resolve({ ok: true, json: async () => ({ loginUrl: 'https://phone.example.test/?token=late' }) }) })
  expect(screen.queryByRole('img')).toBeNull()
})
it('shows setup and retry states without requesting a login link automatically', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ state: 'untrusted-origin', origin: 'https://phone.example.test' }) })
  vi.stubGlobal('fetch', fetcher); render(<ConnectPhone t={t}/>)
  await screen.findByText(en.connectUntrusted)
  expect(screen.queryByRole('button', { name: en.connectGenerate })).toBeNull()
  fetcher.mockResolvedValue({ ok: false }); fireEvent.click(screen.getByRole('button', { name: en.directoryRetry }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(en.connectError))
})
