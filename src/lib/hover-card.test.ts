import { describe, expect, it } from 'vitest'
import { placeHoverCard } from './hover-card'

const viewport = { width: 1000, height: 800 }
const card = { width: 300, height: 120 }

describe('placeHoverCard', () => {
  it('se pose sous le déclencheur, alignée sur son bord gauche', () => {
    const out = placeHoverCard({ left: 100, top: 200, width: 80, height: 24 }, card, viewport)
    expect(out).toEqual({ left: 100, top: 230, side: 'bottom', originX: 40 })
  })

  it('passe au-dessus quand le bas manque de place et le haut en a plus', () => {
    const out = placeHoverCard({ left: 100, top: 740, width: 80, height: 24 }, card, viewport)
    expect(out.side).toBe('top')
    expect(out.top).toBe(740 - 6 - 120)
  })

  it('reste en bas quand aucun côté ne suffit mais que le bas en offre plus', () => {
    const out = placeHoverCard({ left: 100, top: 60, width: 80, height: 24 }, card, { width: 1000, height: 200 })
    expect(out.side).toBe('bottom')
  })

  it('glisse le long du bord droit et garde l’origine sur la puce', () => {
    const out = placeHoverCard({ left: 900, top: 200, width: 60, height: 24 }, card, viewport)
    expect(out.left).toBe(1000 - 8 - 300)
    expect(out.originX).toBe(900 + 30 - out.left)
  })

  it('borne l’origine à la carte quand la puce dépasse', () => {
    const out = placeHoverCard({ left: 0, top: 200, width: 4, height: 24 }, card, viewport)
    expect(out.left).toBe(8)
    expect(out.originX).toBe(0)
  })
})
