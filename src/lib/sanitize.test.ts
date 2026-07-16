// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeHtml, sanitizeChatHtml } from './sanitize'

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

describe('sanitizeChatHtml (réponse LLM — garantie 0 réseau, principe 8.3)', () => {
  it('conserve le Markdown rendu sûr (p, listes, gras, code, table)', () => {
    const out = sanitizeChatHtml(
      '<p>Voici <strong>un point</strong> et <code>x=1</code></p><ul><li>a</li></ul><table><tr><th>K</th><td>V</td></tr></table>',
    )
    expect(out).toContain('<strong>un point</strong>')
    expect(out).toContain('<code>x=1</code>')
    expect(out).toContain('<li>a</li>')
    expect(out).toContain('<table>')
  })

  // LE test qui protège l'argument de vente n°1 : aucune balise réseau, aucune URL http(s)
  // ne doit survivre à l'assainissement d'une réponse hostile.
  it('supprime TOUT vecteur réseau d\'une réponse hostile (0 URL http)', () => {
    const hostile = [
      '<img src="http://evil/beacon.png">',
      '<video src="http://evil/v"></video>',
      '<video><source src="http://evil/s"></video>',
      '<audio src="http://evil/a"></audio>',
      '<track src="http://evil/t">',
      '<svg><use href="http://evil/x#a"/></svg>',
      '<image href="http://evil/i"/>',
      '<link rel="stylesheet" href="http://evil/c.css">',
      '<iframe src="http://evil/f"></iframe>',
      '<input type="image" src="http://evil/i">',
      '<div style="background:url(http://evil/bg)">x</div>',
      '<script src="http://evil/s.js"></script>',
    ].join('')
    const out = sanitizeChatHtml(hostile)
    expect(out).not.toMatch(/https?:/i)
    for (const tag of ['<img', '<video', '<audio', '<source', '<track', '<svg', '<image', '<link', '<iframe', '<script', 'style=']) {
      expect(out.toLowerCase()).not.toContain(tag)
    }
  })

  it('rend inerte une ancre externe (href retiré) et neutralise javascript:', () => {
    expect(sanitizeChatHtml('<a href="http://evil">l</a>')).not.toContain('http://evil')
    expect(sanitizeChatHtml('<a href="javascript:alert(1)">l</a>').toLowerCase()).not.toContain('javascript:')
  })

  it('retire les handlers on* (onerror/onclick)', () => {
    const out = sanitizeChatHtml('<p onclick="x()">t</p>')
    expect(out.toLowerCase()).not.toContain('onclick')
  })

  it('produit un fragment (pas de <html>/<head> enveloppant)', () => {
    const out = sanitizeChatHtml('<p>x</p>')
    expect(out.toLowerCase()).not.toContain('<html')
    expect(out.toLowerCase()).not.toContain('<head')
  })
})
