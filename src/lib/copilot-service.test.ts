import { describe, it, expect } from 'vitest'
import { buildChatMessages, buildDocContext, truncateDoc, MAX_DOC_CHARS } from './copilot-service'

describe('truncateDoc', () => {
  it('laisse un texte court intact', () => {
    expect(truncateDoc('court', 100)).toEqual({ text: 'court', truncated: false })
  })
  it('tronque au-delà de la limite', () => {
    const r = truncateDoc('abcdef', 3)
    expect(r).toEqual({ text: 'abc', truncated: true })
  })
})

describe('buildDocContext', () => {
  it('inclut le texte md entre délimiteurs', () => {
    const ctx = buildDocContext('notes.md', '# Titre\nCorps', 'md')
    expect(ctx).toContain('notes.md')
    expect(ctx).toContain('# Titre')
    expect(ctx).toContain('"""')
  })
  it('signale un PDF comme non extractible (pas de faux contexte)', () => {
    const ctx = buildDocContext('scan.pdf', '', 'pdf')
    expect(ctx).toMatch(/PDF/)
    expect(ctx).toMatch(/non extractible/i)
  })
  it('signale un document vide', () => {
    expect(buildDocContext('vide.txt', '   ', 'txt')).toMatch(/vide/i)
  })
  it('ajoute un marqueur de troncature sur un long doc', () => {
    const long = 'x'.repeat(MAX_DOC_CHARS + 500)
    const ctx = buildDocContext('gros.md', long, 'md')
    expect(ctx).toContain('[… document tronqué …]')
  })
  it('gère un nom absent', () => {
    expect(buildDocContext(null, 'a', 'md')).toContain('sans titre')
  })
})

describe('buildChatMessages', () => {
  const base = { docName: 'notes.md', docText: 'Le ciel est bleu.', kind: 'md' as const }

  it('place un system (cadre + contexte doc), puis la question', () => {
    const msgs = buildChatMessages({ ...base, history: [], question: 'Quelle couleur ?' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Doku-San')
    expect(msgs[0].content).toContain('Le ciel est bleu.')
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'Quelle couleur ?' })
  })

  it('intercale l\'historique entre le system et la question, dans l\'ordre', () => {
    const history = [
      { role: 'user' as const, content: 'Salut' },
      { role: 'assistant' as const, content: 'Bonjour' },
    ]
    const msgs = buildChatMessages({ ...base, history, question: 'Suite ?' })
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(msgs[1].content).toBe('Salut')
    expect(msgs[2].content).toBe('Bonjour')
  })

  it('demande de ne pas inventer hors du document (ancrage)', () => {
    const msgs = buildChatMessages({ ...base, history: [], question: 'x' })
    expect(msgs[0].content).toMatch(/plut[oô]t que d'inventer/i)
  })
})
