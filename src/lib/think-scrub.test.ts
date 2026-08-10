// Scrubber de blocs de raisonnement streames (fournisseurs cloud type MiniMax M-series).
import { describe, expect, it } from 'vitest'
import { ThinkScrubber } from './think-scrub'

function run(deltas: string[]): string {
  const s = new ThinkScrubber()
  let out = ''
  for (const d of deltas) out += s.push(d)
  return out + s.flush()
}

describe('ThinkScrubber', () => {
  it('supprime un bloc entier arrive en un seul delta', () => {
    expect(run(['<think>je reflechis</think>La reponse.'])).toBe('La reponse.')
  })

  it('supprime un bloc coupe entre plusieurs deltas (balises fragmentees)', () => {
    expect(run(['<thi', 'nk>je ref', 'lechis</th', 'ink>La ', 'reponse.'])).toBe('La reponse.')
  })

  it('supprime des blocs enchaines en tete, espaces compris', () => {
    expect(run(['  <think>a</think>\n<thinking>b</thinking>\nOui.'])).toBe('Oui.')
  })

  it('ne touche pas un texte qui MENTIONNE la balise plus loin', () => {
    const text = 'Utilisez des balises <think> dans vos prompts.'
    expect(run([text])).toBe(text)
  })

  it('rend le prefixe ambigu retenu si le flux se termine dessus', () => {
    expect(run(['<thi'])).toBe('<thi')
  })

  it('un vrai texte commencant par < passe tel quel', () => {
    expect(run(['<div> nest pas une pensee'])).toBe('<div> nest pas une pensee')
  })

  it('reponse entierement dans un bloc non ferme -> vide (traitee en echec par l appelant)', () => {
    expect(run(['<think>je reflechis pour toujours'])).toBe('')
  })

  it('flux sans aucun bloc : identite', () => {
    expect(run(['Bonjour', ' monde.'])).toBe('Bonjour monde.')
  })

  it('insensible a la casse des balises', () => {
    expect(run(['<Think>a</THINK>Voila.'])).toBe('Voila.')
  })
})
