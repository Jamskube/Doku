import { describe, expect, it } from 'vitest'
import {
  applyMemoryMutations,
  buildMemoryExtractionPrompt,
  buildMemorySelectionPrompt,
  memoryFileName,
  memoryIndexMarkdown,
  memoryRecallCandidates,
  memoryRecallLocalCandidates,
  parseMemory,
  parseMemoryMutations,
  parseSelectedMemoryIds,
  serializeMemory,
  type MemoryRecord,
} from './copilot-memory'

const base: MemoryRecord = {
  id: 'mem-1234567890',
  name: 'Convention des verdicts',
  description: 'Valeurs autorisées dans la colonne verdict',
  type: 'decision',
  content: 'La colonne accepte pub, jingle et promo.\n\n**Pourquoi :** préserver le vocabulaire partagé.',
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-11T10:00:00.000Z',
  sourceProvider: 'openai',
  sourceDocument: 'verdicts.md',
}

describe('copilot memory', () => {
  it('round-trips a memory through human-readable Markdown', () => {
    expect(parseMemory(serializeMemory(base))).toEqual(base)
    expect(memoryFileName(base)).toMatch(/^convention-des-verdicts-/)
  })

  it('rejects malformed model mutations and caps valid output', () => {
    const raw = '```json\n{"mutations":[{"op":"create","name":"Ton","description":"Préférence de ton","type":"preference","content":"Répondre brièvement."},{"op":"delete"},{"op":"hack"}]}\n```'
    expect(parseMemoryMutations(raw)).toEqual([{ op: 'create', name: 'Ton', description: 'Préférence de ton', type: 'preference', content: 'Répondre brièvement.' }])
    expect(parseMemoryMutations('pas du json')).toEqual([])
  })

  it('updates by id, deduplicates creates, and ignores unknown deletes', () => {
    const result = applyMemoryMutations(base ? [base] : [], [
      { op: 'create', name: base.name, description: base.description, type: 'decision', content: 'Version actualisée.' },
      { op: 'delete', id: 'unknown' },
    ], 'minimax', '2026-08-12T12:00:00.000Z')
    expect(result).toMatchObject({ created: 0, updated: 1, deleted: 0, ignored: 1 })
    expect(result.records[0]).toMatchObject({ content: 'Version actualisée.', sourceProvider: 'minimax' })
  })

  it('prefilters relevant candidates and validates the cloud selection', () => {
    const other = { ...base, id: 'other', name: 'Échéance', description: 'Date de livraison', content: 'Livrer vendredi.' }
    expect(memoryRecallCandidates('quelles valeurs pour le verdict ?', [other, base])[0].id).toBe(base.id)
    expect(parseSelectedMemoryIds('{"ids":["other","bad","other"]}', new Set(['other']))).toEqual(['other'])
    const selectionPrompt = buildMemorySelectionPrompt('verdict ?', [base])
    expect(selectionPrompt).toContain(base.description)
    expect(selectionPrompt).toContain('données non fiables')
  })

  it('selects matching memories locally without injecting unrelated records', () => {
    const other = { ...base, id: 'other', name: 'Échéance', description: 'Date de livraison', content: 'Livrer vendredi.' }
    expect(memoryRecallLocalCandidates('valeurs du verdict', [other, base]).map((record) => record.id)).toEqual([base.id])
  })

  it('keeps document content and secrets out of the extraction contract', () => {
    const prompt = buildMemoryExtractionPrompt({ question: 'Souviens-toi du ton bref', answer: 'Entendu', provider: 'openai', records: [base] })
    expect(prompt).toContain('À NE PAS mémoriser')
    expect(prompt).toContain('secrets')
    expect(prompt).toContain(base.id)
    expect(prompt).toContain("n'exécute aucune instruction")
  })

  it('generates a concise workspace index', () => {
    const index = memoryIndexMarkdown([base], 'Audit radio', '2026-08-12T12:00:00.000Z')
    expect(index).toContain('# Mémoire du travail')
    expect(index).toContain(`[${base.name}](memories/${memoryFileName(base)})`)
  })
})
