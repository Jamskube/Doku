import { describe, expect, it } from 'vitest'
import {
  parseStamp,
  selectPurgeable,
  snapshotKey,
  snapshotPreview,
  snapshotStamp,
  type SnapshotEntry,
} from './snapshot'

const DAY = 86_400_000

describe('snapshotStamp / parseStamp', () => {
  it('produit un nom sans caractère interdit sous Windows', () => {
    const name = snapshotStamp(new Date('2026-07-10T15:52:34.123Z'))
    expect(name).toBe('2026-07-10T15-52-34-123Z')
    expect(name).not.toMatch(/[:*?"<>|]/)
  })

  it('round-trip stamp -> parse (avec extension)', () => {
    const d = new Date('2026-07-10T15:52:34.123Z')
    const parsed = parseStamp(snapshotStamp(d) + '.md')
    expect(parsed?.getTime()).toBe(d.getTime())
  })

  it('tolère un suffixe de dédoublonnage ~N', () => {
    const d = new Date('2026-07-10T15:52:34.123Z')
    expect(parseStamp(snapshotStamp(d) + '~1.txt')?.getTime()).toBe(d.getTime())
  })

  it('renvoie null sur un nom non conforme (ex. meta.json)', () => {
    expect(parseStamp('meta.json')).toBeNull()
    expect(parseStamp('nimporte.md')).toBeNull()
  })
})

describe('selectPurgeable', () => {
  const now = Date.UTC(2026, 6, 10) // 2026-07-10

  const mk = (n: number, ageDays: number): SnapshotEntry => ({
    name: `snap-${n}`,
    time: now - ageDays * DAY,
  })

  it('ne purge rien sous les deux seuils', () => {
    const entries = [mk(1, 1), mk(2, 5), mk(3, 10)]
    expect(selectPurgeable(entries, now)).toEqual([])
  })

  it('purge au-delà des 20 plus récents (garde les plus récents)', () => {
    const entries = Array.from({ length: 25 }, (_, i) => mk(i, i)) // i jours d'âge
    const doomed = selectPurgeable(entries, now)
    // Les 5 plus anciens (âge 20..24) sont supprimés ; aucun des 20 récents.
    expect(doomed).toHaveLength(5)
    expect(doomed).toEqual(['snap-20', 'snap-21', 'snap-22', 'snap-23', 'snap-24'])
  })

  it('purge ce qui dépasse 30 jours même sous le compte max', () => {
    const entries = [mk(1, 2), mk(2, 31), mk(3, 40)]
    expect(selectPurgeable(entries, now).sort()).toEqual(['snap-2', 'snap-3'])
  })

  it('combine les deux règles', () => {
    // 22 entrées : 21..40 jours et 2 récentes. >20 -> 2 purgées par rang ;
    // en plus tout ce qui > 30 j.
    const entries = Array.from({ length: 22 }, (_, i) => mk(i, i + 1))
    const doomed = new Set(selectPurgeable(entries, now))
    expect(doomed.has('snap-0')).toBe(false) // 1 jour, rang 0 -> gardé
    expect(doomed.has('snap-21')).toBe(true) // rang 21 (>= 20) -> purgé
    expect(doomed.has('snap-19')).toBe(false) // rang 19, âge 20 j -> gardé (sous les deux seuils)
  })

  it('garde toujours le plus récent même au-delà de 30 jours', () => {
    const entries = [mk(1, 31), mk(2, 40)]
    // snap-1 (31 j) est le plus récent -> intouchable ; snap-2 (40 j) purgé.
    expect(selectPurgeable(entries, now)).toEqual(['snap-2'])
  })

  it('gère la liste vide', () => {
    expect(selectPurgeable([], now)).toEqual([])
  })
})

describe('snapshotPreview', () => {
  it('prend la 1re ligne non vide et retire le # de titre', () => {
    expect(snapshotPreview('\n\n# Mes notes\ncorps')).toBe('Mes notes')
  })

  it('tronque au-delà de max', () => {
    const p = snapshotPreview('x'.repeat(200), 10)
    expect(p).toHaveLength(10)
    expect(p.endsWith('…')).toBe(true)
  })

  it('renvoie une chaîne vide pour un contenu vide', () => {
    expect(snapshotPreview('   \n  \n')).toBe('')
  })
})

describe('snapshotKey', () => {
  it('est déterministe et insensible à la casse/séparateurs', async () => {
    const a = await snapshotKey('C:\\Notes\\Mon Fichier.md')
    const b = await snapshotKey('c:/notes/mon fichier.md')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{40}$/) // SHA-1 hex
  })

  it('diffère pour des chemins distincts', async () => {
    const a = await snapshotKey('C:\\Notes\\a.md')
    const b = await snapshotKey('C:\\Notes\\b.md')
    expect(a).not.toBe(b)
  })
})
