import { describe, expect, it } from 'vitest'
import { areaHits, joinAreaText, verticalOverlap, type AreaSpan } from './pdf-area-text'

const span = (text: string, left: number, top: number, width = 0.2, height = 0.04): AreaSpan =>
  ({ text, left, top, width, height })

describe('verticalOverlap', () => {
  it('rend la part réellement recouverte', () => {
    expect(verticalOverlap({ left: 0, top: 0.1, width: 1, height: 0.1 }, { left: 0, top: 0, width: 1, height: 1 })).toBe(1)
    // Zone qui s'arrête au milieu du span.
    expect(verticalOverlap({ left: 0, top: 0.1, width: 1, height: 0.1 }, { left: 0, top: 0, width: 1, height: 0.15 })).toBeCloseTo(0.5)
    expect(verticalOverlap({ left: 0, top: 0.5, width: 1, height: 0.1 }, { left: 0, top: 0, width: 1, height: 0.2 })).toBe(0)
  })
})

describe('areaHits', () => {
  const zone = { left: 0.1, top: 0.1, width: 0.5, height: 0.2 }

  it('rend une liste vide pour une zone dégénérée', () => {
    expect(areaHits([span('a', 0.2, 0.15)], { left: 0, top: 0, width: 0, height: 0.5 })).toEqual([])
    expect(areaHits([span('a', 0.2, 0.15)], { left: 0, top: 0, width: 0.5, height: 0 })).toEqual([])
  })

  it('retient ce qui est dedans et écarte ce qui est ailleurs', () => {
    const lignes = areaHits([span('dedans', 0.2, 0.15), span('trop bas', 0.2, 0.8), span('à gauche', 0.0, 0.15, 0.05)], zone)
    expect(lignes.flat().map((h) => h.span.text)).toEqual(['dedans'])
  })

  // LE réglage qui décide si l'outil paraît précis : une ligne seulement effleurée par
  // le bord de la zone ne doit PAS entrer dans la sélection.
  it('écarte une ligne à peine effleurée par le bord', () => {
    // Span 0.28→0.32 ; zone s'arrête à 0.30 → 50 % recouvert, retenu.
    expect(areaHits([span('moitié', 0.2, 0.28)], zone).flat()).toHaveLength(1)
    // Span 0.29→0.33 ; zone s'arrête à 0.30 → 25 % recouvert, écarté.
    expect(areaHits([span('effleuré', 0.2, 0.29)], zone).flat()).toHaveLength(0)
  })

  it('retient un span à cheval sur le bord DROIT — il sera découpé, pas rejeté', () => {
    const lignes = areaHits([span('à cheval', 0.55, 0.15, 0.3)], zone)
    expect(lignes.flat().map((h) => h.span.text)).toEqual(['à cheval'])
  })

  it('groupe par ligne et ordonne en lecture', () => {
    const lignes = areaHits(
      [
        span('monde', 0.35, 0.15),
        span('bonjour', 0.15, 0.15),
        span('deuxième', 0.15, 0.24),
      ],
      zone,
    )
    expect(lignes.map((l) => l.map((h) => h.span.text))).toEqual([['bonjour', 'monde'], ['deuxième']])
  })

  it('tolère un léger décalage vertical dans une même ligne (exposant, police mêlée)', () => {
    const lignes = areaHits(
      [span('texte', 0.15, 0.15, 0.2, 0.04), span('2', 0.36, 0.142, 0.02, 0.02)],
      zone,
    )
    expect(lignes).toHaveLength(1)
    expect(lignes[0].map((h) => h.span.text)).toEqual(['texte', '2'])
  })

  it('ne fusionne pas deux lignes serrées', () => {
    const lignes = areaHits([span('haut', 0.15, 0.12, 0.2, 0.03), span('bas', 0.15, 0.16, 0.2, 0.03)], zone)
    expect(lignes).toHaveLength(2)
  })
})

describe('joinAreaText', () => {
  it('sépare les lignes par un retour', () => {
    expect(joinAreaText([['une'], ['deux']])).toBe('une\ndeux')
  })

  // Un PDF découpe volontiers un mot en plusieurs spans : insérer un espace
  // systématiquement casserait les mots.
  it('n’ajoute un espace que s’il en manque un', () => {
    expect(joinAreaText([['bon', 'jour']])).toBe('bon jour')
    expect(joinAreaText([['bon ', 'jour']])).toBe('bon jour')
    expect(joinAreaText([['bon', ' jour']])).toBe('bon jour')
  })

  it('normalise les espaces et jette les lignes vides', () => {
    expect(joinAreaText([['  trop   d’espaces  '], ['   '], ['fin']])).toBe('trop d’espaces\nfin')
  })

  it('rend une chaîne vide quand il n’y a rien', () => {
    expect(joinAreaText([])).toBe('')
    expect(joinAreaText([[''], ['  ']])).toBe('')
  })
})
