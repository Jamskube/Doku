// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { collectLocalImages, buildStandaloneHtml, exportName, exportStandaloneHtml } from './standalone'
import { mimeFromExt, bytesToDataUrl } from './img-data'

describe('img-data', () => {
  it('mappe le MIME par extension', () => {
    expect(mimeFromExt('a.png')).toBe('image/png')
    expect(mimeFromExt('b.JPG')).toBe('image/jpeg')
    expect(mimeFromExt('c.svg')).toBe('image/svg+xml')
    expect(mimeFromExt('d.xyz')).toBe('application/octet-stream')
  })

  it('encode des octets en data: URI base64 (round-trip)', () => {
    const bytes = new Uint8Array([104, 105]) // "hi"
    const uri = bytesToDataUrl(bytes, 'image/png')
    expect(uri).toBe(`data:image/png;base64,${btoa('hi')}`)
    expect(atob(uri.split(',')[1])).toBe('hi')
  })

  it('encode sans dépassement de pile sur un gros tableau', () => {
    const big = new Uint8Array(200_000).fill(65) // > 0x8000, casserait un spread
    expect(() => bytesToDataUrl(big, 'image/png')).not.toThrow()
  })
})

describe('collectLocalImages', () => {
  it('collecte les images markdown locales, exclut data: et bloquées', () => {
    const content = '![a](sub/x.png)\n![b](data:image/png;base64,AA)\n![c](https://evil/y.png)'
    expect(collectLocalImages({ kind: 'md', name: 'n.md', content })).toEqual(['sub/x.png'])
  })

  it('collecte les <img src> locaux d’un .html', () => {
    const content = '<img src="pic.png"><img src="data:image/png;base64,AA"><img src="//unc/z.png">'
    expect(collectLocalImages({ kind: 'html', name: 'p.html', content })).toEqual(['pic.png'])
  })
})

describe('buildStandaloneHtml', () => {
  it('inline une image markdown en data: (aucun asset:/chemin local), avec CSP + styles + charset', () => {
    const map = new Map([['sub/x.png', 'data:image/png;base64,AAAA']])
    const out = buildStandaloneHtml({ kind: 'md', name: 'n.md', content: '# T\n\n![a](sub/x.png)', dir: 'G:\\N' }, map)
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).not.toContain('asset:')
    expect(out).not.toContain('sub/x.png')
    expect(out).toContain("default-src 'none'") // CSP portable
    expect(out).toContain('charset="utf-8"')
    expect(out).toContain('Source Serif 4') // paperCss inline
    expect(out).toContain('<h1')
  })

  it('inline les images d’un .html et retire les non inlinables', () => {
    const map = new Map([['pic.png', 'data:image/png;base64,BBBB']])
    const content = '<p><img src="pic.png"><img src="missing.png"></p>'
    const out = buildStandaloneHtml({ kind: 'html', name: 'p.html', content }, map)
    expect(out).toContain('data:image/png;base64,BBBB')
    expect(out).not.toContain('pic.png')
    expect(out).not.toContain('missing.png') // src non inlinable retiré
  })

  it('n’émet aucun script (sanitize) et aucune balise réseau', () => {
    const out = buildStandaloneHtml({ kind: 'md', name: 'n.md', content: '<script>alert(1)</script>' }, new Map())
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('alert(1)')
  })

  it('rend un .txt en <pre> échappé', () => {
    const out = buildStandaloneHtml({ kind: 'txt', name: 'a.txt', content: '<b>x</b>' }, new Map())
    expect(out).toContain('<pre>')
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('exportName', () => {
  it('remplace l’extension par .html', () => {
    expect(exportName('note.md')).toBe('note.html')
    expect(exportName('page.html')).toBe('page.html')
    expect(exportName('sansext')).toBe('sansext.html')
  })
})

describe('exportStandaloneHtml', () => {
  it('lit chaque image via io, assemble et enregistre → saved', async () => {
    const readImageDataUrl = vi.fn(async () => 'data:image/png;base64,CCCC')
    const save = vi.fn(async () => true)
    const res = await exportStandaloneHtml(
      { kind: 'md', name: 'n.md', content: '![a](x.png)', dir: 'G:\\N' },
      { readImageDataUrl, save },
    )
    expect(res).toBe('saved')
    expect(readImageDataUrl).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith('n.html', expect.stringContaining('data:image/png;base64,CCCC'))
  })

  it('dialogue annulé → cancelled', async () => {
    const res = await exportStandaloneHtml(
      { kind: 'md', name: 'n.md', content: '# t', dir: '' },
      { readImageDataUrl: async () => null, save: async () => false },
    )
    expect(res).toBe('cancelled')
  })
})
