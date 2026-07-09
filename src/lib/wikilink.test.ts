import { describe, it, expect } from 'vitest'
import { normalizeTarget, matchWikilink } from './wikilink'

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
