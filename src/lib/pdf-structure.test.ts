import { describe, expect, it } from 'vitest'
import {
  buildPdfStructuredDoc,
  groupPdfParagraphs,
  pdfBodySize,
  pdfLinesFromStructuredText,
  type PdfSourceLine,
} from './pdf-structure'

const PAGE = 595

function line(text: string, y: number, extra: Partial<PdfSourceLine> = {}): PdfSourceLine {
  return {
    page: 1,
    x: 60,
    y,
    width: 320,
    height: 16,
    text,
    font: { name: 'Helvetica', size: 12, weight: 'normal', style: 'normal' },
    ...extra,
  }
}

const bold = (size = 12) => ({ font: { name: 'Helvetica-Bold', size, weight: 'bold', style: 'normal' } })

describe('pdfLinesFromStructuredText', () => {
  it('lit la sortie de MuPDF', () => {
    const json = {
      blocks: [{
        type: 'text',
        lines: [{
          text: 'Bonjour à toi',
          bbox: { x: 60, y: 72, w: 200, h: 16 },
          font: { name: 'Helvetica-Bold', size: 16, weight: 'bold', style: 'normal' },
        }],
      }],
    }
    expect(pdfLinesFromStructuredText(json, 3)).toEqual([{
      page: 3, x: 60, y: 72, width: 200, height: 16,
      text: 'Bonjour à toi',
      font: { name: 'Helvetica-Bold', size: 16, weight: 'bold', style: 'normal' },
    }])
  })

  it('écarte les blocs non textuels et les lignes vides', () => {
    const json = {
      blocks: [
        { type: 'image', lines: [] },
        { type: 'text', lines: [{ text: '   ', bbox: { x: 0, y: 0, w: 1, h: 1 } }] },
      ],
    }
    expect(pdfLinesFromStructuredText(json, 1)).toEqual([])
  })

  it('rend une liste vide plutôt que de jeter sur une entrée inattendue', () => {
    expect(pdfLinesFromStructuredText(null, 1)).toEqual([])
    expect(pdfLinesFromStructuredText({ blocks: 'nope' }, 1)).toEqual([])
    expect(pdfLinesFromStructuredText({}, 1)).toEqual([])
  })
})

describe('pdfBodySize', () => {
  it('retient la taille qui porte le plus de texte, pas la plus fréquente', () => {
    // Deux titres courts en 24, un paragraphe long en 11 : le corps est 11.
    const lines = [
      line('Titre A', 10, bold(24)),
      line('Titre B', 40, bold(24)),
      line('Un paragraphe nettement plus long que les deux titres réunis.', 70, { font: { name: 'H', size: 11, weight: 'normal', style: 'normal' } }),
    ]
    expect(pdfBodySize(lines)).toBe(11)
  })

  it('retombe sur 12 sans lignes', () => {
    expect(pdfBodySize([])).toBe(12)
  })
})

describe('groupPdfParagraphs', () => {
  it('recolle les lignes d’un même paragraphe', () => {
    // Le retour à la ligne d'un PDF est une décision de mise en page, pas du contenu.
    const paragraphs = groupPdfParagraphs([
      line('Le prestataire s’engage à livrer', 100),
      line('les travaux décrits en annexe.', 118),
    ], PAGE)
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].runs[0].text).toBe('Le prestataire s’engage à livrer les travaux décrits en annexe.')
  })

  it('coupe sur un blanc plus grand qu’un interligne', () => {
    const paragraphs = groupPdfParagraphs([
      line('Premier paragraphe.', 100),
      line('Second paragraphe.', 160),
    ], PAGE)
    expect(paragraphs).toHaveLength(2)
  })

  it('recolle un mot coupé par une césure', () => {
    const paragraphs = groupPdfParagraphs([
      line('Une résiliation antici-', 100),
      line('pée reste possible.', 118),
    ], PAGE)
    expect(paragraphs[0].runs[0].text).toBe('Une résiliation anticipée reste possible.')
  })

  it('sépare deux paragraphes de graisses différentes', () => {
    const paragraphs = groupPdfParagraphs([
      line('Chapeau en gras.', 100, bold()),
      line('Corps normal.', 118),
    ], PAGE)
    expect(paragraphs).toHaveLength(2)
  })

  it('coupe quand la marge gauche change franchement', () => {
    const paragraphs = groupPdfParagraphs([
      line('Texte courant.', 100),
      line('Élément de liste.', 118, { x: 120 }),
    ], PAGE)
    expect(paragraphs).toHaveLength(2)
  })

  it('classe les titres par rapport au corps', () => {
    const lines = [
      line('Titre principal', 40, bold(24)),
      line('Sous-titre', 80, bold(16)),
      ...Array.from({ length: 6 }, (_, i) => line(`Ligne de corps numéro ${i} avec du texte.`, 200 + i * 60)),
    ]
    const paragraphs = groupPdfParagraphs(lines, PAGE)
    expect(paragraphs[0].kind).toBe('heading1')
    expect(paragraphs[1].kind).toBe('heading2')
    expect(paragraphs.at(-1)!.kind).toBe('paragraph')
  })

  it('détecte un bloc centré', () => {
    const centered = groupPdfParagraphs([
      { ...line('Au centre', 100), x: 200, width: 195 },
    ], PAGE)
    expect(centered[0].align).toBe('center')
  })

  it('laisse à gauche un bloc qui part de la marge', () => {
    expect(groupPdfParagraphs([line('À gauche', 100)], PAGE)[0].align).toBe('left')
  })

  it('ne recolle jamais deux pages', () => {
    const paragraphs = groupPdfParagraphs([
      line('Fin de la page une', 700),
      { ...line('Début de la page deux', 710), page: 2 },
    ], PAGE)
    expect(paragraphs).toHaveLength(2)
  })

  it('remet les lignes dans l’ordre de lecture', () => {
    const paragraphs = groupPdfParagraphs([
      line('Deuxième', 300),
      line('Premier', 100),
    ], PAGE)
    expect(paragraphs[0].runs[0].text).toBe('Premier')
    expect(paragraphs[1].runs[0].text).toBe('Deuxième')
  })
})

describe('buildPdfStructuredDoc', () => {
  it('assemble le document et sa taille de corps', () => {
    const doc = buildPdfStructuredDoc([line('Bonjour', 100), line('Monde', 200)], PAGE, 1)
    expect(doc.pages).toBe(1)
    expect(doc.bodySize).toBe(12)
    expect(doc.paragraphs).toHaveLength(2)
  })

  it('supporte un document sans texte', () => {
    const doc = buildPdfStructuredDoc([], PAGE, 3)
    expect(doc.paragraphs).toEqual([])
    expect(doc.pages).toBe(3)
  })
})
