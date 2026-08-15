// Lecture de la structure d'un DOCX (ADR-0023) — la marche RETOUR de la boucle
// PDF → DOCX → édition → PDF.
//
// SuperDoc sait ouvrir et enregistrer du DOCX, mais **ne sait pas produire de PDF** :
// son `export({ exportType: 'pdf' })` rend une archive vide (22 octets), sa
// documentation n'en parle pas et son bundle ne contient aucun moteur PDF. Doku écrit
// donc lui-même le PDF, à partir du DOCX, avec la bibliothèque qu'il a déjà.
//
// On relit `word/document.xml` — le corps du document OOXML — et on le ramène au MÊME
// modèle de paragraphes que la conversion PDF → DOCX. Les deux sens partagent ainsi
// une seule représentation, et le rendu PDF n'a qu'un format d'entrée.
import type { PdfParagraph, PdfParagraphKind, PdfTextRun } from './pdf-structure'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Demi-points OOXML → points typographiques.
const sizeFromHalfPoints = (value: string | null): number | null => {
  const half = Number(value)
  return Number.isFinite(half) && half > 0 ? half / 2 : null
}

function attr(element: Element | null, name: string): string | null {
  if (!element) return null
  return element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`) ?? element.getAttribute(name)
}

function child(parent: Element | null, local: string): Element | null {
  if (!parent) return null
  const direct = parent.getElementsByTagNameNS(W, local)
  if (direct.length && direct[0].parentNode === parent) return direct[0]
  for (const node of Array.from(parent.children)) {
    if (node.localName === local) return node
  }
  return null
}

// Un booléen OOXML est vrai par ABSENCE de valeur (`<w:b/>`) et faux seulement si
// `w:val` vaut explicitement 0/false. Traiter la présence seule comme vraie serait faux
// dans un document qui désactive l'héritage.
function onOff(element: Element | null): boolean {
  if (!element) return false
  const value = attr(element, 'val')
  return value === null || !/^(0|false|off)$/i.test(value)
}

function kindFromStyle(style: string | null, size: number, body: number, bold: boolean): PdfParagraphKind {
  if (style) {
    const match = /^Heading([1-9])$/i.exec(style) ?? /^Titre([1-9])$/i.exec(style)
    if (match) {
      const level = Number(match[1])
      return level <= 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3'
    }
  }
  const ratio = size / body
  if (ratio >= 1.6) return 'heading1'
  if (ratio >= 1.3) return 'heading2'
  if (ratio >= 1.12 || (bold && ratio >= 1.02)) return 'heading3'
  return 'paragraph'
}

function alignFromJc(value: string | null): PdfParagraph['align'] {
  if (value === 'center') return 'center'
  if (value === 'right' || value === 'end') return 'right'
  return 'left'
}

export interface DocxStructuredDoc {
  paragraphs: PdfParagraph[]
  bodySize: number
  // Boîte de page en points, lue dans `w:sectPr` — un DOCX A4 et un DOCX Letter ne
  // doivent pas produire le même PDF.
  page: { width: number; height: number; marginX: number; marginTop: number; marginBottom: number }
}

const TWIPS = 20 // 1 point = 20 twips
const A4 = { width: 595.28, height: 841.89 }

export function parseDocxDocument(xml: string, parse: (source: string) => Document): DocxStructuredDoc {
  const doc = parse(xml)
  const paragraphs: PdfParagraph[] = []
  const sizes = new Map<number, number>()

  const bodies = doc.getElementsByTagNameNS(W, 'body')
  const body = bodies.length ? bodies[0] : doc.documentElement
  const rawParagraphs = Array.from(body?.getElementsByTagNameNS(W, 'p') ?? [])

  interface Draft {
    runs: PdfTextRun[]
    style: string | null
    align: PdfParagraph['align']
  }
  const drafts: Draft[] = []

  for (const p of rawParagraphs) {
    // Un paragraphe imbriqué dans un tableau est visité une seule fois, par son plus
    // proche ancêtre : sans ce garde, une cellule sortirait en double.
    const properties = child(p, 'pPr')
    const runs: PdfTextRun[] = []
    for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
      const rPr = child(r, 'rPr')
      const bold = onOff(child(rPr, 'b'))
      const italic = onOff(child(rPr, 'i'))
      const size = sizeFromHalfPoints(attr(child(rPr, 'sz'), 'val')) ?? 11
      let text = ''
      for (const node of Array.from(r.childNodes)) {
        const element = node as Element
        if (element.localName === 't') text += element.textContent ?? ''
        else if (element.localName === 'tab') text += '\t'
        else if (element.localName === 'br') text += '\n'
      }
      if (!text) continue
      const previous = runs.at(-1)
      // Word éclate un même passage en plusieurs runs (correcteur, marques de révision) :
      // on recolle ceux qui partagent exactement le même style.
      if (previous && previous.bold === bold && previous.italic === italic && previous.size === size) {
        previous.text += text
      } else {
        runs.push({ text, bold, italic, size })
      }
      sizes.set(size, (sizes.get(size) ?? 0) + text.trim().length)
    }
    if (!runs.length) continue
    drafts.push({
      runs,
      style: attr(child(properties, 'pStyle'), 'val'),
      align: alignFromJc(attr(child(properties, 'jc'), 'val')),
    })
  }

  let bodySize = 11
  let most = -1
  for (const [size, weight] of sizes) {
    if (weight > most) {
      most = weight
      bodySize = size
    }
  }

  for (const draft of drafts) {
    const first = draft.runs[0]
    paragraphs.push({
      page: 1,
      kind: kindFromStyle(draft.style, first.size, bodySize, first.bold),
      align: draft.align,
      runs: draft.runs,
    })
  }

  return { paragraphs, bodySize, page: readPageBox(body) }
}

function readPageBox(body: Element | null): DocxStructuredDoc['page'] {
  const fallback = { width: A4.width, height: A4.height, marginX: 72, marginTop: 72, marginBottom: 72 }
  if (!body) return fallback
  const sections = body.getElementsByTagNameNS(W, 'sectPr')
  const section = sections.length ? sections[sections.length - 1] : null
  if (!section) return fallback
  const size = child(section, 'pgSz')
  const margins = child(section, 'pgMar')
  const twips = (element: Element | null, name: string, byDefault: number) => {
    const raw = Number(attr(element, name))
    return Number.isFinite(raw) && raw > 0 ? raw / TWIPS : byDefault
  }
  return {
    width: twips(size, 'w', A4.width),
    height: twips(size, 'h', A4.height),
    marginX: twips(margins, 'left', 72),
    marginTop: twips(margins, 'top', 72),
    marginBottom: twips(margins, 'bottom', 72),
  }
}
