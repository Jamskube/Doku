// Conversion PDF → DOCX (ADR-0023 : éditer un PDF en le convertissant).
//
// Le DOCX est le format cible parce qu'il porte la mise en page — titres, graisse,
// tailles, alignement — là où le Markdown n'a rien de tout ça. Ce que produit cette
// conversion est un document RÉÉCRIT, pas le PDF modifié : c'est un point de départ
// éditable, et l'appelant doit le présenter comme tel.
//
// MuPDF (AGPL, cf. ADR-0023) fournit la matière — texte, boîtes, polices — et
// `pdf-structure` la reconstruction en paragraphes. Ici, seulement la mise en DOCX.
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx'
import {
  buildPdfStructuredDoc,
  pdfLinesFromStructuredText,
  type PdfParagraph,
  type PdfSourceLine,
  type PdfStructuredDoc,
} from '../pdf-structure'

export class PdfConvertError extends Error {}

const HEADING = {
  heading1: HeadingLevel.HEADING_1,
  heading2: HeadingLevel.HEADING_2,
  heading3: HeadingLevel.HEADING_3,
} as const

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const

// `docx` compte les tailles en demi-points ; MuPDF les donne en points.
const halfPoints = (size: number) => Math.max(2, Math.round(size * 2))

export function docxParagraph(paragraph: PdfParagraph): Paragraph {
  const runs = paragraph.runs.map((run) => new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    size: halfPoints(run.size),
  }))
  return new Paragraph({
    children: runs,
    alignment: ALIGN[paragraph.align],
    ...(paragraph.kind === 'paragraph' ? {} : { heading: HEADING[paragraph.kind] }),
    spacing: { after: 140 },
  })
}

export function docxSections(doc: PdfStructuredDoc): ISectionOptions[] {
  return [{ properties: {}, children: doc.paragraphs.map(docxParagraph) }]
}

export interface PdfConversionReport {
  bytes: Uint8Array
  pages: number
  paragraphs: number
  characters: number
  // Vrai quand le PDF n'a livré presque aucun texte : scanné, ou couche texte absente.
  // L'appelant DOIT le dire plutôt que de rendre un document vide sans explication.
  emptyish: boolean
}

// Extraction MuPDF : la seule partie qui touche au moteur. Isolée pour que la
// reconstruction et la mise en DOCX restent testables sans WASM.
export async function pdfStructuredDocFrom(bytes: Uint8Array): Promise<PdfStructuredDoc> {
  const mupdf = await import('mupdf')
  let doc: ReturnType<typeof mupdf.Document.openDocument>
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  } catch {
    throw new PdfConvertError('Ce PDF n’a pas pu être ouvert.')
  }
  const lines: PdfSourceLine[] = []
  let width = 0
  const pages = doc.countPages()
  for (let index = 0; index < pages; index++) {
    const page = doc.loadPage(index)
    const bounds = page.getBounds()
    width = Math.max(width, bounds[2] - bounds[0])
    const stext = page.toStructuredText('preserve-whitespace')
    try {
      lines.push(...pdfLinesFromStructuredText(JSON.parse(stext.asJSON()), index + 1))
    } catch {
      // Une page illisible ne doit pas emporter tout le document.
    }
  }
  return buildPdfStructuredDoc(lines, width, pages)
}

export async function convertPdfToDocx(bytes: Uint8Array): Promise<PdfConversionReport> {
  const structured = await pdfStructuredDocFrom(bytes)
  const characters = structured.paragraphs.reduce(
    (sum, paragraph) => sum + paragraph.runs.reduce((n, run) => n + run.text.length, 0),
    0,
  )
  // Un PDF scanné n'a pas de couche texte : la conversion rendrait un document vide.
  // Mieux vaut refuser en le nommant que livrer une page blanche.
  if (!characters) {
    throw new PdfConvertError('Ce PDF ne contient pas de texte sélectionnable (document scanné ?).')
  }
  const document = new Document({ sections: docxSections(structured) })
  const blob = await Packer.toBlob(document)
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    pages: structured.pages,
    paragraphs: structured.paragraphs.length,
    characters,
    emptyish: characters < structured.pages * 40,
  }
}

export function convertedDocxName(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? 'document.pdf').replace(/\.pdf$/i, '')
  return `${base}.docx`
}
