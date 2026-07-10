import { describe, it, expect } from 'vitest'
import { matchWikilink, normalizeTarget, wikilinkCandidates, wikilinkFileName } from './wikilink'

describe('normalizeTarget', () => {
  it('retire l’extension et met en minuscules', () => {
    expect(normalizeTarget('Architecture.md')).toBe('architecture')
    expect(normalizeTarget('NOTE')).toBe('note')
  })
  it('enlève l’ancre #heading', () => {
    expect(normalizeTarget('note#section')).toBe('note')
  })
  it('ne garde que le dernier segment', () => {
    expect(normalizeTarget('dossier/sous/note')).toBe('note')
    expect(normalizeTarget('dossier\\note.md')).toBe('note')
  })
})

describe('matchWikilink', () => {
  const files = [
    { path: 'G:\\N\\architecture.md', name: 'architecture.md' },
    { path: 'G:\\N\\sous\\notes.md', name: 'notes.md' },
    { path: 'G:\\N\\notes.txt', name: 'notes.txt' },
    { path: 'G:\\N\\image.png', name: 'image.png' },
  ]

  it('résout un nom simple (dans un sous-dossier)', () => {
    expect(matchWikilink('architecture', files)).toBe('G:\\N\\architecture.md')
  })

  it('préfère le .md quand plusieurs extensions matchent', () => {
    expect(matchWikilink('notes', files)).toBe('G:\\N\\sous\\notes.md')
  })

  it('insensible à la casse et à l’extension écrite', () => {
    expect(matchWikilink('Architecture.md', files)).toBe('G:\\N\\architecture.md')
  })

  it('renvoie null si absent', () => {
    expect(matchWikilink('inexistant', files)).toBe(null)
  })
})

describe('wikilinkCandidates', () => {
  it('ignore les autres extensions quand un .md existe', () => {
    const files = [
      { path: 'G:\\N\\notes.md', name: 'notes.md' },
      { path: 'G:\\N\\notes.txt', name: 'notes.txt' },
    ]
    expect(wikilinkCandidates('notes', files)).toEqual([{ path: 'G:\\N\\notes.md', name: 'notes.md' }])
  })

  it('renvoie plusieurs candidats ambigus (2 .md homonymes)', () => {
    const files = [
      { path: 'G:\\N\\a\\notes.md', name: 'notes.md' },
      { path: 'G:\\N\\b\\notes.md', name: 'notes.md' },
    ]
    expect(wikilinkCandidates('notes', files)).toHaveLength(2)
  })

  it('tombe sur les autres extensions si aucun .md', () => {
    const files = [
      { path: 'G:\\N\\a\\notes.txt', name: 'notes.txt' },
      { path: 'G:\\N\\b\\notes.txt', name: 'notes.txt' },
    ]
    expect(wikilinkCandidates('notes', files)).toHaveLength(2)
  })

  it('renvoie [] si aucune correspondance', () => {
    expect(wikilinkCandidates('inexistant', [{ path: 'G:\\N\\a.md', name: 'a.md' }])).toEqual([])
  })
})

describe('wikilinkFileName', () => {
  it('ajoute .md à un nom sans extension', () => {
    expect(wikilinkFileName('Ma Note')).toBe('Ma Note.md')
  })

  it('préserve une extension supportée déjà écrite', () => {
    expect(wikilinkFileName('journal.txt')).toBe('journal.txt')
  })

  it('retire l’ancre et ne garde que le dernier segment', () => {
    expect(wikilinkFileName('note#section')).toBe('note.md')
    expect(wikilinkFileName('dossier/sous/note')).toBe('note.md')
  })

  it('neutralise une traversée de chemin', () => {
    expect(wikilinkFileName('../../evil')).toBe('evil.md')
    expect(wikilinkFileName('..\\secret.md')).toBe('secret.md')
  })

  it('renvoie une chaîne vide pour une cible vide', () => {
    expect(wikilinkFileName('')).toBe('')
    expect(wikilinkFileName('#anchor')).toBe('')
  })
})
