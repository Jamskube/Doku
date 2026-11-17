// Signature MANUSCRITE : tracée une fois, posée ensuite sur n'importe quelle page.
//
// C'est un tracé comme les autres (`ink`) : déplacement, gomme, annulation et gravure
// dans la copie exportée viennent donc gratuitement du carnet d'annotations.
//
// Ce que ce n'est PAS : une signature numérique (certificat, PKCS#7). Le PDF produit
// porte le DESSIN d'une signature, rien qui prouve qui l'a posée — voir
// `pdf-signatures.ts` pour l'autre sens du mot.
import {
  MAX_PDF_DRAWING_POINTS,
  MAX_PDF_DRAWING_STROKES,
  PDF_DRAWING_COLOR,
  createPdfInkDrawing,
  type PdfDrawingPoint,
  type PdfDrawingRect,
  type PdfInkDrawing,
} from './pdf-drawing'

export interface SavedSignature {
  version: 1
  /** Passes ramenées dans la boîte englobante de la signature : 0..1 sur chaque axe. */
  strokes: PdfDrawingPoint[][]
  /** Largeur / hauteur de cette boîte, telle que tracée. */
  aspect: number
  /** Épaisseur du trait une fois posé, dans l'unité du carnet (millièmes du petit côté de page). */
  strokeWidth: number
}

// « Fin » de la palette : ~1,2 pt sur une page A4, l'épaisseur d'un stylo.
export const SIGNATURE_STROKE_WIDTH = 2
// Choix offerts par le pavé. Plus serrés que ceux du crayon (2 / 4 / 8) : au-delà, les
// boucles d'une signature de 5 cm se bouchent.
// « Très fin » ≈ 0,7 pt sur A4 : un stylo à pointe fine. Il reste au-dessus des deux
// planchers en aval — 1 à la relecture du carnet, 0,5 pt à la gravure.
export const SIGNATURE_STROKE_WIDTHS = [
  { value: 1.2, label: 'Très fin' },
  { value: 2, label: 'Fin' },
  { value: 3, label: 'Moyen' },
  { value: 4.5, label: 'Épais' },
] as const
const MAX_SIGNATURE_STROKE_WIDTH = 8

function signatureStrokeWidth(value: unknown): number {
  // Absente d'une signature enregistrée avant ce réglage : le trait fin d'alors.
  return finite(value) ? clamp(value, 1, MAX_SIGNATURE_STROKE_WIDTH) : SIGNATURE_STROKE_WIDTH
}
// Cadre posé par un simple appui : ~5 cm × 2 cm sur A4. La HAUTEUR compte autant que la
// largeur — bornée par la seule largeur, une signature haute sortait à 5 cm de haut.
export const SIGNATURE_DEFAULT_WIDTH = 0.24
export const SIGNATURE_DEFAULT_HEIGHT = 0.065
// En deçà, le geste est un appui et non un cadre tracé.
const TAP_EXTENT = 0.02
const MIN_ASPECT = 0.2
const MAX_ASPECT = 20

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Tracés du pavé (fractions 0..1 du pavé) → signature normalisée. `null` si le geste
 * ne ressemble pas à une signature : un point ou un trait minuscule serait posé comme
 * une tache sur un contrat.
 */
export function captureSignature(
  strokes: PdfDrawingPoint[][],
  padAspect: number,
  strokeWidth: number = SIGNATURE_STROKE_WIDTH,
): SavedSignature | null {
  const kept = strokes.filter((stroke) => stroke.length >= 2).slice(0, MAX_PDF_DRAWING_STROKES)
  const points = kept.flat()
  if (!points.length || !finite(padAspect) || padAspect <= 0) return null
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  if (maxX - minX + (maxY - minY) < 0.05) return null
  // Plancher d'étendue : un trait parfaitement horizontal aurait une hauteur nulle,
  // donc un rapport infini et des ordonnées divisées par zéro.
  const width = Math.max(maxX - minX, TAP_EXTENT)
  const height = Math.max(maxY - minY, TAP_EXTENT)
  return {
    version: 1,
    strokes: kept.map((stroke) => stroke.map((point) => ({
      x: clamp((point.x - minX) / width, 0, 1),
      y: clamp((point.y - minY) / height, 0, 1),
    }))),
    aspect: clamp(width * padAspect / height, MIN_ASPECT, MAX_ASPECT),
    strokeWidth: signatureStrokeWidth(strokeWidth),
  }
}

/** Relecture du stockage : tout y est faillible, et `null` vaut « pas de signature ». */
export function parseSavedSignature(json: string | null | undefined): SavedSignature | null {
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const { version, strokes, aspect, strokeWidth } = raw as Record<string, unknown>
  if (version !== 1 || !Array.isArray(strokes) || !finite(aspect) || aspect <= 0) return null
  let budget = MAX_PDF_DRAWING_POINTS
  const clean: PdfDrawingPoint[][] = []
  for (const stroke of strokes.slice(0, MAX_PDF_DRAWING_STROKES)) {
    if (!Array.isArray(stroke)) continue
    const points = stroke
      .filter((point): point is PdfDrawingPoint => Boolean(point) && finite(point?.x) && finite(point?.y))
      .slice(0, budget)
      .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
    if (points.length < 2) continue
    budget -= points.length
    clean.push(points)
  }
  return clean.length
    ? { version: 1, strokes: clean, aspect: clamp(aspect, MIN_ASPECT, MAX_ASPECT), strokeWidth: signatureStrokeWidth(strokeWidth) }
    : null
}

/**
 * Cadre visé par le geste, en fractions de page. Un cadre tracé est pris tel quel ; un
 * simple appui pose la taille par défaut, centrée sur le doigt et ramenée dans la page.
 * `pageAspect` = largeur / hauteur de la page : les fractions ne sont pas isotropes.
 */
export function signatureTargetBox(
  start: PdfDrawingPoint,
  end: PdfDrawingPoint,
  aspect: number,
  pageAspect: number,
): PdfDrawingRect {
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  if (width >= TAP_EXTENT || height >= TAP_EXTENT) {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.max(width, TAP_EXTENT),
      height: Math.max(height, TAP_EXTENT),
    }
  }
  const realWidth = Math.min(SIGNATURE_DEFAULT_WIDTH * pageAspect, SIGNATURE_DEFAULT_HEIGHT * aspect)
  const boxWidth = realWidth / pageAspect
  const boxHeight = realWidth / aspect
  return {
    left: clamp(end.x - boxWidth / 2, 0, 1 - boxWidth),
    top: clamp(end.y - boxHeight / 2, 0, 1 - boxHeight),
    width: boxWidth,
    height: boxHeight,
  }
}

/** Passes de la signature, inscrites dans `box` SANS déformation et centrées. */
export function signatureStrokes(signature: SavedSignature, box: PdfDrawingRect, pageAspect: number): PdfDrawingPoint[][] {
  // Unité commune : la hauteur de page. Une fraction horizontale y vaut `pageAspect`.
  const realWidth = Math.min(box.width * pageAspect, box.height * signature.aspect)
  const width = realWidth / pageAspect
  const height = realWidth / signature.aspect
  const left = box.left + (box.width - width) / 2
  const top = box.top + (box.height - height) / 2
  return signature.strokes.map((stroke) => stroke.map((point) => ({
    x: left + point.x * width,
    y: top + point.y * height,
  })))
}

export function stampSignature(
  signature: SavedSignature,
  page: number,
  box: PdfDrawingRect,
  pageAspect: number,
  options: { id?: string; now?: string; color?: string } = {},
): PdfInkDrawing {
  return createPdfInkDrawing(page, signatureStrokes(signature, box, pageAspect), {
    ...options,
    color: options.color ?? PDF_DRAWING_COLOR,
    strokeWidth: signature.strokeWidth,
  })
}
