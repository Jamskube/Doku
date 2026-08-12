import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  index: '',
  undo: null as string | null,
}))
const ragKey = vi.hoisted(() => vi.fn(async (path: string) => `key:${path.replaceAll('\\', '/').toLowerCase()}`))

vi.hoisted(() => {
  Object.defineProperty(globalThis, '$state', {
    configurable: true,
    value: <T>(value: T) => value,
  })
})

vi.mock('./rag', () => ({
  ragDirKey: ragKey,
}))

vi.mock('./tauri', () => ({
  isTauri: true,
  readMemoryMarkdownFiles: async () => [...disk.files].map(([name, content]) => ({ name, content })),
  writeMemoryMarkdownFile: async (_key: string, name: string, content: string) => {
    if (name === 'MEMORY.md') disk.index = content
    else disk.files.set(name, content)
  },
  removeMemoryMarkdownFile: async (_key: string, name: string) => { disk.files.delete(name) },
  readMemoryUndo: async () => disk.undo,
  writeMemoryUndo: async (_key: string, content: string) => { disk.undo = content },
}))

import {
  cloudMemory,
  memoryWorkspace,
  queueMemoryExtraction,
  recallCloudMemories,
  undoCloudMemory,
  updateCloudMemoryRecord,
} from './copilot-memory.svelte'
import { parseMemory } from './copilot-memory'

describe('cloud memory orchestration', () => {
  beforeEach(() => {
    disk.files.clear()
    disk.index = ''
    disk.undo = null
    cloudMemory.workspace = null
    cloudMemory.records = []
    cloudMemory.loading = false
    cloudMemory.extracting = false
    cloudMemory.pendingExtractions = 0
    cloudMemory.error = ''
    cloudMemory.lastBatch = null
    cloudMemory.undoAvailable = false
    ragKey.mockClear()
  })

  it('keeps document memory separate and never aliases it to its parent folder', async () => {
    const document = await memoryWorkspace('G:\\Desktop\\note.md', 'note.md', 'document')
    const folder = await memoryWorkspace('G:\\Desktop', 'Desktop', 'folder')

    expect(document).toMatchObject({ kind: 'document', label: 'note.md' })
    expect(folder).toMatchObject({ kind: 'folder', label: 'Desktop' })
    expect(document.key).not.toBe(folder.key)
    expect(ragKey).toHaveBeenNthCalledWith(1, 'document:G:\\Desktop\\note.md')
    expect(ragKey).toHaveBeenNthCalledWith(2, 'G:\\Desktop')
  })

  it('extracts, persists, recalls, edits, and restores one automatic memory', async () => {
    const workspace = await memoryWorkspace('G:\\Audits', 'Audits')
    const generate = vi.fn(async (prompt: string) => {
      if (prompt.includes('conservateur de la mémoire durable')) {
        return JSON.stringify({ mutations: [{
          op: 'create',
          name: 'Vocabulaire des verdicts',
          description: 'Valeurs autorisées dans la colonne verdict',
          type: 'decision',
          content: 'Utiliser pub, jingle ou promo.',
        }] })
      }
      const record = parseMemory([...disk.files.values()][0])
      return JSON.stringify({ ids: record ? [record.id] : [] })
    })

    queueMemoryExtraction({
      question: 'Pour la suite, les verdicts valides sont pub, jingle ou promo.',
      answer: 'Je conserverai ce vocabulaire pour les prochains audits.',
      documentName: 'verdicts.md',
      workspace,
      provider: 'openai',
      generate,
    })

    const recalled = await recallCloudMemories('Quels verdicts puis-je utiliser ?', workspace, generate)
    expect(recalled).toHaveLength(1)
    expect(recalled[0]).toMatchObject({ name: 'Vocabulaire des verdicts', type: 'decision' })
    expect(disk.files.size).toBe(1)
    expect(disk.index).toContain('[Vocabulaire des verdicts](memories/')
    expect(disk.undo).toBeTruthy()
    expect(generate.mock.calls[1][0]).toContain('Valeurs autorisées')
    expect(generate.mock.calls[1][0]).not.toContain('Utiliser pub, jingle ou promo.')

    await updateCloudMemoryRecord({
      workspace,
      id: recalled[0].id,
      name: recalled[0].name,
      description: 'Valeurs validées pour tous les audits',
      type: 'decision',
      content: 'Utiliser pub, jingle, promo ou habillage.',
      provider: 'minimax',
    })
    expect(cloudMemory.records[0]).toMatchObject({
      description: 'Valeurs validées pour tous les audits',
      sourceProvider: 'minimax',
    })

    expect(await undoCloudMemory(workspace)).toBe(true)
    expect(cloudMemory.records[0]).toMatchObject({
      description: 'Valeurs autorisées dans la colonne verdict',
      sourceProvider: 'openai',
    })
  })
})
