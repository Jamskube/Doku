import { describe, expect, it } from 'vitest'
import {
  conversationHistoryWindow,
  groupConversations,
  historyBudget,
  MAX_PERSISTED_INLINE_CHARS,
  parseConversation,
  searchConversations,
  serializeConversation,
  summarizeConversation,
  type ConversationV1,
} from './copilot-conversation'

const id = '123e4567-e89b-42d3-a456-426614174000'

function conversation(overrides: Partial<ConversationV1> = {}): ConversationV1 {
  return {
    version: 1,
    id,
    revision: 1,
    title: 'Vérifier la licence',
    titlePinned: false,
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    archived: false,
    messages: [
      { role: 'user', content: 'Vérifie la licence', terminal: 'complete' },
      { role: 'assistant', content: 'Voici les éléments.', terminal: 'complete' },
    ],
    contextItems: [],
    scope: 'doc',
    contextFolder: null,
    memoryFolder: null,
    webSearchEnabled: false,
    lastProvider: 'openai',
    workspace: {
      split: true,
      activePaneId: 'secondary',
      primaryPath: 'C:\\docs\\licence.pdf',
      secondaryPath: 'C:\\docs\\notes.md',
      primaryUnsaved: false,
      secondaryUnsaved: false,
      ratio: 62,
    },
    ...overrides,
  }
}

describe('copilot conversation', () => {
  it('round-trips the canonical record and keeps archived outside the index', () => {
    const value = conversation({ archived: true, revision: 7 })
    const parsed = parseConversation(serializeConversation(value))
    expect(parsed?.archived).toBe(true)
    expect(parsed?.revision).toBe(7)
    expect(summarizeConversation(parsed!)).toMatchObject({ archived: true, documentNames: ['licence.pdf', 'notes.md'] })
  })

  it('rejects invalid ids and clamps unsafe workspace values', () => {
    expect(parseConversation(JSON.stringify({ ...conversation(), id: '../memory' }))).toBeNull()
    const parsed = parseConversation(JSON.stringify({ ...conversation(), workspace: { ...conversation().workspace, ratio: 999 } }))
    expect(parsed?.workspace.ratio).toBe(75)
  })

  it('never persists file text and bounds inline context', () => {
    const raw = {
      ...conversation(),
      contextItems: [
        { kind: 'file', id: 'file:1', path: 'C:\\secret.md', label: 'secret.md', signature: '1:2', text: 'NE DOIT PAS RESTER' },
        { kind: 'clipboard', id: 'clipboard:1', label: 'Presse-papiers', text: 'x'.repeat(MAX_PERSISTED_INLINE_CHARS + 10) },
      ],
    }
    const parsed = parseConversation(JSON.stringify(raw))!
    expect(parsed.contextItems[0]).not.toHaveProperty('text')
    expect(parsed.contextItems[1]).toMatchObject({ truncated: true })
    expect((parsed.contextItems[1] as { text: string }).text).toHaveLength(MAX_PERSISTED_INLINE_CHARS)
  })

  it('keeps only complete recent pairs in the provider budget', () => {
    const messages = [
      { role: 'user' as const, content: 'old user', terminal: 'complete' as const },
      { role: 'assistant' as const, content: 'old assistant', terminal: 'complete' as const },
      { role: 'user' as const, content: 'new user', terminal: 'complete' as const },
      { role: 'assistant' as const, content: 'new assistant', terminal: 'complete' as const },
      { role: 'user' as const, content: 'orphan', terminal: 'complete' as const },
    ]
    const result = conversationHistoryWindow(messages, 22)
    expect(result.messages.map((message) => message.content)).toEqual(['new user', 'new assistant'])
    expect(result.omitted).toBe(2)
    expect(historyBudget('ollama', 47_000)).toBe(0)
    expect(historyBudget('openai', 100_000)).toBeGreaterThan(0)
  })

  it('does not replay an interrupted assistant response as history', () => {
    const result = conversationHistoryWindow([
      { role: 'user', content: 'Question', terminal: 'complete' },
      { role: 'assistant', content: 'Réponse partielle', terminal: 'interrupted' },
    ], 10_000)
    expect(result.messages).toEqual([])
  })

  it('groups by time and searches accents across messages and document names', () => {
    const now = new Date('2026-08-20T12:00:00.000Z')
    const older = conversation({ id: '223e4567-e89b-42d3-a456-426614174001', title: 'Ancienne', updatedAt: '2026-07-01T09:00:00.000Z' })
    expect(groupConversations([summarizeConversation(older), summarizeConversation(conversation())], now).map((group) => group.label)).toEqual(['Aujourd’hui', 'Plus anciennes'])
    expect(searchConversations([conversation()], 'verifie')).toHaveLength(1)
    expect(searchConversations([conversation()], 'notes.md')).toHaveLength(1)
  })
})
