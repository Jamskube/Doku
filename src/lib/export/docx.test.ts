import { describe, it, expect, vi } from 'vitest'
import { Packer } from 'docx'
import { mdToDocx, plainDocx, exportDocx, docxName } from './docx'

// Un .docx est un zip OOXML → commence par la signature ZIP « PK » (0x50 0x4B).
async function isDocx(doc: Parameters<typeof Packer.toBuffer>[0]): Promise<boolean> {
  const buf = await Packer.toBuffer(doc)
  return buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4b
}

describe('mdToDocx', () => {
  it('produit un .docx valide depuis un markdown riche (titres/emphase/liste/lien/table/code)', async () => {
    const md = [
      '# Titre',
      '',
      'Un **gras**, un *italique*, un `code`, un [lien](https://ex.com).',
      '',
      '- a',
      '- b',
      '',
      '1. un',
      '2. deux',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '> citation',
    ].join('\n')
    expect(await isDocx(mdToDocx(md))).toBe(true)
  })

  it('ne plante pas sur des tokens non mappables (HTML brut) ni sur du vide', async () => {
    expect(() => mdToDocx('<div>x</div>\n\n<custom-tag>')).not.toThrow()
    expect(await isDocx(mdToDocx('<div>x</div>'))).toBe(true)
    expect(await isDocx(mdToDocx(''))).toBe(true)
  })

  it('gère l’emphase imbriquée sans planter', async () => {
    expect(await isDocx(mdToDocx('***gras-italique*** et ~~barré~~'))).toBe(true)
  })
})

describe('plainDocx', () => {
  it('produit un .docx valide depuis du texte brut', async () => {
    expect(await isDocx(plainDocx('ligne 1\nligne 2'))).toBe(true)
    expect(await isDocx(plainDocx(''))).toBe(true)
  })
})

describe('docxName', () => {
  it('remplace l’extension par .docx', () => {
    expect(docxName('note.md')).toBe('note.docx')
    expect(docxName('page.html')).toBe('page.docx')
    expect(docxName('sansext')).toBe('sansext.docx')
  })
})

describe('exportDocx', () => {
  it('sérialise en octets .docx et enregistre → saved', async () => {
    let savedBytes: Uint8Array | null = null
    const save = vi.fn(async (_name: string, bytes: Uint8Array) => {
      savedBytes = bytes
      return true
    })
    const res = await exportDocx({ kind: 'md', name: 'n.md', content: '# T' }, { save })
    expect(res).toBe('saved')
    expect(save).toHaveBeenCalledWith('n.docx', expect.any(Uint8Array))
    expect(savedBytes![0]).toBe(0x50) // 'P'
    expect(savedBytes![1]).toBe(0x4b) // 'K'
  })

  it('dialogue annulé → cancelled', async () => {
    const res = await exportDocx({ kind: 'txt', name: 'a.txt', content: 'x' }, { save: async () => false })
    expect(res).toBe('cancelled')
  })
})
