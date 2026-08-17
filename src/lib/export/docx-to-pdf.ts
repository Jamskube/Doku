// Export DOCX → PDF (ADR-0023) : la marche RETOUR, écrite par Doku.
//
// SuperDoc ne sait pas produire de PDF (son `exportType: 'pdf'` rend une archive vide,
// sa documentation n'en parle pas, son bundle ne contient aucun moteur PDF). Plutôt que
// de brancher un bouton qui ment, Doku écrit le PDF lui-même avec `@cantoo/pdf-lib`,
// déjà présent pour la gravure des annotations (ADR-0022).
//
// Ce que ça garantit : le texte, sa graisse, son italique, sa taille, l'alignement, les
// titres, la coupure de lignes aux vraies métriques de police, et la pagination.
// Ce que ça ne garantit pas : images, tableaux, en-têtes/pieds, colonnes. L'appelant
// doit le dire — jamais laisser croire à une reproduction fidèle.
import { parseDocxDocument, type DocxStructuredDoc } from '../docx-structure'
import type { PdfParagraph } from '../docx-structure'

export class DocxToPdfError extends Error {}

// Les polices standard d'un PDF sont encodées en WinAnsi : tout caractère hors de ce
// jeu ferait ÉCHOUER l'écriture. On les remplace au lieu de laisser l'export planter,
// et les substitutions choisies gardent le sens (guillemets typographiques, tirets).
const WINANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const WINANSI = new Set<string>()
for (let code = 0x20; code <= 0x7e; code++) WINANSI.add(String.fromCharCode(code))
for (let code = 0xa0; code <= 0xff; code++) WINANSI.add(String.fromCharCode(code))
for (const ch of WINANSI_HIGH) WINANSI.add(ch)

const LATIN_FOLD: Record<string, string> = {
  ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o', Ø: 'O', ı: 'i', ħ: 'h', ŧ: 't',
}

const SUBSTITUTIONS: [RegExp, string][] = [
  [/\r\n?/g, '\n'],
  [/[‘’‚‛]/g, '’'],
  [/[“”„‟]/g, '”'],
  // U+2010 et U+2011 sont de vrais TRAITS D’UNION, pas des tirets demi-cadratins :
  // « COVID‑11 » ne doit pas devenir « COVID–11 ».
  [/[‐‑]/g, '-'],
  [/[‒–]/g, '–'],
  [/[—―]/g, '—'],
  [/[   ]/g, ' '],
  [/\t/g, '    '],
]

export function toWinAnsi(text: string): string {
  let out = text
  for (const [pattern, replacement] of SUBSTITUTIONS) out = out.replace(pattern, replacement)
  return Array.from(out)
    .map((ch) => {
      if (ch === String.fromCharCode(10) || WINANSI.has(ch)) return ch
      const folded = LATIN_FOLD[ch]
      if (folded) return folded
      const stripped = ch.normalize('NFD').replace(/\p{M}+/gu, '')
      return stripped && Array.from(stripped).every((c) => WINANSI.has(c)) ? stripped : '?'
    })
    .join('')
}

export interface DocxPdfReport {
  bytes: Uint8Array
  pages: number
  paragraphs: number
}

interface Line {
  text: string
  bold: boolean
  italic: boolean
  size: number
}

// Coupure aux VRAIES largeurs de glyphes, pas à un nombre de caractères : une ligne
// mesurée au caractère déborde dès qu'il y a des majuscules ou des « m ».
export function wrapRuns(
  runs: Line[],
  maxWidth: number,
  measure: (text: string, size: number, bold: boolean, italic: boolean) => number,
): Line[][] {
  const lines: Line[][] = []
  let current: Line[] = []
  let width = 0

  const push = () => {
    if (current.length) lines.push(current)
    current = []
    width = 0
  }

  for (const run of runs) {
    // Les sauts de ligne explicites du DOCX (`<w:br/>`) sont respectés tels quels.
    const segments = run.text.split('\n')
    segments.forEach((segment, index) => {
      if (index > 0) push()
      const words = segment.split(/(\s+)/).filter((part) => part !== '')
      for (const word of words) {
        const size = measure(word, run.size, run.bold, run.italic)
        if (width + size > maxWidth && width > 0) {
          push()
          if (/^\s+$/.test(word)) continue // pas d'espace en début de ligne
        }
        const last = current.at(-1)
        if (last && last.bold === run.bold && last.italic === run.italic && last.size === run.size) {
          last.text += word
        } else {
          current.push({ text: word, bold: run.bold, italic: run.italic, size: run.size })
        }
        width += size
      }
    })
  }
  push()
  return lines
}

const HEADING_SCALE = { heading1: 1.7, heading2: 1.4, heading3: 1.18, paragraph: 1 } as const

export async function renderDocxStructureToPdf(structured: DocxStructuredDoc): Promise<DocxPdfReport> {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  const doc = await PDFDocument.create()
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  }
  const pick = (bold: boolean, italic: boolean) =>
    bold && italic ? fonts.boldItalic : bold ? fonts.bold : italic ? fonts.italic : fonts.regular
  const measure = (text: string, size: number, bold: boolean, italic: boolean) =>
    pick(bold, italic).widthOfTextAtSize(toWinAnsi(text), size)

  const { width, height } = structured.page
  // Marges BORNÉES avant tout calcul : un `w:pgMar` aberrant (ou une page de 72 pt de
  // haut avec des marges d'un pouce) donnait une hauteur utile négative, donc une page
  // neuve par ligne — des milliers de pages, sans un mot.
  const marginX = Math.min(structured.page.marginX, width * 0.4)
  const marginTop = Math.min(structured.page.marginTop, height * 0.35)
  const marginBottom = Math.min(structured.page.marginBottom, height * 0.35)
  const usable = Math.max(36, width - marginX * 2)
  const ink = rgb(0.1, 0.1, 0.12)

  let page = doc.addPage([width, height])
  let cursor = height - marginTop

  // Plafond de sécurité : si la géométrie reste malgré tout dégénérée, on s'arrête en
  // le NOMMANT plutôt que de produire des milliers de pages et de figer l'interface.
  const MAX_PAGES = 2_000
  const newPage = () => {
    if (doc.getPageCount() >= MAX_PAGES) {
      throw new DocxToPdfError(`Ce document dépasse ${MAX_PAGES} pages : export interrompu.`)
    }
    page = doc.addPage([width, height])
    cursor = height - marginTop
  }

  for (const paragraph of structured.paragraphs) {
    const runs: Line[] = paragraph.runs.map((run) => ({
      text: toWinAnsi(run.text),
      bold: run.bold || paragraph.kind !== 'paragraph',
      italic: run.italic,
      // L'échelle de titre ne s'applique QUE si la taille a été déduite. Une taille
      // écrite dans le document est déjà la taille finale — la remultiplier faisait
      // grossir chaque titre de 70 % à chaque aller-retour.
      size: run.size * (run.sizeExplicit ? 1 : HEADING_SCALE[paragraph.kind]),
    }))
    const lines = wrapRuns(runs, usable, measure)
    // `Math.max(...[])` vaut -Infinity : un paragraphe sans run mettait le curseur à
    // l'infini et produisait un PDF qu'aucun lecteur n'ouvre, avec une bannière
    // « PDF créé ».
    const leading = Math.max(8, ...runs.map((run) => run.size)) * 1.35
    // Un titre respire au-dessus, sauf en tête de page où l'espace serait perdu.
    const spaceBefore = paragraph.kind === 'paragraph' ? 0 : leading * 0.5

    for (const line of lines) {
      // L'espace avant titre est pris en compte AVANT le test de tenue en page, sinon
      // un titre pouvait être posé jusqu'à une demi-ligne dans la marge basse.
      const besoin = leading + (line === lines[0] ? spaceBefore : 0)
      if (cursor - besoin < marginBottom) newPage()
      else if (line === lines[0]) cursor -= spaceBefore

      const lineWidth = line.reduce((sum, part) => sum + measure(part.text, part.size, part.bold, part.italic), 0)
      let x = marginX
      if (paragraph.align === 'center') x = marginX + (usable - lineWidth) / 2
      else if (paragraph.align === 'right') x = marginX + usable - lineWidth

      // Ligne de base COMMUNE à toute la ligne : la caler sur la taille de chaque
      // fragment faisait flotter un mot en plus gros au-dessus de ses voisins.
      const baseline = cursor - Math.max(...line.map((part) => part.size))
      for (const part of line) {
        page.drawText(part.text, {
          x,
          y: baseline,
          size: part.size,
          font: pick(part.bold, part.italic),
          color: ink,
        })
        x += measure(part.text, part.size, part.bold, part.italic)
      }
      cursor -= leading
    }
    cursor -= leading * 0.35 // blanc inter-paragraphes
  }

  return {
    bytes: await doc.save(),
    pages: doc.getPageCount(),
    paragraphs: structured.paragraphs.length,
  }
}

// Chaîne complète : octets DOCX → PDF. `parse` est injecté (DOMParser du navigateur,
// jsdom en test) pour que la lecture du XML reste testable hors navigateur.
export async function convertDocxToPdf(
  bytes: Uint8Array,
  parse: (xml: string) => Document,
): Promise<DocxPdfReport> {
  const { default: JSZip } = await import('jszip')
  let xml: string
  try {
    const zip = await JSZip.loadAsync(bytes)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('document.xml absent')
    xml = await entry.async('string')
  } catch {
    throw new DocxToPdfError('Ce document Word n’a pas pu être lu.')
  }
  const structured = parseDocxDocument(xml, parse)
  if (!structured.paragraphs.length) {
    throw new DocxToPdfError('Ce document ne contient aucun texte à exporter.')
  }
  return renderDocxStructureToPdf(structured)
}
