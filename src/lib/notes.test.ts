import { describe, expect, it } from 'vitest'
import { noteContent, noteFileBase, noteFileName } from './notes'
import { stripCitationMarkers } from './citations'

describe('noteFileBase', () => {
  it('nettoie les caractères interdits Windows et les sauts de ligne', () => {
    expect(noteFileBase('quel est le seuil : 42 Ko ?\net après')).toBe('quel est le seuil 42 Ko et après')
  })

  it('tronque à une frontière de mot, jamais de point/espace final', () => {
    const base = noteFileBase('une question vraiment très longue qui dépasse largement la limite de nommage')
    expect(base.length).toBeLessThanOrEqual(40)
    expect(base).toBe('une question vraiment très longue qui')
    expect(base).not.toMatch(/[. ]$/)
  })

  it('question vide ou faite uniquement de caractères interdits → repli', () => {
    expect(noteFileBase(null)).toBe('Note Doku-San')
    expect(noteFileBase('  ')).toBe('Note Doku-San')
    expect(noteFileBase('///:::???')).toBe('Note Doku-San')
  })
})

describe('noteFileName', () => {
  it('tentative 1 sans suffixe, extension .md ajoutée', () => {
    expect(noteFileName('le plan', 1)).toBe('Doku-San — le plan.md')
  })

  it('tentatives suivantes suffixées « (n) »', () => {
    expect(noteFileName('le plan', 2)).toBe('Doku-San — le plan (2).md')
    expect(noteFileName('le plan', 7)).toBe('Doku-San — le plan (7).md')
  })

  it('une question finissant par une extension supportée reste un .md (revue 21.x)', () => {
    expect(noteFileName('résume plan-licence 3.pdf', 1)).toBe('Doku-San — résume plan-licence 3.md')
    expect(noteFileName('que dit recette.html', 2)).toMatch(/\.md$/)
  })
})

describe('stripCitationMarkers', () => {
  it('retire les marqueurs et les espaces orphelines, préserve le code', () => {
    const s = 'Le seuil est 42 Ko [1]. Voir `tab[2]` et :\n```\na[3]\n```\nFin [1, 2].'
    expect(stripCitationMarkers(s)).toBe('Le seuil est 42 Ko. Voir `tab[2]` et :\n```\na[3]\n```\nFin.')
  })
})

describe('noteContent', () => {
  const date = new Date(2026, 7, 10) // 10 août 2026

  it('provenance avec source + marqueurs retirés', () => {
    const out = noteContent('Le seuil est 42 Ko [1].', { sourceLabel: 'plan-licence 3.pdf', date })
    expect(out).toContain("> Note générée par Doku-San le 10 août 2026 — d'après « plan-licence 3.pdf ».")
    expect(out).toContain('Le seuil est 42 Ko.')
    expect(out).not.toContain('[1]')
  })

  it("sans source connue : pas de « d'après » (ne jamais inventer la provenance)", () => {
    const out = noteContent('Réponse.', { sourceLabel: null, date })
    expect(out).toContain('> Note générée par Doku-San le 10 août 2026.')
    expect(out).not.toContain("d'après")
  })

  it('mode dossier : liste des notes consultées, dédupliquée', () => {
    const out = noteContent('Réponse.', {
      sourceLabel: 'les notes du dossier',
      date,
      sourceNames: ['recettes', 'courses', 'recettes'],
    })
    expect(out).toContain('Passages consultés : « recettes », « courses ».')
  })
})
