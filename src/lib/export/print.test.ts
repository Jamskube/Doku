// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { buildPrintHtml } from './print'

describe('buildPrintHtml', () => {
  it('échappe la source .txt dans un <pre> (pas d’injection HTML)', () => {
    const out = buildPrintHtml({ kind: 'txt', name: 'a.txt', content: '<script>alert(1)</script>\n& < >' })
    expect(out).toContain('<pre>')
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).toContain('&amp; &lt; &gt;')
    expect(out).not.toContain('<script>alert(1)</script>')
  })

  it('traite .md comme du texte brut échappé (rendu MD→HTML = story 10.2)', () => {
    const out = buildPrintHtml({ kind: 'md', name: 'n.md', content: '# Titre\n<b>x</b>' })
    expect(out).toContain('# Titre')
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('assainit le .html (retire les <script>) via sanitizeHtml', () => {
    const out = buildPrintHtml({
      kind: 'html',
      name: 'p.html',
      content: '<!doctype html><html><body><h1>Ok</h1><script>alert(1)</script></body></html>',
    })
    expect(out).toContain('<h1>Ok</h1>')
    expect(out).not.toContain('<script>alert(1)</script>')
  })

  it('injecte la CSP d’impression (aucun réseau) et la feuille papier', () => {
    const out = buildPrintHtml({ kind: 'txt', name: 'a.txt', content: 'x' })
    expect(out).toContain('Content-Security-Policy')
    expect(out).toContain("default-src 'none'")
    expect(out).toContain('Source Serif 4') // feuille papier AIR réutilisée
  })

  it('porte les règles d’impression : marges @page, anti-coupure, bascule clair forcée', () => {
    const out = buildPrintHtml({ kind: 'txt', name: 'a.txt', content: 'x' })
    expect(out).toContain('@page')
    expect(out).toContain('break-inside: avoid')
    expect(out).toContain('@media print')
    expect(out).toMatch(/background:\s*#fff/i)
    expect(out).toMatch(/color:\s*#1C1A16/i)
  })
})
