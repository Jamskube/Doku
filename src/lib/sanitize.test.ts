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
})
