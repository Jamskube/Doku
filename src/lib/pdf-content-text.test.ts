import { describe, expect, it } from 'vitest'
import {
  decodeGlyphs,
  decodePdfString,
  encodeGlyphs,
  encodePdfString,
  findTextRuns,
  groupRunsIntoLines,
  invertToUnicode,
  parseToUnicode,
  planLineEdit,
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

  // Régression : la modification d'UNE ligne s'écrivait à moitié. `planLineEdit` porte le
  // texte neuf par le premier passage touché et VIDE les suivants ; quand le premier était
  // refusé faute de glyphe, les passages vides — qui s'encodent parfaitement — partaient
  // quand même à l'écriture. La correction n'était pas écrite, la FIN DE LA LIGNE
  // disparaissait du document, et `applied` valant 1, le rapport annonçait un succès.
  it('ne vide PAS la fin d’une ligne dont le début est refusé (atomicité du groupe)', () => {
    const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ [(\\000\\005)] TJ'
    const runs = findTextRuns(flux, codecs)
    // « abc » → « aZZZ » : `Z` manque à la police, et le plan vide le dernier passage.
    const edits = planLineEdit({ text: 'abc', runs }, 'aZZZ').map((e) => ({ ...e, group: 0 }))
    expect(edits.some((e) => e.text === '')).toBe(true) // le piège est bien armé
    const out = rewriteTextRuns(flux, codecs, edits)
    expect(out.applied).toBe(0)
    expect(out.flux).toBe(flux)
    expect(findTextRuns(out.flux, codecs).map((r) => r.text)).toEqual(['a', 'b', 'c'])
    expect(out.rejected[0].group).toBe(0)
  })

  it('deux lignes restent indépendantes : le refus de l’une n’annule pas l’autre', () => {
    const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ'
    const runs = findTextRuns(flux, codecs)
    const out = rewriteTextRuns(flux, codecs, [
      { run: runs[0], text: 'c', group: 0 },
      { run: runs[1], text: 'Z', group: 1 },
    ])
    expect(out.applied).toBe(1)
    expect(findTextRuns(out.flux, codecs).map((r) => r.text)).toEqual(['c', 'b'])
  })
})

describe('groupRunsIntoLines', () => {
  const codecs = new Map([['f0', codec()]])
  // `a`=0x03 `b`=0x04 `c`=0x05 `A`=0x24 dans la CMap de test.
  const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ [(\\000\\005)] TJ'

  it('reconstitue une ligne portée par plusieurs passages', () => {
    // Une ligne affichée mêlant les styles est écrite en plusieurs opérateurs : exiger
    // qu'UN passage la couvre entièrement laissait 31 % des lignes sans champ.
    const groupes = groupRunsIntoLines(findTextRuns(flux, codecs), ['abc'])
    expect(groupes).toHaveLength(1)
    expect(groupes[0].runs).toHaveLength(3)
    expect(groupes[0].text).toBe('abc')
  })

  it('garde une ligne d’un seul passage', () => {
    const groupes = groupRunsIntoLines(findTextRuns(flux, codecs), ['a', 'b', 'c'])
    expect(groupes.map((g) => g.runs.length)).toEqual([1, 1, 1])
  })

  it('trouve la suite même si l’ordre du flux diffère de l’ordre de lecture', () => {
    // L'ordre du flux est celui du DESSIN ; celui des lignes, celui de la LECTURE.
    // Les deux divergent dès qu'il y a colonnes ou encadrés.
    const groupes = groupRunsIntoLines(findTextRuns(flux, codecs), ['c', 'ab'])
    expect(groupes.map((g) => g.text)).toEqual(['c', 'ab'])
  })

  it('ne réutilise jamais un passage déjà pris', () => {
    const groupes = groupRunsIntoLines(findTextRuns(flux, codecs), ['ab', 'ab'])
    expect(groupes).toHaveLength(1)
  })

  it('ignore une ligne sans correspondance sans désaligner les suivantes', () => {
    const groupes = groupRunsIntoLines(findTextRuns(flux, codecs), ['zzz', 'ab'])
    expect(groupes.map((g) => g.text)).toEqual(['ab'])
  })
})

describe('planLineEdit', () => {
  const codecs = new Map([['f0', codec()]])
  const flux = '/f0 12 Tf [(\\000\\003)] TJ [(\\000\\004)] TJ [(\\000\\005)] TJ'
  const ligne = () => groupRunsIntoLines(findTextRuns(flux, codecs), ['abc'])[0]

  it('ne réécrit QUE le passage touché', () => {
    // Corriger le milieu d'une ligne doit laisser intacts les passages voisins —
    // c'est ce qui préserve un mot en gras ou un extrait de code au sein de la ligne.
    const edits = planLineEdit(ligne(), 'aXc')
    expect(edits).toHaveLength(1)
    expect(edits[0].run.text).toBe('b')
    expect(edits[0].text).toBe('X')
  })

  it('couvre plusieurs passages quand la modification les traverse', () => {
    const edits = planLineEdit(ligne(), 'aZZ')
    expect(edits.length).toBeGreaterThan(1)
    // Le premier porte le texte neuf, les suivants sont vidés.
    expect(edits[0].text).toBe('ZZ')
    expect(edits.slice(1).every((e) => e.text === '')).toBe(true)
  })

  it('rend une liste vide quand rien ne change', () => {
    expect(planLineEdit(ligne(), 'abc')).toEqual([])
  })

  it('traite une ligne d’un seul passage sans découpage', () => {
    const simple = groupRunsIntoLines(findTextRuns(flux, codecs), ['a'])[0]
    expect(planLineEdit(simple, 'cc')).toEqual([{ run: simple.runs[0], text: 'cc' }])
  })

  it('gère un ajout en fin de ligne', () => {
    const edits = planLineEdit(ligne(), 'abcc')
    expect(edits).toHaveLength(1)
    expect(edits[0].run.text).toBe('c')
    expect(edits[0].text).toBe('cc')
  })

  it('gère une suppression en début de ligne', () => {
    const edits = planLineEdit(ligne(), 'bc')
    expect(edits[0].run.text).toBe('a')
    expect(edits[0].text).toBe('')
  })
})
