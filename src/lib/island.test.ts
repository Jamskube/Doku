import { describe, expect, it } from 'vitest'
import { overshootEasing, pickLive } from './island'

describe('pickLive', () => {
  it('donne l’îlot au plus prioritaire et le bourgeon au second', () => {
    const { main, bud } = pickLive([{ id: 'rag', priority: 50 }, { id: 'notice', priority: 90 }, { id: 'saved', priority: 30 }])
    expect(main?.id).toBe('notice')
    expect(bud?.id).toBe('rag')
  })
  it('départage à priorité égale par l’ordre d’arrivée', () => {
    expect(pickLive([{ id: 'a', priority: 1 }, { id: 'b', priority: 1 }]).main?.id).toBe('a')
  })
  it('vide : ni îlot ni bourgeon', () => {
    expect(pickLive([])).toEqual({ main: null, bud: null })
  })
})

describe('overshootEasing', () => {
  it('part de 0, dépasse de la valeur demandée et finit à 1', () => {
    const values = overshootEasing(0.03).slice(7, -1).split(', ').map(Number)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
    expect(Math.max(...values)).toBeCloseTo(1.03, 2)
  })
})
