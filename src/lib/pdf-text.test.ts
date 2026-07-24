import { describe, expect, it } from 'vitest'
import { assemblePageText, buildPdfExtraction, detectScanned, type PdfTextItem } from './pdf-text'

const item = (str: string, hasEOL = false): PdfTextItem => ({ str, hasEOL })

describe('assemblePageText', () => {
  it('concatène les items et insère un saut de ligne sur hasEOL', () => {
    const items = [item('Bonjour '), item('le monde', true), item('Ligne deux', true)]
    expect(assemblePageText(items)).toBe('Bonjour le monde\nLigne deux\n')
  })

  it('ignore les items sans str (garde défensive marked-content)', () => {
    const items = [item('a'), { hasEOL: false } as unknown as PdfTextItem, item('b')]
    expect(assemblePageText(items)).toBe('ab')
  })

  it('page sans items → chaîne vide', () => {
    expect(assemblePageText([])).toBe('')
  })
})

describe('detectScanned', () => {
  it('document quasi vide → scanné', () => {
    expect(detectScanned(0, 3)).toBe(true)
    expect(detectScanned(2, 5)).toBe(true) // < pageCount
  })

  it('vraie matière texte → non scanné', () => {
    expect(detectScanned(500, 3)).toBe(false)
  })

  it('biais vers non scanné : un mot par page reste du texte', () => {
    expect(detectScanned(30, 3)).toBe(false)
  })
})

describe('buildPdfExtraction', () => {
  it('assemble les pages jointes par une ligne vide', () => {
    const pages = [
      [item('Page un.', true)],
      [item('Page deux.', true)],
    ]
    const r = buildPdfExtraction(pages)
    expect(r.text).toBe('Page un.\n\nPage deux.')
    expect(r.pageCount).toBe(2)
    expect(r.scanned).toBe(false)
    expect(r.charCount).toBeGreaterThan(0)
  })

  it('PDF tout-image (items vides) → scanné, texte vide', () => {
    const r = buildPdfExtraction([[], [], []])
    expect(r.scanned).toBe(true)
    expect(r.text).toBe('')
    expect(r.pageCount).toBe(3)
    expect(r.charCount).toBe(0)
  })

  it('pages tout-blanc → scanné (aucune matière)', () => {
    const r = buildPdfExtraction([[item('   ', true)], [item('\t', true)]])
    expect(r.scanned).toBe(true)
    expect(r.text).toBe('')
  })

  it('PDF mixte (une page texte, une page image) → texte, on garde ce qui existe', () => {
    const r = buildPdfExtraction([
      [item('Contenu réel présent sur cette page.', true)],
      [], // page image, ne contribue rien
    ])
    expect(r.scanned).toBe(false)
    expect(r.text).toContain('Contenu réel')
    expect(r.pageCount).toBe(2)
  })

  it('document vide (0 page) → scanné, texte vide', () => {
    const r = buildPdfExtraction([])
    expect(r.scanned).toBe(true)
    expect(r.text).toBe('')
    expect(r.pageCount).toBe(0)
  })
})
