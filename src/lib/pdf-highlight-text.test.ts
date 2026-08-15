import { describe, expect, it } from 'vitest'
import { coveredPdfTextBoxes, joinPdfHighlightQuote } from './pdf-highlight-text'

// Trois lignes de texte empilées, hauteur 0,04 chacune, séparées de 0,02.
const lines = [
  { left: 0.1, right: 0.9, top: 0.10, bottom: 0.14 },
  { left: 0.1, right: 0.9, top: 0.16, bottom: 0.20 },
  { left: 0.1, right: 0.9, top: 0.22, bottom: 0.26 },
]

describe('citation sous un trait de surligneur', () => {
  it('ne retient que la ligne balayée, sur la plage horizontale du trait', () => {
    const samples = [{ x: 0.3, y: 0.18 }, { x: 0.5, y: 0.18 }, { x: 0.62, y: 0.181 }]
    const covered = coveredPdfTextBoxes(lines, samples, 0.005, 0.01)
    expect(covered).toEqual([{ index: 1, from: 0.295, to: 0.625 }])
  })

  it('attrape la ligne voisine dès que l’épaisseur du trait la recoupe', () => {
    const samples = [{ x: 0.3, y: 0.152 }, { x: 0.6, y: 0.152 }]
    const thin = coveredPdfTextBoxes(lines, samples, 0.005, 0.005)
    const thick = coveredPdfTextBoxes(lines, samples, 0.005, 0.02)
    expect(thin).toEqual([])
    expect(thick.map((item) => item.index)).toEqual([0, 1])
  })

  it('borne la plage aux bords de la ligne et ignore un trait hors du texte', () => {
    const wide = coveredPdfTextBoxes(lines, [{ x: 0, y: 0.12 }, { x: 1, y: 0.12 }], 0.01, 0.01)
    expect(wide).toEqual([{ index: 0, from: 0.1, to: 0.9 }])
    expect(coveredPdfTextBoxes(lines, [{ x: 0.5, y: 0.6 }], 0.01, 0.01)).toEqual([])
  })

  it('garde l’ordre des lignes, un trait vertical traversant tout', () => {
    const samples = Array.from({ length: 40 }, (_, index) => ({ x: 0.5, y: 0.10 + index * 0.004 }))
    expect(coveredPdfTextBoxes(lines, samples, 0.004, 0.004).map((item) => item.index)).toEqual([0, 1, 2])
  })

  it('assemble une citation propre à partir des morceaux de lignes', () => {
    expect(joinPdfHighlightQuote(['  sectetur   adipiscing', 'elit sed\ndo  '])).toBe('sectetur adipiscing elit sed do')
  })
})
