// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DocxToPdfError, convertDocxToPdf, toWinAnsi, wrapRuns } from './docx-to-pdf'
import { parseDocxDocument } from '../docx-structure'

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const wrap = (body: string, sect = '') => `<?xml version="1.0"?><w:document ${W}><w:body>${body}${sect}</w:body></w:document>`
const para = (text: string, opts: { bold?: boolean; italic?: boolean; size?: number; style?: string; jc?: string } = {}) => `
  <w:p>
    <w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${opts.jc ? `<w:jc w:val="${opts.jc}"/>` : ''}</w:pPr>
    <w:r><w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.italic ? '<w:i/>' : ''}${opts.size ? `<w:sz w:val="${opts.size * 2}"/>` : ''}</w:rPr><w:t>${text}</w:t></w:r>
  </w:p>`

describe('parseDocxDocument', () => {
  it('lit les paragraphes, la graisse et la taille', () => {
    const doc = parseDocxDocument(wrap(para('Bonjour', { bold: true, size: 14 })), parse)
    expect(doc.paragraphs).toHaveLength(1)
    expect(doc.paragraphs[0].runs[0]).toMatchObject({ text: 'Bonjour', bold: true, size: 14 })
  })

  it('reconnaît un titre par son style Word', () => {
    const doc = parseDocxDocument(wrap(para('Titre', { style: 'Heading1' }) + para('Corps')), parse)
    expect(doc.paragraphs[0].kind).toBe('heading1')
    expect(doc.paragraphs[1].kind).toBe('paragraph')
  })

  it('reconnaît un titre par sa taille quand le style manque', () => {
    const body = para('Grand titre', { size: 24, bold: true })
      + Array.from({ length: 5 }, (_, i) => para(`Ligne de corps ${i} avec du texte.`, { size: 11 })).join('')
    expect(parseDocxDocument(wrap(body), parse).paragraphs[0].kind).toBe('heading1')
  })

  it('lit l’alignement', () => {
    const doc = parseDocxDocument(wrap(para('Centré', { jc: 'center' }) + para('Droite', { jc: 'right' })), parse)
    expect(doc.paragraphs[0].align).toBe('center')
    expect(doc.paragraphs[1].align).toBe('right')
  })

  it('traite un booléen OOXML explicitement désactivé comme faux', () => {
    // `<w:b w:val="0"/>` DÉSACTIVE la graisse : la présence seule de la balise ne suffit
    // pas à conclure, sinon un document qui coupe l'héritage sortirait tout en gras.
    const xml = wrap(`<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Normal</w:t></w:r></w:p>`)
    expect(parseDocxDocument(xml, parse).paragraphs[0].runs[0].bold).toBe(false)
  })

  it('recolle les runs de même style éclatés par Word', () => {
    const xml = wrap(`<w:p>
      <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Bon</w:t></w:r>
      <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>jour</w:t></w:r>
      <w:r><w:rPr><w:sz w:val="22"/><w:b/></w:rPr><w:t> gras</w:t></w:r>
    </w:p>`)
    const runs = parseDocxDocument(xml, parse).paragraphs[0].runs
    expect(runs).toHaveLength(2)
    expect(runs[0].text).toBe('Bonjour')
    expect(runs[1]).toMatchObject({ text: ' gras', bold: true })
  })

  it('ignore les paragraphes vides', () => {
    expect(parseDocxDocument(wrap('<w:p/>' + para('Réel')), parse).paragraphs).toHaveLength(1)
  })

  it('lit la boîte de page du document', () => {
    const sect = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1800" w:bottom="1440"/></w:sectPr>'
    const page = parseDocxDocument(wrap(para('x'), sect), parse).page
    expect(page.width).toBeCloseTo(612)   // Letter
    expect(page.height).toBeCloseTo(792)
    expect(page.marginX).toBeCloseTo(90)
  })

  it('retombe sur A4 sans section', () => {
    const page = parseDocxDocument(wrap(para('x')), parse).page
    expect(Math.round(page.width)).toBe(595)
  })
})

describe('toWinAnsi', () => {
  it('garde les accents français', () => {
    expect(toWinAnsi('éèàçùôî — « test »')).toBe('éèàçùôî — « test »')
  })

  it('remplace ce que les polices standard ne savent pas écrire', () => {
    // Sans ce filet, pdf-lib LÈVE sur un caractère hors WinAnsi et tout l'export échoue.
    expect(toWinAnsi('漢字')).toBe('??')
    expect(toWinAnsi('a b')).toBe('a b')
  })
})

describe('wrapRuns', () => {
  // Mesure factice : 10 points de large par caractère, quelle que soit la police.
  const measure = (text: string) => text.length * 10

  it('coupe sur la largeur disponible', () => {
    const lines = wrapRuns([{ text: 'aaa bbb ccc ddd', bold: false, italic: false, size: 12 }], 80, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0].map((l) => l.text).join('')).not.toContain('ddd')
  })

  it('respecte un saut de ligne explicite', () => {
    const lines = wrapRuns([{ text: 'un\ndeux', bold: false, italic: false, size: 12 }], 1000, measure)
    expect(lines).toHaveLength(2)
  })

  it('ne commence jamais une ligne par une espace', () => {
    const lines = wrapRuns([{ text: 'aaaa bbbb', bold: false, italic: false, size: 12 }], 45, measure)
    for (const line of lines) expect(line[0].text.startsWith(' ')).toBe(false)
  })

  it('garde les changements de style dans la ligne', () => {
    const lines = wrapRuns([
      { text: 'normal ', bold: false, italic: false, size: 12 },
      { text: 'gras', bold: true, italic: false, size: 12 },
    ], 1000, measure)
    expect(lines[0]).toHaveLength(2)
    expect(lines[0][1].bold).toBe(true)
  })

  it('n’entre pas en boucle sur un mot plus large que la ligne', () => {
    const lines = wrapRuns([{ text: 'incompressible', bold: false, italic: false, size: 12 }], 20, measure)
    expect(lines).toHaveLength(1)
  })
})

describe('convertDocxToPdf', () => {
  async function docxWith(body: string, sect = ''): Promise<Uint8Array> {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('word/document.xml', wrap(body, sect))
    return zip.generateAsync({ type: 'uint8array' })
  }

  it('produit un PDF relisible', async () => {
    const bytes = await docxWith(para('Titre du document', { style: 'Heading1' }) + para('Un paragraphe de corps.'))
    const report = await convertDocxToPdf(bytes, parse)
    expect(report.pages).toBeGreaterThanOrEqual(1)
    expect(report.paragraphs).toBe(2)
    expect(String.fromCharCode(...report.bytes.slice(0, 5))).toBe('%PDF-')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const reopened = await PDFDocument.load(report.bytes)
    expect(reopened.getPageCount()).toBe(report.pages)
  })

  it('pagine un document long', async () => {
    const long = Array.from({ length: 120 }, (_, i) =>
      para(`Paragraphe numéro ${i} contenant assez de texte pour occuper une ligne entière de la page.`)).join('')
    const report = await convertDocxToPdf(await docxWith(long), parse)
    expect(report.pages).toBeGreaterThan(1)
  })

  it('respecte la taille de page du DOCX', async () => {
    const sect = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    const report = await convertDocxToPdf(await docxWith(para('Letter'), sect), parse)
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const reopened = await PDFDocument.load(report.bytes)
    expect(Math.round(reopened.getPage(0).getWidth())).toBe(612)
  })

  it('n’échoue pas sur un caractère hors WinAnsi', async () => {
    const report = await convertDocxToPdf(await docxWith(para('Bonjour 漢字 éàç')), parse)
    expect(report.pages).toBe(1)
  })

  it('refuse un document sans texte plutôt que de rendre un PDF blanc', async () => {
    await expect(convertDocxToPdf(await docxWith('<w:p/>'), parse)).rejects.toBeInstanceOf(DocxToPdfError)
  })

  it('refuse une archive qui n’est pas un DOCX', async () => {
    await expect(convertDocxToPdf(new Uint8Array([1, 2, 3, 4]), parse)).rejects.toBeInstanceOf(DocxToPdfError)
  })
})
