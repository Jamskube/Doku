import { describe, expect, it } from 'vitest'
import {
  appendWebSearchContext,
  appendCurrentDateContext,
  buildWebSearchQuery,
  webSearchCitations,
} from './web-search'

const results = [{ title: 'Source fiable', url: 'https://example.com/a', snippet: 'Un extrait.' }]

describe('web search context', () => {
  it('injects untrusted snippets into the latest user turn with citation instructions', () => {
    const messages = appendWebSearchContext(
      [{ role: 'user', content: 'Question' }],
      results,
      'OpenAI facture TVA',
      new Date('2026-08-20T12:00:00Z'),
    )
    expect(messages[0].content).toContain('<web_sources>')
    expect(messages[0].content).toContain('[Web 1] Source fiable')
    expect(messages[0].content).toContain('[web:n]')
    expect(messages[0].content).toContain('OpenAI facture TVA')
    expect(messages[0].content).toContain('20 août 2026')
  })

  it('creates safe deterministic source metadata', () => {
    expect(webSearchCitations(results)).toEqual([expect.objectContaining({
      n: 1,
      title: 'Source fiable',
      url: 'https://example.com/a',
      snippet: 'Un extrait.',
    })])
  })

  it('builds a useful query locally from a vague question and its document', () => {
    const query = buildWebSearchQuery(
      'Est-ce normal ?',
      [{ role: 'user', content: 'Facture OpenAI Ireland Limited, ChatGPT Pro, reverse charge Belgique' }],
      new Date('2026-08-20T12:00:00Z'),
    )
    expect(query).toContain('OpenAI Ireland Limited')
    expect(query).toContain('ChatGPT Pro')
    expect(query).toContain('reverse charge')
  })

  it('skips needless date searches', () => {
    expect(buildWebSearchQuery('Quel jour sommes-nous ?', [])).toBeNull()
    expect(buildWebSearchQuery('Et quel jour sommes-nous ?', [])).toBeNull()
    expect(appendCurrentDateContext(
      [{ role: 'user', content: 'Quel jour sommes-nous ?' }],
      new Date('2026-08-20T12:00:00Z'),
    )[0].content).toContain('20 août 2026')
  })
})
