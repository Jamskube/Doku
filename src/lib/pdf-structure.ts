// Reconstruction de la structure d'un PDF (ADR-0023 : édition par conversion).
//
// Un PDF ne contient ni paragraphes ni titres — seulement des lignes posées à des
// coordonnées. Ce module rebâtit une structure de document à partir de ce que MuPDF
// sait extraire (texte, boîte, police, graisse, taille par ligne), pour qu'on puisse
// ensuite écrire un DOCX éditable.
//
// C'est une HEURISTIQUE, et elle assume ses limites : elle vise le document en une
// colonne (note, article, courrier, contrat). Les mises en page complexes — colonnes,
// tableaux, encadrés — en sortent aplaties. L'appelant doit le dire à l'utilisateur,
// jamais laisser croire à une conversion fidèle.

export interface PdfSourceFont {
  name: string
  size: number
  weight: string
  style: string
}

export interface PdfSourceLine {
  page: number
  x: number
  y: number
  width: number
  height: number
  text: string
  font: PdfSourceFont
}

export interface PdfTextRun {
  text: string
  bold: boolean
  italic: boolean
  size: number
  // La taille a-t-elle été ÉCRITE dans le document, ou déduite ? Un titre déjà
  // dimensionné ne doit pas être remultiplié par l'échelle de titre au rendu : c'est
  // ce qui faisait passer un titre de 22 pt à 37 pt en aller-retour PDF → DOCX → PDF.
  sizeExplicit?: boolean
}

export type PdfParagraphKind = 'paragraph' | 'heading1' | 'heading2' | 'heading3'

export interface PdfParagraph {
  page: number
  kind: PdfParagraphKind
  align: 'left' | 'center' | 'right'
  runs: PdfTextRun[]
}

export interface PdfStructuredDoc {
  paragraphs: PdfParagraph[]
  // Taille de corps retenue : sert de référence pour décider ce qui est un titre.
  bodySize: number
  pages: number
}

const isBold = (font: PdfSourceFont) => /bold|black|heavy|semibold/i.test(`${font.weight} ${font.name}`)
const isItalic = (font: PdfSourceFont) => /italic|oblique/i.test(`${font.style} ${font.name}`)

// Normalise la sortie JSON de MuPDF (`StructuredText.asJSON`) en lignes exploitables.
// Tolérant par construction : un PDF dont la structure surprend doit donner MOINS de
// lignes, jamais une exception.
export function pdfLinesFromStructuredText(json: unknown, page: number): PdfSourceLine[] {
  const blocks = (json as { blocks?: unknown[] })?.blocks
  if (!Array.isArray(blocks)) return []
  const lines: PdfSourceLine[] = []
  for (const block of blocks) {
    const raw = block as { type?: string; lines?: unknown[] }
    if (raw.type !== 'text' || !Array.isArray(raw.lines)) continue
    for (const item of raw.lines) {
      const line = item as {
        text?: string
        bbox?: { x?: number; y?: number; w?: number; h?: number }
        font?: Partial<PdfSourceFont>
      }
      const text = typeof line.text === 'string' ? line.text : ''
      if (!text.trim()) continue
      const box = line.bbox ?? {}
      lines.push({
        page,
        x: Number(box.x) || 0,
        y: Number(box.y) || 0,
        width: Number(box.w) || 0,
        height: Number(box.h) || 0,
        text,
        font: {
          name: String(line.font?.name ?? ''),
          size: Number(line.font?.size) || 12,
          weight: String(line.font?.weight ?? ''),
          style: String(line.font?.style ?? ''),
        },
      })
    }
  }
  return lines
}

// Taille de corps = la taille la plus RÉPANDUE, pondérée par le nombre de caractères.
// La moyenne serait tirée vers le haut par un gros titre ; la médiane des lignes
// ignorerait qu'un paragraphe pèse plus qu'un titre.
export function pdfBodySize(lines: PdfSourceLine[]): number {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const size = Math.round(line.font.size * 2) / 2
    weight.set(size, (weight.get(size) ?? 0) + line.text.trim().length)
  }
  let best = 12
  let most = -1
  for (const [size, total] of weight) {
    if (total > most) {
      most = total
      best = size
    }
  }
  return best
}

function headingKind(size: number, bold: boolean, body: number): PdfParagraphKind {
  const ratio = size / body
  if (ratio >= 1.6) return 'heading1'
  if (ratio >= 1.3) return 'heading2'
  if (ratio >= 1.12 || (bold && ratio >= 1.02)) return 'heading3'
  return 'paragraph'
}

function alignOf(lines: PdfSourceLine[], pageWidth: number): 'left' | 'center' | 'right' {
  if (!pageWidth) return 'left'
  const left = Math.min(...lines.map((line) => line.x))
  const right = Math.max(...lines.map((line) => line.x + line.width))
  const leftGap = left
  const rightGap = pageWidth - right
  // Un bloc centré a des marges comparables des deux côtés, et ne touche aucun bord.
  if (leftGap > pageWidth * 0.12 && Math.abs(leftGap - rightGap) < pageWidth * 0.06) return 'center'
  if (leftGap > pageWidth * 0.25 && rightGap < pageWidth * 0.1) return 'right'
  return 'left'
}

// Deux lignes appartiennent au même paragraphe si elles se suivent de près, partagent
// la même taille de police, et démarrent à la même marge (ou en retrait d'alinéa).
function continues(previous: PdfSourceLine, line: PdfSourceLine): boolean {
  if (line.page !== previous.page) return false
  if (Math.abs(line.font.size - previous.font.size) > 0.6) return false
  if (isBold(line.font) !== isBold(previous.font)) return false
  const gap = line.y - (previous.y + previous.height)
  // Interligne normal : jusqu'à ~0,9 fois la hauteur de ligne. Au-delà, c'est un saut
  // de paragraphe — c'est ce blanc qui porte l'information de découpe.
  if (gap < -previous.height || gap > previous.height * 0.9) return false
  // Un décalage à gauche important trahit une liste ou une nouvelle colonne.
  return Math.abs(line.x - previous.x) <= Math.max(previous.font.size * 1.6, 12)
}

export function groupPdfParagraphs(lines: PdfSourceLine[], pageWidth: number, bodySize = pdfBodySize(lines)): PdfParagraph[] {
  const ordered = [...lines].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
  const groups: PdfSourceLine[][] = []
  for (const line of ordered) {
    const current = groups.at(-1)
    if (current && continues(current.at(-1)!, line)) current.push(line)
    else groups.push([line])
  }
  return groups.map((group) => {
    const size = group[0].font.size
    const bold = isBold(group[0].font)
    const kind = headingKind(size, bold, bodySize)
    return {
      page: group[0].page,
      kind,
      align: alignOf(group, pageWidth),
      runs: [{
        // Les lignes d'un même paragraphe se recollent par une espace : dans un PDF, le
        // retour à la ligne est une décision de mise en page, pas du contenu. Le trait
        // d'union de césure en fin de ligne est ravalé avec lui.
        text: group.reduce((text, line, index) => {
          if (index === 0) return line.text.trim()
          const previous = text.trimEnd()
          if (/[-‐­]$/.test(previous)) return `${previous.slice(0, -1)}${line.text.trim()}`
          return `${previous} ${line.text.trim()}`
        }, ''),
        bold: kind === 'paragraph' ? bold : false,
        italic: isItalic(group[0].font),
        size,
      }],
    }
  })
}

export function buildPdfStructuredDoc(lines: PdfSourceLine[], pageWidth: number, pages: number): PdfStructuredDoc {
  const bodySize = pdfBodySize(lines)
  return { paragraphs: groupPdfParagraphs(lines, pageWidth, bodySize), bodySize, pages }
}

// Part de fidélité qu'on est capable d'annoncer honnêtement : ce que la reconstruction
// a su rattacher à un paragraphe ou un titre, rapporté au texte total.
export function pdfStructureCoverage(doc: PdfStructuredDoc): number {
  const total = doc.paragraphs.reduce((sum, p) => sum + p.runs.reduce((n, r) => n + r.text.length, 0), 0)
  return total
}
