import { describe, expect, it } from 'vitest'
import { describeSignatures, normalizeSignatures, parsePdfDate } from './pdf-signatures'

describe('parsePdfDate', () => {
  it('lit une date PDF complète avec décalage horaire', () => {
    // D:20260818120000+02'00' = 12 h à Paris = 10 h UTC. Le décalage se RETIRE.
    expect(parsePdfDate("D:20260818120000+02'00'")?.toISOString()).toBe('2026-08-18T10:00:00.000Z')
  })

  it('accepte un décalage négatif et la forme Z', () => {
    expect(parsePdfDate("D:20260818120000-05'00'")?.toISOString()).toBe('2026-08-18T17:00:00.000Z')
    expect(parsePdfDate('D:20260818120000Z')?.toISOString()).toBe('2026-08-18T12:00:00.000Z')
  })

  it('accepte les champs tronqués après l’année', () => {
    expect(parsePdfDate('D:2026')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(parsePdfDate('D:202608')?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  // Une date fausse est PIRE qu'une date absente : elle sera lue comme un fait.
  it('refuse plutôt que d’inventer', () => {
    expect(parsePdfDate('20260818120000')).toBeNull() // préfixe D: manquant
    expect(parsePdfDate('D:20261318000000')).toBeNull() // mois 13
    expect(parsePdfDate('D:20260231000000')).toBeNull() // 31 février : ne doit PAS glisser au 3 mars
    expect(parsePdfDate('D:20260818250000')).toBeNull() // heure 25
    expect(parsePdfDate(null)).toBeNull()
    expect(parsePdfDate(42)).toBeNull()
  })
})

describe('normalizeSignatures', () => {
  it('survit à des champs absents, vides ou du mauvais type', () => {
    const out = normalizeSignatures([{ signerName: '  ', reason: 42, signingTime: 'n’importe quoi' }])
    expect(out).toHaveLength(1)
    expect(out[0].signer).toBeNull()
    expect(out[0].reason).toBeNull()
    expect(out[0].signedAt).toBeNull()
    expect(out[0].id).toBe('signature-0')
  })

  it('rend une liste vide sur null ou une valeur non-tableau', () => {
    expect(normalizeSignatures(null)).toEqual([])
    expect(normalizeSignatures(undefined)).toEqual([])
  })
})

describe('describeSignatures', () => {
  it('ne dit rien quand il n’y a aucune signature', () => {
    expect(describeSignatures([]).summary).toBe('')
    expect(describeSignatures(null).summary).toBe('')
  })

  // LE test qui compte : la réserve doit être là, quoi qu'il arrive. Sans elle,
  // Doku laisserait croire qu'il a validé un document contractuel.
  it('porte TOUJOURS la réserve de non-vérification', () => {
    const un = describeSignatures([{ signerName: 'Arnaud De Cafmeyer', signingTime: "D:20260818120000+02'00'" }])
    expect(un.summary).toContain('Doku ne vérifie pas sa validité.')

    const anonyme = describeSignatures([{}])
    expect(anonyme.summary).toContain('Doku ne vérifie pas sa validité.')

    const plusieurs = describeSignatures([{ signerName: 'A' }, { signerName: 'B' }])
    expect(plusieurs.summary).toContain('Doku ne vérifie pas sa validité.')
  })

  it('nomme le signataire et la date quand ils sont déclarés', () => {
    const { summary } = describeSignatures([
      { signerName: 'Arnaud De Cafmeyer', signingTime: "D:20260818120000+02'00'" },
    ])
    expect(summary).toContain('par Arnaud De Cafmeyer')
    expect(summary).toMatch(/le 18 août 2026/)
  })

  it('reste lisible quand rien n’est déclaré', () => {
    expect(describeSignatures([{}]).summary).toBe('Ce document porte une signature. Doku ne vérifie pas sa validité.')
  })

  it('compte les signatures multiples et dédoublonne les signataires', () => {
    const { summary } = describeSignatures([{ signerName: 'A' }, { signerName: 'A' }, { signerName: 'B' }])
    expect(summary).toContain('3 signatures')
    expect(summary).toContain('(A, B)')
  })
})
