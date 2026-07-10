// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sandboxDoc } from './html'

describe('sandboxDoc', () => {
  it('injecte la CSP dans <head>, avant le contenu existant', () => {
    const out = sandboxDoc('<!doctype html><html><head><title>x</title></head><body>ok</body></html>')
    expect(out).toContain('Content-Security-Policy')
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain("default-src 'none'")
    expect(out).toContain('ok')
  })

  it('injecte la CSP même sans <head> explicite', () => {
    const out = sandboxDoc('<p>ok</p>')
    expect(out).toContain('Content-Security-Policy')
    expect(out).toContain("default-src 'none'")
    expect(out).toContain('<p>ok</p>')
  })

  // --- Assainissement avant injection (audit sécu : beacon phone-home) ---

  it('retire le <meta http-equiv=refresh> (beacon auto)', () => {
    const out = sandboxDoc('<html><head><meta http-equiv="refresh" content="0;url=http://evil.tld/b"></head><body>x</body></html>')
    expect(out.toLowerCase()).not.toContain('http-equiv="refresh"')
    expect(out).not.toContain('evil.tld')
  })

  it('retire les <script>', () => {
    const out = sandboxDoc('<html><body><p>ok</p><script>fetch("http://evil")</script></body></html>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).toContain('<p>ok</p>')
  })

  it('neutralise les ancres à href externe (beacon au clic), garde les fragments', () => {
    const out = sandboxDoc('<html><body><a href="http://evil.tld/b">lien</a><a href="#section">ancre</a></body></html>')
    expect(out).not.toContain('evil.tld')
    expect(out).toContain('lien') // le texte reste, le href a sauté
    expect(out).toContain('href="#section"') // fragment conservé
  })

  it('conserve le <style> du document (fidélité du rendu)', () => {
    const out = sandboxDoc('<html><head><style>body{color:rebeccapurple}</style></head><body>x</body></html>')
    expect(out).toContain('rebeccapurple')
  })
})
