// Redimensionner et tourner un tracé : de simples transformations de points, puisqu'un
// tracé n'est que cela. Aucune orientation n'est stockée — le manifeste ne change pas.
//
// Les fractions de page ne sont PAS isotropes (0,1 en x et 0,1 en y ne font pas la même
// longueur sur une page A4) : tout angle et toute distance se calculent dans un repère
// commun, la hauteur de page, où une abscisse vaut `x * pageAspect`.
import { pdfDrawingBox, type PdfDrawingPoint, type PdfDrawingRect, type PdfStrokeDrawing } from './pdf-drawing'

// Plus petit côté dominant d'un tracé redimensionné : en dessous, il devient un point
// qu'on ne peut plus rattraper.
export const MIN_PDF_DRAWING_EXTENT = 0.02

/**
 * Facteur d'échelle d'un glisser de la poignée d'angle : la part du déplacement portée
 * par la diagonale du cadre. Relatif au point de départ, donc sans saut à la prise.
 */
export function pdfResizeFactor(box: PdfDrawingRect, from: PdfDrawingPoint, to: PdfDrawingPoint, pageAspect: number): number {
  const diagonalX = box.width * pageAspect
  const diagonalY = box.height
  const length = diagonalX * diagonalX + diagonalY * diagonalY
  if (!(length > 0)) return 1
  return 1 + ((to.x - from.x) * pageAspect * diagonalX + (to.y - from.y) * diagonalY) / length
}

/** Angle balayé autour du centre du cadre entre deux positions du pointeur, en radians. */
export function pdfRotationAngle(box: PdfDrawingRect, from: PdfDrawingPoint, to: PdfDrawingPoint, pageAspect: number): number {
  const centerX = (box.left + box.width / 2) * pageAspect
  const centerY = box.top + box.height / 2
  return Math.atan2(to.y - centerY, to.x * pageAspect - centerX)
    - Math.atan2(from.y - centerY, from.x * pageAspect - centerX)
}

/** Échelle uniforme autour du coin haut-gauche, bornée par la page et par une taille minimale. */
export function scalePdfStrokeDrawing(
  drawing: PdfStrokeDrawing,
  factor: number,
  now = new Date().toISOString(),
): PdfStrokeDrawing {
  const box = pdfDrawingBox(drawing)
  const extent = Math.max(box.width, box.height)
  if (!(extent > 0) || !Number.isFinite(factor)) return drawing
  const largest = Math.min(
    box.width > 0 ? (1 - box.left) / box.width : Infinity,
    box.height > 0 ? (1 - box.top) / box.height : Infinity,
  )
  const scale = Math.min(Math.max(factor, MIN_PDF_DRAWING_EXTENT / extent), largest)
  return {
    ...drawing,
    strokes: drawing.strokes.map((stroke) => stroke.map((point) => ({
      x: box.left + (point.x - box.left) * scale,
      y: box.top + (point.y - box.top) * scale,
    }))),
    updatedAt: now,
  }
}

/**
 * Rotation autour du centre du cadre. Un tracé qui déborderait est DÉCALÉ dans la page,
 * jamais rogné (le rognage point par point le déformerait) ; s'il n'y tient plus du
 * tout, la rotation est refusée et le tracé rendu tel quel.
 */
export function rotatePdfStrokeDrawing(
  drawing: PdfStrokeDrawing,
  radians: number,
  pageAspect: number,
  now = new Date().toISOString(),
): PdfStrokeDrawing {
  if (!Number.isFinite(radians) || !(pageAspect > 0)) return drawing
  const box = pdfDrawingBox(drawing)
  const centerX = (box.left + box.width / 2) * pageAspect
  const centerY = box.top + box.height / 2
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const rotated = drawing.strokes.map((stroke) => stroke.map((point) => {
    const x = point.x * pageAspect - centerX
    const y = point.y - centerY
    return { x: (centerX + x * cos - y * sin) / pageAspect, y: centerY + x * sin + y * cos }
  }))
  const points = rotated.flat()
  if (!points.length) return drawing
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  if (maxX - minX > 1 || maxY - minY > 1) return drawing
  const dx = minX < 0 ? -minX : maxX > 1 ? 1 - maxX : 0
  const dy = minY < 0 ? -minY : maxY > 1 ? 1 - maxY : 0
  return {
    ...drawing,
    strokes: rotated.map((stroke) => stroke.map((point) => ({ x: point.x + dx, y: point.y + dy }))),
    updatedAt: now,
  }
}
