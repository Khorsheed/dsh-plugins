// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { MobileHomescreen } from '../src/client/homescreen.ts'

describe('mobile home-screen affordances', () => {
  afterEach(() => {
    document.head.querySelectorAll('[data-mobile-owned]').forEach(node => node.remove())
    history.replaceState(null, '', '/')
  })
  it('injects a credential-free manifest and apple meta only while active', () => {
    history.replaceState(null, '', '/ui/?token=secret-launch')
    const hs = new MobileHomescreen(document)
    hs.sync(false)
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
    hs.sync(true)
    const link = document.head.querySelector('link[rel="manifest"]')
    expect(link).not.toBeNull()
    const href = link!.getAttribute('href')!
    expect(href).not.toContain('secret-launch')
    const manifest = JSON.parse(decodeURIComponent(href.slice('data:application/manifest+json,'.length))) as { name: string; display: string; start_url: string; icons: { type: string }[] }
    expect(manifest).toMatchObject({ name: 'DSH Mobile', display: 'standalone', start_url: 'http://localhost:3000/ui/' })
    expect(manifest.icons[0]).toMatchObject({ type: 'image/svg+xml' })
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-capable"]')).not.toBeNull()
    hs.sync(true)
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    hs.sync(false)
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
    expect(document.head.querySelector('[data-mobile-owned]')).toBeNull()
    hs.dispose()
  })
})
