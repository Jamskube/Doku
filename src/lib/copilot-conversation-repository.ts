import {
  MAX_CONVERSATION_FILES,
  MAX_CONVERSATION_SEARCH_CHARS,
  parseConversation,
  searchConversations,
  serializeConversation,
  summarizeConversation,
  type ConversationSearchResult,
  type ConversationSummary,
  type ConversationV1,
} from './copilot-conversation'

export interface ConversationStorage {
  list(): Promise<{ id: string; content: string }[]>
  read(id: string): Promise<string | null>
  write(id: string, content: string): Promise<void>
  writeIndex(content: string): Promise<void>
  quarantine(id: string, stamp: string): Promise<void>
  remove(id: string): Promise<void>
  purge(): Promise<void>
}

export class ConversationRepository {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: ConversationStorage) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  async flush(): Promise<void> { await this.queue }

  reconcile(): Promise<{ records: ConversationV1[]; summaries: ConversationSummary[]; quarantined: number }> {
    return this.enqueue(async () => this.reconcileNow())
  }

  private async reconcileNow(): Promise<{ records: ConversationV1[]; summaries: ConversationSummary[]; quarantined: number }> {
    const files = await this.storage.list()
    const records: ConversationV1[] = []
    let quarantined = 0
    for (const file of files) {
      const record = parseConversation(file.content)
      if (!record || record.id !== file.id) {
        quarantined++
        await this.storage.quarantine(file.id, new Date().toISOString().replace(/[:.]/g, '-'))
        continue
      }
      records.push(record)
    }
    records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const retained = records.slice(0, MAX_CONVERSATION_FILES)
    const summaries = retained.map(summarizeConversation)
    await this.storage.writeIndex(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), conversations: summaries }, null, 2))
    return { records: retained, summaries, quarantined }
  }

  async read(id: string): Promise<ConversationV1 | null> {
    await this.flush()
    const raw = await this.storage.read(id)
    return raw ? parseConversation(raw) : null
  }

  save(record: ConversationV1): Promise<ConversationSummary[]> {
    return this.enqueue(async () => {
      const currentRaw = await this.storage.read(record.id)
      const current = currentRaw ? parseConversation(currentRaw) : null
      if (current && current.revision >= record.revision) return (await this.reconcileNow()).summaries
      await this.storage.write(record.id, serializeConversation(record))
      return (await this.reconcileNow()).summaries
    })
  }

  update(id: string, change: (record: ConversationV1) => ConversationV1): Promise<ConversationSummary[]> {
    return this.enqueue(async () => {
      const raw = await this.storage.read(id)
      const record = raw ? parseConversation(raw) : null
      if (!record) throw new Error('Cette discussion est introuvable.')
      const next = change(record)
      await this.storage.write(id, serializeConversation({ ...next, id, revision: record.revision + 1, updatedAt: new Date().toISOString() }))
      return (await this.reconcileNow()).summaries
    })
  }

  remove(id: string): Promise<ConversationSummary[]> {
    return this.enqueue(async () => {
      await this.storage.remove(id)
      return (await this.reconcileNow()).summaries
    })
  }

  purge(): Promise<void> {
    return this.enqueue(async () => { await this.storage.purge() })
  }

  async search(query: string): Promise<{ results: ConversationSearchResult[]; limited: boolean }> {
    await this.flush()
    const files = (await this.storage.list()).slice(0, MAX_CONVERSATION_FILES)
    const records: ConversationV1[] = []
    let chars = 0
    let limited = files.length >= MAX_CONVERSATION_FILES
    for (const file of files) {
      if (chars + file.content.length > MAX_CONVERSATION_SEARCH_CHARS) {
        limited = true
        break
      }
      chars += file.content.length
      const record = parseConversation(file.content)
      if (record) records.push(record)
    }
    return { results: searchConversations(records, query), limited }
  }
}
