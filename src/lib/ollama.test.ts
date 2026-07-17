import { describe, it, expect } from 'vitest'
import { formatBytes, splitNdjson } from './ollama'

describe('splitNdjson', () => {
  it('lignes complètes → objets + reste vide', () => {
    const { objects, rest } = splitNdjson('', '{"a":1}\n{"a":2}\n')
    expect(objects).toEqual([{ a: 1 }, { a: 2 }])
    expect(rest).toBe('')
  })

  it('ligne partielle → conservée dans le reste', () => {
    const { objects, rest } = splitNdjson('', '{"a":1}\n{"a":2')
    expect(objects).toEqual([{ a: 1 }])
    expect(rest).toBe('{"a":2')
  })

  it('reliquat re-préfixé au chunk suivant (fragment coupé au milieu)', () => {
    const first = splitNdjson('', '{"r":"Bon')
    expect(first.objects).toEqual([])
    expect(first.rest).toBe('{"r":"Bon')
    const second = splitNdjson(first.rest, 'jour"}\n')
    expect(second.objects).toEqual([{ r: 'Bonjour' }])
    expect(second.rest).toBe('')
  })

  it('lignes vides ignorées', () => {
    const { objects } = splitNdjson('', '\n{"a":1}\n\n')
    expect(objects).toEqual([{ a: 1 }])
  })
})

describe('formatBytes', () => {
  it('Go (1 décimale, virgule française)', () => expect(formatBytes(2_019_393_189)).toBe('2,0 Go'))
  it('Mo (arrondi)', () => expect(formatBytes(397_000_000)).toBe('397 Mo'))
  it('Ko', () => expect(formatBytes(1_500)).toBe('2 Ko'))
  it('octets', () => expect(formatBytes(512)).toBe('512 o'))
})
