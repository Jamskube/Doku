// Export DOCX (story 10.4, stretch — ADR-0010). Walker marked.lexer → modèle `docx`.
// Tout token non mappable retombe en texte brut (jamais de crash — le verify l'exige).
// `docx` (~100 Ko) est chargé par import dynamique au clic (hors bundle principal) : ce
// module n'est lui-même importé que dynamiquement depuis DocumentView.
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
  BorderStyle,
  type ParagraphChild,
  type FileChild,
} from 'docx'
import { marked } from 'marked'
import type { Printable } from './print'

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

interface Fmt {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

// Tokens inline → runs de texte. Récursif pour l'emphase imbriquée ; défaut = texte brut.
function inlineRuns(tokens: unknown[] | undefined, fmt: Fmt = {}): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const raw of tokens ?? []) {
    const t = raw as { type: string; text?: string; tokens?: unknown[]; href?: string; raw?: string }
    switch (t.type) {
      case 'text':
      case 'escape':
        out.push(new TextRun({ text: t.text ?? '', ...fmt }))
        break
      case 'strong':
        out.push(...inlineRuns(t.tokens, { ...fmt, bold: true }))
        break
      case 'em':
        out.push(...inlineRuns(t.tokens, { ...fmt, italics: true }))
        break
      case 'del':
        out.push(...inlineRuns(t.tokens, { ...fmt, strike: true }))
        break
      case 'codespan':
        out.push(new TextRun({ text: t.text ?? '', font: 'Consolas', ...fmt }))
        break
      case 'br':
        out.push(new TextRun({ break: 1 }))
        break
      case 'link':
        out.push(
          new ExternalHyperlink({
            link: t.href ?? '',
            children: inlineRuns(t.tokens, fmt) as TextRun[],
          }),
        )
        break
      case 'image':
        // Pas d'image binaire ici : on garde le texte alternatif (ou l'URL).
        out.push(new TextRun({ text: t.text || t.href || '', ...fmt }))
        break
      default:
        out.push(new TextRun({ text: t.text ?? t.raw ?? '', ...fmt }))
    }
  }
  return out.length ? out : [new TextRun('')]
}

// Items d'une liste → paragraphes (puce ou préfixe numérique) ; imbrication récursive.
function listItems(list: { ordered?: boolean; items?: unknown[] }, level: number, out: FileChild[]) {
  let n = 1
  for (const rawItem of list.items ?? []) {
    const item = rawItem as { tokens?: unknown[] }
    const children = (item.tokens ?? []) as { type: string; tokens?: unknown[] }[]
    // Contenu inline de l'item : tokens 'text'/'paragraph' (on saute les sous-listes).
    const inline = children.filter((c) => c.type !== 'list').flatMap((c) => c.tokens ?? [])
    if (list.ordered) {
      out.push(new Paragraph({ children: [new TextRun(`${n}. `), ...inlineRuns(inline)], indent: { left: 360 * (level + 1) } }))
    } else {
      out.push(new Paragraph({ children: inlineRuns(inline), bullet: { level } }))
    }
    for (const c of children) if (c.type === 'list') listItems(c as { ordered?: boolean; items?: unknown[] }, level + 1, out)
    n++
  }
}

function tableBlock(t: { header?: unknown[]; rows?: unknown[][] }): Table {
  const cell = (c: unknown) =>
    new TableCell({ children: [new Paragraph({ children: inlineRuns((c as { tokens?: unknown[] }).tokens) })] })
  const rows: TableRow[] = []
  rows.push(new TableRow({ children: (t.header ?? []).map(cell) }))
  for (const row of t.rows ?? []) rows.push(new TableRow({ children: row.map(cell) }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

// Tokens bloc → éléments docx (Paragraph | Table). Défaut = paragraphe texte brut.
function blockElements(tokens: unknown[]): FileChild[] {
  const out: FileChild[] = []
  for (const raw of tokens) {
    const t = raw as { type: string; depth?: number; text?: string; tokens?: unknown[]; raw?: string }
    switch (t.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HEADINGS[(t.depth ?? 1) - 1] ?? HeadingLevel.HEADING_6, children: inlineRuns(t.tokens) }))
        break
      case 'paragraph':
        out.push(new Paragraph({ children: inlineRuns(t.tokens) }))
        break
      case 'text':
        out.push(new Paragraph({ children: t.tokens ? inlineRuns(t.tokens) : [new TextRun(t.text ?? '')] }))
        break
      case 'list':
        listItems(t as { ordered?: boolean; items?: unknown[] }, 0, out)
        break
      case 'code':
        for (const line of (t.text ?? '').split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }))
        break
      case 'blockquote':
        for (const b of t.tokens ?? []) {
          const bt = b as { tokens?: unknown[] }
          out.push(new Paragraph({ children: inlineRuns(bt.tokens, { italics: true }), indent: { left: 720 } }))
        }
        break
      case 'table':
        out.push(tableBlock(t as { header?: unknown[]; rows?: unknown[][] }))
        break
      case 'hr':
        out.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } }))
        break
      case 'space':
        break
      default:
        // html brut ou token inconnu → texte brut (jamais de crash).
        out.push(new Paragraph({ children: [new TextRun((t.raw ?? t.text ?? '').trim())] }))
    }
  }
  return out
}

// Document DOCX depuis du Markdown (section unique). Section jamais vide (Word l'exige).
export function mdToDocx(md: string): Document {
  const children = blockElements(marked.lexer(md))
  return new Document({ sections: [{ children: children.length ? children : [new Paragraph('')] }] })
}

// Fallback texte brut (txt, ou html aplati) : une ligne = un paragraphe.
export function plainDocx(text: string): Document {
  const lines = text.split('\n')
  const children = lines.map((line) => new Paragraph({ children: [new TextRun(line)] }))
  return new Document({ sections: [{ children: children.length ? children : [new Paragraph('')] }] })
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent ?? ''
}

export interface DocxIO {
  save: (defaultName: string, bytes: Uint8Array) => Promise<boolean>
}

export function docxName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '') + '.docx'
}

// Orchestration async (I/O injectée) : construit le doc, sérialise en octets (toBlob, pas
// toBuffer → pas de Buffer Node sous Vite), propose l'enregistrement.
export async function exportDocx(tab: Printable, io: DocxIO): Promise<'saved' | 'cancelled'> {
  const doc =
    tab.kind === 'md'
      ? mdToDocx(tab.content)
      : plainDocx(tab.kind === 'html' ? htmlToText(tab.content) : tab.content)
  const blob = await Packer.toBlob(doc)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return (await io.save(docxName(tab.name), bytes)) ? 'saved' : 'cancelled'
}
