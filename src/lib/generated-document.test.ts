// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  extractGeneratedDocument,
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
