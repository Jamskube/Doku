import { describe, expect, it } from 'vitest'
import { frenchNumber, isNoiseReply, speakableSentences, stripForSpeech, verbalizeNumbers } from './voice-text'

describe('frenchNumber', () => {
  it.each([
    [0, 'zéro'], [1, 'un'], [16, 'seize'], [17, 'dix-sept'], [21, 'vingt et un'], [22, 'vingt-deux'],
    [70, 'soixante-dix'], [71, 'soixante et onze'], [77, 'soixante-dix-sept'], [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'], [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'], [100, 'cent'],
    [101, 'cent un'], [200, 'deux cents'], [212, 'deux cent douze'], [1000, 'mille'], [1001, 'mille un'],
    [2026, 'deux mille vingt-six'], [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'],
    [14320, 'quatorze mille trois cent vingt'], [1000000, 'un million'], [2500000, 'deux millions cinq cent mille'],
    [3000000000, 'trois milliards'],
  ])('%i → %s', (n, words) => expect(frenchNumber(n)).toBe(words))
})

describe('verbalizeNumbers', () => {
  it('la phrase qui sortait en bouillie au spike', () => {
    expect(verbalizeNumbers('Le rendez-vous est fixé au mardi 14 octobre 2026 à 9 h 30, salle 212.')).toBe(
      'Le rendez-vous est fixé au mardi quatorze octobre deux mille vingt-six à neuf heures trente, salle deux cent douze.',
    )
  })
  it('milliers séparés, euros, pourcentages décimaux', () => {
    expect(verbalizeNumbers('Le budget total s’élève à 14 320 euros, soit 4,5 % de plus.')).toBe(
      'Le budget total s’élève à quatorze mille trois cent vingt euros, soit quatre virgule cinq pour cent de plus.',
    )
    expect(verbalizeNumbers('Coût : 42 000 € ou 1 €.')).toBe('Coût : quarante-deux mille euros ou un euro.')
  })
  it('heures, ordinaux, décimales à zéro de tête', () => {
    expect(verbalizeNumbers('Rendez-vous à 1 h, puis 14:05.')).toBe('Rendez-vous à une heure, puis quatorze heures cinq.')
    expect(verbalizeNumbers('Le 1er et le 2e étage, la 1re fois.')).toBe('Le premier et le deuxième étage, la première fois.')
    expect(verbalizeNumbers('Un écart de 0,05.')).toBe('Un écart de zéro virgule zéro cinq.')
  })
})

describe('stripForSpeech', () => {
  it('retire Markdown, liens, code et numéros d’extraits', () => {
    const md = '## Titre\n- **Point** important [1]\n> cité [2, 3]\nVoir [la doc](https://x.y) et `code`.\n```js\nconst a = 1\n```'
    expect(stripForSpeech(md).split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
      'Titre', 'Point important', 'cité', 'Voir la doc et code.',
    ])
  })
})

describe('isNoiseReply (transcriptions du banc radio du 27/11)', () => {
  const REFUSAL = 'Je ne trouve pas cette information dans ce document.'
  it('« pas compris », écho exact et refus sans question = bruit', () => {
    expect(isNoiseReply('Amen.', 'Pardon, je n’ai pas compris.', REFUSAL)).toBe(true)
    expect(isNoiseReply('Amen.', "Je n'ai pas bien compris, peux-tu répéter ?", REFUSAL)).toBe(true)
    expect(isNoiseReply('Ensemble.', 'Ensemble.', REFUSAL)).toBe(true)
    expect(isNoiseReply('Ensemble.', '« Ensemble. »', REFUSAL)).toBe(true)
    expect(isNoiseReply("L'un des points principaux, c'est l'ouverture de 132 possibilités.", "L'un des points principaux, c'est l'ouverture de 132 possibilités. [1]", REFUSAL)).toBe(true)
    expect(isNoiseReply('Oh, 15 ans.', REFUSAL, REFUSAL)).toBe(true)
  })
  it('une vraie réponse, ou un refus à une vraie question, est gardée', () => {
    expect(isNoiseReply('Bonjour Doku-San, de quoi parle ce document ?', 'Ce document parle d’une note vide.', REFUSAL)).toBe(false)
    expect(isNoiseReply('Ça va ?', 'Oui, ça va, merci !', REFUSAL)).toBe(false)
    expect(isNoiseReply('Quel est le numéro de Camille ?', REFUSAL, REFUSAL)).toBe(false)  })
})

describe('speakableSentences', () => {
  it('une phrase par requête, lignes de liste closes, fragments courts rattachés', () => {
    expect(speakableSentences('Voici le plan. Oui.\n- Lancement le 14 mars 2027\n- Budget : 42 000 €')).toEqual([
      'Voici le plan. Oui.',
      'Lancement le quatorze mars deux mille vingt-sept.',
      'Budget : quarante-deux mille euros.',
    ])
  })
  it('pas d’espace orpheline là où était un numéro d’extrait', () => {
    expect(speakableSentences('Salle 212 [1].')).toEqual(['Salle deux cent douze.'])
  })
  it('rien à dire → aucune phrase', () => {
    expect(speakableSentences('```\ncode\n```\n[1]')).toEqual([])
  })
})
