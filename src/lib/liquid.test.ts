import { describe, expect, it } from 'vitest'
import { stretchKeyframes } from './liquid'

const px = (value: unknown) => parseFloat(String(value).split(' ')[0])

describe('stretchKeyframes', () => {
  it('vers la droite : le bord droit part devant, le gauche traîne', () => {
    const [start, mid, end] = stretchKeyframes({ x: 0, w: 40 }, { x: 100, w: 40 })
    expect(px(start.translate)).toBe(0)
    expect(px(mid.translate)).toBe(10)
    expect(px(mid.translate) + px(mid.width)).toBeCloseTo(125)
    expect(px(end.translate)).toBe(100)
    expect(end.width).toBe('40px')
  })

  it('vers la gauche : le bord gauche part devant, le droit traîne', () => {
    const [, mid] = stretchKeyframes({ x: 100, w: 40 }, { x: 0, w: 40 })
    expect(px(mid.translate)).toBeCloseTo(15)
    expect(px(mid.translate) + px(mid.width)).toBeCloseTo(130)
  })

  it('la goutte étirée est plus large que les deux options et s’affine', () => {
    const [, mid] = stretchKeyframes({ x: 0, w: 40 }, { x: 100, w: 60 })
    expect(px(mid.width)).toBeGreaterThan(60)
    expect(mid.scale).toBe('1 0.84')
  })

  it('axe vertical : translate et hauteur', () => {
    const [, mid, end] = stretchKeyframes({ x: 0, w: 20 }, { x: 80, w: 20 }, 'y')
    expect(String(end.translate)).toBe('0 80px')
    expect(end.height).toBe('20px')
    expect(mid.scale).toBe('0.84 1')
  })
})
