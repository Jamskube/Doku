import { describe, it, expect } from 'vitest'
import { formatBytes, splitSse } from './llama'

describe('splitSse', () => {
  it('événements complets → charges data + reste vide', () => {
    const { data, rest } = splitSse('', 'data: {"a":1}\n\ndata: [DONE]\n\n')
    expect(data).toEqual(['{"a":1}', '[DONE]'])
    expect(rest).toBe('')
  })
  it('événement coupé → conservé, recollé au chunk suivant', () => {
    const first = splitSse('', 'data: {"r":"Bon')
    expect(first.data).toEqual([])
    const second = splitSse(first.rest, 'jour"}\n\n')
    expect(second.data).toEqual(['{"r":"Bonjour"}'])
  })
  it('CRLF et lignes hors data (commentaires, event:) ignorées', () => {
    expect(splitSse('', ': ping\r\n\r\nevent: x\r\ndata: 1\r\n\r\n').data).toEqual(['1'])
  })
})

describe('formatBytes', () => {
  it('Go (1 décimale, virgule française)', () => expect(formatBytes(2_019_393_189)).toBe('2,0 Go'))
  it('Mo (arrondi)', () => expect(formatBytes(397_000_000)).toBe('397 Mo'))
  it('Ko', () => expect(formatBytes(1_500)).toBe('2 Ko'))
  it('octets', () => expect(formatBytes(512)).toBe('512 o'))
})
