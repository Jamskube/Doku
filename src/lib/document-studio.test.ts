// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildDocumentStudioInstruction, DOCUMENT_STUDIO_PROVENANCE } from './document-studio'
import { buildGeneratedDocumentPrompt } from './generated-document'

describe('Doku Document Studio', () => {
  it('pins the audited upstream inspiration', () => {
    expect(DOCUMENT_STUDIO_PROVENANCE).toMatchObject({
      release: 'beautiful-article-v0.1.0',
      commit: '78b4d081493e2a4a1c199d074f63e57814ed7e30',
      license: 'MIT',
    })
  })

  it('keeps the runtime contract native, bounded and safe', () => {
    const instruction = buildDocumentStudioInstruction('html')
    expect(instruction).toContain('Planifie en silence')
    expect(instruction).toContain('aucun JavaScript')
    expect(instruction).toContain('SVG inline')
    expect(instruction).toContain('360 px')
    expect(instruction).not.toMatch(/npm|bash|Reacticle|ThemeProvider/)
    expect(instruction.length).toBeLessThan(8_000)
  })

  it('gives PDF generation a print-flow contract instead of a fixed canvas', () => {
    const instruction = buildDocumentStudioInstruction('pdf')
    expect(instruction).toContain('@page { size: A4')
    expect(instruction).toContain("laisse le flux d'impression paginer")
    expect(instruction).toContain('orphans/widows à 3')
    expect(instruction).toContain('width:210mm')
  })

  it('keeps revisions scoped to the existing artifact', () => {
    const existing = '<html><body><h1>Version existante</h1></body></html>'
    const prompt = buildGeneratedDocumentPrompt('html', existing)
    expect(prompt).toContain('Conserve ce qui n\'est pas concerné')
    expect(prompt).toContain(existing)
    expect(prompt).toContain('<doku-document title=')
  })
})
