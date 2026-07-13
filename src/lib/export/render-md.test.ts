// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// Simule le runtime Tauri : les images locales sont résolues en asset:// (URL http
// valide conservée par DOMPurify). Hors Tauri, le chemin brut serait strippé.
vi.mock('../tauri', () => ({ isTauri: true }))
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => 'http://asset.localhost/' + encodeURIComponent(p),
}))

import { renderMarkdown } from './render-md'

describe('renderMarkdown', () => {
  it('rend les blocs GFM (titres, emphase, listes, code, citation, hr, lien)', () => {
    const md = [
      '# Titre',
      '',
      'Un **gras** et un *italique*.',
      '',
      '- a',
      '- b',
      '',
      '1. un',
      '2. deux',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '> citation',
      '',
      '---',
      '',
      '[lien](https://ex.com)',
    ].join('\n')
    const out = renderMarkdown(md)
    expect(out).toMatch(/<h1[^>]*>Titre<\/h1>/)
    expect(out).toContain('<strong>gras</strong>')
    expect(out).toContain('<em>italique</em>')
    expect(out).toContain('<ul>')
    expect(out).toContain('<ol>')
    expect(out).toContain('<pre>')
    expect(out).toContain('<code')
    expect(out).toContain('<blockquote>')
    expect(out).toContain('<hr>')
    expect(out).toContain('lien') // ancre présente (href retiré par sanitize = attendu)
  })

  it('rend un tableau GFM', () => {
    const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const out = renderMarkdown(md)
    expect(out).toContain('<table>')
    expect(out).toContain('<th>a</th>')
    expect(out).toContain('<td>1</td>')
  })

  it('rend les cases à cocher des listes de tâches', () => {
    const out = renderMarkdown('- [ ] à faire\n- [x] fait')
    expect(out).toMatch(/<input[^>]*type="checkbox"/)
    expect(out).toMatch(/<input[^>]*checked/)
  })

  it('retire le HTML dangereux (script, onerror) via sanitizeHtml', () => {
    const out = renderMarkdown('# Ok\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')
    expect(out).toContain('<h1')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('transforme un wikilink [[cible]] en texte (inerte)', () => {
    const out = renderMarkdown('Voir [[ma note]] ici.')
    expect(out).toContain('ma note')
    expect(out).not.toContain('[[')
  })

  it('rend un wikilink à markdown actif comme texte inerte (pas de re-parse)', () => {
    const out = renderMarkdown('Voir [[**gras**]] ici.')
    expect(out).toContain('**gras**')
    expect(out).not.toContain('<strong>gras</strong>')
  })

  it('supprime une image bloquée (réseau/UNC) — aucun beacon émis', () => {
    const out = renderMarkdown('![a](https://evil/beacon.png)\n\n![b](//unc/share/x.png)')
    expect(out).not.toContain('evil')
    expect(out).not.toContain('unc')
    expect(out).not.toMatch(/<img[^>]*https/)
  })

  it('résout une image locale relative au dossier (asset:// en Tauri)', () => {
    const out = renderMarkdown('![photo](sub/img.png)', { dir: 'G:\\Notes' })
    expect(out).toContain('src="http://asset.localhost/')
    expect(out).toContain('Notes') // le dossier apparaît dans le chemin résolu
    expect(out).toContain('img.png')
  })

  it('préserve une image data: et laisse passer', () => {
    const out = renderMarkdown('![x](data:image/png;base64,AAAA)')
    expect(out).toContain('src="data:image/png;base64,AAAA"')
  })
})
