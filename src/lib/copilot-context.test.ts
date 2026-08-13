import { describe, expect, it } from 'vitest'
import {
  buildContextBundle,
  contextItemId,
  mergeAutomaticContextItems,
  normalizeContextPath,
  pathBelongsToFolder,
  truncateContextItem,
  upsertContextItems,
  type CopilotContextItem,
} from './copilot-context'

function item(id: string, text: string, path?: string): CopilotContextItem {
  return { id, kind: 'file', label: path ?? id, text, path, charCount: text.length, truncatedAtLoad: false }
}

describe('copilot context', () => {
  it('normalise et déduplique les chemins Windows sans tenir compte de la casse', () => {
    expect(normalizeContextPath('C:\\Notes\\Plan.MD')).toBe('c:/notes/plan.md')
    const first = item(contextItemId({ kind: 'file', path: 'C:\\Notes\\Plan.MD', text: 'v1' }), 'v1')
    const second = item(contextItemId({ kind: 'file', path: 'c:/notes/plan.md', text: 'v2' }), 'v2')
    expect(upsertContextItems([first], [second]).items).toEqual([second])
  })

  it('garde une portée dossier seulement pour ses propres documents', () => {
    expect(pathBelongsToFolder('C:\\Users\\Nicos\\Desktop\\note.md', 'c:/users/nicos/desktop')).toBe(true)
    expect(pathBelongsToFolder('C:\\Users\\Nicos\\Desktop-old\\note.md', 'c:/users/nicos/desktop')).toBe(false)
    expect(pathBelongsToFolder('C:\\Users\\Nicos\\Documents\\note.md', 'c:/users/nicos/desktop')).toBe(false)
    expect(pathBelongsToFolder(null, 'c:/users/nicos/desktop')).toBe(false)
  })

  it('borne un item avant construction du payload', () => {
    const result = truncateContextItem('x'.repeat(240_001))
    expect(result.text).toHaveLength(240_000)
    expect(result.truncated).toBe(true)
  })

  it('partage le budget 50/50 puis redistribue la part inutilisée', () => {
    const bundle = buildContextBundle({
      primary: [{ id: 'doc', kind: 'document', label: 'doc.md', text: 'd'.repeat(80), path: 'C:\\secret\\doc.md' }],
      additions: [item('a', 'a'.repeat(80)), item('b', 'b'.repeat(10))],
      maxChars: 100,
    })
    expect(bundle.primary[0].sentChars).toBe(50)
    expect(bundle.additions.map((x) => x.sentChars)).toEqual([40, 10])
    expect(bundle.primary[0].sentChars + bundle.additions.reduce((n, x) => n + x.sentChars, 0)).toBe(100)
  })

  it('n’expose aucun chemin dans la provenance envoyable', () => {
    const bundle = buildContextBundle({
      primary: [{ id: 'doc', kind: 'document', label: 'doc.md', text: 'abc', path: 'C:\\secret\\doc.md' }],
      additions: [item('file:c:/secret/note.md', 'def', 'C:\\secret\\note.md')],
      maxChars: 20,
    })
    expect(JSON.stringify(bundle.sentSources)).not.toContain('C:')
    expect(bundle.sentSources.map((x) => x.label)).toEqual(['doc.md', 'note.md'])
  })

  it('refuse les ajouts au-delà de huit sans perdre les précédents', () => {
    const existing = Array.from({ length: 8 }, (_, index) => item(`file:${index}`, String(index)))
    const result = upsertContextItems(existing, [item('file:new', 'nouveau')])
    expect(result.items).toEqual(existing)
    expect(result.rejected).toBe(1)
  })

  it('préfère le document visible frais au même fichier ajouté manuellement', () => {
    const manual = item('file:c:/notes/plan.md', 'ancienne version', 'C:\\Notes\\Plan.md')
    const automatic = item('workspace:2', 'version visible', 'c:/notes/plan.md')
    const clipboard = { ...item('clipboard:1', 'copié'), kind: 'clipboard' as const }

    expect(mergeAutomaticContextItems([automatic], [manual, clipboard])).toEqual([automatic, clipboard])
  })

  it('distingue la troncature à l’ajout de celle du budget de requête', () => {
    const partial = { ...item('partial', 'abcdef'), truncatedAtLoad: true }
    const bundle = buildContextBundle({ primary: [], additions: [partial], maxChars: 3 })
    expect(bundle.additions[0]).toMatchObject({ truncatedAtLoad: true, truncatedForRequest: true, sentChars: 3 })
  })

  it('ne dépasse jamais un budget inférieur au nombre de sources', () => {
    const bundle = buildContextBundle({
      primary: [],
      additions: [item('a', 'aaa'), item('b', 'bbb'), item('c', 'ccc')],
      maxChars: 1,
    })
    expect(bundle.additions.reduce((sum, source) => sum + source.sentChars, 0)).toBe(1)
  })
})
