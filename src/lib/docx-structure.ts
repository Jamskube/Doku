// Lecture de la structure d'un DOCX (ADR-0023) : `word/document.xml`, le corps du
// document OOXML, ramené à un modèle de paragraphes simple que le rendu PDF sait
// imprimer (`export/docx-to-pdf.ts`).
//
// SuperDoc sait ouvrir et enregistrer du DOCX, mais **ne sait pas produire de PDF** :
// son `export({ exportType: 'pdf' })` rend une archive vide (22 octets), sa
// documentation n'en parle pas et son bundle ne contient aucun moteur PDF. Doku écrit
// donc lui-même le PDF, à partir du DOCX, avec la bibliothèque qu'il a déjà.
//
// Ce modèle venait de la conversion PDF → DOCX, retirée depuis que Doku modifie le
// texte d'un PDF sur place. Il vit désormais ici, où il sert encore.

export type PdfParagraphKind = 'paragraph' | 'heading1' | 'heading2' | 'heading3'

// Un fragment de texte homogène : même graisse, même style, même taille.
export interface PdfTextRun {
  text: string
  bold: boolean
  italic: boolean
  size: number
  // La taille a-t-elle été ÉCRITE dans le document, ou déduite ? Un titre déjà
  // dimensionné ne doit pas être remultiplié par l'échelle de titre au rendu : c'est
  // ce qui faisait grossir un titre de 22 pt à 37 pt à chaque aller-retour.
  sizeExplicit?: boolean
}

export interface PdfParagraph {
  page: number
  kind: PdfParagraphKind
  align: 'left' | 'center' | 'right'
  runs: PdfTextRun[]
}

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

  // Word encapsule toute zone de texte / forme / page de garde dans un
  // `mc:AlternateContent` qui porte DEUX variantes équivalentes (`mc:Choice` et
  // `mc:Fallback`), chacune avec ses propres `w:p`. Une recherche descendante naïve
  // sort donc le même texte deux fois, et le `w:p` extérieur le ramasse une troisième
  // fois par descendance. On ne garde que les paragraphes dont aucun ancêtre n'est
  // lui-même un `w:p`, et on ignore la branche `mc:Fallback`.
  // On ne rejette QUE la branche `mc:Fallback` : le paragraphe intérieur de la
  // `mc:Choice` porte le vrai texte de la zone, il doit être gardé. Le paragraphe
  // EXTÉRIEUR, lui, ne sort rien de lui-même — `ownRuns` ci-dessous ne lui attribue
  // pas les runs de la zone qu'il contient.
  const nested = (element: Element): boolean => {
    let node = element.parentNode as Element | null
    while (node && node !== body) {
      if (node.localName === 'Fallback') return true
      node = node.parentNode as Element | null
    }
    return false
  }
  const rawParagraphs = Array.from(body?.getElementsByTagNameNS(W, 'p') ?? []).filter((p) => !nested(p))

  // Un run n'appartient à un paragraphe que si son plus proche ancêtre `w:p` EST ce
  // paragraphe : sans ce filtre, un `w:p` extérieur avale les runs des zones de texte
  // qu'il contient.
  const ownRuns = (p: Element): Element[] =>
    Array.from(p.getElementsByTagNameNS(W, 'r')).filter((r) => {
      let node = r.parentNode as Element | null
      while (node && node !== body) {
        if (node.localName === 'p') return node === p
        if (node.localName === 'Fallback') return false
        node = node.parentNode as Element | null
      }
      return false
    })

  interface Draft {
    runs: PdfTextRun[]
    style: string | null
    align: PdfParagraph['align']
  }
  const drafts: Draft[] = []

  for (const p of rawParagraphs) {
    const properties = child(p, 'pPr')
    const runs: PdfTextRun[] = []
    for (const r of ownRuns(p)) {
      const rPr = child(r, 'rPr')
      const bold = onOff(child(rPr, 'b'))
      const italic = onOff(child(rPr, 'i'))
      // `sizeExplicit` distingue une taille ÉCRITE dans le document d'une taille par
      // défaut. Sans cette distinction, un titre déjà dimensionné se voyait remultiplier
      // par l'échelle de titre au rendu — 22 pt devenaient 37 pt en aller-retour.
      const explicit = sizeFromHalfPoints(attr(child(rPr, 'sz'), 'val'))
      const size = explicit ?? 11
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
        runs.push({ text, bold, italic, size, sizeExplicit: explicit !== null })
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
