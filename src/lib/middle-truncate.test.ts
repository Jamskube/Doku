import { describe, expect, it } from 'vitest'
import { middleTruncate } from './middle-truncate'

describe('middleTruncate', () => {
  it('laisse un nom court intact', () => {
    expect(middleTruncate('notes.md', 36)).toBe('notes.md')
    expect(middleTruncate('a'.repeat(36), 36)).toBe('a'.repeat(36))
  })

  it('garde le début et la fin avec l’extension', () => {
    const out = middleTruncate('Q3 Board Deck — FINAL draft for review (revised).md', 36)
    expect(out.startsWith('Q3 Board Deck')).toBe(true)
    expect(out.endsWith('(revised).md')).toBe(true)
    expect(out).toContain('…')
    expect(Array.from(out).length).toBeLessThanOrEqual(36)
  })

  it('distingue deux versions qui ne diffèrent qu’à la fin', () => {
    const a = middleTruncate('Compte rendu de la réunion du conseil — version 2.md', 30)
    const b = middleTruncate('Compte rendu de la réunion du conseil — version 3.md', 30)
    expect(a).not.toBe(b)
  })

  it('ne coupe pas un caractère hors BMP en deux', () => {
    const out = middleTruncate('😀'.repeat(50), 10)
    expect(out).toBe('😀'.repeat(5) + '…' + '😀'.repeat(4))
  })
})
