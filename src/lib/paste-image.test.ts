import { describe, it, expect } from 'vitest'
import { candidateName, imageMarkdown, imageStamp, nextFreeName, sniffImageExt } from './paste-image'

const bytes = (...n: number[]) => new Uint8Array(n)

describe('sniffImageExt', () => {
  it('PNG', () => expect(sniffImageExt(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png'))
  it('JPEG', () => expect(sniffImageExt(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('jpg'))
  it('GIF', () => expect(sniffImageExt(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('gif'))
  it('WebP', () => expect(sniffImageExt(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('webp'))
  it('RIFF sans WEBP → null', () => expect(sniffImageExt(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20))).toBe(null))
  it('inconnu → null', () => expect(sniffImageExt(bytes(0x00, 0x01, 0x02, 0x03))).toBe(null))
  it('tronqué → null', () => expect(sniffImageExt(bytes(0x89, 0x50))).toBe(null))
  it('SVG (texte « <svg ») → null', () => expect(sniffImageExt(bytes(0x3c, 0x73, 0x76, 0x67, 0x20))).toBe(null))
})

describe('candidateName', () => {
  it('seq 0 = sans suffixe', () => expect(candidateName('image-20260714-120000', 'png', 0)).toBe('image-20260714-120000.png'))
  it('seq 1 = ~1', () => expect(candidateName('image-20260714-120000', 'png', 1)).toBe('image-20260714-120000~1.png'))
  it('seq 2 = ~2', () => expect(candidateName('image-20260714-120000', 'jpg', 2)).toBe('image-20260714-120000~2.jpg'))
})

describe('imageStamp', () => {
  it('format image-YYYYMMDD-HHmmss, zéro-paddé (heure locale)', () => {
    expect(imageStamp(new Date(2026, 2, 5, 8, 7, 9))).toBe('image-20260305-080709')
  })
  it('décembre / fin de mois', () => {
    expect(imageStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('image-20261231-235959')
  })
})

describe('nextFreeName', () => {
  const of = (taken: Set<string>) => async (n: string) => taken.has(n)
  it('libre au 1er essai → sans suffixe', async () => {
    expect(await nextFreeName('image-x', 'png', of(new Set()))).toBe('image-x.png')
  })
  it('collision simple → ~1', async () => {
    expect(await nextFreeName('image-x', 'png', of(new Set(['image-x.png'])))).toBe('image-x~1.png')
  })
  it('collisions en cascade → ~2 (jamais écrasant)', async () => {
    expect(await nextFreeName('image-x', 'png', of(new Set(['image-x.png', 'image-x~1.png'])))).toBe('image-x~2.png')
  })
})

describe('imageMarkdown', () => {
  it('![](name)', () => expect(imageMarkdown('image-x.png')).toBe('![](image-x.png)'))
})
