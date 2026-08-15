import { describe, expect, it } from 'vitest'
import {
  decodeGlyphs,
  decodePdfString,
  encodeGlyphs,
  encodePdfString,
  findTextRuns,
  invertToUnicode,
  parseToUnicode,
  rewriteTextRuns,
  type PdfGlyphCodec,
} from './pdf-content-text'

const CMAP = `
/CIDInit /ProcSet findresource begin
12 dict begin begincmap
1 beginbfchar
<0024> <0041>
endbfchar
2 beginbfrange
<0003> <0005> <0061>
<0010> <0011> <00E9>
endbfrange
endcmap
`

function codec(bytes: 1 | 2 = 2): PdfGlyphCodec {
  const toUnicode = parseToUnicode(CMAP)
  return { bytes, toUnicode, fromUnicode: invertToUnicode(toUnicode) }
}

describe('parseToUnicode', () => {
  it('lit les associations une à une', () => {
    expect(parseToUnicode(CMAP).get(0x24)).toBe('A')
  })

  it('déplie les plages en incrémentant', () => {
    const table = parseToUnicode(CMAP)
    expect(table.get(0x03)).toBe('a')
    expect(table.get(0x04)).toBe('b')
    expect(table.get(0x05)).toBe('c')
    expect(table.get(0x10)).toBe('é')
    expect(table.get(0x11)).toBe('ê')
  })

  it('ignore une plage absurde plutôt que d’exploser', () => {
    // Fin avant début, et plage démesurée : une CMap malformée ne doit pas faire
    // grossir la table jusqu'à saturer la mémoire.
    const table = parseToUnicode('beginbfrange <0100> <0002> <0041> endbfrange')
    expect(table.size).toBe(0)
    expect(parseToUnicode('beginbfrange <0000> <FFFFFF> <0041> endbfrange').size).toBe(0)
  })

  it('rend une table vide sur une CMap vide ou illisible', () => {
    expect(parseToUnicode('').size).toBe(0)
    expect(parseToUnicode('nimporte quoi').size).toBe(0)
  })
})

describe('invertToUnicode', () => {
  it('associe le caractère à son code', () => {
    expect(invertToUnicode(parseToUnicode(CMAP)).get('A')).toBe(0x24)
  })

  it('n’indexe pas les ligatures', () => {
    // Un glyphe qui vaut « fi » ne doit pas servir à écrire « f » : on encoderait deux
    // lettres avec un seul glyphe.
    const table = new Map([[1, 'fi'], [2, 'f']])
    const inverse = invertToUnicode(table)
    expect(inverse.get('f')).toBe(2)
    expect(inverse.has('fi')).toBe(false)
  })

  it('garde le premier code en cas de doublon', () => {
    expect(invertToUnicode(new Map([[7, 'x'], [9, 'x']])).get('x')).toBe(7)
  })
})

describe('chaînes PostScript', () => {
  it('décode les échappements octaux et nommés', () => {
    expect(decodePdfString('\\000\\044')).toEqual([0, 36])
    expect(decodePdfString('a\\(b\\)c')).toEqual([97, 40, 98, 41, 99])
    expect(decodePdfString('\\n\\t')).toEqual([10, 9])
    expect(decodePdfString('\\\\')).toEqual([92])
  })

  it('réencode en échappant ce qui doit l’être', () => {
    expect(encodePdfString([0, 36])).toBe('\\000$')
    expect(encodePdfString([40, 41, 92])).toBe('\\(\\)\\\\')
    expect(encodePdfString([65, 66])).toBe('AB')
  })

  it('fait l’aller-retour sans perte', () => {
    const octets = [0, 3, 0, 36, 40, 92, 255, 10]
    expect(decodePdfString(encodePdfString(octets))).toEqual(octets)
  })
})

describe('glyphes', () => {
  it('décode une suite de codes sur 2 octets', () => {
    expect(decodeGlyphs([0x00, 0x03, 0x00, 0x04, 0x00, 0x24], codec())).toBe('abA')
  })

  it('décode sur 1 octet pour une police simple', () => {
    expect(decodeGlyphs([0x03, 0x05], codec(1))).toBe('ac')
  })

  it('encode ce que la police connaît', () => {
    expect(encodeGlyphs('abA', codec())).toEqual({ octets: [0, 3, 0, 4, 0, 0x24], manquants: [] })
  })

  it('SIGNALE les caractères absents du sous-ensemble au lieu de les avaler', () => {
    // C'est la limite réelle de l'édition dans le flux : une police embarquée ne
    // contient que les glyphes déjà utilisés. Le silence ici produirait du texte amputé.
    const resultat = encodeGlyphs('aZb', codec())
    expect(resultat.manquants).toEqual(['Z'])
    expect(decodeGlyphs(resultat.octets, codec())).toBe('ab')
  })

  it('ne répète pas un manquant', () => {
    expect(encodeGlyphs('ZZZ', codec()).manquants).toEqual(['Z'])
  })
})

describe('findTextRuns', () => {
  const codecs = new Map([['f0', codec()]])

  it('lit un TJ et le rattache à sa police', () => {
    const flux = '/f0 12 Tf [(\\000\\003\\000\\004)] TJ'
    const runs = findTextRuns(flux, codecs)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ font: 'f0', text: 'ab', kind: 'TJ' })
  })

  it('lit un Tj simple', () => {
    // `\044` = octal 44 = 0x24, le code du glyphe « A » dans la CMap de test.
    const runs = findTextRuns('/f0 12 Tf (\\000\\044) Tj', new Map([['f0', codec()]]))
    expect(runs[0]).toMatchObject({ text: 'A', kind: 'Tj' })
  })

  it('recolle les morceaux d’un TJ séparés par du crénage', () => {
    // `[(a) -50 (b)] TJ` : le nombre est un déplacement, pas du texte.
    const flux = '/f0 12 Tf [(\\000\\003) -50 (\\000\\004)] TJ'
    expect(findTextRuns(flux, codecs)[0].text).toBe('ab')
  })

  it('suit le changement de police en cours de flux', () => {
    const autre = codec()
    autre.toUnicode = new Map([[3, 'Z']])
    const flux = '/f0 12 Tf [(\\000\\003)] TJ /f1 12 Tf [(\\000\\003)] TJ'
    const runs = findTextRuns(flux, new Map([['f0', codec()], ['f1', autre]]))
    expect(runs.map((r) => r.text)).toEqual(['a', 'Z'])
    expect(runs.map((r) => r.font)).toEqual(['f0', 'f1'])
  })

  it('ignore un passage dont la police est inconnue', () => {
    expect(findTextRuns('/inconnu 12 Tf [(\\000\\003)] TJ', codecs)).toEqual([])
  })

  it('donne des bornes exactes, réutilisables pour un remplacement', () => {
    const flux = 'BT /f0 12 Tf [(\\000\\003)] TJ ET'
    const run = findTextRuns(flux, codecs)[0]
    expect(flux.slice(run.start, run.end)).toBe('[(\\000\\003)] TJ')
  })
})

describe('rewriteTextRuns', () => {
  const codecs = new Map([['f0', codec()]])

  it('remplace un passage sans toucher au reste du flux', () => {
    const flux = 'q 1 0 0 1 0 0 cm /f0 12 Tf [(\\000\\003)] TJ Q'
    const run = findTextRuns(flux, codecs)[0]
    const out = rewriteTextRuns(flux, codecs, [{ run, text: 'b' }])
    expect(out.applied).toBe(1)
    expect(out.flux.startsWith('q 1 0 0 1 0 0 cm /f0 12 Tf ')).toBe(true)
    expect(out.flux.endsWith(' Q')).toBe(true)
    expect(findTextRuns(out.flux, codecs)[0].text).toBe('b')
  })

  it('applique plusieurs remplacements sans décaler les positions', () => {
    // Appliquer du début vers la fin invaliderait les bornes des suivants : le premier
    // remplacement n'a pas la même longueur que l'original.
    const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ [(\\000\\005)] TJ'
    const runs = findTextRuns(flux, codecs)
    const out = rewriteTextRuns(flux, codecs, [
      { run: runs[0], text: 'abc' },
      { run: runs[2], text: 'aa' },
    ])
    expect(out.applied).toBe(2)
    expect(findTextRuns(out.flux, codecs).map((r) => r.text)).toEqual(['abc', 'b', 'aa'])
  })

  it('REFUSE un remplacement dont un glyphe manque, et dit lequel', () => {
    const flux = '/f0 12 Tf [(\\000\\003)] TJ'
    const run = findTextRuns(flux, codecs)[0]
    const out = rewriteTextRuns(flux, codecs, [{ run, text: 'aZ' }])
    expect(out.applied).toBe(0)
    expect(out.rejected).toEqual([{ text: 'aZ', manquants: ['Z'] }])
    // Le flux doit être rendu INTACT : un remplacement partiel serait pire que rien.
    expect(out.flux).toBe(flux)
  })

  it('applique ce qui passe et refuse le reste, sans mélanger', () => {
    const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ'
    const runs = findTextRuns(flux, codecs)
    const out = rewriteTextRuns(flux, codecs, [
      { run: runs[0], text: 'c' },
      { run: runs[1], text: 'Z' },
    ])
    expect(out.applied).toBe(1)
    expect(out.rejected).toHaveLength(1)
    expect(findTextRuns(out.flux, codecs).map((r) => r.text)).toEqual(['c', 'b'])
  })

  it('rend le flux inchangé sans édition', () => {
    const flux = '/f0 12 Tf [(\\000\\003)] TJ'
    expect(rewriteTextRuns(flux, codecs, []).flux).toBe(flux)
  })
})
