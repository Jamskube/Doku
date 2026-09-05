import { describe, expect, it } from 'vitest'
import {
  conversationHistoryWindow,
  parsePersistedGeneratedDocument,
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

  it('round-trips a diagram artifact without affecting older messages', () => {
    const value = conversation({
      messages: [
        { role: 'user', content: 'Montre le flux', terminal: 'complete' },
        {
          role: 'assistant',
          content: 'Diagramme généré.',
          terminal: 'complete',
          diagram: {
            title: 'Flux',
            prompt: 'Montre le flux',
            source: 'node a "Entrée" at (0, 0)',
          },
        },
      ],
    })
    expect(parseConversation(serializeConversation(value))?.messages[1].diagram).toEqual(value.messages[1].diagram)
    expect(parseConversation(serializeConversation(conversation()))?.messages[1].diagram).toBeUndefined()
  })

  it('round-trips a generated document while bounding its hidden source', () => {
    const generatedDocument = {
      version: 1 as const,
      kind: 'html' as const,
      title: 'Synthèse',
      prompt: 'Crée une synthèse',
      html: '<html><body><h1>Synthèse</h1></body></html>',
      review: {
        version: 1 as const,
        status: 'passed' as const,
        attempts: 2,
        visual: true,
        summary: 'Mise en page vérifiée.',
        warnings: [],
      },
    }
    const value = conversation({
      messages: [
        { role: 'user', content: 'Crée une synthèse', terminal: 'complete' },
        { role: 'assistant', content: 'Page HTML générée.', terminal: 'complete', generatedDocument },
      ],
    })
    expect(parseConversation(serializeConversation(value))?.messages[1].generatedDocument).toEqual(generatedDocument)
    expect(parseConversation(serializeConversation(conversation()))?.messages[1].generatedDocument).toBeUndefined()
  })

  it('keeps a bounded verification receipt when restoring an artifact, without touching the DOM', () => {
    const artifact = parsePersistedGeneratedDocument({
      kind: 'pdf',
      title: 'Rapport',
      prompt: 'Crée un rapport',
      html: '<main><h1>Rapport</h1></main>',
      review: {
        status: 'passed',
        attempts: 99,
        visual: true,
        summary: ' Mise en page vérifiée. ',
        warnings: ['A'.repeat(300)],
      },
    })
    expect(artifact?.review).toEqual({
      version: 1,
      status: 'passed',
      attempts: 3,
      visual: true,
      summary: 'Mise en page vérifiée.',
      warnings: ['A'.repeat(240)],
    })
    expect(parsePersistedGeneratedDocument({ kind: 'html', html: '   ' })).toBeNull()
  })

  it('round-trips the cloud diagram studio candidates', () => {
    const diagram = {
      title: 'Architecture',
      prompt: 'Montre le système',
      source: 'type block { title: "Architecture" }',
      studio: {
        version: 1 as const,
        brief: {
          objective: 'Expliquer le système',
          keyQuestion: 'Qui dépend de quoi ?',
          desiredInsight: 'Montrer les responsabilités',
          facts: ['Registry conserve les droits'],
          entities: ['Registry', 'Issuer'],
          relations: ['Registry autorise Issuer'],
          measures: [],
          events: [],
        },
        candidates: [{
          id: 'block-1',
          genre: 'block',
          kind: 'architecture' as const,
          label: 'Architecture des composants',
          thesis: 'Responsabilités',
          keeps: ['composants'],
          omits: ['chronologie'],
          layout: 'deux niveaux',
          source: 'type block { title: "Architecture" }',
          width: 640,
          height: 360,
          aspectRatio: 640 / 360,
        }],
        selectedCandidateId: 'block-1',
        rationale: 'Cette vue montre les responsabilités.',
      },
    }
    const value = conversation({
      messages: [
        { role: 'user', content: 'Montre le système', terminal: 'complete' },
        { role: 'assistant', content: 'Diagramme généré.', terminal: 'complete', diagram },
      ],
    })
    expect(parseConversation(serializeConversation(value))?.messages[1].diagram).toEqual(diagram)
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
