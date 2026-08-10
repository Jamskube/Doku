import { describe, expect, it } from 'vitest'
import { assemblePageItems, assemblePageText, buildPdfExtraction, detectScanned, matchPassageRange, pageForOffset, type PdfTextItem } from './pdf-text'

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

  it('pageStarts : offsets exacts, numéros RÉELS malgré une page image intercalée', () => {
    const r = buildPdfExtraction([
      [item('Page un.', true)],
      [], // page image : absente de pageStarts mais son numéro n'est pas réattribué
      [item('Page trois.', true)],
    ])
    expect(r.pageStarts).toEqual([
      { page: 1, start: 0 },
      { page: 3, start: 'Page un.\n\n'.length },
    ])
    // Le texte à chaque offset est bien le début de la page annoncée.
    expect(r.text.slice(r.pageStarts[1].start)).toBe('Page trois.')
  })

  it('pageStarts vide pour un PDF scanné', () => {
    expect(buildPdfExtraction([[], []]).pageStarts).toEqual([])
  })
})

describe('assemblePageItems', () => {
  it('mêmes plages que le texte assemblé (le \\n du hasEOL compte dans son item)', () => {
    const items = [item('Bonjour ', false), item('le monde.', true), item('Suite.', false)]
    const { text, ranges } = assemblePageItems(items)
    expect(text).toBe('Bonjour le monde.\nSuite.')
    expect(text).toBe(assemblePageText(items))
    expect(ranges).toEqual([
      { start: 0, end: 8 },
      { start: 8, end: 18 }, // « le monde.\n »
      { start: 18, end: 24 },
    ])
  })
})

describe('matchPassageRange', () => {
  it("étend l'ancre tant que la page suit le passage", () => {
    const page = 'Intro.\nLe seuil est 42 Ko.\nLa suite continue ici.\nFin.'
    const passage = 'Le seuil est 42 Ko.\nLa suite continue ici.'
    const anchor = { index: page.indexOf('Le seuil'), length: 'Le seuil est 42 Ko.'.length }
    const r = matchPassageRange(page, passage, anchor)
    expect(page.slice(r.start, r.end)).toBe(passage)
  })

  it("s'arrête à la première divergence (chunk à cheval sur la page suivante)", () => {
    const page = 'Le seuil est 42 Ko.\nDernière ligne de la page.'
    const passage = 'Le seuil est 42 Ko.\nDernière ligne de la page.\nTexte de la page suivante.'
    const anchor = { index: 0, length: 'Le seuil est 42 Ko.'.length }
    const r = matchPassageRange(page, passage, anchor)
    expect(r).toEqual({ start: 0, end: page.length })
  })

  it("couvre au moins l'ancre quand l'extension diverge immédiatement", () => {
    const page = 'Le seuil est 42 Ko. MAIS tout diffère ensuite.'
    const passage = '\n\n  Le seuil est 42 Ko.… autre normalisation…'
    const anchor = { index: 0, length: 'Le seuil est 42 Ko.'.length }
    const r = matchPassageRange(page, passage, anchor)
    expect(r.end - r.start).toBeGreaterThanOrEqual(anchor.length)
  })
})

describe('pageForOffset', () => {
  const starts = [
    { page: 1, start: 0 },
    { page: 3, start: 100 },
    { page: 4, start: 250 },
  ]

  it('retourne la dernière page dont le départ est ≤ offset', () => {
    expect(pageForOffset(starts, 0)).toBe(1)
    expect(pageForOffset(starts, 99)).toBe(1)
    expect(pageForOffset(starts, 100)).toBe(3)
    expect(pageForOffset(starts, 9999)).toBe(4)
  })

  it('null sans pages', () => {
    expect(pageForOffset([], 50)).toBeNull()
  })
})
