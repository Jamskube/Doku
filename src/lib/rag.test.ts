import { describe, expect, it } from 'vitest'
import {
  bytesToMatrix,
  checksumBytes,
  chunkText,
  diffFiles,
  embedInput,
  flattenVectors,
  hashText,
  isWithinDir,
  matrixToBytes,
  normalizeVec,
  noteTitle,
  parseRagMeta,
  ragDirKey,
  RAG_META_VERSION,
  topK,
} from './rag'

describe('chunkText', () => {
  it('fusionne les paragraphes jusqu’à ~target', () => {
    const paras = Array.from({ length: 10 }, (_, i) => `Paragraphe ${i} ` + 'x'.repeat(200))
    const { chunks, truncated } = chunkText(paras.join('\n\n'), 900)
    expect(truncated).toBe(false)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000)
    // Reconstruction : aucun contenu perdu (les blancs de fusion près)
    expect(chunks.join('\n\n')).toBe(paras.join('\n\n'))
  })

  it('coupe préférentiellement aux titres Markdown', () => {
    const text = 'Intro. ' + 'a'.repeat(300) + '\n\n## Section\n\nContenu de section.'
    const { chunks } = chunkText(text, 900)
    expect(chunks.length).toBe(2)
    expect(chunks[1].startsWith('## Section')).toBe(true)
  })

  it('ne coupe PAS à un titre si le tampon est encore minuscule', () => {
    const text = 'Court.\n\n## Titre\n\nSuite.'
    const { chunks } = chunkText(text, 900)
    expect(chunks.length).toBe(1)
  })

  it('scinde un paragraphe géant sans blancs', () => {
    const words = Array.from({ length: 500 }, (_, i) => `mot${i}`).join(' ')
    const { chunks } = chunkText(words, 900)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1400)
    expect(chunks.join(' ').replace(/\n\n/g, ' ')).toBe(words)
  })

  it('plafonne le nombre de chunks par fichier en le signalant', () => {
    const huge = Array.from({ length: 20 }, (_, i) => `P${i} ` + 'y'.repeat(880)).join('\n\n')
    const { chunks, truncated } = chunkText(huge, 900, 5)
    expect(chunks.length).toBe(5)
    expect(truncated).toBe(true)
  })

  it('fichier vide → aucun chunk', () => {
    expect(chunkText('', 900)).toEqual({ chunks: [], truncated: false })
    expect(chunkText('   \n\n  ', 900)).toEqual({ chunks: [], truncated: false })
  })
})

describe('hachage', () => {
  it('hashText est stable et sensible au contenu', async () => {
    const a = await hashText('bonjour')
    expect(a).toBe(await hashText('bonjour'))
    expect(a).not.toBe(await hashText('bonjour!'))
    expect(a).toMatch(/^[0-9a-f]{40}$/)
  })

  it('isWithinDir tolère casse, séparateurs et séparateur final', () => {
    expect(isWithinDir('C:\\Notes\\a.md', 'c:/notes/')).toBe(true)
    expect(isWithinDir('c:/notes/sub/b.md', 'C:\\Notes')).toBe(true)
    expect(isWithinDir('C:\\NotesBis\\a.md', 'C:\\Notes')).toBe(false)
    expect(isWithinDir('C:\\Autre\\a.md', 'C:\\Notes')).toBe(false)
  })

  it('ragDirKey unifie séparateurs, casse et séparateur final', async () => {
    const k = await ragDirKey('C:\\Notes\\Perso')
    expect(await ragDirKey('c:/notes/perso/')).toBe(k)
    expect(await ragDirKey('C:\\Notes\\Perso\\')).toBe(k)
    expect(await ragDirKey('C:\\Notes\\Autre')).not.toBe(k)
  })
})

describe('vecteurs', () => {
  it('normalizeVec → norme 1, topK trie par score décroissant', () => {
    const dims = 4
    const rows = [
      normalizeVec(Float32Array.from([1, 0, 0, 0])),
      normalizeVec(Float32Array.from([0, 1, 0, 0])),
      normalizeVec(Float32Array.from([1, 1, 0, 0])),
    ]
    const matrix = flattenVectors(rows, dims)
    const q = normalizeVec(Float32Array.from([1, 0.2, 0, 0]))
    const hits = topK(q, matrix, dims, 2)
    expect(hits.length).toBe(2)
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score)
    expect(hits[0].row).toBe(0) // le plus proche de (1, .2)
  })

  it('topK borne k au nombre de lignes et gère la matrice vide', () => {
    const m = flattenVectors([normalizeVec(Float32Array.from([1, 0]))], 2)
    expect(topK(Float32Array.from([1, 0]), m, 2, 5).length).toBe(1)
    expect(topK(Float32Array.from([1, 0]), new Float32Array(0), 2, 5)).toEqual([])
  })

  it('aller-retour matrice ↔ octets, y compris vide', () => {
    const dims = 3
    const matrix = flattenVectors([Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6])], dims)
    const bytes = matrixToBytes(matrix)
    const back = bytesToMatrix(bytes, dims, 2)
    expect(back).not.toBeNull()
    expect([...back!]).toEqual([1, 2, 3, 4, 5, 6])
    const empty = bytesToMatrix(matrixToBytes(new Float32Array(0)), 0, 0)
    expect(empty).not.toBeNull()
    expect(empty!.length).toBe(0)
  })

  it('bin/meta dépareillés (taille ≠ rows×dims) → null', () => {
    const bytes = matrixToBytes(new Float32Array(6))
    expect(bytesToMatrix(bytes, 3, 3)).toBeNull() // meta annonce 3 lignes, bin n'en a que 2
  })

  it('checksumBytes détecte toute altération du bin', async () => {
    const a = matrixToBytes(Float32Array.from([1, 2, 3]))
    const c1 = await checksumBytes(a)
    expect(c1).toBe(await checksumBytes(matrixToBytes(Float32Array.from([1, 2, 3]))))
    expect(c1).not.toBe(await checksumBytes(matrixToBytes(Float32Array.from([1, 2, 4]))))
  })
})

describe('diffFiles', () => {
  it('détecte ajout, modification, suppression', () => {
    const prev = [
      { path: 'a.md', hash: 'h1' },
      { path: 'b.md', hash: 'h2' },
      { path: 'c.md', hash: 'h3' },
    ]
    const next = [
      { path: 'a.md', hash: 'h1' }, // inchangé
      { path: 'b.md', hash: 'h2bis' }, // modifié
      { path: 'd.md', hash: 'h4' }, // ajouté
    ]
    expect(diffFiles(prev, next)).toEqual({ added: ['d.md'], changed: ['b.md'], removed: ['c.md'] })
  })

  it('index initial : tout est ajouté', () => {
    const next = [{ path: 'a.md', hash: 'h1' }]
    expect(diffFiles([], next)).toEqual({ added: ['a.md'], changed: [], removed: [] })
  })
})

describe('parseRagMeta', () => {
  const valid = {
    version: RAG_META_VERSION,
    dir: 'C:\\Notes',
    model: 'granite-embedding:278m',
    dims: 768,
    chunkTarget: 900,
    checksum: 'abc',
    files: [{ path: 'C:\\Notes\\a.md', name: 'a.md', hash: 'h1', chunks: ['texte'] }],
  }

  it('accepte un meta valide (y compris index vide)', () => {
    expect(parseRagMeta(JSON.stringify(valid))).not.toBeNull()
    expect(parseRagMeta(JSON.stringify({ ...valid, files: [] }))).not.toBeNull()
  })

  it('rejette JSON invalide, version inconnue, structure incomplète', () => {
    expect(parseRagMeta('{pas du json')).toBeNull()
    expect(parseRagMeta(JSON.stringify({ ...valid, version: 99 }))).toBeNull()
    expect(parseRagMeta(JSON.stringify({ ...valid, dims: 'oups' }))).toBeNull()
    expect(parseRagMeta(JSON.stringify({ ...valid, files: [{ path: 'x' }] }))).toBeNull()
    expect(parseRagMeta(JSON.stringify({ ...valid, files: [{ ...valid.files[0], chunks: [42] }] }))).toBeNull()
  })
})

describe('préfixes', () => {
  it('noteTitle retire l’extension, embedInput préfixe le titre', () => {
    expect(noteTitle('recette-tarte.md')).toBe('recette-tarte')
    expect(noteTitle('sans-extension')).toBe('sans-extension')
    expect(embedInput('titre', 'contenu')).toBe('«titre» — contenu')
  })
})
