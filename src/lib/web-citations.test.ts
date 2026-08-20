import { describe, expect, it } from 'vitest'
import {
  addWebCitationMarkers,
  annotateWebCitations,
  citedWebCitationNumbers,
  normalizeWebCitations,
} from './web-citations'

describe('web citations', () => {
  it('conserve uniquement des sources HTTPS uniques', () => {
    expect(normalizeWebCitations([
      { url: 'https://example.com/a', title: 'Exemple', startIndex: 2, endIndex: 4 },
      { url: 'https://example.com/a', title: 'Doublon', startIndex: 8, endIndex: 9 },
      { url: 'http://unsafe.test', title: 'Non sécurisé' },
      { url: 'javascript:alert(1)', title: 'Dangereux' },
    ])).toEqual([{
      n: 1,
      url: 'https://example.com/a',
      title: 'Exemple',
      startIndex: 2,
      endIndex: 4,
    }])
  })

  it('place les marqueurs sans modifier le passage cité', () => {
    const citations = normalizeWebCitations([
      { url: 'https://example.com', title: 'Exemple', startIndex: 0, endIndex: 7 },
    ])
    expect(addWebCitationMarkers('Bonjour monde.', citations)).toBe('Bonjour[web:1] monde.')
  })

  it('injecte seulement les boutons de sources connues', () => {
    expect(annotateWebCitations('<p>Info[web:1][web:9]</p>', 1)).toBe(
      '<p>Info<button type="button" class="cop-web-cite" data-web-cite="1" aria-label="Ouvrir la source Web 1">1</button></p>',
    )
  })

  it('affiche uniquement les sources réellement citées par le modèle', () => {
    expect([...citedWebCitationNumbers('Fait [web:2], puis [web:2] et [web:9].', 3)]).toEqual([2])
  })
})
