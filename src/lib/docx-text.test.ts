// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DocxTextError, docxTextFromXml, extractDocxText } from './docx-text'

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const wrap = (body: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`
const para = (text: string, style?: string) => `
  <w:p>
    <w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr>
    <w:r><w:t>${text}</w:t></w:r>
  </w:p>`

describe('docxTextFromXml', () => {
  it('rend le texte des paragraphes, séparés par une ligne vide', () => {
    const ex = docxTextFromXml(wrap(para('Premier') + para('Second')), parse)
    expect(ex.text).toBe('Premier\n\nSecond')
    expect(ex.paragraphs).toBe(2)
    expect(ex.empty).toBe(false)
  })

  it('préfixe les titres en Markdown — le modèle reçoit la STRUCTURE, pas un mur de texte', () => {
    const ex = docxTextFromXml(
      wrap(para('Rapport', 'Heading1') + para('Contexte', 'Heading2') + para('Le corps.')),
      parse,
    )
    expect(ex.text).toBe('# Rapport\n\n## Contexte\n\nLe corps.')
  })

  it('recolle les fragments d’un même paragraphe', () => {
    // Word découpe une phrase en plusieurs `w:r` dès qu'un mot change de style : sans
    // recollage, le modèle recevrait « Le mot gras compte » en trois morceaux.
    const xml = wrap(`
      <w:p><w:r><w:t>Le mot </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>gras</w:t></w:r><w:r><w:t> compte.</w:t></w:r></w:p>`)
    expect(docxTextFromXml(xml, parse).text).toBe('Le mot gras compte.')
  })

  it('ignore les paragraphes vides plutôt que d’empiler des lignes blanches', () => {
    const ex = docxTextFromXml(wrap(para('Un') + '<w:p/>' + para('  ') + para('Deux')), parse)
    expect(ex.text).toBe('Un\n\nDeux')
    expect(ex.paragraphs).toBe(2)
  })

  it('SIGNALE un document sans texte au lieu de rendre une chaîne vide', () => {
    // Le cas qui comptait : un DOCX d'images et de tableaux. Rendre `''` en silence est
    // exactement ce qui faisait broder le modèle.
    const ex = docxTextFromXml(wrap('<w:p/><w:p/>'), parse)
    expect(ex.empty).toBe(true)
    expect(ex.text).toBe('')
  })

  it('survit à un corps absent', () => {
    const ex = docxTextFromXml(`<?xml version="1.0"?><w:document ${W}></w:document>`, parse)
    expect(ex.empty).toBe(true)
  })
})

describe('extractDocxText', () => {
  it('refuse une archive illisible en le DISANT', async () => {
    await expect(extractDocxText(new Uint8Array([1, 2, 3]), parse)).rejects.toBeInstanceOf(DocxTextError)
  })

  it('lit un vrai .docx de bout en bout', async () => {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('word/document.xml', wrap(para('Titre', 'Heading1') + para('Contenu réel.')))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const ex = await extractDocxText(bytes, parse)
    expect(ex.text).toBe('# Titre\n\nContenu réel.')
    expect(ex.empty).toBe(false)
  })

  it('refuse une archive ZIP valide SANS document.xml', async () => {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    zip.file('autre.txt', 'rien')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    await expect(extractDocxText(bytes, parse)).rejects.toBeInstanceOf(DocxTextError)
  })
})
