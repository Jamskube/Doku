import { describe, expect, it } from 'vitest'
import { createPdfInkDrawing, pdfDrawingBox } from './pdf-drawing'
import {
  MIN_PDF_DRAWING_EXTENT,
  pdfResizeFactor,
  pdfRotationAngle,
  rotatePdfStrokeDrawing,
  scalePdfStrokeDrawing,
} from './pdf-drawing-transform'

const A4 = 210 / 297
// Trait horizontal de 0,4 de large, surmonté d'un petit jambage : cadre 0,4 × 0,1.
const ink = (left = 0.3, top = 0.5) => createPdfInkDrawing(1, [
  [{ x: left, y: top + 0.1 }, { x: left + 0.2, y: top + 0.1 }, { x: left + 0.4, y: top + 0.1 }],
  [{ x: left + 0.2, y: top }, { x: left + 0.2, y: top + 0.1 }],
], { id: 'ink' })

describe('scalePdfStrokeDrawing', () => {
  it('garde le coin haut-gauche et les proportions', () => {
    const box = pdfDrawingBox(scalePdfStrokeDrawing(ink(), 0.5))
    expect(box.left).toBeCloseTo(0.3)
    expect(box.top).toBeCloseTo(0.5)
    expect(box.width).toBeCloseTo(0.2)
    expect(box.height).toBeCloseTo(0.05)
  })

  it('ne sort jamais de la page en grandissant', () => {
    const box = pdfDrawingBox(scalePdfStrokeDrawing(ink(), 50))
    expect(box.left + box.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(box.top + box.height).toBeLessThanOrEqual(1 + 1e-9)
    // Borné par la largeur restante (0,7 / 0,4), et toujours proportionné.
    expect(box.width / box.height).toBeCloseTo(4)
  })

  it('ne rétrécit pas jusqu’à disparaître, même avec un facteur nul ou négatif', () => {
    for (const factor of [0, -3]) {
      const box = pdfDrawingBox(scalePdfStrokeDrawing(ink(), factor))
      expect(box.width).toBeCloseTo(MIN_PDF_DRAWING_EXTENT)
    }
  })

  it('rend le tracé intact sur un facteur illisible', () => {
    const drawing = ink()
    expect(scalePdfStrokeDrawing(drawing, Number.NaN)).toBe(drawing)
  })
})

describe('rotatePdfStrokeDrawing', () => {
  it('un quart de tour échange largeur et hauteur RÉELLES, pas les fractions', () => {
    const before = pdfDrawingBox(ink())
    const after = pdfDrawingBox(rotatePdfStrokeDrawing(ink(), Math.PI / 2, A4))
    expect(after.height).toBeCloseTo(before.width * A4)
    expect(after.width * A4).toBeCloseTo(before.height)
  })

  it('tourne autour du centre du cadre', () => {
    const before = pdfDrawingBox(ink())
    const after = pdfDrawingBox(rotatePdfStrokeDrawing(ink(), Math.PI, A4))
    expect(after.left + after.width / 2).toBeCloseTo(before.left + before.width / 2)
    expect(after.top + after.height / 2).toBeCloseTo(before.top + before.height / 2)
  })

  it('un tour complet rend les mêmes points', () => {
    const drawing = ink()
    const turned = rotatePdfStrokeDrawing(drawing, 2 * Math.PI, A4)
    turned.strokes.flat().forEach((point, index) => {
      expect(point.x).toBeCloseTo(drawing.strokes.flat()[index].x)
      expect(point.y).toBeCloseTo(drawing.strokes.flat()[index].y)
    })
  })

  it('décale dans la page au lieu de rogner', () => {
    // Collé au bord bas : un quart de tour le ferait dépasser de la page.
    const after = rotatePdfStrokeDrawing(ink(0.3, 0.89), Math.PI / 2, A4)
    const box = pdfDrawingBox(after)
    expect(box.top + box.height).toBeLessThanOrEqual(1 + 1e-9)
    expect(box.height).toBeCloseTo(0.4 * A4)
  })

  it('refuse la rotation qui ne tient plus dans la page', () => {
    // Trait vertical sur presque toute la hauteur : couché, il serait plus large que la page.
    const tall = createPdfInkDrawing(1, [[{ x: 0.5, y: 0.02 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.98 }]])
    expect(rotatePdfStrokeDrawing(tall, Math.PI / 2, A4)).toBe(tall)
  })
})

describe('gestes des poignées', () => {
  const box = { left: 0.3, top: 0.5, width: 0.4, height: 0.1 }

  it('aucun déplacement = aucun changement', () => {
    const at = { x: 0.7, y: 0.6 }
    expect(pdfResizeFactor(box, at, at, A4)).toBe(1)
    expect(pdfRotationAngle(box, at, at, A4)).toBe(0)
  })

  it('ramener la poignée d’angle au coin opposé annule la taille', () => {
    expect(pdfResizeFactor(box, { x: 0.7, y: 0.6 }, { x: 0.3, y: 0.5 }, A4)).toBeCloseTo(0)
  })

  it('doubler la diagonale double la taille', () => {
    expect(pdfResizeFactor(box, { x: 0.7, y: 0.6 }, { x: 1.1, y: 0.7 }, A4)).toBeCloseTo(2)
  })

  it('mesure un quart de tour dans le repère réel de la page', () => {
    // Du dessus du centre vers sa droite, à distance réelle égale : +90° (y vers le bas).
    const center = { x: 0.5, y: 0.55 }
    const angle = pdfRotationAngle(box, { x: center.x, y: center.y - 0.1 }, { x: center.x + 0.1 / A4, y: center.y }, A4)
    expect(angle).toBeCloseTo(Math.PI / 2)
  })
})
