import {
  type ConversationSearchResult,
  type ConversationSummary,
  type ConversationV1,
} from './copilot-conversation'
import { ConversationRepository, type ConversationStorage } from './copilot-conversation-repository'
import {
  keepConversationFileAside,
  listConversationFiles,
  purgeConversationFiles,
  readConversationFile,
  removeConversationFile,
  writeConversationFile,
  writeConversationIndex,
} from './tauri'

const nativeStorage: ConversationStorage = {
  list: listConversationFiles,
  read: readConversationFile,
  write: writeConversationFile,
  writeIndex: writeConversationIndex,
  quarantine: keepConversationFileAside,
  remove: removeConversationFile,
  purge: purgeConversationFiles,
}

export const conversationRepository = new ConversationRepository(nativeStorage)

export const conversations = $state({
  summaries: [] as ConversationSummary[],
  activeId: null as string | null,
  ready: false,
  loading: false,
  restoring: false,
  error: '',
  searchQuery: '',
  searchResults: [] as ConversationSearchResult[],
  searchLimited: false,
})

let loadPromise: Promise<void> | null = null
let searchRevision = 0

export function initConversations(): Promise<void> {
  if (loadPromise) return loadPromise
  conversations.loading = true
  loadPromise = conversationRepository.reconcile()
    .then(({ summaries, quarantined }) => {
      conversations.summaries = summaries
      conversations.error = quarantined > 0
        ? `${quarantined} discussion${quarantined > 1 ? 's' : ''} illisible${quarantined > 1 ? 's ont' : ' a'} été mise${quarantined > 1 ? 's' : ''} de côté.`
        : ''
      conversations.ready = true
    })
    .catch((error) => {
      conversations.error = error instanceof Error ? error.message : 'Les discussions n’ont pas pu être chargées.'
    })
    .finally(() => { conversations.loading = false })
  return loadPromise
}

export async function persistConversation(record: ConversationV1): Promise<ConversationV1> {
  conversations.summaries = await conversationRepository.save(record)
  const canonical = await conversationRepository.read(record.id)
  if (!canonical) throw new Error('La discussion enregistrée est introuvable.')
  conversations.activeId = record.id
  return canonical
}

export async function loadConversation(id: string): Promise<ConversationV1> {
  const record = await conversationRepository.read(id)
  if (!record) throw new Error('Cette discussion est introuvable ou illisible.')
  return record
}

export function setActiveConversation(id: string | null): void {
  conversations.activeId = id
}

export async function renameConversation(id: string, title: string): Promise<ConversationV1 | null> {
  const clean = title.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120)
  if (!clean) return null
  conversations.summaries = await conversationRepository.update(id, (record) => ({ ...record, title: clean, titlePinned: true }))
  return loadConversation(id)
}

export async function setConversationArchived(id: string, archived: boolean): Promise<void> {
  conversations.summaries = await conversationRepository.update(id, (record) => ({ ...record, archived }))
  if (archived && conversations.activeId === id) conversations.activeId = null
}

export async function deleteConversation(id: string): Promise<void> {
  conversations.summaries = await conversationRepository.remove(id)
  if (conversations.activeId === id) conversations.activeId = null
}

export async function purgeConversations(): Promise<void> {
  await conversationRepository.purge()
  conversations.summaries = []
  conversations.searchResults = []
  conversations.activeId = null
}

export async function flushConversationWrites(): Promise<void> {
  await conversationRepository.flush()
}

export async function runConversationSearch(query: string): Promise<void> {
  const revision = ++searchRevision
  conversations.searchQuery = query
  const q = query.trim()
  if (!q) {
    conversations.searchResults = []
    conversations.searchLimited = false
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  if (revision !== searchRevision) return
  const result = await conversationRepository.search(q)
  if (revision !== searchRevision) return
  conversations.searchResults = result.results
  conversations.searchLimited = result.limited
}
