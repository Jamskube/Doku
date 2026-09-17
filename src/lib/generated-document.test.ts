// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  applyGeneratedDocumentEdit,
  buildGeneratedDocumentPrompt,
  extractGeneratedDocument,
  numberedDocumentHtml,
  generatedDocumentPreview,
  generatedDocumentPrintSource,
  generatedDocumentStandalone,
  sanitizeGeneratedDocumentHtml,
} from './generated-document'

describe('generated documents', () => {
  it('extracts raw HTML from the envelope and sanitizes active content', () => {
    const output = 'Voici :\n<doku-document title="Rapport">\n<!doctype html><html><body><h1>Résultat "cité"</h1>\n<script>alert(1)</script></body></html>\n</doku-document>'
    const artifact = extractGeneratedDocument(output, 'pdf', 'Crée un rapport')
    expect(artifact?.title).toBe('Rapport')
    expect(artifact?.html).toContain('Résultat "cité"')
    expect(artifact?.html).not.toContain('<script')
  })

  it('still accepts the first JSON contract, wrapped or bare', () => {
    const wrapped = '<doku-document>{"title":"Rapport","html":"<main><h1>A</h1></main>"}</doku-document>'
    const bare = '{"title":"Nu","html":"<main><h1>B</h1></main>"}'
    expect(extractGeneratedDocument(wrapped, 'html', 'x')?.title).toBe('Rapport')
    expect(extractGeneratedDocument(bare, 'html', 'x')?.html).toContain('<h1>B</h1>')
    expect(extractGeneratedDocument('Je ne peux pas.', 'html', 'x')).toBeNull()
  })

  it('removes remote resources from images, SVG links and CSS', () => {
    const clean = sanitizeGeneratedDocumentHtml('<html><head><style>@import "https://evil.test/x";.x{background:url(https://evil.test/a)}.y{background:image-set("https://evil.test/b" 1x)}.z{background:url(data:image/png;base64,AA)}</style></head><body><h1>OK</h1><img src="https://evil.test/a.png"><svg><a href="https://evil.test/beacon"><text>lien</text></a><use href="https://evil.test/s.svg#i"></use></svg></body></html>')
    expect(clean).not.toContain('https://')
    expect(clean).not.toContain('@import')
    expect(clean).toContain('data:image/png')
  })

  it('strips the chat citation markers, but never inside code, style or SVG', () => {
    const clean = sanitizeGeneratedDocumentHtml('<html><head><style>.card .title{margin:0 .5em}</style></head><body><main><p>Le chiffre est de 12 % [1], confirmé [2, 3].</p><pre><code>const a = t[1]</code></pre><svg viewBox="0 0 10 10"><path d="M 10 .5"/><text>[2]</text></svg><p style="margin:0 .5em">x</p></main></body></html>')
    expect(clean).toContain('12 %, confirmé.')
    expect(clean).toContain('t[1]')
    // Le nettoyage de l'espace orpheline ne doit JAMAIS toucher une feuille de style :
    // `.card .title` est un sélecteur descendant, `0 .5em` un raccourci à deux valeurs.
    expect(clean).toContain('.card .title{margin:0 .5em}')
    expect(clean).toContain('margin:0 .5em"')
    expect(clean).toContain('M 10 .5')
    expect(clean).toContain('<text>[2]</text>')
  })

  it('keeps the display and standalone gates isolated', () => {
    const artifact = extractGeneratedDocument('<doku-document title="Page"><main><h1>Bonjour</h1></main></doku-document>', 'html', 'Page')!
    expect(generatedDocumentPreview(artifact, 'dark')).toContain("default-src 'none'")
    expect(generatedDocumentStandalone(artifact)).toContain('<title>Page</title>')
  })

  it('gives the A4 preview, audit and print the same text column', () => {
    const artifact = extractGeneratedDocument('<doku-document title="PDF"><html><head><style>body{width:210mm;padding:40px}.page{width:210mm}</style></head><body><main class="page"><h1>Rapport</h1></main></body></html></doku-document>', 'pdf', 'Rapport')!
    const preview = generatedDocumentPreview(artifact, 'dark')
    expect(preview.indexOf('data-doku-document-frame')).toBeGreaterThan(preview.indexOf('width:210mm'))
    expect(preview).toContain('max-width: 794px !important')
    expect(preview).toContain('padding: 16mm 15mm 18mm !important')
    expect(preview).toContain('color-scheme: light')
    expect(generatedDocumentPrintSource(artifact)).toContain('padding: 0 !important')
  })
})

describe('targeted document edits', () => {
  const base = extractGeneratedDocument(
    '<doku-document title="Recette"><html><head><style>h1{color:#222}</style></head><body><main><h1>Gâteau</h1><p>Intro</p><ul><li>Farine</li><li>Sucre</li></ul><p>Cuisson 30 min</p></main></body></html></doku-document>',
    'html',
    'Crée une recette',
  )!
  const idOf = (html: string, text: string) => new RegExp(`data-doku-id="(\\d+)">${text}<`).exec(html)?.[1]

  it('numbers blocks the same way for the preview and the model, never in exports', () => {
    const numbered = numberedDocumentHtml(base.html)
    expect(numbered).toBe(numberedDocumentHtml(base.html))
    expect(numbered).toContain('<style data-doku-id="1">')
    expect(generatedDocumentPreview(base, 'light')).toContain(`data-doku-id="${idOf(numbered, 'Intro')}">Intro<`)
    expect(base.html).not.toContain('data-doku-id')
    expect(generatedDocumentStandalone(base)).not.toContain('data-doku-id')
    expect(generatedDocumentPrintSource(base)).not.toContain('data-doku-id')
  })

  it('drops block ids copied by the model into a full document', () => {
    const artifact = extractGeneratedDocument('<doku-document><main><p data-doku-id="7">Texte</p></main></doku-document>', 'html', 'x')!
    expect(artifact.html).not.toContain('data-doku-id')
  })

  it('applies replace, insert and remove without touching other blocks', () => {
    const numbered = numberedDocumentHtml(base.html)
    const intro = idOf(numbered, 'Intro')
    const sugar = idOf(numbered, 'Sucre')
    const baking = idOf(numbered, 'Cuisson 30 min')
    const output = `<doku-edit title="Gâteau léger"><remove id="${sugar}"/><replace id="${intro}"><p>Une intro plus courte</p></replace><insert after="${baking}"><p>Servir tiède</p></insert></doku-edit>`
    const result = applyGeneratedDocumentEdit(output, base, 'html', 'Allège la recette')
    expect(result && 'artifact' in result).toBe(true)
    const artifact = (result as { artifact: typeof base }).artifact
    expect(artifact.title).toBe('Gâteau léger')
    expect(artifact.html).toContain('<p>Une intro plus courte</p>')
    expect(artifact.html).not.toContain('Sucre')
    expect(artifact.html).toContain('<li>Farine</li>')
    expect(artifact.html).toContain('<p>Cuisson 30 min</p><p>Servir tiède</p>')
    expect(artifact.html).toContain('<style>h1{color:#222}</style>')
    expect(artifact.html).not.toContain('data-doku-id')
  })

  it('sanitizes inserted HTML like a generated document', () => {
    const intro = idOf(numberedDocumentHtml(base.html), 'Intro')
    const result = applyGeneratedDocumentEdit(`<doku-edit><insert before="${intro}"><p onclick="x()">Note</p><script>alert(1)</script></insert></doku-edit>`, base, 'html', 'x')
    const html = (result as { artifact: typeof base }).artifact.html
    expect(html).toContain('<p>Note</p><p>Intro</p>')
    expect(html).not.toContain('script')
    expect(html).not.toContain('onclick')
  })

  it('reports an edit it cannot apply, and ignores a full document', () => {
    expect(applyGeneratedDocumentEdit('<doku-edit><replace id="999"><p>x</p></replace></doku-edit>', base, 'html', 'x')).toEqual({ error: "le bloc 999 n'existe pas" })
    expect(applyGeneratedDocumentEdit('<doku-edit>rien</doku-edit>', base, 'html', 'x')).toEqual({ error: 'aucune opération reconnue' })
    expect(applyGeneratedDocumentEdit('<doku-document><main><p>Nouveau</p></main></doku-document>', base, 'html', 'x')).toBeNull()
  })

  // Vécu le 2026-09-17 : « change le nombre de jours estimés » → carte réécrite, classes
  // perdues, le chiffre retombé dans la typo du texte courant.
  it('changes a number inside a card without touching its markup', () => {
    const card = extractGeneratedDocument(
      '<doku-document title="CastLan"><main><div class="kpis"><div class="kpi"><span class="kpi-label">Jours démontrables</span><strong class="kpi-value">131</strong></div><div class="kpi"><span class="kpi-label">Jours estimés</span><strong class="kpi-value">230</strong><small>sans trace d\'historique</small></div></div></main></doku-document>',
      'html',
      'x',
    )!
    const numbered = numberedDocumentHtml(card.html)
    const estimated = /<div class="kpi" data-doku-id="(\d+)"><span class="kpi-label">Jours estimés/.exec(numbered)![1]
    const result = applyGeneratedDocumentEdit(`<doku-edit><change id="${estimated}"><from>230</from><to>250</to></change></doku-edit>`, card, 'html', 'x')
    const html = (result as { artifact: typeof card }).artifact.html
    expect(html).toContain('<span class="kpi-label">Jours estimés</span><strong class="kpi-value">250</strong><small>sans trace d\'historique</small>')
    expect(html).toContain('<strong class="kpi-value">131</strong>')
  })

  it('accepts a <from> copied with or without block ids, refuses an ambiguous or missing one', () => {
    const numbered = numberedDocumentHtml(base.html)
    const list = /<ul data-doku-id="(\d+)">/.exec(numbered)![1]
    const withIds = /<ul data-doku-id="\d+">(<li data-doku-id="\d+">Farine<\/li>)/.exec(numbered)![1]
    const copied = applyGeneratedDocumentEdit(`<doku-edit><change id="${list}"><from>${withIds}</from><to><li>Farine complète</li></to></change></doku-edit>`, base, 'html', 'x')
    expect((copied as { artifact: typeof base }).artifact.html).toContain('<ul><li>Farine complète</li><li>Sucre</li></ul>')
    const bare = applyGeneratedDocumentEdit(`<doku-edit><change id="${list}"><from><li>Sucre</li></from><to><li>Sucre roux</li></to></change></doku-edit>`, base, 'html', 'x')
    expect((bare as { artifact: typeof base }).artifact.html).toContain('<li>Sucre roux</li>')
    expect(applyGeneratedDocumentEdit(`<doku-edit><change id="${list}"><from>li</from><to>x</to></change></doku-edit>`, base, 'html', 'x')).toEqual({ error: `bloc ${list} : extrait <from> présent plusieurs fois` })
    expect(applyGeneratedDocumentEdit(`<doku-edit><change id="${list}"><from>Beurre</from><to>x</to></change></doku-edit>`, base, 'html', 'x')).toEqual({ error: `bloc ${list} : extrait <from> introuvable` })
  })

  it('tells a revision to keep the existing style, without the creative studio brief', () => {
    const prompt = buildGeneratedDocumentPrompt('html', base)
    expect(prompt).toContain('<change id="N">')
    expect(prompt).toContain('le document existant fixe le style')
    expect(prompt).toContain('Contraintes Doku')
    expect(prompt).not.toContain('direction visuelle')
  })

  it('points the revision prompt at the designated block', () => {
    const prompt = buildGeneratedDocumentPrompt('html', { ...base, target: { id: '4', excerpt: 'Intro' } })
    expect(prompt).toContain('<doku-edit>')
    expect(prompt).toContain('le bloc data-doku-id="4" (« Intro »)')
    expect(prompt).toContain(numberedDocumentHtml(base.html))
  })
})
