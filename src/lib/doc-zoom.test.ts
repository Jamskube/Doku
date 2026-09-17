import { describe, expect, it } from 'vitest'
import { nextDocZoom, parseDocZoom } from './doc-zoom'

describe('document text zoom', () => {
  it('steps by 10 % without float drift and resets to 100 %', () => {
    let zoom = 1
    for (let i = 0; i < 3; i++) zoom = nextDocZoom(zoom, 1)
    expect(zoom).toBe(1.3)
    expect(nextDocZoom(1.3, -1)).toBe(1.2)
    expect(nextDocZoom(1.7, 0)).toBe(1)
  })

  it('stays between 70 % and 200 %', () => {
    expect(nextDocZoom(2, 1)).toBe(2)
    expect(nextDocZoom(0.7, -1)).toBe(0.7)
  })

  it('reads a stored value defensively', () => {
    expect(parseDocZoom(1.25)).toBe(1.3)
    expect(parseDocZoom(9)).toBe(2)
    expect(parseDocZoom('1.5')).toBe(1)
    expect(parseDocZoom(Number.NaN)).toBe(1)
  })
})
