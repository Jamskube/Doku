import type { PdfDrawingPoint } from './pdf-drawing'

// Citation d'un trait de surligneur : quelles boîtes de texte le trait balaie-t-il,
// et sur quelle plage horizontale ? Purement géométrique (fractions de page 0..1),
// donc testable sans DOM — le découpage caractère par caractère, lui, a besoin de la
// mise en page réelle et vit dans PdfView.
export interface PdfTextBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PdfHighlightCoverage {
  index: number
  from: number
  to: number
}

const MAX_QUOTE_LENGTH = 4_000

export function coveredPdfTextBoxes(
  boxes: PdfTextBox[],
  samples: PdfDrawingPoint[],
  halfX: number,
  halfY: number,
): PdfHighlightCoverage[] {
  const coverage: PdfHighlightCoverage[] = []
  for (const [index, box] of boxes.entries()) {
    let minimum = Infinity
    let maximum = -Infinity
    for (const sample of samples) {
      // Le trait a une épaisseur : il touche la ligne dès que sa bande verticale
      // recoupe la boîte, pas seulement quand son axe passe dessus.
      if (sample.y + halfY < box.top || sample.y - halfY > box.bottom) continue
      if (sample.x < minimum) minimum = sample.x
      if (sample.x > maximum) maximum = sample.x
    }
    if (minimum === Infinity) continue
    const from = Math.max(minimum - halfX, box.left)
    const to = Math.min(maximum + halfX, box.right)
    if (to > from) coverage.push({ index, from, to })
  }
  return coverage
}

export function joinPdfHighlightQuote(parts: string[]): string {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUOTE_LENGTH)
}
