import { describe, expect, it } from 'vitest'
import {
  appendWebSearchContext,
  appendCurrentDateContext,
  buildWebSearchPlannerPrompt,
  parseWebSearchQuery,
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
    expect(webSearchCitations(results)).toEqual([expect.objectContaining({ n: 1, title: 'Source fiable', url: 'https://example.com/a' })])
  })

  it('plans from the document instead of searching the vague question verbatim', () => {
    const prompt = buildWebSearchPlannerPrompt(
      'Est-ce normal ?',
      [{ role: 'user', content: 'Facture OpenAI Ireland Limited, ChatGPT Pro, reverse charge Belgique' }],
      new Date('2026-08-20T12:00:00Z'),
    )
    expect(prompt).toContain('OpenAI Ireland Limited')
    expect(prompt).toContain('Date actuelle certaine')
    expect(prompt).toContain('NO_SEARCH')
  })

  it('accepts one clean query and skips needless date searches', () => {
    expect(parseWebSearchQuery('Query: "OpenAI invoice VAT Belgium"\nExplication inutile')).toBe('OpenAI invoice VAT Belgium')
    expect(parseWebSearchQuery('NO_SEARCH')).toBeNull()
    expect(appendCurrentDateContext(
      [{ role: 'user', content: 'Quel jour sommes-nous ?' }],
      new Date('2026-08-20T12:00:00Z'),
    )[0].content).toContain('20 août 2026')
  })
})
