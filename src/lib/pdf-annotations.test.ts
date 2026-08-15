import { describe, expect, it } from 'vitest'
import {
  clusterPdfNotePins,
  emptyPdfAnnotationManifest,
  parsePdfAnnotationManifest,
  pdfAnnotationIdentity,
  pdfNotes,
  removeOrphanedPdfDrawings,
  removePdfDrawing,
  updatePdfDrawingComment,
  upsertPdfDrawing,
} from './pdf-annotations'
import {
  PDF_HIGHLIGHT_COLOR,
  createPdfEllipseDrawing,
  createPdfHighlightDrawing,
  createPdfInkDrawing,
  createPdfTextHighlightDrawing,
} from './pdf-drawing'

const rect = { left: 0.1, top: 0.2, width: 0.3, height: 0.04 }
const document = { key: 'a'.repeat(64), fingerprint: 'b'.repeat(64) }
const stroke = [[{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }]]

const legacyAnnotation = {
  id: 'legacy-1',
  page: 2,
  quote: 'Passage stable',
  rects: [rect],
  color: 'amber',
  comment: 'note héritée',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  status: 'active',
}

describe('identité du carnet', () => {
  it('identifie un PDF par son chemin canonique et son contenu', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const first = await pdfAnnotationIdentity('C:/Docs/Test.pdf', bytes)
    const same = await pdfAnnotationIdentity('c:\\docs\\test.pdf', bytes)
    const changed = await pdfAnnotationIdentity('C:/Docs/Test.pdf', new Uint8Array([1, 2, 3, 5]))
    expect(same).toEqual(first)
    expect(changed.key).toBe(first.key)
    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })

  it('détecte aussi une modification au milieu d’un PDF de même taille', async () => {
    const original = new Uint8Array(150_000)
    const changed = original.slice()
    changed[75_000] = 1
    const before = await pdfAnnotationIdentity('C:/Docs/Test.pdf', original)
    const after = await pdfAnnotationIdentity('C:/Docs/Test.pdf', changed)
    expect(after.key).toBe(before.key)
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })
})

describe('manifeste v5', () => {
  it('migre un surlignage hérité en tracé de texte, sans rien perdre', () => {
    const json = JSON.stringify({ version: 2, document, annotations: [legacyAnnotation], drawings: [] })
    const parsed = parsePdfAnnotationManifest(json, document)
    expect(parsed.manifest.version).toBe(5)
    expect(parsed.manifest.drawings).toHaveLength(1)
    expect(parsed.manifest.drawings[0]).toMatchObject({
      id: 'legacy-1',
      kind: 'text',
      page: 2,
      rects: [rect],
      quote: 'Passage stable',
      comment: 'note héritée',
      color: PDF_HIGHLIGHT_COLOR,
      createdAt: '2026-08-01T10:00:00.000Z',
    })
  })

  it('relit un surlignage de texte v5 avec sa citation et sa couleur', () => {
    const highlight = createPdfTextHighlightDrawing(1, [rect], { id: 'txt-1', quote: 'mots surlignés', color: '#8CE99A' })
    const json = JSON.stringify({ version: 4, document, drawings: [highlight] })
    expect(parsePdfAnnotationManifest(json, document).manifest.drawings[0]).toMatchObject({
      id: 'txt-1', kind: 'text', quote: 'mots surlignés', color: '#8CE99A',
    })
  })

  it('rassemble surlignages hérités et tracés existants dans un seul tableau', () => {
    const ink = createPdfInkDrawing(1, stroke, { id: 'ink-1' })
    const json = JSON.stringify({ version: 3, document, annotations: [legacyAnnotation], drawings: [ink] })
    expect(parsePdfAnnotationManifest(json, document).manifest.drawings.map((d) => [d.id, d.kind])).toEqual([
      ['legacy-1', 'text'],
      ['ink-1', 'ink'],
    ])
  })

  it('rejette un surlignage sans aucun rectangle exploitable', () => {
    const json = JSON.stringify({
      version: 4,
      document,
      drawings: [{ ...createPdfTextHighlightDrawing(1, [rect], { id: 'txt-1' }), rects: [{ left: 0.5, top: 0.5, width: 0, height: 0.1 }] }],
    })
    expect(parsePdfAnnotationManifest(json, document).manifest.drawings).toEqual([])
  })

  it('rend tout orphelin si l’empreinte du PDF a changé', () => {
    const changed = { key: document.key, fingerprint: 'neuf' }
    const json = JSON.stringify({
      version: 4,
      document,
      drawings: [createPdfTextHighlightDrawing(1, [rect], { id: 'txt-1' }), createPdfInkDrawing(1, stroke, { id: 'ink-1' })],
    })
    const parsed = parsePdfAnnotationManifest(json, changed)
    expect(parsed.stale).toBe(true)
    expect(parsed.manifest.drawings.map((d) => d.status)).toEqual(['orphaned', 'orphaned'])
  })

  it('signale un manifeste illisible au lieu de le faire passer pour vide', () => {
    // Un fichier cassé ou écrit par une version postérieure ne doit PAS être confondu
    // avec un carnet vide : l'appelant l'écraserait au premier tracé.
    const casse = parsePdfAnnotationManifest('{', document)
    expect(casse.manifest).toEqual(emptyPdfAnnotationManifest(document))
    expect(casse.unreadable).toBe(true)

    const futur = parsePdfAnnotationManifest(JSON.stringify({ version: 9, document, drawings: [] }), document)
    expect(futur.unreadable).toBe(true)

    // Absence de fichier et clé étrangère sont des carnets vides légitimes.
    expect(parsePdfAnnotationManifest(null, document).unreadable).toBe(false)
    const autre = JSON.stringify({ version: 5, document: { key: 'c'.repeat(64), fingerprint: 'x' }, drawings: [] })
    expect(parsePdfAnnotationManifest(autre, document).unreadable).toBe(false)
  })
})

describe('édition du carnet', () => {
  it('conserve, remplace puis supprime un tracé', () => {
    const drawing = createPdfInkDrawing(1, stroke, { id: 'ink-1' })
    const added = upsertPdfDrawing(emptyPdfAnnotationManifest(document), drawing)
    expect(added.drawings).toEqual([drawing])
    const moved = { ...drawing, strokes: [[{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.6 }]] }
    expect(upsertPdfDrawing(added, moved).drawings).toEqual([moved])
    expect(removePdfDrawing(added, drawing.id).drawings).toEqual([])
  })

  it('commente n’importe quel tracé, surlignage de texte compris', () => {
    const highlight = createPdfTextHighlightDrawing(1, [rect], { id: 'txt-1', quote: 'mots' })
    const manifest = upsertPdfDrawing(emptyPdfAnnotationManifest(document), highlight)
    const updated = updatePdfDrawingComment(manifest, 'txt-1', '  À relire  ', '2026-08-14T11:00:00.000Z')
    expect(updated.drawings[0]).toMatchObject({
      comment: 'À relire',
      updatedAt: '2026-08-14T11:00:00.000Z',
      rects: [rect],
      quote: 'mots',
    })
  })

  it('purge les orphelins sans toucher aux tracés replaçables', () => {
    const kept = createPdfInkDrawing(1, stroke, { id: 'ink-1' })
    const lost = { ...createPdfInkDrawing(2, stroke, { id: 'ink-2' }), status: 'orphaned' as const }
    const manifest = { ...emptyPdfAnnotationManifest(document), drawings: [kept, lost] }
    expect(removeOrphanedPdfDrawings(manifest).drawings).toEqual([kept])
  })
})

describe('notes et épingles', () => {
  const manifest = {
    ...emptyPdfAnnotationManifest(document),
    drawings: [
      createPdfTextHighlightDrawing(1, [{ ...rect, top: 0.2 }], { id: 'txt', quote: 'passage surligné' }),
      createPdfHighlightDrawing(1, [[{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }]], { id: 'libre', quote: 'trait libre' }),
      createPdfInkDrawing(2, [[{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.4 }]], { id: 'ink-nu' }),
      createPdfEllipseDrawing(2, { x: 0.1, y: 0.1 }, { x: 0.4, y: 0.3 }, { id: 'ellipse', comment: 'à vérifier' }),
    ],
  }

  it('liste les surlignages et les tracés commentés, en écartant les gribouillis nus', () => {
    expect(pdfNotes(manifest).map((note) => [note.id, note.kind, note.page])).toEqual([
      ['txt', 'text', 1],
      ['libre', 'highlight', 1],
      ['ellipse', 'ellipse', 2],
    ])
  })

  it('place le repère au sommet de l’objet annoté', () => {
    const byId = Object.fromEntries(pdfNotes(manifest).map((note) => [note.id, note.top]))
    expect(byId.txt).toBeCloseTo(0.2)
    expect(byId.libre).toBeCloseTo(0.5)
    expect(byId.ellipse).toBeCloseTo(0.1)
  })

  it('n’épingle que les notes commentées et regroupe les voisines', () => {
    const base = pdfNotes(manifest)[0]
    expect(clusterPdfNotePins(pdfNotes(manifest), 1_000).map((c) => c.map((n) => n.id))).toEqual([['ellipse']])
    const close = [
      { ...base, id: 'a', top: 0.20, comment: 'x' },
      { ...base, id: 'b', top: 0.22, comment: 'y' },
      { ...base, id: 'c', top: 0.60, comment: 'z' },
    ]
    expect(clusterPdfNotePins(close, 1_000).map((c) => c.map((n) => n.id))).toEqual([['a', 'b'], ['c']])
  })
})
