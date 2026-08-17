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

  // Écrit un vrai PDF puis le relit : pdf-lib + MuPDF (WASM) coûtent plusieurs secondes.
  // Délai explicite plutôt que le défaut de 5 s, qui fait échouer ce test sur une machine
  // chargée alors que le code est bon.
  it('produit un PDF relisible', async () => {
    const bytes = await docxWith(para('Titre du document', { style: 'Heading1' }) + para('Un paragraphe de corps.'))
    const report = await convertDocxToPdf(bytes, parse)
    expect(report.pages).toBeGreaterThanOrEqual(1)
    expect(report.paragraphs).toBe(2)
    expect(String.fromCharCode(...report.bytes.slice(0, 5))).toBe('%PDF-')
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    const reopened = await PDFDocument.load(report.bytes)
    expect(reopened.getPageCount()).toBe(report.pages)
  }, 30_000)

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

// --- Boucle fermée : DOCX → PDF → RELECTURE ---------------------------------------
// Le vrai manque des tests précédents : ils vérifiaient l'en-tête `%PDF-` et le nombre
// de pages, jamais le CONTENU. Quatre défauts bloquants sont passés au travers (sauts
// de ligne devenus « ? », titres grossis de 70 %, zones de texte triplées, plantage sur
// « ł »). MuPDF est déjà une dépendance : on relit ce qu'on vient d'écrire.
describe('boucle fermée DOCX → PDF → relecture', () => {
  async function pdfDepuis(body: string, sect = ''): Promise<Uint8Array> {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('word/document.xml', wrap(body, sect))
    const docx = await zip.generateAsync({ type: 'uint8array' })
    return (await convertDocxToPdf(docx, parse)).bytes
  }

  async function lignesDu(pdf: Uint8Array) {
    const mupdf = await import('mupdf')
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
    const out: { text: string; size: number; y: number }[] = []
    for (let n = 0; n < doc.countPages(); n++) {
      const json = JSON.parse((doc.loadPage(n) as never as { toStructuredText: (o: string) => { asJSON: () => string } })
        .toStructuredText('preserve-whitespace').asJSON())
      for (const bloc of json.blocks ?? []) {
        for (const l of bloc.lines ?? []) out.push({ text: l.text, size: l.font?.size ?? 0, y: l.y })
      }
    }
    return out
  }

  it('rend le texte exact, sans caractère parasite', async () => {
    const lignes = await lignesDu(await pdfDepuis(para('Le contrat est signé.')))
    expect(lignes.map((l) => l.text).join(' ')).toBe('Le contrat est signé.')
  })

  it('respecte un saut de ligne au lieu de le transformer en « ? »', async () => {
    // `<w:br/>` doit produire DEUX lignes. Le filtre WinAnsi le mangeait avant que la
    // coupure de lignes ne le voie, et écrivait « Nom?Adresse » sur une seule ligne.
    const xml = `<w:p><w:r><w:t>Nom</w:t><w:br/><w:t>Adresse</w:t></w:r></w:p>`
    const lignes = await lignesDu(await pdfDepuis(xml))
    expect(lignes.map((l) => l.text)).toEqual(['Nom', 'Adresse'])
    expect(lignes.some((l) => l.text.includes('?'))).toBe(false)
  })

  it('ne regrossit PAS un titre dont la taille est déjà écrite', async () => {
    // C'est le chemin nominal PDF → DOCX → PDF : la conversion aller écrit un `w:sz`
    // explicite EN PLUS du style de titre. Remultiplier donnait 22 → 37,4 pt.
    const lignes = await lignesDu(await pdfDepuis(para('Titre', { style: 'Heading1', size: 22 })))
    expect(lignes[0].size).toBeCloseTo(22, 0)
  })

  it('n’écrit une zone de texte Word qu’une seule fois', async () => {
    // `mc:AlternateContent` porte deux variantes équivalentes ; le `w:p` extérieur
    // ramassait en plus les runs intérieurs. Résultat : le texte sortait trois fois.
    const xml = `<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
      <mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p><w:r><w:t>Encadre</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Encadre</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback>
    </mc:AlternateContent></w:r></w:p>`
    const lignes = await lignesDu(await pdfDepuis(xml))
    expect(lignes.filter((l) => l.text.includes('Encadre'))).toHaveLength(1)
  })

  it('n’échoue pas sur un mot latin-étendu et le rend lisible', async () => {
    // « Wrocław » passait l'ancien filtre de plage et faisait LEVER pdf-lib : tout
    // l'export échouait sur un mot ordinaire.
    const lignes = await lignesDu(await pdfDepuis(para('Wroclaw Kovac Skoda')))
    expect(lignes[0].text).toBe('Wroclaw Kovac Skoda')
  })

  it('replie les diacritiques hors WinAnsi au lieu de planter', async () => {
    // `á` EST dans WinAnsi et doit être conservé tel quel ; seuls `ł` et `č` se
    // replient. Une substitution trop large abîmerait du texte parfaitement écrivable.
    const lignes = await lignesDu(await pdfDepuis(para('Wrocław Kováč')))
    expect(lignes[0].text).toBe('Wroclaw Kovác')
  })

  it('garde une ligne de base commune sur une ligne à tailles mixtes', async () => {
    const xml = `<w:p>
      <w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>Grand </w:t></w:r>
      <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>petit</w:t></w:r>
    </w:p>`
    const lignes = await lignesDu(await pdfDepuis(xml))
    const ys = lignes.map((l) => l.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5)
  })

  it('refuse en le nommant une page dont la géométrie est dégénérée', async () => {
    // Page de 72 pt de haut : les marges par défaut d'un pouce ne tiennent pas. Avant,
    // une page neuve était créée par ligne, indéfiniment.
    const sect = '<w:sectPr><w:pgSz w:w="12240" w:h="1440"/></w:sectPr>'
    const long = Array.from({ length: 40 }, (_, i) => para(`Ligne ${i}`)).join('')
    const pdf = await pdfDepuis(long, sect)
    const { PDFDocument } = await import('@cantoo/pdf-lib')
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeLessThan(60)
  })
})
