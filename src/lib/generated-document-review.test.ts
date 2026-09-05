// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildGeneratedDocumentCorrectionPrompt,
  parseGeneratedDocumentVisualVerdict,
  type GeneratedDocumentLayoutEvidence,
} from './generated-document-review'

const evidence: GeneratedDocumentLayoutEvidence = {
  viewport: { width: 826, height: 1123 },
  document: { width: 900, height: 1800, pages: 2 },
  issues: [{ code: 'horizontal-overflow', severity: 'blocking', message: 'Le contenu déborde.' }],
  screenshot: 'data:image/jpeg;base64,abc',
}

describe('generated document review', () => {
  it('parses and bounds a visual verdict envelope', () => {
    const verdict = parseGeneratedDocumentVisualVerdict('<document-review>{"passed":false,"blocking":["Titre tronqué"],"warnings":["Dense"],"summary":"  À corriger  "}</document-review>')
    expect(verdict).toEqual({ passed: false, blocking: ['Titre tronqué'], warnings: ['Dense'], summary: 'À corriger' })
  })

  it('rejects prose without the private verdict envelope', () => {
    expect(parseGeneratedDocumentVisualVerdict('{"passed":true}')).toBeNull()
  })

  it('feeds measured defects and the current HTML to correction', () => {
    const prompt = buildGeneratedDocumentCorrectionPrompt({
      version: 1,
      kind: 'pdf',
      title: 'Rapport',
      prompt: 'Rapport',
      html: '<main style="width:1200px">Rapport</main>',
    }, evidence, null)
    expect(prompt).toContain('blocking: Le contenu déborde.')
    expect(prompt).toContain('width:1200px')
    expect(prompt).toContain('<doku-document title=')
  })
})
