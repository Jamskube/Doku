import { describe, expect, it } from 'vitest'
import { fitPdfPage } from './pdf-layout'

describe('fitPdfPage', () => {
  it('adapte la page à la largeur utile du lecteur', () => {
    expect(fitPdfPage(824, 24, 400, 600, 2)).toEqual({
      cssWidth: 800,
      cssHeight: 1200,
      renderScale: 4,
    })
  })

  it('recalcule la hauteur quand le lecteur rétrécit puis grandit', () => {
    const narrow = fitPdfPage(424, 24, 400, 600, 2)
    const wide = fitPdfPage(1024, 24, 400, 600, 2)

    expect(narrow).toMatchObject({ cssWidth: 400, cssHeight: 600 })
    expect(wide).toMatchObject({ cssWidth: 1000, cssHeight: 1500 })
  })

  it('borne le DPR pour éviter un backing store démesuré', () => {
    expect(fitPdfPage(424, 24, 400, 600, 5).renderScale).toBe(3)
    expect(fitPdfPage(424, 24, 400, 600, 0).renderScale).toBe(1)
  })
})
