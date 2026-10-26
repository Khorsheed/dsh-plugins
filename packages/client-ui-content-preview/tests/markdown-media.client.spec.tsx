// @vitest-environment jsdom
/**
 * The markdown preview's media layer: the README `<img>` vocabulary becomes
 * markdown the official renderer shows, code is never rewritten, local
 * destinations resolve against the document's directory, local images load
 * through the surface, and local links open through it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { linkFailedImages, resolveDocPath, rewriteHtmlMedia } from '../src/client/markdown-media.ts'
import { MarkdownDocument } from '../src/client/MarkdownDocument.tsx'

const labels = { code: { copyLabel: 'copy', copiedLabel: 'copied' }, footnotes: 'Footnotes' }

describe('rewriteHtmlMedia', () => {
  it('turns a README <img> into markdown image syntax, entities decoded', () => {
    expect(rewriteHtmlMedia('<img src="https://x.test/a.png?a=1&amp;b=2" width="640" alt="右栏的画布">'))
      .toBe('![右栏的画布](https://x.test/a.png?a=1&b=2)')
  })

  it('drops alignment wrappers, flush-lefts the image, and keeps a linked image linked', () => {
    const source = '<p align="center">\n    <a href="https://x.test"><img src=\'docs/shot.png\' alt="a [b]"></a>\n</p>'
    expect(rewriteHtmlMedia(source)).toBe('\n[![a \\[b\\]](docs/shot.png)](https://x.test)\n')
  })

  it('keeps the image of a multi-line anchor and brackets destinations with spaces', () => {
    expect(rewriteHtmlMedia('<a href="https://x.test">\n<img src="my shot.png">\n</a>'))
      .toBe('\n![](<my shot.png>)\n')
  })

  it('never rewrites code: fences, indented blocks, inline spans', () => {
    const source = [
      '```html',
      '<img src="a.png">',
      '```',
      '',
      '    <img src="b.png">',
      '',
      'Write `<img src="c.png">` to embed, or <img src="d.png">.',
    ].join('\n')
    expect(rewriteHtmlMedia(source).split('\n')).toEqual([
      '```html',
      '<img src="a.png">',
      '```',
      '',
      '    <img src="b.png">',
      '',
      'Write `<img src="c.png">` to embed, or ![](d.png).',
    ])
  })

  it('leaves other HTML, and an <img> without a source, as authored', () => {
    expect(rewriteHtmlMedia('<details><summary>x</summary></details>')).toBe('<details><summary>x</summary></details>')
    expect(rewriteHtmlMedia('<img alt="no source">')).toBe('<img alt="no source">')
  })
})

describe('linkFailedImages', () => {
  const failed = (destination: string) => destination.includes('broken')
  const describe = (name: string) => `failed: ${name}`

  it('turns a failed image into a link to its address, and leaves loaded ones alone', () => {
    expect(linkFailedImages('![ok](a.png) ![shot](https://x.test/broken.JPG)', failed, describe))
      .toBe('![ok](a.png) [⚠ failed: shot](https://x.test/broken.JPG)')
  })

  it('names an alt-less image by its file, keeps <angle> destinations, and does not nest links', () => {
    expect(linkFailedImages('![](<docs/broken shot.png>)', failed, describe)).toBe('[⚠ failed: broken shot.png](<docs/broken shot.png>)')
    expect(linkFailedImages('[![badge](https://x.test/broken.svg)](https://ci.test)', failed, describe))
      .toBe('[⚠ failed: badge](https://ci.test)')
  })

  it('never touches code', () => {
    expect(linkFailedImages('`![a](broken.png)`\n\n```\n![a](broken.png)\n```', failed, describe))
      .toBe('`![a](broken.png)`\n\n```\n![a](broken.png)\n```')
  })
})

describe('resolveDocPath', () => {
  it('resolves relative destinations against the document directory', () => {
    expect(resolveDocPath('/w/pkg/README.md', 'docs/a.png')).toBe('/w/pkg/docs/a.png')
    expect(resolveDocPath('/w/pkg/README.md', './../b%20c.png')).toBe('/w/b c.png')
    expect(resolveDocPath('pkg/README.md', '../x.md#L3')).toBe('x.md')
    expect(resolveDocPath('README.md', 'img/a.png?raw=1')).toBe('img/a.png')
  })

  it('keeps absolute paths, and refuses URLs, fragments and escapes above a relative root', () => {
    expect(resolveDocPath('pkg/README.md', '/abs/a.png')).toBe('/abs/a.png')
    expect(resolveDocPath('/w/README.md', 'https://x.test/a.png')).toBeUndefined()
    expect(resolveDocPath('/w/README.md', '//cdn.test/a.png')).toBeUndefined()
    expect(resolveDocPath('/w/README.md', '#section')).toBeUndefined()
    expect(resolveDocPath('README.md', '../outside.png')).toBeUndefined()
  })
})

describe('MarkdownDocument', () => {
  afterEach(() => { cleanup() })

  it('shows a remote <img> as an image without asking the surface', () => {
    const resolveImage = vi.fn(async () => undefined)
    render(<MarkdownDocument text={'<img src="https://x.test/a.png" alt="shot">'} docPath="/w/README.md" labels={labels} resolveImage={resolveImage} version="v" />)
    expect(screen.getByRole('img', { name: 'shot' }).getAttribute('src')).toBe('https://x.test/a.png')
    expect(resolveImage).not.toHaveBeenCalled()
  })

  it('loads a local image through the surface once, resolved against the document directory', async () => {
    const resolveImage = vi.fn(async () => 'data:image/png;base64,AAAA')
    const { rerender } = render(<MarkdownDocument text="![local](docs/a.png)" docPath="/w/pkg/README.md" labels={labels} resolveImage={resolveImage} version="v" />)
    await act(async () => {})
    expect(resolveImage).toHaveBeenCalledWith('/w/pkg/docs/a.png')
    expect(screen.getByRole('img', { name: 'local' }).getAttribute('src')).toBe('data:image/png;base64,AAAA')
    // A fresh callback identity (surfaces pass inline closures) does not re-read.
    rerender(<MarkdownDocument text="![local](docs/a.png)" docPath="/w/pkg/README.md" labels={labels} resolveImage={async () => 'data:x'} version="v" />)
    await act(async () => {})
    expect(resolveImage).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img', { name: 'local' }).getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('says so, as a link to the file, when the surface cannot read a local image', async () => {
    const onOpenFile = vi.fn()
    render(<MarkdownDocument text="![missing shot](gone.png)" docPath="/w/README.md" labels={labels} resolveImage={async () => undefined} onOpenFile={onOpenFile} describeFailedImage={name => `图片加载失败：${name}`} version="v" />)
    await act(async () => {})
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByText('⚠ 图片加载失败：missing shot'))
    expect(onOpenFile).toHaveBeenCalledWith('/w/gone.png', undefined)
  })

  it('turns a remote image the browser cannot load into a link to its address', async () => {
    render(<MarkdownDocument text={'<img src="https://x.test/ankh-guard.JPG" alt="守护的重启">'} docPath="/w/README.md" labels={labels} version="v" />)
    await act(async () => { fireEvent.error(screen.getByRole('img', { name: '守护的重启' })) })
    const link = screen.getByText('⚠ Image failed to load: 守护的重启').closest('a')
    expect(link?.getAttribute('href')).toBe('https://x.test/ankh-guard.JPG')
  })

  it('marks a local image that was read but cannot be decoded as failed', async () => {
    render(<MarkdownDocument text="![bad](docs/bad.png)" docPath="/w/README.md" labels={labels} resolveImage={async () => 'data:image/png;base64,AAAA'} version="v" />)
    await act(async () => {})
    await act(async () => { fireEvent.error(screen.getByRole('img', { name: 'bad' })) })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('⚠ Image failed to load: bad')).toBeTruthy()
  })

  it('opens a local link through the surface, resolved against the document directory', () => {
    const onOpenFile = vi.fn()
    render(<MarkdownDocument text="[English](README.en.md) | 中文" docPath="/w/pkg/README.md" labels={labels} onOpenFile={onOpenFile} version="v" />)
    fireEvent.click(screen.getByText('English'))
    expect(onOpenFile).toHaveBeenCalledWith('/w/pkg/README.en.md', undefined)
  })
})
