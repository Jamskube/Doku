// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('retire les <script>', () => {
    const out = sanitizeHtml('<p>ok</p><script>window.__xss = 1</script>')
    expect(out).toContain('<p>ok</p>')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('retire les handlers on* (onerror)', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('retire onclick', () => {
    const out = sanitizeHtml('<button onclick="steal()">x</button>')
    expect(out.toLowerCase()).not.toContain('onclick')
  })

  it('neutralise les URLs javascript:', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">lien</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('retire les iframes et objets actifs', () => {
    expect(sanitizeHtml('<iframe src="http://evil"></iframe>').toLowerCase()).not.toContain('<iframe')
    expect(sanitizeHtml('<object data="x"></object>').toLowerCase()).not.toContain('<object')
  })

  it('conserve le HTML sûr', () => {
    const out = sanitizeHtml('<h1>Titre</h1><p><strong>gras</strong> <em>ital</em></p><ul><li>a</li></ul>')
    expect(out).toContain('<h1>Titre</h1>')
    expect(out).toContain('<strong>gras</strong>')
    expect(out).toContain('<li>a</li>')
  })

  it('retire <meta http-equiv=refresh> et <base> (navigation auto)', () => {
    const out = sanitizeHtml('<meta http-equiv="refresh" content="0;url=http://evil"><base href="http://evil/">x')
    expect(out.toLowerCase()).not.toContain('http-equiv')
    expect(out.toLowerCase()).not.toContain('<base')
    expect(out).not.toContain('evil')
  })

  it('retire le href d’une ancre externe (beacon au clic) mais garde le fragment', () => {
    const ext = sanitizeHtml('<a href="http://evil/b">lien</a>')
    expect(ext).not.toContain('http://evil')
    expect(ext).toContain('lien')
    const frag = sanitizeHtml('<a href="#s">ancre</a>')
    expect(frag).toContain('href="#s"')
  })

  it('conserve le <style> (fidélité ; réseau CSS bloqué par la CSP de l’iframe)', () => {
    const out = sanitizeHtml('<style>body{color:rebeccapurple}</style><p>x</p>')
    expect(out).toContain('rebeccapurple')
  })
})
