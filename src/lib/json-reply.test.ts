import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './json-reply'

describe('extractJsonObject', () => {
  it('lit un objet nu', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('retire les clôtures de bloc de code', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('traverse le bavardage avant ET après — c’est sa raison d’être', () => {
    // Un modèle sommé de « répondre uniquement en JSON » enrobe quand même. Refuser
    // ces réponses ferait échouer la fonction pour une politesse.
    expect(extractJsonObject('Bien sûr ! {"a":1} — dites-moi si cela convient.')).toEqual({ a: 1 })
  })

  it('garde les objets imbriqués entiers (première `{` → dernière `}`)', () => {
    expect(extractJsonObject('{"a":{"b":[1,2]},"c":"}"}')).toEqual({ a: { b: [1, 2] }, c: '}' })
  })

  it('rend null plutôt que de jeter, sur toutes les formes d’échec', () => {
    // Aucun chemin de génération ne doit casser sur une réponse malformée.
    expect(extractJsonObject('pas du json')).toBeNull()
    expect(extractJsonObject('')).toBeNull()
    expect(extractJsonObject('{ceci n’est pas du json}')).toBeNull()
    expect(extractJsonObject('}{')).toBeNull()
  })
})
