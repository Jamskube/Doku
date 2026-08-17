import { describe, expect, it, vi } from 'vitest'
import { annotatedPdfName, annotatedPdfSummary, exportAnnotatedPdf, type AnnotatedPdfPorts } from './pdf-annotated'
import { PdfBurnError } from '../pdf-write'
import { emptyPdfAnnotationManifest, pdfAnnotationIdentity } from '../pdf-annotations'
import { createPdfInkDrawing } from '../pdf-drawing'

const PATH = 'C:\\docs\\contrat.pdf'

async function blankPdf(): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return doc.save()
}

async function manifestJson(bytes: Uint8Array, mutate: (m: ReturnType<typeof emptyPdfAnnotationManifest>) => void): Promise<string> {
  const identity = await pdfAnnotationIdentity(PATH, bytes)
  const manifest = emptyPdfAnnotationManifest(identity)
  mutate(manifest)
  return JSON.stringify(manifest)
}

function ports(overrides: Partial<AnnotatedPdfPorts> = {}): AnnotatedPdfPorts & { saved: { name: string; bytes: Uint8Array }[] } {
  const saved: { name: string; bytes: Uint8Array }[] = []
  return {
    saved,
    readFileBytes: async () => null,
    readManifest: async () => null,
    save: async (name, bytes) => {
      saved.push({ name, bytes })
      return true
    },
    ...overrides,
  }
}

describe('annotatedPdfName', () => {
  it('dérive un nom qui ne peut pas écraser la source', () => {
    expect(annotatedPdfName('C:\\docs\\contrat.pdf')).toBe('contrat — annoté.pdf')
    expect(annotatedPdfName('/home/kubo/Rapport Final.PDF')).toBe('Rapport Final — annoté.pdf')
    expect(annotatedPdfName('sans-extension')).toBe('sans-extension — annoté.pdf')
  })
})

describe('exportAnnotatedPdf', () => {
  // Écrit un vrai PDF puis le relit : pdf-lib + MuPDF (WASM) coûtent plusieurs secondes.
  // Délai explicite plutôt que le défaut de 5 s, qui fait échouer ce test sur une machine
  // chargée alors que le code est bon.
  it('grave le carnet et propose une copie', async () => {
    const bytes = await blankPdf()
    const json = await manifestJson(bytes, (m) => {
      m.drawings.push(createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.5 }]], { comment: 'à revoir' }))
    })
    const io = ports({ readFileBytes: async () => bytes, readManifest: async () => json })
    const report = await exportAnnotatedPdf(PATH, io)
    expect(report).toMatchObject({ saved: true, burned: 1, notes: 1, skipped: 0 })
    expect(io.saved).toHaveLength(1)
    expect(io.saved[0].name).toBe('contrat — annoté.pdf')
    expect(io.saved[0].bytes.length).toBeGreaterThan(bytes.length)
  }, 30_000)

  it('rend saved=false quand l’utilisateur ferme le dialogue, sans erreur', async () => {
    const bytes = await blankPdf()
    const json = await manifestJson(bytes, (m) => {
      m.drawings.push(createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.5 }]]))
    })
    const io = ports({ readFileBytes: async () => bytes, readManifest: async () => json, save: async () => false })
    await expect(exportAnnotatedPdf(PATH, io)).resolves.toMatchObject({ saved: false, burned: 1 })
  })

  it('refuse un carnet ILLISIBLE au lieu de rendre un PDF faussement propre', async () => {
    // Le piège : un manifeste cassé parse en carnet vide. Exporter alors une copie
    // « sans annotation » ferait croire à l'utilisateur qu'il n'avait rien annoté.
    const bytes = await blankPdf()
    const io = ports({ readFileBytes: async () => bytes, readManifest: async () => '{ ceci n’est pas du json' })
    await expect(exportAnnotatedPdf(PATH, io)).rejects.toThrow(/illisible/i)
  })

  it('refuse quand le PDF a changé sous les annotations', async () => {
    const bytes = await blankPdf()
    const identity = await pdfAnnotationIdentity(PATH, bytes)
    const json = JSON.stringify({
      version: 5,
      document: { ...identity, fingerprint: 'un-autre-document' },
      drawings: [createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.5 }]])],
    })
    const io = ports({ readFileBytes: async () => bytes, readManifest: async () => json })
    await expect(exportAnnotatedPdf(PATH, io)).rejects.toThrow(/a changé/i)
  })

  it('refuse un carnet vide plutôt que de produire une copie identique', async () => {
    const bytes = await blankPdf()
    const io = ports({ readFileBytes: async () => bytes, readManifest: async () => null })
    await expect(exportAnnotatedPdf(PATH, io)).rejects.toThrow(/aucune annotation/i)
  })

  it('signale un document source introuvable', async () => {
    const io = ports()
    await expect(exportAnnotatedPdf(PATH, io)).rejects.toBeInstanceOf(PdfBurnError)
  })

  it('n’écrit jamais sans passer par le dialogue', async () => {
    const bytes = await blankPdf()
    const json = await manifestJson(bytes, (m) => {
      m.drawings.push(createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.5 }]]))
    })
    const save = vi.fn(async (_name: string, _bytes: Uint8Array) => true)
    await exportAnnotatedPdf(PATH, ports({ readFileBytes: async () => bytes, readManifest: async () => json, save }))
    expect(save).toHaveBeenCalledOnce()
    // Le nom proposé porte le suffixe : même en validant sans regarder, l'utilisateur
    // n'écrase pas son document d'origine.
    expect(save.mock.calls[0][0]).toMatch(/— annoté\.pdf$/)
  })
})

describe('annotatedPdfSummary', () => {
  it('dit ce qui a été gravé', () => {
    expect(annotatedPdfSummary({ saved: true, burned: 1, notes: 0, skipped: 0 }))
      .toBe('1 annotation gravée. Le document d’origine est intact.')
    expect(annotatedPdfSummary({ saved: true, burned: 4, notes: 2, skipped: 0 }))
      .toBe('4 annotations gravées, dont 2 notes. Le document d’origine est intact.')
  })

  it('avoue ce qui a été écarté', () => {
    expect(annotatedPdfSummary({ saved: true, burned: 3, notes: 0, skipped: 2 }))
      .toContain('2 annotations sur une page absente n’ont pas pu être gravées.')
  })
})
