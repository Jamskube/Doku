import { describe, expect, it } from 'vitest'
import { createConversationId, serializeConversation, type ConversationV1 } from './copilot-conversation'
import { ConversationRepository, type ConversationStorage } from './copilot-conversation-repository'

class MemoryStorage implements ConversationStorage {
  files = new Map<string, string>()
  index = ''
  quarantined: string[] = []
  writes: string[] = []
  delayId: string | null = null

  async list() { return [...this.files].map(([id, content]) => ({ id, content })) }
  async read(id: string) { return this.files.get(id) ?? null }
  async write(id: string, content: string) {
    if (id === this.delayId) await new Promise((resolve) => setTimeout(resolve, 15))
    this.writes.push(id)
    this.files.set(id, content)
  }
  async writeIndex(content: string) { this.index = content }
  async quarantine(id: string) { this.quarantined.push(id); this.files.delete(id) }
  async remove(id: string) { this.files.delete(id) }
  async purge() { this.files.clear(); this.index = '' }
}

function record(id = createConversationId(), overrides: Partial<ConversationV1> = {}): ConversationV1 {
  return {
    version: 1,
    id,
    revision: 1,
    title: 'Discussion',
    titlePinned: false,
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    archived: false,
    messages: [{ role: 'user', content: 'Bonjour', terminal: 'complete' }],
    contextItems: [],
    scope: 'doc',
    contextFolder: null,
    memoryFolder: null,
    webSearchEnabled: false,
    lastProvider: 'ollama',
    workspace: {
      split: false,
      activePaneId: 'primary',
      primaryPath: null,
      secondaryPath: null,
      primaryUnsaved: false,
      secondaryUnsaved: false,
      ratio: 50,
    },
    ...overrides,
  }
}

describe('ConversationRepository', () => {
  it('rebuilds the index from canonical files and preserves archived', async () => {
    const storage = new MemoryStorage()
    const archived = record(createConversationId(), { archived: true })
    storage.files.set(archived.id, serializeConversation(archived))
    storage.index = '{broken'
    const result = await new ConversationRepository(storage).reconcile()
    expect(result.summaries).toMatchObject([{ id: archived.id, archived: true }])
    expect(JSON.parse(storage.index).conversations).toMatchObject([{ archived: true }])
  })

  it('quarantines an invalid canonical file without blocking valid records', async () => {
    const storage = new MemoryStorage()
    const valid = record()
    const brokenId = createConversationId()
    storage.files.set(valid.id, serializeConversation(valid))
    storage.files.set(brokenId, '{broken')
    const result = await new ConversationRepository(storage).reconcile()
    expect(result.records).toHaveLength(1)
    expect(storage.quarantined).toEqual([brokenId])
  })

  it('serializes writes across different ids before rebuilding the shared index', async () => {
    const storage = new MemoryStorage()
    const first = record()
    const second = record()
    storage.delayId = first.id
    const repository = new ConversationRepository(storage)
    await Promise.all([repository.save(first), repository.save(second)])
    expect(storage.writes).toEqual([first.id, second.id])
    expect(JSON.parse(storage.index).conversations.map((item: { id: string }) => item.id).sort()).toEqual([first.id, second.id].sort())
  })

  it('does not let an older revision replace a newer one', async () => {
    const storage = new MemoryStorage()
    const id = createConversationId()
    const repository = new ConversationRepository(storage)
    await repository.save(record(id, { revision: 3, title: 'Nouveau' }))
    await repository.save(record(id, { revision: 2, title: 'Ancien' }))
    expect(JSON.parse(storage.files.get(id)!).title).toBe('Nouveau')
  })

  it('does not let a stale snapshot with the same revision overwrite a mutation', async () => {
    const storage = new MemoryStorage()
    const id = createConversationId()
    const repository = new ConversationRepository(storage)
    await repository.save(record(id, { revision: 1, title: 'Avant' }))
    await repository.update(id, (value) => ({ ...value, title: 'Titre renommé', titlePinned: true }))
    await repository.save(record(id, { revision: 2, title: 'Avant' }))
    expect(JSON.parse(storage.files.get(id)!).title).toBe('Titre renommé')
  })

  it('removes canonical data before reconciling and purges everything', async () => {
    const storage = new MemoryStorage()
    const value = record()
    const repository = new ConversationRepository(storage)
    await repository.save(value)
    expect(await repository.remove(value.id)).toEqual([])
    await repository.save(value)
    await repository.purge()
    expect(storage.files.size).toBe(0)
  })
})
