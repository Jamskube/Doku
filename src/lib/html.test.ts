import { describe, it, expect } from 'vitest'
import { sandboxDoc } from './html'

describe('sandboxDoc', () => {
  it('injecte la CSP dans <head>', () => {
    const out = sandboxDoc('<!doctype html><html><head><title>x</title></head><body>ok</body></html>')
    expect(out).toContain('Content-Security-Policy')
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'))
    expect(out).toContain('default-src \'none\'')
  })

  it('crée un <head> si absent mais <html> présent', () => {
    const out = sandboxDoc('<html><body>ok</body></html>')
    expect(out).toContain('<head>')
    expect(out).toContain('Content-Security-Policy')
  })

  it('préfixe si ni head ni html', () => {
    const out = sandboxDoc('<p>ok</p>')
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(out).toContain('<p>ok</p>')
  })

  it('interdit scripts et réseau (default-src none)', () => {
    const out = sandboxDoc('<html><head></head><body></body></html>')
    expect(out).toContain("default-src 'none'")
  })
})
