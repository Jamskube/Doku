import { describe, expect, it } from 'vitest'
import { lensMapPixels } from './island-lens'

describe('lensMapPixels', () => {
  const w = 200
  const h = 60
  const px = lensMapPixels(w, h, 30, 14)
  const at = (x: number, y: number) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 1]]

  it('ne déplace rien au cœur', () => {
    expect(at(100, 30)).toEqual([128, 128])
  })
  it('au bord gauche, va chercher le fond vers la droite (rouge > 128)', () => {
    const [r, g] = at(2, 30)
    expect(r).toBeGreaterThan(200)
    expect(Math.abs(g - 128)).toBeLessThanOrEqual(3)
    expect(at(40, 30)).toEqual([128, 128])
  })
  it('au bord bas, va chercher le fond vers le haut (vert < 128), plus fort près du contour', () => {
    const near = at(100, 59)[1]
    const far = at(100, 50)[1]
    expect(near).toBeLessThan(far)
    expect(far).toBeLessThanOrEqual(128)
  })
})
