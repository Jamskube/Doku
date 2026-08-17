import { describe, expect, it } from 'vitest'
import {
  PDF_BURN_MIN_STROKE,
  PDF_BURN_NOTE_SIZE,
  PdfBurnError,
  applyPdfPagePlan,
  burnPdfAnnotations,
  normalizePdfRotation,
  pdfBurnAnchor,
  pdfBurnPathData,
  pdfBurnPoint,
  pdfBurnRect,
  pdfBurnStrokeWidth,
  pdfNoteMarkerRect,
  pdfRgbFromHex,
  type PdfBurnPage,
} from './pdf-write'
import {
  createPdfEllipseDrawing,
  createPdfHighlightDrawing,
  createPdfInkDrawing,
  createPdfRectangleDrawing,
  createPdfTextHighlightDrawing,
  type PdfDrawing,
  type PdfDrawingRect,
} from './pdf-drawing'
import {
  dropPdfPagePlan,
  identityPdfPagePlan,
  insertPdfPagePlan,
  movePdfPagePlan,
  turnPdfPagePlan,
} from './pdf-pages'

function page(rotation: number, extra: Partial<PdfBurnPage> = {}): PdfBurnPage {
  return { x: 0, y: 0, width: 600, height: 800, rotation, ...extra }
}

describe('normalizePdfRotation', () => {
  it('ramène tout angle à un quart de tour', () => {
    expect(normalizePdfRotation(0)).toBe(0)
    expect(normalizePdfRotation(90)).toBe(90)
    expect(normalizePdfRotation(360)).toBe(0)
    expect(normalizePdfRotation(450)).toBe(90)
    expect(normalizePdfRotation(-90)).toBe(270)
    expect(normalizePdfRotation(-450)).toBe(270)
  })

  it('arrondit un angle non conforme au lieu de le rejeter', () => {
    expect(normalizePdfRotation(89)).toBe(90)
    expect(normalizePdfRotation(271)).toBe(270)
  })
})

describe('pdfBurnPoint', () => {
  // Le coin haut gauche de l'AFFICHAGE change de coin de page à chaque rotation :
  // c'est tout le piège que ces quatre cas verrouillent.
  it('page droite : le haut gauche affiché est le haut gauche de la page', () => {
    expect(pdfBurnPoint({ x: 0, y: 0 }, page(0))).toEqual({ x: 0, y: 800 })
    expect(pdfBurnPoint({ x: 1, y: 1 }, page(0))).toEqual({ x: 600, y: 0 })
  })

  it('page à 90° : le haut gauche affiché est le bas gauche de la page', () => {
    expect(pdfBurnPoint({ x: 0, y: 0 }, page(90))).toEqual({ x: 0, y: 0 })
    expect(pdfBurnPoint({ x: 1, y: 0 }, page(90))).toEqual({ x: 0, y: 800 })
    expect(pdfBurnPoint({ x: 0, y: 1 }, page(90))).toEqual({ x: 600, y: 0 })
  })

  it('page à 180° : les deux axes sont retournés', () => {
    expect(pdfBurnPoint({ x: 0, y: 0 }, page(180))).toEqual({ x: 600, y: 0 })
    expect(pdfBurnPoint({ x: 1, y: 1 }, page(180))).toEqual({ x: 0, y: 800 })
  })

  it('page à 270° : le haut gauche affiché est le haut droit de la page', () => {
    expect(pdfBurnPoint({ x: 0, y: 0 }, page(270))).toEqual({ x: 600, y: 800 })
    expect(pdfBurnPoint({ x: 1, y: 0 }, page(270))).toEqual({ x: 600, y: 0 })
    expect(pdfBurnPoint({ x: 0, y: 1 }, page(270))).toEqual({ x: 0, y: 800 })
  })

  it('reste dans la page à toutes les rotations', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const target = page(rotation)
      for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }]) {
        const projected = pdfBurnPoint(point, target)
        expect(projected.x).toBeGreaterThanOrEqual(0)
        expect(projected.x).toBeLessThanOrEqual(600)
        expect(projected.y).toBeGreaterThanOrEqual(0)
        expect(projected.y).toBeLessThanOrEqual(800)
      }
    }
  })

  it('décale du coin de la boîte de recadrage', () => {
    // Une CropBox qui ne part pas de l'origine (repères d'impression) décalerait tout
    // l'export si on prenait la MediaBox à sa place.
    const cropped = page(0, { x: 20, y: 30 })
    expect(pdfBurnPoint({ x: 0, y: 0 }, cropped)).toEqual({ x: 20, y: 830 })
    expect(pdfBurnPoint({ x: 1, y: 1 }, cropped)).toEqual({ x: 620, y: 30 })
  })
})

describe('pdfBurnRect', () => {
  it('garde des dimensions positives à toutes les rotations', () => {
    const rect = { left: 0.1, top: 0.2, width: 0.3, height: 0.4 }
    for (const rotation of [0, 90, 180, 270]) {
      const box = pdfBurnRect(rect, page(rotation))
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
  })

  it('échange les côtés sur un quart de tour', () => {
    const rect = { left: 0, top: 0, width: 0.5, height: 0.25 }
    const straight = pdfBurnRect(rect, page(0))
    const turned = pdfBurnRect(rect, page(90))
    expect(straight.width).toBeCloseTo(300)
    expect(straight.height).toBeCloseTo(200)
    expect(turned.width).toBeCloseTo(150)
    expect(turned.height).toBeCloseTo(400)
  })
})

describe('pdfBurnStrokeWidth', () => {
  it('suit la plus petite dimension de la page, comme à l’écran', () => {
    expect(pdfBurnStrokeWidth(4, page(0))).toBeCloseTo(2.4)
    expect(pdfBurnStrokeWidth(20, page(0))).toBeCloseTo(12)
  })

  it('ne dépend pas de la rotation', () => {
    for (const rotation of [90, 180, 270]) {
      expect(pdfBurnStrokeWidth(4, page(rotation))).toBeCloseTo(pdfBurnStrokeWidth(4, page(0)))
    }
  })

  it('garde un trait visible à l’impression', () => {
    expect(pdfBurnStrokeWidth(0.001, page(0))).toBe(PDF_BURN_MIN_STROKE)
  })
})

describe('pdfRgbFromHex', () => {
  it('lit une couleur du manifeste', () => {
    expect(pdfRgbFromHex('#FFD400')).toEqual({ r: 1, g: 212 / 255, b: 0 })
    expect(pdfRgbFromHex('000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('retombe sur le noir plutôt que sur du NaN', () => {
    expect(pdfRgbFromHex('rouge')).toEqual({ r: 0, g: 0, b: 0 })
    expect(pdfRgbFromHex('#fff')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('pdfBurnPathData', () => {
  it('produit un chemin ancré au coin haut gauche de la page', () => {
    const target = page(0)
    expect(pdfBurnAnchor(target)).toEqual({ x: 0, y: 800 })
    const path = pdfBurnPathData([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], target)
    expect(path).toBe('M 0 0 L 600 800')
  })

  it('suit la rotation de la page', () => {
    // Même geste, page tournée : le chemin doit changer, sinon la gravure ignorerait
    // le `/Rotate` et poserait le tracé de travers.
    const straight = pdfBurnPathData([[{ x: 0, y: 0 }, { x: 1, y: 0 }]], page(0))
    const turned = pdfBurnPathData([[{ x: 0, y: 0 }, { x: 1, y: 0 }]], page(90))
    expect(straight).toBe('M 0 0 L 600 0')
    expect(turned).toBe('M 0 800 L 0 0')
  })
})

// --- Gravure réelle ---------------------------------------------------------------
// pdf-lib tourne en Node : on peut fabriquer un PDF, le graver et le relire sans
// navigateur. C'est ce qui prouve que le fichier produit s'ouvre encore.

async function blankPdf(pages: { width: number; height: number; rotation?: number }[]): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  for (const spec of pages) {
    const created = doc.addPage([spec.width, spec.height])
    if (spec.rotation) created.setRotation(degrees(spec.rotation))
  }
  return doc.save()
}

function everyKind(): PdfDrawing[] {
  return [
    createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.35 }, { x: 0.6, y: 0.2 }]]),
    createPdfHighlightDrawing(1, [[{ x: 0.1, y: 0.5 }, { x: 0.8, y: 0.5 }]], { quote: 'passage' }),
    createPdfTextHighlightDrawing(1, [{ left: 0.1, top: 0.6, width: 0.5, height: 0.02 }], { quote: 'ligne' }),
    createPdfRectangleDrawing(1, { x: 0.2, y: 0.7 }, { x: 0.6, y: 0.8 }),
    createPdfEllipseDrawing(1, { x: 0.2, y: 0.85 }, { x: 0.5, y: 0.95 }),
  ]
}

describe('burnPdfAnnotations', () => {
  it('grave chaque type de tracé et rend un PDF relisible', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const result = await burnPdfAnnotations(source, everyKind())
    expect(result.burned).toBe(5)
    expect(result.skipped).toBe(0)
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const reopened = await PDFDocument.load(result.bytes)
    expect(reopened.getPageCount()).toBe(1)
    expect(result.bytes.length).toBeGreaterThan(source.length)
  })

  it('ne touche jamais les octets de la source', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const copy = source.slice()
    await burnPdfAnnotations(source, everyKind())
    expect(source).toEqual(copy)
  })

  it('transforme un commentaire en annotation PDF lisible ailleurs', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const commented = createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]], {
      comment: 'Vérifier la clause « résiliation »',
    })
    const result = await burnPdfAnnotations(source, [commented])
    expect(result.notes).toBe(1)
    const { PDFDocument, PDFName, PDFArray } = await import('@cantoo/pdf-lib')
    const reopened = await PDFDocument.load(result.bytes)
    const annots = reopened.getPage(0).node.get(PDFName.of('Annots'))
    expect(annots).toBeInstanceOf(PDFArray)
    expect((annots as unknown as { size: () => number }).size()).toBe(1)
  })

  it('écarte un tracé orphelin au lieu de le poser au hasard', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const orphan = { ...createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]]), status: 'orphaned' as const }
    await expect(burnPdfAnnotations(source, [orphan])).rejects.toBeInstanceOf(PdfBurnError)
  })

  it('compte les tracés dont la page n’existe plus au lieu de casser', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const drawings = [
      createPdfInkDrawing(1, [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]]),
      createPdfInkDrawing(9, [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]]),
    ]
    const result = await burnPdfAnnotations(source, drawings)
    expect(result.burned).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('grave aussi sur les pages tournées', async () => {
    for (const rotation of [90, 180, 270]) {
      const source = await blankPdf([{ width: 600, height: 800, rotation }])
      const result = await burnPdfAnnotations(source, everyKind())
      expect(result.burned).toBe(5)
    }
  })

  it('refuse un carnet vide plutôt que de produire une copie muette', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    await expect(burnPdfAnnotations(source, [])).rejects.toBeInstanceOf(PdfBurnError)
  })
})

describe('applyPdfPagePlan', () => {
  const four = () => blankPdf([
    { width: 600, height: 800 },
    { width: 600, height: 800 },
    { width: 400, height: 400 },
    { width: 600, height: 800 },
  ])

  async function pageSizes(bytes: Uint8Array) {
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const doc = await PDFDocument.load(bytes)
    return doc.getPages().map((page) => ({
      width: Math.round(page.getWidth()),
      height: Math.round(page.getHeight()),
      rotation: page.getRotation().angle,
    }))
  }

  it('réordonne les pages sans en perdre', async () => {
    const source = await four()
    // La page carrée est reconnaissable : elle prouve que c'est bien ELLE qui a bougé.
    const plan = movePdfPagePlan(identityPdfPagePlan(4), 2, 0)
    const result = await applyPdfPagePlan([source], plan)
    expect(result.pages).toBe(4)
    const sizes = await pageSizes(result.bytes)
    expect(sizes[0]).toMatchObject({ width: 400, height: 400 })
    expect(sizes).toHaveLength(4)
  })

  it('supprime une page', async () => {
    const source = await four()
    const result = await applyPdfPagePlan([source], dropPdfPagePlan(identityPdfPagePlan(4), 2))
    expect(result.pages).toBe(3)
    expect(await pageSizes(result.bytes)).not.toContainEqual(expect.objectContaining({ width: 400 }))
  })

  it('compose la rotation avec celle que la page portait déjà', async () => {
    const source = await blankPdf([{ width: 600, height: 800, rotation: 90 }])
    const result = await applyPdfPagePlan([source], turnPdfPagePlan(identityPdfPagePlan(1), 0, 1))
    expect((await pageSizes(result.bytes))[0].rotation).toBe(180)
  })

  it('fusionne deux documents', async () => {
    const first = await blankPdf([{ width: 600, height: 800 }])
    const second = await blankPdf([{ width: 300, height: 300 }, { width: 300, height: 300 }])
    const plan = insertPdfPagePlan(identityPdfPagePlan(1), 1, 1, 2)
    const result = await applyPdfPagePlan([first, second], plan)
    expect(result.pages).toBe(3)
    const sizes = await pageSizes(result.bytes)
    expect(sizes[0].width).toBe(600)
    expect(sizes[1].width).toBe(300)
    expect(sizes[2].width).toBe(300)
  })

  it('ne touche jamais les octets des sources', async () => {
    const source = await four()
    const copy = source.slice()
    await applyPdfPagePlan([source], movePdfPagePlan(identityPdfPagePlan(4), 0, 3))
    expect(source).toEqual(copy)
  })

  it('refuse un document sans page', async () => {
    const source = await four()
    await expect(applyPdfPagePlan([source], [])).rejects.toBeInstanceOf(PdfBurnError)
  })

  it('refuse une page qui n’existe pas dans sa source', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    await expect(applyPdfPagePlan([source], [{ from: 0, source: 9, turn: 0 }])).rejects.toBeInstanceOf(PdfBurnError)
  })
})

describe('pdfNoteMarkerRect', () => {
  const page = { x: 0, y: 0, width: 600, height: 800, rotation: 0 }
  // Un passage surligné au milieu d'une colonne de texte : le cas de la capture qui a
  // motivé ce changement — le repère se posait sur les premiers mots.
  const passage = { left: 0.12, top: 0.2, width: 0.76, height: 0.03 }

  it('pose le repère DANS LA MARGE, jamais sur le passage annoté', () => {
    const m = pdfNoteMarkerRect(passage, page)
    expect(m.left + m.width).toBeLessThanOrEqual(passage.left)
  })

  // Le cas que le rendu de contrôle a révélé : surligner en MILIEU de ligne laissait le
  // repère sur les mots qui précèdent, parce qu'il se calait sur l'annotation et non sur
  // la page.
  it('reste au bord de la PAGE, même pour un passage surligné en milieu de ligne', () => {
    const milieu = { left: 0.55, top: 0.3, width: 0.3, height: 0.02 }
    const m = pdfNoteMarkerRect(milieu, page)
    // Assez près du bord pour être dans la marge, très loin du début du passage.
    expect(m.left + m.width).toBeLessThan(0.06)
    expect(m.left).toBeGreaterThan(0)
  })

  it('reste dans la page', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const m = pdfNoteMarkerRect(passage, { ...page, rotation })
      expect(m.left).toBeGreaterThanOrEqual(0)
      expect(m.top).toBeGreaterThanOrEqual(0)
      expect(m.left + m.width).toBeLessThanOrEqual(1)
      expect(m.top + m.height).toBeLessThanOrEqual(1)
    }
  })

  it('mesure 18 pt de côté quelle que soit la rotation', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const p = { ...page, rotation }
      const m = pdfNoteMarkerRect(passage, p)
      const zone = pdfBurnRect(m, p)
      expect(zone.width).toBeCloseTo(PDF_BURN_NOTE_SIZE, 6)
      expect(zone.height).toBeCloseTo(PDF_BURN_NOTE_SIZE, 6)
    }
  })

  it('bascule à DROITE quand la marge gauche est trop étroite', () => {
    const colle = { left: 0.002, top: 0.4, width: 0.5, height: 0.03 }
    const m = pdfNoteMarkerRect(colle, page)
    expect(m.left).toBeGreaterThanOrEqual(colle.left + colle.width)
  })

  it('passe AU-DESSUS quand l’annotation prend toute la largeur', () => {
    const pleine = { left: 0, top: 0.5, width: 1, height: 0.03 }
    const m = pdfNoteMarkerRect(pleine, page)
    expect(m.top + m.height).toBeLessThanOrEqual(pleine.top)
  })

  it('ne superpose pas deux commentaires voisins', () => {
    const poses: PdfDrawingRect[] = []
    for (let i = 0; i < 4; i++) {
      poses.push(pdfNoteMarkerRect(passage, page, poses))
    }
    for (let a = 0; a < poses.length; a++) {
      for (let b = a + 1; b < poses.length; b++) {
        const x = poses[a], y = poses[b]
        const seTouchent = x.left < y.left + y.width && y.left < x.left + x.width &&
          x.top < y.top + y.height && y.top < x.top + x.height
        expect(seTouchent).toBe(false)
      }
    }
  })

  it('reste aligné sur la LIGNE annotée, pas renvoyé en haut de page', () => {
    const m = pdfNoteMarkerRect(passage, page)
    expect(Math.abs(m.top - passage.top)).toBeLessThan(0.02)
  })
})

describe('repère de commentaire dans le PDF gravé', () => {
  // Preuve en boucle fermée : on relit le `/Rect` réellement écrit dans le fichier, et
  // on vérifie qu'il ne recouvre pas le passage surligné. Un test qui n'inspecterait que
  // la fonction de placement ne dirait rien de ce qui atterrit dans le document.
  it('n’écrit pas le repère par-dessus le passage surligné', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const passage = { left: 0.12, top: 0.2, width: 0.76, height: 0.03 }
    const surlignage = createPdfTextHighlightDrawing(1, [passage], { color: '#ffd400' })
    const result = await burnPdfAnnotations(source, [{ ...surlignage, comment: 'Une remarque' }])
    expect(result.notes).toBe(1)

    const mupdf = await import('mupdf')
    const doc = mupdf.Document.openDocument(result.bytes.slice(), 'application/pdf') as never as {
      loadPage: (n: number) => { getAnnotations: () => { getBounds: () => number[] }[] }
    }
    const bornes = doc.loadPage(0).getAnnotations().map((a) => a.getBounds())
    expect(bornes.length).toBe(1)

    // Le passage surligné, dans le repère PDF (page droite, origine en bas à gauche).
    const page = { x: 0, y: 0, width: 600, height: 800, rotation: 0 }
    const zonePassage = pdfBurnRect(passage, page)
    const [x0, y0, x1, y1] = bornes[0]
    // MuPDF rend ses bornes en y DESCENDANT depuis le haut : on repasse en repère PDF.
    const hautPdf = 800 - Math.min(y0, y1)
    const basPdf = 800 - Math.max(y0, y1)
    const chevauche =
      Math.min(x0, x1) < zonePassage.x + zonePassage.width && zonePassage.x < Math.max(x0, x1) &&
      basPdf < zonePassage.y + zonePassage.height && zonePassage.y < hautPdf
    expect(chevauche).toBe(false)
  })

  it('empile les repères de plusieurs commentaires sans les superposer', async () => {
    const source = await blankPdf([{ width: 600, height: 800 }])
    const passage = { left: 0.12, top: 0.2, width: 0.76, height: 0.03 }
    const notes = [1, 2, 3].map((n) => ({
      ...createPdfTextHighlightDrawing(1, [passage], { color: '#ffd400' }),
      comment: `Remarque ${n}`,
    }))
    const result = await burnPdfAnnotations(source, notes)
    expect(result.notes).toBe(3)

    const mupdf = await import('mupdf')
    const doc = mupdf.Document.openDocument(result.bytes.slice(), 'application/pdf') as never as {
      loadPage: (n: number) => { getAnnotations: () => { getBounds: () => number[] }[] }
    }
    const bornes = doc.loadPage(0).getAnnotations().map((a) => a.getBounds())
    expect(bornes.length).toBe(3)
    for (let a = 0; a < bornes.length; a++) {
      for (let b = a + 1; b < bornes.length; b++) {
        const [ax0, ay0, ax1, ay1] = bornes[a]
        const [bx0, by0, bx1, by1] = bornes[b]
        const seTouchent =
          Math.min(ax0, ax1) < Math.max(bx0, bx1) && Math.min(bx0, bx1) < Math.max(ax0, ax1) &&
          Math.min(ay0, ay1) < Math.max(by0, by1) && Math.min(by0, by1) < Math.max(ay0, ay1)
        expect(seTouchent).toBe(false)
      }
    }
  })
})
