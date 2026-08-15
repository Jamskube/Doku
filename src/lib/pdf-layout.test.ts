import { describe, expect, it } from 'vitest'
import { PDF_MAX_ZOOM, PDF_MIN_ZOOM, clampPdfZoom, fitPdfPage, stepPdfZoom } from './pdf-layout'

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

  it('agrandit la page au zoom, en gardant le rendu net', () => {
    const normal = fitPdfPage(824, 24, 400, 600, 2)
    const zoomed = fitPdfPage(824, 24, 400, 600, 2, 2)
    expect(zoomed.cssWidth).toBe(normal.cssWidth * 2)
    expect(zoomed.cssHeight).toBe(normal.cssHeight * 2)
    // La finesse du rendu suit l'agrandissement : sans ça la page serait floue.
    expect(zoomed.renderScale).toBe(normal.renderScale * 2)
  })

  it('plafonne le backing store en zoom extrême plutôt que de saturer la mémoire', () => {
    const huge = fitPdfPage(2_000, 24, 1_190, 1_684, 3, 4)
    const pixels = huge.renderScale * 1_190 * (huge.renderScale * 1_684)
    expect(pixels).toBeLessThanOrEqual(16_000_001)
    // La page reste bien agrandie à l'écran, seul le rendu est bridé.
    expect(huge.cssWidth).toBeCloseTo((2_000 - 24) * 4)
  })

  it('borne le zoom et avance par crans, 100 % compris', () => {
    expect(clampPdfZoom(12)).toBe(PDF_MAX_ZOOM)
    expect(clampPdfZoom(0.1)).toBe(PDF_MIN_ZOOM)
    expect(clampPdfZoom(Number.NaN)).toBe(1)
    expect(stepPdfZoom(1, 1)).toBe(1.25)
    expect(stepPdfZoom(1.25, -1)).toBe(1)
    expect(stepPdfZoom(PDF_MAX_ZOOM, 1)).toBe(PDF_MAX_ZOOM)
    expect(stepPdfZoom(PDF_MIN_ZOOM, -1)).toBe(PDF_MIN_ZOOM)
  })
})
